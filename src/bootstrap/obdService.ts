// Facciata OBD per la UI (SPEC 5 e 6.3.5). La UI non puo' importare src/obd: passa da qui, tramite '@/bootstrap'.
// Cosa fa: apre la modalita' DEMO con l'auto simulata (SimulatedTransport e' TypeScript puro: va bene su web e su
// telefono), legge uno snapshot, il report di capacita' e i dati live ad auto ferma, e tiene lo stato di connessione
// osservabile. Cosa NON fa: nessuna scrittura sul database (le tabelle obd_sessions/dtc_events non hanno ancora
// casi d'uso) e nessuna cancellazione dei codici: l'OBD e' in SOLA LETTURA e qui non esiste nemmeno il metodo.
// Il collegamento a un adattatore Bluetooth reale NON e' ancora attivo (serve la versione di prova dell'app).
import type { Clock, ObdTransport } from '@/domain/ports';
import {
  ObdConnection,
  ObdLinkLostError,
  type CapabilityReport,
  type InitFailure,
  type InitFailureCode,
  type InitHint,
  type InitOptions,
  type InitStep,
  type LiveHandle,
  type LiveOptions,
  type LivePlanItem,
  type LiveSample,
  type LiveStopReason,
  type Snapshot,
  type VehicleService,
  type VehicleServiceOptions,
} from '@/obd/session';
import type { ElmSessionOptions } from '@/obd/session/ElmSession';
import { SimulatedTransport, type SimulatedTransportOptions } from '@/obd/transport/SimulatedTransport';
import type { ScenarioId } from '@/obd/transport/simulator/scenarios';

// ----------------------------------------------------------------------------- tipi pubblici

/** Scenari che la UI puo' scegliere in modalita' demo. */
export type DemoScenario = Extract<ScenarioId, 'petrol' | 'mil-on' | 'ignition-off'>;
export const DEMO_SCENARIOS: readonly DemoScenario[] = ['petrol', 'mil-on', 'ignition-off'];

export type ObdPhase = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'failed' | 'closed';

/** Passo dell'inizializzazione dell'adattatore (la UI lo traduce in italiano). */
export type ObdConnectStep = InitStep;

/** Passo della lettura (capacita' e snapshot). */
export type ObdReadStep = 'capabilities' | 'vin' | 'status' | 'dtc' | 'freeze' | 'data' | 'voltage';

export type ObdFailureCode = InitFailureCode | 'NOT_CONNECTED' | 'READ_FAILED';

export interface ObdFailure {
  code: ObdFailureCode;
  /** Che cosa deve fare l'utente (la UI sceglie il testo). */
  hint: InitHint;
  retryable: boolean;
}

export interface ObdState {
  phase: ObdPhase;
  /** Collegato (o in collegamento) all'auto simulata. */
  demo: boolean;
  scenario: DemoScenario | null;
  connectStep: ObdConnectStep | null;
  readStep: ObdReadStep | null;
  failure: ObdFailure | null;
  live: boolean;
  /** Dopo il collegamento: nome del protocollo trovato (es. "ISO 15765-4 CAN (11 bit, 500 kbaud)"). */
  protocolName: string | null;
}

export type ObdResult<T> = { ok: true; value: T } | { ok: false; error: ObdFailure };

export interface StartLiveOptions {
  /** Cicli al secondo (default 2: frequenza moderata, a auto ferma basta). */
  hz?: number;
  onStop?: (reason: LiveStopReason) => void;
}

