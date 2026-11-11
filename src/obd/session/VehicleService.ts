// VehicleService (SPEC 8.7): casi d'uso di lettura sopra ElmSession. SOLO lettura: nessun comando di
// scrittura e nessun Mode 04 nell'MVP (la sessione li blocca comunque).
//   readSnapshot  VIN, spia, monitor, codici (memorizzati/pendenti/permanenti), freeze frame, PID chiave, tensione
//   discoverCapabilities  cosa risponde davvero (dichiarato E risposto)
//   liveStream  4-8 Hz con PID scaglionati, multi-PID (solo CAN) opzionale
import type { Clock } from '@/domain/ports';
import {
  buildFreezeFrame,
  combineStatuses,
  isCanProtocol,
  parseDtcResponse,
  parseFreezeFramePidResponse,
  parseMultiPidResponse,
  parsePidResponse,
  parseResponseLines,
  parseStatusResponse,
  parseSupportResponse,
  parseVinResponse,
  pidDef,
  protocolInfo,
  request01,
  request01Multi,
  request02,
  splitByService,
  withoutPointers,
  isUnsupportedNrc,
  obdError,
  PID_SUPPORT_BASES,
  REQ_DTC_PENDING,
  REQ_DTC_PERMANENT,
  REQ_DTC_STORED,
  REQ_VIN,
  hasNextBlock,
  mergeSupport,
  type DecodedPid,
  type DtcMode,
  type DtcResponse,
  type EcuValue,
  type FreezeFrame,
  type FreezeFrameEntry,
  type Mode01Status,
  type ObdError,
  type ParseOptions,
} from '@/obd/protocol';
import { realTimers, type Timers } from '@/obd/transport/types';
import type { ElmResponse, ElmSession, Priority, ResponseStatus, SendOptions } from './ElmSession';
import type { InitResult } from './AdapterInit';
import {
  buildChecklist,
  buildNotes,
  pidCapabilityBase,
  reportAdapterFrom,
  type CapabilityReport,
  type PidCapability,
  type ServiceProbe,
} from './capability';
import { readReading, type Reading } from './provenance';

// ----------------------------------------------------------------------------- tipi

export interface ReadFailure {
  /** 'unsupported' = l'auto non ha quel dato (NO DATA, 7F 11/12/31); 'error' = problema di comunicazione o di formato. */
  kind: 'unsupported' | 'error';
  error: ObdError;
  status: ResponseStatus | 'parse';
}

/**
 * Lanciata da discoverCapabilities quando il collegamento con l'adattatore cade a meta' lettura: un report
 * costruito sulle risposte mancanti sarebbe falso, quindi la lettura fallisce e non va messa in cache.
 */
export class ObdLinkLostError extends Error {
  constructor() {
    super("Collegamento con l'adattatore perso durante la lettura.");
    this.name = 'ObdLinkLostError';
  }
}

export type ReadResult<T> = { ok: true; value: T; ecu?: string; readAt: string } | ({ ok: false } & ReadFailure);

export type SectionStatus = 'ok' | 'unsupported' | 'error' | 'skipped';

export interface DtcSection {
  status: SectionStatus;
  codes: string[];
  byEcu: { ecu: string; codes: string[] }[];
  readAt?: string;
  error?: ObdError;
}

export interface SnapshotIssue {
  step: string;
  error: ObdError;
}

export interface Snapshot {
  readAt: string;
  finishedAt: string;
  vin: Reading<string> | null;
  vinStatus: SectionStatus | 'invalid';
  status: Reading<Mode01Status> | null;
  dtc: { stored: DtcSection; pending: DtcSection; permanent: DtcSection };
  freezeFrame: Reading<FreezeFrame> | null;
  freezeFrameStatus: SectionStatus;
  /** Valori dei PID letti, per id (es. 'engine_rpm'). */
  pids: Record<string, Reading<DecodedPid>>;
  /** PID richiesti che l'auto non ha restituito. */
  unsupportedPids: number[];
  adapterVoltage: Reading<number> | null;
  issues: SnapshotIssue[];
}

