// Il sottoscrittore che mantiene coerenti promemoria e notifiche (SPEC 8.4 "Ripianificazione", 8.6 "Accesso ai dati").
// Ascolta gli eventi 'data-changed' emessi dai casi d'uso DOPO il commit e, con coalescenza di 1,5 s, esegue
//   riconciliazione dei promemoria (tutti i veicoli, oppure solo quello toccato)  ->  sincronizzazione delle notifiche.
// Garanzie: mai due esecuzioni in parallelo; le richieste arrivate durante un'esecuzione ne producono UNA successiva;
// un errore di un passo non ferma l'altro ne' l'app (si segnala con onError).
//
// Anti-ciclo: gli eventi emessi dalla pipeline stessa (es. una riconciliazione che emette 'reminders') arrivano agli
// altri ascoltatori (la UI che si aggiorna) ma NON rimettono in moto la pipeline.
//
// Non importa i casi d'uso: riceve le funzioni (contratti di '@/usecases/deadlines' e '@/usecases/notifications'),
// cosi' si prova senza database ne' Expo.
import type { DomainEvent, EventBus } from '@/domain/ports';
import type { Deps, NotificationDeps } from '@/usecases/context';

export interface ReplanPipeline {
  reconcileAll(d: Deps): Promise<void>;
  reconcileVehicle(d: Deps, vehicleId: string): Promise<void>;
  /** Il risultato (SyncReport) non serve qui. */
  syncNotifications(d: NotificationDeps): Promise<unknown>;
}

export type ReplanStage = 'reconcile' | 'sync';

export interface ReplanOptions {
  deps: NotificationDeps;
  pipeline: ReplanPipeline;
  /** Attesa dall'ultima richiesta prima di partire (default 1500 ms, SPEC 8.4). */
  debounceMs?: number;
  /** Al massimo una ripianificazione per ritorno in primo piano ogni questo intervallo (default 60 s). */
  foregroundMinIntervalMs?: number;
  /** Istante corrente in ms (default Date.now). */
  now?: () => number;
  onError?: (stage: ReplanStage, error: unknown) => void;
}

export interface ReplanRequest {
  /** Solo questo veicolo (assente = tutti). Ignorato se `reconcile` e' false. */
  vehicleId?: string;
  /** false = solo sincronizzazione delle notifiche, senza riconciliare (default true). */
  reconcile?: boolean;
}

export interface ReplanCoordinator {
  /** Accoda una ripianificazione (con coalescenza). */
  request(req?: ReplanRequest): void;
  /** Ritorno in primo piano: come request(), ma al massimo una volta al minuto. */
  requestForeground(): void;
  /** Esegue subito quanto in attesa (e quanto in corso) e risolve alla fine. Non lancia mai. */
  flush(): Promise<void>;
  /** Smette di ascoltare, annulla il timer e aspetta l'esecuzione in corso. */
  dispose(): Promise<void>;
}

/** Traduce un evento di dominio nella richiesta corrispondente; null = non interessa. */
export function requestForEvent(e: DomainEvent): ReplanRequest | null {
  if (e.type === 'backup-imported') return {};
  // le righe dei promemoria sono gia' coerenti: basta riallineare le notifiche
  if (e.scope === 'reminders') return { reconcile: false };
  return e.vehicleId ? { vehicleId: e.vehicleId } : {};
}

export function createReplanCoordinator(events: EventBus, opts: ReplanOptions): ReplanCoordinator {
  const debounceMs = opts.debounceMs ?? 1500;
  const foregroundMinMs = opts.foregroundMinIntervalMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const onError =
    opts.onError ??
    ((stage: ReplanStage, error: unknown): void => {
      console.warn(`[ripianificazione] ${stage} fallita`, error);
    });

  // La pipeline emette tramite questo bus: la marcatura (sincrona) permette di riconoscere i propri eventi.
  let selfEmitting = 0;
  const pipelineBus: EventBus = {
    on: (fn) => events.on(fn),
    emit(e) {
      selfEmitting++;
      try {
        events.emit(e);
      } finally {
        selfEmitting--;
      }
    },
  };
  const deps: NotificationDeps = { ...opts.deps, events: pipelineBus };

  let pendingAll = false;
  let pendingSync = false;
  const pendingVehicles = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;
  let lastForegroundAt = Number.NEGATIVE_INFINITY;
  let disposed = false;

  const hasPending = (): boolean => pendingAll || pendingSync || pendingVehicles.size > 0;
  const clearTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (): void => {
    clearTimer();
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, debounceMs);
  };

  async function execute(all: boolean, vehicles: string[]): Promise<void> {
    try {
      if (all) await opts.pipeline.reconcileAll(deps);
      else for (const id of vehicles) await opts.pipeline.reconcileVehicle(deps, id);
    } catch (e) {
      onError('reconcile', e);
    }
    try {
      await opts.pipeline.syncNotifications(deps);
    } catch (e) {
      onError('sync', e);
    }
  }

  function flush(): Promise<void> {
    clearTimer();
    if (running) return running.then(() => (hasPending() ? flush() : undefined));
    if (!hasPending()) return Promise.resolve();
    const all = pendingAll;
    const vehicles = [...pendingVehicles];
    pendingAll = false;
    pendingSync = false;
    pendingVehicles.clear();
    running = execute(all, vehicles).finally(() => {
      running = null;
      if (hasPending() && !disposed) schedule(); // richieste arrivate durante l'esecuzione: una sola esecuzione in piu'
    });
    return running;
  }

  function request(req: ReplanRequest = {}): void {
    if (disposed) return;
    pendingSync = true;
    if (req.reconcile !== false) {
      if (req.vehicleId) pendingVehicles.add(req.vehicleId);
      else pendingAll = true;
    }
    schedule();
  }

  const off = events.on((e) => {
    if (selfEmitting > 0) return; // evento della pipeline stessa
    const req = requestForEvent(e);
    if (req) request(req);
  });

  return {
    request,
    requestForeground() {
      const t = now();
      if (t - lastForegroundAt < foregroundMinMs) return;
      lastForegroundAt = t;
      request();
    },
    flush,
    async dispose() {
      disposed = true;
      off();
      clearTimer();
      pendingAll = false;
      pendingSync = false;
      pendingVehicles.clear();
      await running;
    },
  };
}