export interface ObdService {
  /** Stato corrente: stesso oggetto finche' non cambia (adatto a useSyncExternalStore). */
  getState(): ObdState;
  subscribe(listener: (state: ObdState) => void): () => void;
  /** Collega l'auto simulata. Chiude un eventuale collegamento precedente. */
  openDemo(scenario?: DemoScenario): Promise<ObdResult<void>>;
  /** Cosa risponde davvero l'auto (dichiarato e risposto). Messo in cache finche' dura il collegamento. */
  capabilities(opts?: { refresh?: boolean }): Promise<ObdResult<CapabilityReport>>;
  /** Fotografia diagnostica: VIN, spia, codici, freeze frame, valori chiave, tensione. Solo lettura. */
  snapshot(): Promise<ObdResult<Snapshot>>;
  /** Ultimo snapshot/report letti in questo collegamento (per cambiare schermata senza rileggere). */
  lastSnapshot(): Snapshot | null;
  lastCapabilities(): CapabilityReport | null;
  /** Dati live ad auto ferma (giri, temperatura, tensione). Un solo flusso alla volta. */
  startLive(onSample: (sample: LiveSample) => void, opts?: StartLiveOptions): Promise<ObdResult<void>>;
  stopLive(): Promise<void>;
  /** Scollega e torna allo stato iniziale. */
  close(): Promise<void>;
}

export interface ObdServiceOptions {
  clock?: Pick<Clock, 'nowIso'>;
  /** Trasporto demo (default: SimulatedTransport con ritardi realistici). Serve ai test. */
  createDemoTransport?: (scenario: DemoScenario) => ObdTransport;
  /** Solo per i test: sessione, init e VehicleService piu' veloci. */
  session?: ElmSessionOptions;
  init?: InitOptions;
  vehicle?: VehicleServiceOptions;
}

// ----------------------------------------------------------------------------- dettagli

/** Piano live ad auto ferma: giri a ogni ciclo, temperatura liquido, tensione del modulo e dell'adattatore. */
export const STATIONARY_LIVE_PLAN: readonly LivePlanItem[] = [
  { pid: 0x0c, every: 1 },
  { pid: 0x05, every: 2 },
  { pid: 0x42, every: 4 },
  { pid: 'adapter-voltage', every: 4 },
];

const DEFAULT_LIVE_HZ = 2;

/** Ritardi della demo: abbastanza lunghi da vedere l'avanzamento, abbastanza corti da non annoiare. */
const DEMO_SIMULATOR: Omit<SimulatedTransportOptions, 'scenario'> = { searchDelayMs: 1200, latencyMs: 20, chunkDelayMs: 0 };

const IDLE: ObdState = {
  phase: 'idle',
  demo: false,
  scenario: null,
  connectStep: null,
  readStep: null,
  failure: null,
  live: false,
  protocolName: null,
};

/** I passi che VehicleService comunica a parole (italiano) diventano codici: i testi li decide la UI. */
const READ_STEPS: Readonly<Record<string, ObdReadStep>> = {
  'Lettura dei PID dichiarati': 'capabilities',
  'Prova dei dati': 'capabilities',
  'Prova di VIN, spia e codici': 'capabilities',
  VIN: 'vin',
  'Spia motore e monitor': 'status',
  'Codici guasto': 'dtc',
  'Freeze frame': 'freeze',
  'Dati del motore': 'data',
  Tensione: 'voltage',
};

const failureOf = (code: ObdFailureCode, hint: InitHint, retryable = true): ObdFailure => ({ code, hint, retryable });
const fromInit = (f: InitFailure): ObdFailure => failureOf(f.code, f.hint, f.retryable);
const notConnected = (): { ok: false; error: ObdFailure } => ({ ok: false, error: failureOf('NOT_CONNECTED', 'retry') });