export interface SnapshotOptions {
  /** Report di capacita' gia' calcolato (cache per VIN): evita di richiedere cio' che l'auto non ha. */
  capabilities?: CapabilityReport;
  /** PID da leggere (default: PID chiave dichiarati dall'auto). */
  pids?: readonly number[];
  skipVin?: boolean;
  skipFreezeFrame?: boolean;
  onProgress?: (step: string) => void;
}

export interface CapabilityOptions {
  /** Sonda anche i PID non dichiarati ma utili (livello carburante, odometro...). Default true. */
  probeUndeclared?: boolean;
  onProgress?: (step: string) => void;
}

export interface VehicleServiceOptions {
  clock?: Pick<Clock, 'nowIso'>;
  /** Orologio in ms per le cadenze del live. Default Date.now. */
  now?: () => number;
  timers?: Timers;
  /** Quante volte rispedire una richiesta con risposta 7F xx 78 (response pending). */
  pendingRetries?: number;
  pendingDelayMs?: number;
}

/** PID letti nello snapshot (se dichiarati dall'auto). */
export const SNAPSHOT_PIDS: readonly number[] = [
  0x04, 0x05, 0x0b, 0x0c, 0x0d, 0x0f, 0x10, 0x11, 0x1c, 0x1f, 0x21, 0x2f, 0x31, 0x33, 0x42, 0x46, 0x51, 0x5c, 0xa6,
];

/** PID sondati anche se non dichiarati: alcune ECU rispondono senza dichiararli. */
export const PROBE_UNDECLARED_PIDS: readonly number[] = [0x2f, 0x5c, 0xa6, 0x42, 0x51];

/** PID del freeze frame (Mode 02) letti quando c'e' un codice che l'ha generato. */
export const FREEZE_FRAME_PIDS: readonly number[] = [0x04, 0x05, 0x0b, 0x0c, 0x0d, 0x0f, 0x11];

// ----------------------------------------------------------------------------- live

export interface LivePlanItem {
  /** PID Mode 01, oppure la tensione misurata dall'adattatore (ATRV). */
  pid: number | 'adapter-voltage';
  /** Ogni quanti cicli rileggerlo (1 = ogni ciclo). */
  every: number;
}

/** Piano predefinito: giri e velocita' a ogni ciclo, temperature ogni 10, tensione ogni 20 (SPEC 8.7). */
export const DEFAULT_LIVE_PLAN: readonly LivePlanItem[] = [
  { pid: 0x0c, every: 1 },
  { pid: 0x0d, every: 1 },
  { pid: 0x04, every: 2 },
  { pid: 0x05, every: 10 },
  { pid: 0x2f, every: 20 },
  { pid: 0x42, every: 20 },
  { pid: 'adapter-voltage', every: 20 },
];

export interface LiveSample {
  cycle: number;
  /** Millisecondi dall'avvio dello stream all'inizio del ciclo (a 8 Hz i cicli distano almeno 125 ms). */
  elapsedMs: number;
  readAt: string;
  /** Solo i valori letti in questo ciclo, per id del PID. */
  values: Record<string, Reading<DecodedPid>>;
  adapterVoltage?: Reading<number>;
  /** PID tolti dal piano perche' l'auto non risponde. */
  dropped: number[];
}

export type LiveStopReason = 'stopped' | 'link-lost' | 'no-pids';

export interface LiveOptions {
  plan?: readonly LivePlanItem[];
  /** Cicli al secondo, limitati a 1-8 (default 5). Sui protocolli J1850 il tetto scende a 4. */
  hz?: number;
  /** Raggruppa fino a 6 PID per richiesta (solo CAN). Default false. */
  multiPid?: boolean;
  /** Dopo quanti fallimenti consecutivi un PID esce dal piano. Default 3. */
  maxFailures?: number;
  onSample(sample: LiveSample): void;
  onStop?(reason: LiveStopReason, error?: ObdError): void;
}

export interface LiveHandle {
  stop(): Promise<LiveStopReason>;
  readonly running: boolean;
  readonly done: Promise<LiveStopReason>;
}

// ----------------------------------------------------------------------------- servizio

function sleep(timers: Timers, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) resolve();
    else timers.setTimeout(resolve, ms);
  });
}

