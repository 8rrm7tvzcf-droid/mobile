// Coordinatore della sincronizzazione (data.md 4.7-4.8, SPEC 8.4): mai due sync in parallelo, richieste ravvicinate
// coalescenti (finestra di 1,5 s), al massimo una sync al minuto quando l'app torna in primo piano.
// Tutti i parametri di tempo sono iniettabili: nei test si passa un timer manuale e un orologio fisso.
import type { EventBus } from '@/domain/ports';
import type { NotificationDeps } from '../context';
import { syncNotifications } from './sync';
import type { SyncReport } from './sync';

export const COALESCE_MS = 1500;
export const FOREGROUND_MIN_INTERVAL_MS = 60_000;

/** Perche' si chiede una sincronizzazione (solo informativo: finisce nello stato per la schermata "Verifica notifiche"). */
export type SyncReason =
  | 'startup'
  | 'foreground'
  | 'data-changed'
  | 'settings'
  | 'permission'
  | 'timezone'
  | 'import'
  | 'manual'
  | 'background';

export interface SyncCoordinatorOptions {
  /** Finestra di coalescenza in ms (default 1500). */
  coalesceMs?: number;
  /** Intervallo minimo fra due sync richieste dal ritorno in primo piano (default 60000). */
  foregroundMinIntervalMs?: number;
  /** Timer iniettabili (default: setTimeout/clearTimeout globali). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Eseguito prima di ogni sync (es. `() => reconcileAll(deps)` dall'agente delle scadenze). */
  prepare?: () => Promise<void>;
  /** Sostituisce `syncNotifications(d)` (per i test). */
  run?: () => Promise<SyncReport>;
  /** Chiamato per ogni errore (la sync non lancia mai verso chi la richiede). */
  onError?: (error: unknown) => void;
}

export interface SyncCoordinatorState {
  running: boolean;
  /** Una richiesta e' in attesa della finestra di coalescenza. */
  pending: boolean;
  runs: number;
  lastReason: SyncReason | null;
  /** Istante UTC dell'ultima esecuzione completata o fallita. */
  lastRunAt: string | null;
  lastReport: SyncReport | null;
  lastError: string | null;
}

export interface SyncCoordinator {
  /** Chiede una sync: le richieste entro la finestra diventano UNA esecuzione. Risolve col report (null se fallita o scartata). */
  request(reason?: SyncReason): Promise<SyncReport | null>;
  /** Ritorno in primo piano: come `request`, ma scartata (null) se l'ultima sync e' piu' recente di `foregroundMinIntervalMs`. */
  requestForeground(): Promise<SyncReport | null>;
  /** Esegue subito (senza attendere la finestra): "Ripianifica adesso", ritorno dalle impostazioni di sistema. */
  syncNow(reason?: SyncReason): Promise<SyncReport | null>;
  getState(): SyncCoordinatorState;
  /** Ferma timer e richieste: le promesse in attesa si risolvono con null. */
  dispose(): void;
}

export function createSyncCoordinator(d: NotificationDeps, options: SyncCoordinatorOptions = {}): SyncCoordinator {
  const coalesceMs = options.coalesceMs ?? COALESCE_MS;
  const minForegroundMs = options.foregroundMinIntervalMs ?? FOREGROUND_MIN_INTERVAL_MS;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h: unknown): void => clearTimeout(h as ReturnType<typeof setTimeout>));
  const runSync = options.run ?? ((): Promise<SyncReport> => syncNotifications(d));
  const nowMs = (): number => Date.parse(d.clock.nowIso());

  let timer: unknown = null;
  let looping = false;
  let dirty = false;
  let disposed = false;
  let waiters: ((r: SyncReport | null) => void)[] = [];
  let lastStartMs: number | null = null;
  const state: SyncCoordinatorState = {
    running: false,
    pending: false,
    runs: 0,
    lastReason: null,
    lastRunAt: null,
    lastReport: null,
    lastError: null,
  };
  let reason: SyncReason = 'manual';

  const drain = async (): Promise<void> => {
    try {
      while (dirty && !disposed) {
        dirty = false;
        const batch = waiters;
        waiters = [];
        state.running = true;
        state.lastReason = reason;
        lastStartMs = nowMs();
        let report: SyncReport | null = null;
        try {
          if (options.prepare) await options.prepare();
          report = await runSync();
          state.lastReport = report;
          state.lastError = null;
        } catch (e) {
          state.lastError = e instanceof Error ? e.message : String(e);
          options.onError?.(e);
        }
        state.runs++;
        state.lastRunAt = d.clock.nowIso();
        state.running = false;
        // se non c'e' altro da fare il ciclo risulta libero PRIMA di risolvere le attese: una richiesta fatta
        // subito dopo `await request()` apre una nuova finestra invece di perdersi
        if (!dirty || disposed) looping = false;
        for (const w of batch) w(report);
      }
    } finally {
      looping = false;
    }
  };

  const startLoop = (): void => {
    timer = null;
    state.pending = false;
    if (looping) return; // sta girando: il ciclo vede `dirty` e riparte da solo
    looping = true;
    void drain();
  };

  const enqueue = (r: SyncReason): Promise<SyncReport | null> => {
    if (disposed) return Promise.resolve(null);
    dirty = true;
    reason = r;
    return new Promise((resolve) => {
      waiters.push(resolve);
    });
  };

  const request = (r: SyncReason = 'data-changed'): Promise<SyncReport | null> => {
    const p = enqueue(r);
    if (!disposed && !looping && timer === null) {
      state.pending = true;
      timer = setTimer(startLoop, coalesceMs);
    }
    return p;
  };

  return {
    request,
    requestForeground(): Promise<SyncReport | null> {
      const busy = timer !== null || looping;
      if (!busy && lastStartMs !== null && nowMs() - lastStartMs < minForegroundMs) return Promise.resolve(null);
      return request('foreground');
    },
    syncNow(r: SyncReason = 'manual'): Promise<SyncReport | null> {
      const p = enqueue(r);
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      if (!disposed) startLoop();
      return p;
    },
    getState: () => ({ ...state }),
    dispose(): void {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      state.pending = false;
      const rest = waiters;
      waiters = [];
      for (const w of rest) w(null);
    },
  };
}

/**
 * Collega gli eventi di dominio (emessi dopo il commit) al coordinatore: ogni modifica ai dati, alle impostazioni o un
 * ripristino di backup chiede una sync (coalescenza 1,5 s). Ritorna la funzione per scollegarsi.
 */
export function attachSyncToEvents(events: EventBus, coordinator: Pick<SyncCoordinator, 'request'>): () => void {
  return events.on((e) => {
    const reason: SyncReason = e.type === 'backup-imported' ? 'import' : e.scope === 'settings' ? 'settings' : 'data-changed';
    void coordinator.request(reason);
  });
}