export function createObdService(opts: ObdServiceOptions = {}): ObdService {
  const clock = opts.clock;
  let state: ObdState = IDLE;
  let conn: ObdConnection | null = null;
  let live: LiveHandle | null = null;
  let capabilities: CapabilityReport | null = null;
  let snapshot: Snapshot | null = null;
  /** Letture in corso: due richieste uguali insieme (o il doppio effetto di React in sviluppo) ne condividono una. */
  let capabilitiesRun: Promise<ObdResult<CapabilityReport>> | null = null;
  let snapshotRun: Promise<ObdResult<Snapshot>> | null = null;
  /** Numero del collegamento corrente: scarta gli eventi di un collegamento ormai chiuso. */
  let generation = 0;
  /**
   * Cresce a ogni caduta del collegamento (reconnecting / failed / closed): una lettura iniziata prima di una
   * caduta non va messa in cache ne' restituita come valida, anche se nel frattempo il link e' tornato su.
   */
  let linkEpoch = 0;
  const listeners = new Set<(s: ObdState) => void>();

  const set = (patch: Partial<ObdState>): void => {
    state = { ...state, ...patch };
    for (const fn of Array.from(listeners)) {
      try {
        fn(state);
      } catch {
        // un ascoltatore difettoso non ferma gli altri
      }
    }
  };

  const demoTransport = (scenario: DemoScenario): ObdTransport =>
    opts.createDemoTransport ? opts.createDemoTransport(scenario) : new SimulatedTransport({ ...DEMO_SIMULATOR, scenario });

  const stopLive = async (): Promise<void> => {
    const handle = live;
    live = null;
    if (!handle) return;
    try {
      await handle.stop();
    } catch {
      // gia' fermo
    }
    if (state.live) set({ live: false });
  };

  /** Il collegamento e' caduto o e' stato richiuso: le letture in cache non valgono piu'. */
  const linkDown = (): void => {
    linkEpoch++;
    capabilities = null;
    snapshot = null;
    void stopLive();
  };

  const dropConnection = async (): Promise<void> => {
    await stopLive();
    const c = conn;
    conn = null;
    capabilities = null;
    snapshot = null;
    generation++;
    if (c) await c.close().catch(() => undefined);
  };

  const ready = (): { ok: true; value: VehicleService } | { ok: false; error: ObdFailure } => {
    const vehicle = conn?.vehicle ?? null;
    if (!conn || conn.state !== 'ready' || !vehicle) return notConnected();
    return { ok: true, value: vehicle };
  };

  const readCapabilities = async (refresh: boolean): Promise<ObdResult<CapabilityReport>> => {
    const r = ready();
    if (!r.ok) return r;
    if (capabilities && !refresh) return { ok: true, value: capabilities };
    const mine = generation;
    const epoch = linkEpoch;
    try {
      set({ readStep: 'capabilities' });
      const report = await r.value.discoverCapabilities({
        onProgress: (s) => {
          if (generation === mine) set({ readStep: READ_STEPS[s] ?? 'capabilities' });
        },
      });
      if (generation !== mine || linkEpoch !== epoch) return notConnected();
      capabilities = report;
      return { ok: true, value: report };
    } catch (e) {
      if (e instanceof ObdLinkLostError || generation !== mine || linkEpoch !== epoch) return notConnected();
      return { ok: false, error: failureOf('READ_FAILED', 'retry') };
    } finally {
      if (generation === mine) set({ readStep: null });
    }
  };

  const readSnapshot = async (): Promise<ObdResult<Snapshot>> => {
    await stopLive();
    const caps = await readCapabilities(false);
    if (!caps.ok) return caps;
    const r = ready();
    if (!r.ok) return r;
    const mine = generation;
    const epoch = linkEpoch;
    try {
      const snap = await r.value.readSnapshot({
        capabilities: caps.value,
        onProgress: (s) => {
          if (generation === mine) set({ readStep: READ_STEPS[s] ?? 'data' });
        },
      });
      if (generation !== mine || linkEpoch !== epoch) return notConnected();
      snapshot = snap;
      return { ok: true, value: snap };
    } catch {
      if (generation !== mine || linkEpoch !== epoch) return notConnected();
      return { ok: false, error: failureOf('READ_FAILED', 'retry') };
    } finally {
      if (generation === mine) set({ readStep: null });
    }
  };

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async openDemo(scenario = 'petrol') {
      await dropConnection();
      const mine = generation;
      set({ ...IDLE, phase: 'connecting', demo: true, scenario });
      const connection = new ObdConnection({
        transport: demoTransport(scenario),
        ...(clock ? { clock } : {}),
        ...(opts.session ? { session: opts.session } : {}),
        init: {
          ...opts.init,
          onProgress: (p) => {
            if (generation === mine) set({ connectStep: p.step });
          },
        },
        ...(opts.vehicle ? { vehicle: opts.vehicle } : {}),
      });
      conn = connection;
      connection.onState((s, detail) => {
        if (generation !== mine || conn !== connection) return;
        if (s === 'reconnecting') {
          linkDown();
          set({ phase: 'reconnecting' });
        } else if (s === 'closed') {
          linkDown();
          set({ phase: 'closed' });
        } else if (s === 'failed' && state.phase === 'reconnecting') {
          // L'init di recupero (dopo una riconnessione o un reset dell'adattatore) e' fallito, es. quadro spento.
          linkDown();
          const error = detail ?? connection.failure;
          set({ phase: 'failed', failure: error ? fromInit(error) : failureOf('DISCONNECTED', 'retry'), connectStep: null, readStep: null });
        } else if (s === 'ready' && (state.phase === 'reconnecting' || state.phase === 'failed')) {
          set({ phase: 'ready', failure: null, connectStep: null, protocolName: connection.init?.protocolName ?? state.protocolName });
        }
      });

      let result: Awaited<ReturnType<ObdConnection['open']>> | null;
      try {
        result = await connection.open();
      } catch {
        result = null;
      }
      // annullato nel frattempo (close() o un nuovo openDemo): lo stato lo ha gia' deciso chi ha annullato
      if (generation !== mine || conn !== connection) return { ok: false, error: failureOf('DISCONNECTED', 'retry') };
      if (!result || !result.ok) {
        const error = result ? fromInit(result.error) : failureOf('DISCONNECTED', 'retry');
        conn = null;
        generation++;
        await connection.close().catch(() => undefined);
        set({ phase: 'failed', failure: error, connectStep: null });
        return { ok: false, error };
      }
      set({ phase: 'ready', connectStep: null, failure: null, protocolName: result.value.protocolName });
      return { ok: true, value: undefined };
    },

    capabilities(o = {}) {
      capabilitiesRun ??= readCapabilities(o.refresh === true).finally(() => {
        capabilitiesRun = null;
      });
      return capabilitiesRun;
    },

    snapshot() {
      snapshotRun ??= readSnapshot().finally(() => {
        snapshotRun = null;
      });
      return snapshotRun;
    },

    lastSnapshot: () => snapshot,
    lastCapabilities: () => capabilities,

    async startLive(onSample, o = {}) {
      const r = ready();
      if (!r.ok) return r;
      await stopLive();
      const mine = generation;
      const liveOptions: LiveOptions = {
        plan: STATIONARY_LIVE_PLAN,
        hz: o.hz ?? DEFAULT_LIVE_HZ,
        onSample: (sample) => {
          if (generation === mine) onSample(sample);
        },
        onStop: (reason) => {
          if (generation !== mine) return;
          live = null;
          if (state.live) set({ live: false });
          o.onStop?.(reason);
        },
      };
      live = r.value.liveStream(liveOptions);
      set({ live: true });
      return { ok: true, value: undefined };
    },

    stopLive,

    async close() {
      await dropConnection();
      set({ ...IDLE });
    },
  };
}

// ----------------------------------------------------------------------------- tipi che la UI deve mostrare
// Solo tipi: la UI li importa da '@/bootstrap' e non vede mai src/obd.
export type {
  CapabilityReport,
  ChecklistItem,
  DtcSection,
  LiveSample,
  LiveStopReason,
  PidCapability,
  Provenance,
  Reading,
  SectionStatus,
  ServiceProbe,
  Snapshot,
} from '@/obd/session';
export type { DecodedPid, FreezeFrame, Mode01Status, MonitorStatus } from '@/obd/protocol';