export class VehicleService {
  private readonly session: ElmSession;
  readonly init: InitResult;
  private readonly clock: Pick<Clock, 'nowIso'>;
  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly pendingRetries: number;
  private readonly pendingDelayMs: number;
  private readonly parseOpts: ParseOptions;
  private support: { byEcu: Record<string, number[]>; union: number[] } | null = null;

  constructor(session: ElmSession, init: InitResult, opts: VehicleServiceOptions = {}) {
    this.session = session;
    this.init = init;
    this.clock = opts.clock ?? { nowIso: () => new Date().toISOString() };
    this.now = opts.now ?? (() => Date.now());
    this.timers = opts.timers ?? realTimers;
    this.pendingRetries = opts.pendingRetries ?? 6;
    this.pendingDelayMs = opts.pendingDelayMs ?? 300;
    this.parseOpts = { protocol: init.protocol === '0' ? undefined : init.protocol, headers: init.headers };
  }

  get isCan(): boolean {
    return isCanProtocol(this.init.protocol);
  }

  // ------------------------------------------------------------------ richieste

  /** Invia e gestisce le risposte negative 'response pending' (7F xx 78): i cloni non le gestiscono da soli. */
  private async ask(cmd: string, opts: SendOptions = {}): Promise<ElmResponse> {
    let resp = await this.session.send(cmd, opts);
    for (let i = 0; i < this.pendingRetries; i++) {
      if (resp.status !== 'ok' || !this.isPending(resp)) break;
      await sleep(this.timers, this.pendingDelayMs);
      resp = await this.session.send(cmd, opts);
    }
    return resp;
  }

  private isPending(resp: ElmResponse): boolean {
    const parsed = parseResponseLines(resp.lines, this.parseOpts);
    if (parsed.messages.length === 0) return false;
    const svc = parseInt(resp.command.replace(/\s+/g, '').slice(0, 2), 16);
    if (!Number.isFinite(svc)) return false;
    const s = splitByService(parsed.messages, svc);
    return s.positive.length === 0 && s.negatives.some((n) => n.error.code === 'RESPONSE_PENDING');
  }

  private failure(resp: ElmResponse, error?: ObdError): ReadFailure {
    const e = error ?? resp.error ?? obdError('EMPTY_RESPONSE');
    const unsupported =
      resp.status === 'no_data' ||
      e.code === 'NO_DATA' ||
      (e.code === 'NEGATIVE_RESPONSE' && isUnsupportedNrc(e.nrc)) ||
      e.code === 'UNEXPECTED_SERVICE' ||
      e.code === 'UNKNOWN_COMMAND';
    return { kind: unsupported ? 'unsupported' : 'error', error: e, status: resp.status === 'ok' ? 'parse' : resp.status };
  }

  /** Primo valore tra le ECU: preferisce chi ha dichiarato il PID, poi l'id piu' basso (motore). */
  private pickPrimary<T>(list: readonly EcuValue<T>[], pid?: number): EcuValue<T> {
    const declared = pid === undefined ? [] : list.filter((x) => (this.init.declaredByEcu[x.ecu] ?? this.support?.byEcu[x.ecu] ?? []).includes(pid));
    const pool = declared.length > 0 ? declared : list;
    return pool.slice().sort((a, b) => (a.ecu < b.ecu ? -1 : a.ecu > b.ecu ? 1 : 0))[0];
  }

  // ------------------------------------------------------------------ letture singole

  async readVin(priority: Priority = 'normal'): Promise<ReadResult<string>> {
    const resp = await this.ask(REQ_VIN, { kind: 'mode09', priority });
    if (resp.status !== 'ok') return { ok: false, ...this.failure(resp) };
    const r = parseVinResponse(resp, this.parseOpts);
    if (!r.ok) return { ok: false, ...this.failure(resp, r.error) };
    return { ok: true, value: r.value.value, ecu: r.value.ecu, readAt: this.clock.nowIso() };
  }

