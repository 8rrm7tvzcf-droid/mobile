import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReplanCoordinator, requestForEvent, type ReplanPipeline } from '@/bootstrap/replan';
import type { DomainEvent } from '@/domain/ports';
import { createSimpleEventBus } from '@/platform/events/simpleEventBus';
import type { NotificationDeps } from '@/usecases/context';

const changed = (scope: Extract<DomainEvent, { type: 'data-changed' }>['scope'], vehicleId?: string): DomainEvent => ({
  type: 'data-changed',
  scope,
  ...(vehicleId ? { vehicleId } : {}),
});

function setup(over: { onError?: (stage: string, e: unknown) => void; foregroundMinIntervalMs?: number; now?: () => number } = {}) {
  const events = createSimpleEventBus();
  const calls: string[] = [];
  const pipeline: ReplanPipeline = {
    reconcileAll: vi.fn(async () => {
      calls.push('all');
    }),
    reconcileVehicle: vi.fn(async (_d, id: string) => {
      calls.push(`v:${id}`);
    }),
    syncNotifications: vi.fn(async () => {
      calls.push('sync');
    }),
  };
  const deps = { db: {}, clock: {}, ids: {}, events, scheduler: {} } as unknown as NotificationDeps;
  const coordinator = createReplanCoordinator(events, { deps, pipeline, ...over });
  return { events, calls, pipeline, coordinator };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('requestForEvent', () => {
  it('mappa gli eventi sulle richieste', () => {
    expect(requestForEvent(changed('odometer', 'v1'))).toEqual({ vehicleId: 'v1' });
    expect(requestForEvent(changed('settings'))).toEqual({});
    expect(requestForEvent(changed('reminders', 'v1'))).toEqual({ reconcile: false });
    expect(requestForEvent({ type: 'backup-imported' })).toEqual({});
  });
});

describe('coalescenza', () => {
  it('piu\' eventi ravvicinati = una sola esecuzione dopo 1,5 s', async () => {
    const { events, calls } = setup();
    events.emit(changed('service', 'v1'));
    await vi.advanceTimersByTimeAsync(1000);
    events.emit(changed('odometer', 'v1'));
    events.emit(changed('fuel', 'v2'));
    await vi.advanceTimersByTimeAsync(1499);
    expect(calls).toEqual([]); // la finestra riparte a ogni evento
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(['v:v1', 'v:v2', 'sync']);
  });

  it('un evento senza veicolo riconcilia tutti (e assorbe quelli dei singoli veicoli)', async () => {
    const { events, calls } = setup();
    events.emit(changed('vehicles', 'v1'));
    events.emit(changed('settings'));
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual(['all', 'sync']);
  });

  it("l'evento 'reminders' sincronizza soltanto le notifiche", async () => {
    const { events, calls } = setup();
    events.emit(changed('reminders', 'v1'));
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual(['sync']);
  });

  it('import di un backup: tutto da capo', async () => {
    const { events, calls } = setup();
    events.emit({ type: 'backup-imported' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual(['all', 'sync']);
  });
});

describe('esecuzione', () => {
  it('mai due esecuzioni in parallelo: le richieste durante una esecuzione ne producono una sola in piu\'', async () => {
    const events = createSimpleEventBus();
    let active = 0;
    let maxActive = 0;
    let release: () => void = () => undefined;
    const gate = (): Promise<void> => new Promise((r) => (release = r));
    const pipeline: ReplanPipeline = {
      reconcileAll: vi.fn(async () => undefined),
      reconcileVehicle: vi.fn(async () => undefined),
      syncNotifications: vi.fn(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await gate();
        active--;
      }),
    };
    const deps = { db: {}, clock: {}, ids: {}, events, scheduler: {} } as unknown as NotificationDeps;
    const c = createReplanCoordinator(events, { deps, pipeline });

    events.emit(changed('settings'));
    await vi.advanceTimersByTimeAsync(1500); // parte la prima, resta in attesa nel gate
    expect(pipeline.syncNotifications).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) events.emit(changed('settings')); // durante l'esecuzione
    await vi.advanceTimersByTimeAsync(5000);
    expect(pipeline.syncNotifications).toHaveBeenCalledTimes(1); // la seconda aspetta la fine della prima

    release();
    await vi.advanceTimersByTimeAsync(1500);
    expect(pipeline.syncNotifications).toHaveBeenCalledTimes(2);
    release();
    await c.flush();
    expect(maxActive).toBe(1);
    expect(pipeline.syncNotifications).toHaveBeenCalledTimes(2);
  });

  it('un errore di riconciliazione non impedisce la sincronizzazione; entrambi si segnalano', async () => {
    const onError = vi.fn();
    const { events, pipeline } = setup({ onError });
    (pipeline.reconcileAll as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('rotto'));
    events.emit(changed('settings'));
    await vi.advanceTimersByTimeAsync(1500);
    expect(pipeline.syncNotifications).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('reconcile', expect.any(Error));

    (pipeline.syncNotifications as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('sync rotta'));
    events.emit(changed('settings'));
    await vi.advanceTimersByTimeAsync(1500);
    expect(onError).toHaveBeenCalledWith('sync', expect.any(Error));
  });

  it('flush() esegue subito quanto e\' in attesa, senza aspettare i 1,5 s', async () => {
    const { events, calls, coordinator } = setup();
    events.emit(changed('service', 'v9'));
    await coordinator.flush();
    expect(calls).toEqual(['v:v9', 'sync']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual(['v:v9', 'sync']); // il timer e' stato annullato
  });

  it('flush() senza nulla in attesa non fa niente', async () => {
    const { calls, coordinator } = setup();
    await coordinator.flush();
    expect(calls).toEqual([]);
  });
});

describe('anti-ciclo', () => {
  it('gli eventi emessi dalla pipeline arrivano agli altri ascoltatori ma non la rimettono in moto', async () => {
    const events = createSimpleEventBus();
    const uiSeen: string[] = [];
    events.on((e) => uiSeen.push(e.type === 'data-changed' ? e.scope : e.type));
    let runs = 0;
    const pipeline: ReplanPipeline = {
      reconcileAll: vi.fn(async (d) => {
        runs++;
        d.events.emit(changed('reminders')); // come farebbe una riconciliazione che cambia dei promemoria
      }),
      reconcileVehicle: vi.fn(async () => undefined),
      syncNotifications: vi.fn(async (d) => {
        d.events.emit(changed('settings')); // o una sync che registra la propria esecuzione
      }),
    };
    const deps = { db: {}, clock: {}, ids: {}, events, scheduler: {} } as unknown as NotificationDeps;
    createReplanCoordinator(events, { deps, pipeline });

    events.emit(changed('settings'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runs).toBe(1);
    expect(uiSeen).toEqual(['settings', 'reminders', 'settings']); // la UI ha visto anche gli eventi della pipeline
  });

  it("un evento vero emesso subito dopo l'esecuzione viene gestito", async () => {
    const { events, calls } = setup();
    events.emit(changed('settings'));
    await vi.advanceTimersByTimeAsync(1500);
    events.emit(changed('odometer', 'v1'));
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual(['all', 'sync', 'v:v1', 'sync']);
  });
});

describe('ritorno in primo piano', () => {
  it('al massimo una ripianificazione al minuto', async () => {
    let t = 1_000_000;
    const { calls, coordinator } = setup({ now: () => t });
    coordinator.requestForeground();
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual(['all', 'sync']);

    t += 30_000;
    coordinator.requestForeground();
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual(['all', 'sync']); // troppo presto

    t += 31_000;
    coordinator.requestForeground();
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual(['all', 'sync', 'all', 'sync']);
  });
});

describe('dispose', () => {
  it('smette di ascoltare e annulla quanto in attesa', async () => {
    const { events, calls, coordinator } = setup();
    events.emit(changed('settings'));
    await coordinator.dispose();
    events.emit(changed('settings'));
    coordinator.request();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toEqual([]);
  });

  it("aspetta l'esecuzione in corso", async () => {
    const events = createSimpleEventBus();
    let finished = false;
    const pipeline: ReplanPipeline = {
      reconcileAll: vi.fn(async () => undefined),
      reconcileVehicle: vi.fn(async () => undefined),
      syncNotifications: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 2000));
        finished = true;
      }),
    };
    const deps = { db: {}, clock: {}, ids: {}, events, scheduler: {} } as unknown as NotificationDeps;
    const c = createReplanCoordinator(events, { deps, pipeline });
    events.emit(changed('settings'));
    await vi.advanceTimersByTimeAsync(1500);
    const done = c.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    expect(finished).toBe(true);
  });
});