  async readStatus(priority: Priority = 'normal'): Promise<ReadResult<Mode01Status>> {
    const resp = await this.ask(request01(0x01), { kind: 'mode01', priority });
    if (resp.status !== 'ok') return { ok: false, ...this.failure(resp) };
    const r = parseStatusResponse(resp, this.parseOpts);
    if (!r.ok) return { ok: false, ...this.failure(resp, r.error) };
    const combined = combineStatuses(r.value.map((x) => x.value));
    if (!combined) return { ok: false, ...this.failure(resp, obdError('EMPTY_RESPONSE')) };
    return { ok: true, value: combined, ecu: this.pickPrimary(r.value, 0x01).ecu, readAt: this.clock.nowIso() };
  }

  async readDtcs(mode: DtcMode, priority: Priority = 'normal'): Promise<ReadResult<DtcResponse>> {
    const cmd = mode === 0x03 ? REQ_DTC_STORED : mode === 0x07 ? REQ_DTC_PENDING : REQ_DTC_PERMANENT;
    const resp = await this.ask(cmd, { kind: 'mode03', priority });
    if (resp.status !== 'ok') return { ok: false, ...this.failure(resp) };
    const r = parseDtcResponse(resp, mode, this.parseOpts);
    if (!r.ok) return { ok: false, ...this.failure(resp, r.error) };
    return { ok: true, value: r.value, readAt: this.clock.nowIso() };
  }

  async readPid(pid: number, priority: Priority = 'normal', opts: SendOptions = {}): Promise<ReadResult<DecodedPid>> {
    const resp = await this.ask(request01(pid), { kind: 'mode01', priority, ...opts });
    if (resp.status !== 'ok') return { ok: false, ...this.failure(resp) };
    const r = parsePidResponse(resp, pid, this.parseOpts);
    if (!r.ok) return { ok: false, ...this.failure(resp, r.error) };
    const primary = this.pickPrimary(r.value, pid);
    return { ok: true, value: primary.value, ecu: primary.ecu, readAt: this.clock.nowIso() };
  }

  /** Tensione al pin 16 misurata dall'adattatore (ATRV). */
  async readAdapterVoltage(priority: Priority = 'normal'): Promise<ReadResult<number>> {
    const resp = await this.session.send('ATRV', { kind: 'config', priority, retries: 0 });
    if (resp.status !== 'ok') return { ok: false, ...this.failure(resp) };
    const m = /(\d{1,2}(?:[.,]\d{1,2})?)\s*V/i.exec(resp.lines.join(' '));
    if (!m) return { ok: false, ...this.failure(resp, obdError('NOT_AVAILABLE', 'ATRV')) };
    return { ok: true, value: Number(m[1].replace(',', '.')), readAt: this.clock.nowIso() };
  }

  /**
   * Freeze frame (Mode 02): si legge il codice che l'ha generato (PID 02); se esiste si leggono i PID di
   * contesto. Va letto PRIMA di qualsiasi cancellazione. Restituisce null se non c'e' freeze frame.
   */
  async readFreezeFrame(priority: Priority = 'normal'): Promise<ReadResult<FreezeFrame | null>> {
    const first = await this.ask(request02(0x02), { kind: 'mode02', priority });
    if (first.status !== 'ok') return { ok: false, ...this.failure(first) };
    const pr = parseFreezeFramePidResponse(first, 0x02, this.parseOpts);
    if (!pr.ok) return { ok: false, ...this.failure(first, pr.error) };
    const entries: FreezeFrameEntry[] = [pr.value.value];
    if (pr.value.value.dtc == null) {
      return { ok: true, value: null, ecu: pr.value.ecu, readAt: this.clock.nowIso() };
    }
    for (const pid of FREEZE_FRAME_PIDS) {
      const resp = await this.ask(request02(pid), { kind: 'mode02', priority, retries: 0 });
      if (resp.status !== 'ok') continue;
      const r = parseFreezeFramePidResponse(resp, pid, this.parseOpts);
      if (r.ok) entries.push(r.value.value);
    }
    return { ok: true, value: buildFreezeFrame(entries), ecu: pr.value.ecu, readAt: this.clock.nowIso() };
  }

  // ------------------------------------------------------------------ supporto PID

  /**
   * Bitmask dichiarate dalle ECU: 0100 (gia' letto dall'init) e i blocchi successivi solo se il bit
   * 'puntatore' e' attivo. Il risultato e' memorizzato nel servizio.
   */
  async discoverSupport(): Promise<{ byEcu: Record<string, number[]>; union: number[] }> {
    if (this.support) return this.support;
    const byEcu: Record<string, number[]> = {};
    for (const [ecu, pids] of Object.entries(this.init.declaredByEcu)) byEcu[ecu] = pids.slice();
    let union = mergeSupport(Object.values(byEcu));
    let base = 0x00;
    while (hasNextBlock(base, union) && base < PID_SUPPORT_BASES[PID_SUPPORT_BASES.length - 1]) {
      base += 0x20;
      const resp = await this.ask(request01(base), { kind: 'mode01', priority: 'normal', retryNoData: 0 });
      if (resp.status !== 'ok') break;
      const r = parseSupportResponse(resp, base, 0x01, this.parseOpts);
      if (!r.ok) break;
      for (const [ecu, pids] of Object.entries(r.value.byEcu)) byEcu[ecu] = mergeSupport([byEcu[ecu] ?? [], pids]);
      union = mergeSupport(Object.values(byEcu));
    }
    this.support = { byEcu, union };
    return this.support;
  }

  // ------------------------------------------------------------------ report di capacita'

  /** Se la lettura e' fallita perche' il collegamento e' caduto (DISCONNECTED / WRITE_FAILED) interrompe tutto. */
  private assertLinkUp<T extends ReadResult<unknown>>(r: T): T {
    if (!r.ok && (r.error.code === 'DISCONNECTED' || r.error.code === 'WRITE_FAILED')) throw new ObdLinkLostError();
    return r;
  }

  /** Cosa risponde davvero l'auto: dichiarato E risposto almeno una volta. */
  async discoverCapabilities(opts: CapabilityOptions = {}): Promise<CapabilityReport> {
    const progress = (s: string) => opts.onProgress?.(s);
    progress('Lettura dei PID dichiarati');
    const support = await this.discoverSupport();
    const declaredData = withoutPointers(support.union);
    const declaredSet = new Set(declaredData);

    const toProbe = new Set<number>();
    for (const pid of SNAPSHOT_PIDS) if (declaredSet.has(pid)) toProbe.add(pid);
    if (opts.probeUndeclared !== false) for (const pid of PROBE_UNDECLARED_PIDS) toProbe.add(pid);

    const pids: PidCapability[] = [];
    progress('Prova dei dati');
    for (const pid of Array.from(toProbe).sort((a, b) => a - b)) {
      const base = pidCapabilityBase(pid);
      const declared = declaredSet.has(pid);
      let r = await this.readPid(pid, 'normal', { retries: 0, retryNoData: 0 });
      this.assertLinkUp(r);
      // Un errore di COMUNICAZIONE (BUS BUSY, DATA ERROR, timeout, risposta danneggiata) non dice nulla sul
      // supporto del PID: si ritenta (una volta con i retry della sessione); solo NO DATA / risposta negativa
      // ('unsupported') dicono che l'auto non lo ha.
      if (!r.ok && r.kind === 'error') {
        r = await this.readPid(pid, 'normal', { retries: 1, retryNoData: 0 });
        this.assertLinkUp(r);
      }
      const cap: PidCapability = { ...base, declared, answered: r.ok, supported: declared && r.ok };
      if (r.ok) {
        cap.ecu = r.ecu;
        cap.sample = r.value.value;
      } else if (r.kind === 'error') {
        cap.unverified = true; // non verificato: l'errore di comunicazione persiste, NON e' 'non risponde'
      }
      pids.push(cap);
    }
    // PID dichiarati ma fuori dalla lista di sonda: compaiono come dichiarati (non verificati)
    for (const pid of declaredData) {
      if (!toProbe.has(pid) && pidDef(pid)) pids.push({ ...pidCapabilityBase(pid), declared: true, answered: false, supported: false });
    }

    const probe = (r: ReadResult<unknown>): ServiceProbe => (r.ok ? 'answers' : r.kind === 'unsupported' ? 'no_data' : 'error');
    progress('Prova di VIN, spia e codici');
    const vin = this.assertLinkUp(await this.readVin());
    const status = this.assertLinkUp(await this.readStatus());
    const stored = this.assertLinkUp(await this.readDtcs(0x03));
    const pending = this.assertLinkUp(await this.readDtcs(0x07));
    const permanent = this.assertLinkUp(await this.readDtcs(0x0a));

    let freezeFrame: ServiceProbe = 'untested';
    if (stored.ok && stored.value.all.length > 0) {
      const ff = this.assertLinkUp(await this.readFreezeFrame());
      freezeFrame = probe(ff);
    }

    const report: CapabilityReport = {
      version: 1,
      generatedAt: this.clock.nowIso(),
      protocol: { id: this.init.protocol, name: this.init.protocolName, auto: this.init.protocolAuto, headers: this.init.headers },
      adapter: reportAdapterFrom(this.init),
      ecus: Array.from(new Set([...this.init.ecus, ...Object.keys(support.byEcu)])).sort(),
      declaredByEcu: support.byEcu,
      declared: declaredData,
      pids,
      services: {
        vin: probe(vin),
        status: probe(status),
        dtcStored: probe(stored),
        dtcPending: probe(pending),
        dtcPermanent: probe(permanent),
        freezeFrame,
      },
      checklist: [],
      notes: [],
    };
    report.checklist = buildChecklist(report);
    report.notes = buildNotes(this.init.adapter, report.ecus, pids);
    return report;
  }

  // ------------------------------------------------------------------ snapshot

  private section(r: ReadResult<DtcResponse>): DtcSection {
    if (r.ok) {
      return { status: 'ok', codes: r.value.all, byEcu: r.value.byEcu.map((e) => ({ ecu: e.ecu, codes: e.codes })), readAt: r.readAt };
    }
    return { status: r.kind === 'unsupported' ? 'unsupported' : 'error', codes: [], byEcu: [], error: r.error };
  }

  /**
   * Snapshot diagnostico (F-60): VIN, spia MIL, monitor, codici, freeze frame, PID chiave, tensione.
   * Ogni passo e' tollerante: un errore diventa una voce in `issues`, non interrompe lo snapshot.
   */
  async readSnapshot(opts: SnapshotOptions = {}): Promise<Snapshot> {
    const progress = (s: string) => opts.onProgress?.(s);
    const caps = opts.capabilities;
    const issues: SnapshotIssue[] = [];
    const readAt = this.clock.nowIso();
    const note = (step: string, f: ReadFailure) => {
      if (f.kind === 'error') issues.push({ step, error: f.error });
    };

    // VIN
    let vin: Reading<string> | null = null;
    let vinStatus: Snapshot['vinStatus'] = 'skipped';
    if (!opts.skipVin && caps?.services.vin !== 'no_data') {
      progress('VIN');
      const r = await this.readVin();
      if (r.ok) {
        vin = readReading(r.value, r.readAt, r.ecu);
        vinStatus = 'ok';
      } else {
        vinStatus = r.error.code === 'INVALID_VIN' ? 'invalid' : r.kind === 'unsupported' ? 'unsupported' : 'error';
        note('vin', r);
      }
    }

    // spia e monitor
    progress('Spia motore e monitor');
    let status: Reading<Mode01Status> | null = null;
    const st = await this.readStatus();
    if (st.ok) status = readReading(st.value, st.readAt, st.ecu);
    else note('status', st);

    // codici
    progress('Codici guasto');
    const stored = this.section(await this.readDtcs(0x03));
    const pending = this.section(caps?.services.dtcPending === 'no_data' ? { ok: false, kind: 'unsupported', error: obdError('NO_DATA'), status: 'no_data' } : await this.readDtcs(0x07));
    const permanent = this.section(caps?.services.dtcPermanent === 'no_data' ? { ok: false, kind: 'unsupported', error: obdError('NO_DATA'), status: 'no_data' } : await this.readDtcs(0x0a));
    for (const [name, s] of [['dtc_stored', stored], ['dtc_pending', pending], ['dtc_permanent', permanent]] as const) {
      if (s.status === 'error' && s.error) issues.push({ step: name, error: s.error });
    }

    // freeze frame (prima di qualunque cancellazione)
    let freezeFrame: Reading<FreezeFrame> | null = null;
    let freezeFrameStatus: SectionStatus = 'skipped';
    const hasCodes = stored.codes.length > 0 || pending.codes.length > 0 || (status?.value.dtcCount ?? 0) > 0;
    if (!opts.skipFreezeFrame && hasCodes) {
      progress('Freeze frame');
      const ff = await this.readFreezeFrame();
      if (ff.ok) {
        if (ff.value) {
          freezeFrame = readReading(ff.value, ff.readAt, ff.ecu);
          freezeFrameStatus = 'ok';
        } else {
          freezeFrameStatus = 'unsupported';
        }
      } else {
        freezeFrameStatus = ff.kind === 'unsupported' ? 'unsupported' : 'error';
        note('freeze_frame', ff);
      }
    }

    // PID chiave
    progress('Dati del motore');
    let wanted: readonly number[];
    if (opts.pids) wanted = opts.pids;
    else if (caps) wanted = caps.pids.filter((p) => p.supported || (p.declared && p.unverified)).map((p) => p.pid); // i non verificati si riprovano
    else {
      const support = await this.discoverSupport();
      const declared = new Set(support.union);
      wanted = SNAPSHOT_PIDS.filter((p) => declared.has(p));
    }
    const pids: Record<string, Reading<DecodedPid>> = {};
    const unsupportedPids: number[] = [];
    for (const pid of wanted) {
      const r = await this.readPid(pid, 'normal', { retries: 1, retryNoData: 0 });
      if (r.ok) pids[r.value.id] = readReading(r.value, r.readAt, r.ecu);
      else {
        unsupportedPids.push(pid);
        note(`pid_${pid.toString(16)}`, r);
      }
    }

    // tensione
    progress('Tensione');
    let adapterVoltage: Reading<number> | null = null;
    const v = await this.readAdapterVoltage();
    if (v.ok) adapterVoltage = readReading(v.value, v.readAt);

    return {
      readAt,
      finishedAt: this.clock.nowIso(),
      vin,
      vinStatus,
      status,
      dtc: { stored, pending, permanent },
      freezeFrame,
      freezeFrameStatus,
      pids,
      unsupportedPids,
      adapterVoltage,
      issues,
    };
  }

  // ------------------------------------------------------------------ live

  /**
   * Flusso live a 4-8 Hz con PID scaglionati. Le richieste hanno priorita' 'poll': un comando dell'utente
   * passa avanti. Non persiste nulla. Si ferma con `stop()` o se il collegamento cade.
   */
  liveStream(opts: LiveOptions): LiveHandle {
    const info = protocolInfo(this.init.protocol);
    const j1850 = this.init.protocol === '1' || this.init.protocol === '2';
    const maxHz = j1850 ? 4 : 8; // J1850: richieste piu' frequenti di una ogni 100 ms vietate prima del 2002 (datasheet p.32)
    const hz = Math.min(maxHz, Math.max(1, opts.hz ?? 5));
    const period = 1000 / hz;
    const minGap = j1850 ? 100 : 0;
    const maxFailures = opts.maxFailures ?? 3;
    const multi = opts.multiPid === true && this.isCan && info?.can === true;
    let plan = (opts.plan ?? DEFAULT_LIVE_PLAN).map((p) => ({ ...p, every: Math.max(1, Math.floor(p.every)), failures: 0 }));
    const dropped: number[] = [];
    let stopRequested = false;
    let running = true;
    let reason: LiveStopReason = 'stopped';

    const run = async (): Promise<LiveStopReason> => {
      // solo i PID che l'auto dichiara (o la tensione dell'adattatore)
      const support = await this.discoverSupport();
      const declared = new Set(support.union);
      plan = plan.filter((p) => p.pid === 'adapter-voltage' || declared.has(p.pid));
      if (plan.length === 0) return 'no-pids';

      const startedAt = this.now();
      let cycle = 0;
      while (!stopRequested) {
        const cycleStart = this.now();
        const due = plan.filter((p) => cycle % p.every === 0);
        const values: Record<string, Reading<DecodedPid>> = {};
        let voltage: Reading<number> | undefined;
        const numeric = due.filter((p): p is typeof p & { pid: number } => typeof p.pid === 'number');
        const failedNow = new Set<number>();

        const markFail = (pid: number) => {
          failedNow.add(pid);
          const item = plan.find((p) => p.pid === pid);
          if (item) item.failures++;
        };

        if (multi && numeric.length > 1) {
          for (let i = 0; i < numeric.length && !stopRequested; i += 6) {
            const group = numeric.slice(i, i + 6);
            const resp = await this.session.send(request01Multi(group.map((g) => g.pid)), { kind: 'mode01', priority: 'poll', retries: 0, retryNoData: 0 });
            if (resp.status === 'error' && (resp.error?.code === 'DISCONNECTED' || resp.error?.code === 'WRITE_FAILED')) {
              reason = 'link-lost';
              opts.onStop?.('link-lost', resp.error);
              return reason;
            }
            const got = new Set<number>();
            if (resp.status === 'ok') {
              const r = parseMultiPidResponse(resp, this.parseOpts);
              if (r.ok) {
                for (const ev of r.value) {
                  if (got.has(ev.value.pid)) continue;
                  got.add(ev.value.pid);
                  values[ev.value.id] = readReading(ev.value, this.clock.nowIso(), ev.ecu);
                }
              }
            }
            for (const g of group) {
              if (got.has(g.pid)) {
                const item = plan.find((p) => p.pid === g.pid);
                if (item) item.failures = 0;
              } else markFail(g.pid);
            }
            if (minGap > 0) await sleep(this.timers, minGap);
          }
        } else {
          for (const item of numeric) {
            if (stopRequested) break;
            const r = await this.readPid(item.pid, 'poll', { retries: 0, retryNoData: 0 });
            if (r.ok) {
              values[r.value.id] = readReading(r.value, r.readAt, r.ecu);
              const it = plan.find((p) => p.pid === item.pid);
              if (it) it.failures = 0;
            } else {
              if (r.status === 'error' && (r.error.code === 'DISCONNECTED' || r.error.code === 'WRITE_FAILED')) {
                reason = 'link-lost';
                opts.onStop?.('link-lost', r.error);
                return reason;
              }
              markFail(item.pid);
            }
            if (minGap > 0) await sleep(this.timers, minGap);
          }
        }

        if (due.some((p) => p.pid === 'adapter-voltage') && !stopRequested) {
          const v = await this.readAdapterVoltage('poll');
          if (v.ok) voltage = readReading(v.value, v.readAt);
          else if (v.status === 'error' && (v.error.code === 'DISCONNECTED' || v.error.code === 'WRITE_FAILED')) {
            reason = 'link-lost';
            opts.onStop?.('link-lost', v.error);
            return reason;
          }
        }

        // PID che non rispondono piu': escono dal piano
        const newlyDropped = plan.filter((p) => typeof p.pid === 'number' && p.failures >= maxFailures).map((p) => p.pid as number);
        if (newlyDropped.length > 0) {
          plan = plan.filter((p) => !newlyDropped.includes(p.pid as number));
          dropped.push(...newlyDropped);
        }

        if (!stopRequested) {
          const sample: LiveSample = {
            cycle,
            elapsedMs: cycleStart - startedAt,
            readAt: this.clock.nowIso(),
            values,
            dropped: dropped.slice(),
          };
          if (voltage) sample.adapterVoltage = voltage;
          try {
            opts.onSample(sample);
          } catch {
            // la UI non deve fermare il flusso
          }
        }
        cycle++;
        if (plan.length === 0) return 'no-pids';

        const elapsed = this.now() - cycleStart;
        const wait = Math.max(0, period - elapsed);
        await sleep(this.timers, wait);
      }
      return 'stopped';
    };

    const done: Promise<LiveStopReason> = run()
      .then((r) => {
        running = false;
        if (r !== 'link-lost') opts.onStop?.(r);
        return r;
      })
      .catch(() => {
        running = false;
        opts.onStop?.('link-lost');
        return 'link-lost' as LiveStopReason;
      });

    return {
      stop: () => {
        stopRequested = true;
        return done;
      },
      get running() {
        return running;
      },
      done,
    };
  }
}
