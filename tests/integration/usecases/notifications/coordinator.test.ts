// Coordinatore: coalescenza (1,5 s), mai due sync in parallelo, al massimo una al minuto in primo piano.
// Timer e orologio sono iniettati: nessuna attesa reale tranne l'ultimo test (che prova i timer predefiniti).
import { describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '@/domain/ports';
import { attachSyncToEvents, createSyncCoordinator } from '@/usecases/notifications';
import type { SyncReason, SyncReport } from '@/usecases/notifications';
import { addManual, addVehicle, setup } from '../queries/helpers';
import { FakeScheduler } from './fakeScheduler';

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

function manualTimers() {
  let next = 0;
  const queue = new Map<number, { fn: () => void; ms: number }>();
  return {
    setTimer: (fn: () => void, ms: number): unknown => {
      const h = ++next;
      queue.set(h, { fn, ms });
      return h;
    },
    clearTimer: (h: unknown): void => {
      queue.delete(h as number);
    },
    pending: (): number => queue.size,
    delays: (): number[] => [...queue.values()].map((q) => q.ms),
    fire(): void {
      const items = [...queue.values()];
      queue.clear();
      for (const q of items) q.fn();
    },
  };
}

const report = (n: number): SyncReport => ({ permission: 'granted', planned: n, scheduled: n, cancelled: 0, skippedUnchanged: false });

/** Esecuzioni sospese: il test decide quando ognuna termina. */
function controlledRun() {
  const st = { calls: 0, active: 0, maxActive: 0 };
  const waiting: (() => void)[] = [];
  return {
    st,
    run: (): Promise<SyncReport> => {
      st.calls++;
      st.active++;
      st.maxActive = Math.max(st.maxActive, st.active);
      const n = st.calls;
      return new Promise<SyncReport>((resolve) => {
        waiting.push(() => {
          st.active--;
          resolve(report(n));
        });
      });
    },
    async finish(): Promise<void> {
      waiting.shift()?.();
      await tick();
    },
  };
}

describe('coalescenza', () => {
  it('cinque richieste ravvicinate diventano UNA esecuzione dopo 1,5 s', async () => {
    const c = await setup();
    const t = manualTimers();
    const r = controlledRun();
    const co = createSyncCoordinator(c.depsWith(new FakeScheduler()), { run: r.run, ...t });
    const ps = [1, 2, 3, 4, 5].map(() => co.request('data-changed'));
    expect(t.pending()).toBe(1);
    expect(t.delays()).toEqual([1500]);
    expect(r.st.calls).toBe(0);
    expect(co.getState().pending).toBe(true);
    t.fire();
    expect(r.st.calls).toBe(1);
    await r.finish();
    expect(await Promise.all(ps)).toEqual([report(1), report(1), report(1), report(1), report(1)]);
    expect(r.st.calls).toBe(1);
  });

  it('richieste arrivate durante l\'esecuzione: una sola esecuzione successiva, mai in parallelo', async () => {
    const c = await setup();
    const t = manualTimers();
    const r = controlledRun();
    const co = createSyncCoordinator(c.depsWith(new FakeScheduler()), { run: r.run, ...t });
    const first = co.request();
    t.fire();
    expect(r.st.calls).toBe(1);
    expect(co.getState().running).toBe(true);
    const later = [co.request(), co.request(), co.request()];
    expect(t.pending()).toBe(0); // niente nuova finestra: la riprende il ciclo
    await r.finish();
    expect(await first).toEqual(report(1));
    expect(r.st.calls).toBe(2);
    await r.finish();
    expect(await Promise.all(later)).toEqual([report(2), report(2), report(2)]);
    expect(r.st.calls).toBe(2);
    expect(r.st.maxActive).toBe(1);
  });

  it('una richiesta dopo la fine apre una nuova finestra', async () => {
    const c = await setup();
    const t = manualTimers();
    const r = controlledRun();
    const co = createSyncCoordinator(c.depsWith(new FakeScheduler()), { run: r.run, ...t });
    const a = co.request();
    t.fire();
    await r.finish();
    await a;
    const b = co.request();
    expect(t.pending()).toBe(1);
    t.fire();
    await r.finish();
    expect(await b).toEqual(report(2));
  });

  it('syncNow esegue subito, annulla la finestra e risolve anche le richieste in attesa', async () => {
    const c = await setup();
    const t = manualTimers();
    const r = controlledRun();
    const co = createSyncCoordinator(c.depsWith(new FakeScheduler()), { run: r.run, ...t });
    const pending = co.request('data-changed');
    expect(t.pending()).toBe(1);
    const now = co.syncNow('manual');
    expect(t.pending()).toBe(0);
    expect(r.st.calls).toBe(1);
    await r.finish();
    expect(await Promise.all([pending, now])).toEqual([report(1), report(1)]);
    expect(co.getState().lastReason).toBe('manual');
  });
});

describe('primo piano: al massimo una sync al minuto', () => {
  it('scarta la richiesta se l\'ultima sync e\' piu\' recente di 60 s', async () => {
    const c = await setup('2026-10-08T07:30:00.000Z');
    const t = manualTimers();
    const r = controlledRun();
    const co = createSyncCoordinator(c.depsWith(new FakeScheduler()), { run: r.run, ...t });
    const first = co.requestForeground(); // mai eseguita: parte
    expect(t.pending()).toBe(1);
    t.fire();
    await r.finish();
    expect(await first).toEqual(report(1));

    expect(await co.requestForeground()).toBeNull();
    expect(t.pending()).toBe(0);
    c.clock.set('2026-10-08T07:30:30.000Z');
    expect(await co.requestForeground()).toBeNull();
    expect(r.st.calls).toBe(1);

    c.clock.set('2026-10-08T07:31:01.000Z');
    const again = co.requestForeground();
    expect(t.pending()).toBe(1);
    t.fire();
    await r.finish();
    expect(await again).toEqual(report(2));
  });

  it('i parametri sono iniettabili (intervallo minimo e finestra)', async () => {
    const c = await setup('2026-10-08T07:30:00.000Z');
    const t = manualTimers();
    const r = controlledRun();
    const co = createSyncCoordinator(c.depsWith(new FakeScheduler()), { run: r.run, ...t, coalesceMs: 50, foregroundMinIntervalMs: 5000 });
    const a = co.requestForeground();
    expect(t.delays()).toEqual([50]);
    t.fire();
    await r.finish();
    await a;
    c.clock.set('2026-10-08T07:30:06.000Z');
    const b = co.requestForeground();
    expect(t.pending()).toBe(1);
    t.fire();
    await r.finish();
    expect(await b).toEqual(report(2));
  });

  it('se una richiesta e\' gia\' in attesa, il primo piano si unisce senza essere scartato', async () => {
    const c = await setup();
    const t = manualTimers();
    const r = controlledRun();
    const co = createSyncCoordinator(c.depsWith(new FakeScheduler()), { run: r.run, ...t });
    const a = co.request();
    t.fire();
    await r.finish();
    await a; // ultima sync appena fatta
    const dc = co.request('data-changed');
    const fg = co.requestForeground();
    expect(t.pending()).toBe(1);
    t.fire();
    await r.finish();
    expect(await Promise.all([dc, fg])).toEqual([report(2), report(2)]);
  });
});

describe('errori, preparazione e chiusura', () => {
  it('un errore non lancia verso chi chiede: promessa null, stato e onError; poi si riparte', async () => {
    const c = await setup();
    const t = manualTimers();
    let fail = true;
    const onError = vi.fn();
    const co = createSyncCoordinator(c.depsWith(new FakeScheduler()), {
      run: async () => {
        if (fail) throw new Error('boom');
        return report(1);
      },
      onError,
      ...t,
    });
    const p = co.request();
    t.fire();
    expect(await p).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(co.getState()).toMatchObject({ running: false, runs: 1, lastError: 'boom', lastReport: null });
    fail = false;
    const q = co.request();
    t.fire();
    expect(await q).toEqual(report(1));
    expect(co.getState()).toMatchObject({ runs: 2, lastError: null, lastReport: report(1) });
  });

  it('prepare (es. la riconciliazione) gira prima di ogni sync; se fallisce la sync non parte', async () => {
    const c = await setup();
    const t = manualTimers();
    const log: string[] = [];
    let failPrepare = false;
    const co = createSyncCoordinator(c.depsWith(new FakeScheduler()), {
      prepare: async () => {
        log.push('prepare');
        if (failPrepare) throw new Error('riconciliazione fallita');
      },
      run: async () => {
        log.push('run');
        return report(1);
      },
      ...t,
    });
    for (let i = 0; i < 2; i++) {
      const p = co.request();
      t.fire();
      await p;
    }
    expect(log).toEqual(['prepare', 'run', 'prepare', 'run']);
    failPrepare = true;
    const p = co.request();
    t.fire();
    expect(await p).toBeNull();
    expect(log).toEqual(['prepare', 'run', 'prepare', 'run', 'prepare']);
    expect(co.getState().lastError).toBe('riconciliazione fallita');
  });

  it('dispose ferma il timer, risolve le attese con null e scarta le richieste successive', async () => {
    const c = await setup();
    const t = manualTimers();
    const r = controlledRun();
    const co = createSyncCoordinator(c.depsWith(new FakeScheduler()), { run: r.run, ...t });
    const p = co.request();
    co.dispose();
    expect(t.pending()).toBe(0);
    expect(await p).toBeNull();
    expect(await co.request()).toBeNull();
    expect(await co.syncNow()).toBeNull();
    expect(await co.requestForeground()).toBeNull();
    t.fire();
    expect(r.st.calls).toBe(0);
  });

  it('getState: esecuzioni, motivo, ultimo report e istante', async () => {
    const c = await setup();
    const t = manualTimers();
    const co = createSyncCoordinator(c.depsWith(new FakeScheduler()), { run: async () => report(3), ...t });
    expect(co.getState()).toEqual({ running: false, pending: false, runs: 0, lastReason: null, lastRunAt: null, lastReport: null, lastError: null });
    const p = co.request('settings');
    t.fire();
    await p;
    expect(co.getState()).toEqual({
      running: false, pending: false, runs: 1, lastReason: 'settings', lastRunAt: '2026-10-08T07:30:00.000Z', lastReport: report(3), lastError: null,
    });
  });
});

describe('collegamento agli eventi di dominio', () => {
  it('ogni evento chiede una sync con il motivo giusto; scollegandosi smette', async () => {
    const c = await setup();
    const reasons: (SyncReason | undefined)[] = [];
    const off = attachSyncToEvents(c.bus, { request: (r) => { reasons.push(r); return Promise.resolve(null); } });
    c.bus.emit({ type: 'data-changed', scope: 'odometer', vehicleId: 'x' } satisfies DomainEvent);
    c.bus.emit({ type: 'data-changed', scope: 'settings' });
    c.bus.emit({ type: 'backup-imported' });
    expect(reasons).toEqual(['data-changed', 'settings', 'import']);
    off();
    c.bus.emit({ type: 'data-changed', scope: 'fuel' });
    expect(reasons).toHaveLength(3);
  });
});

describe('con i timer predefiniti e la sync vera', () => {
  it('una modifica ai dati ripianifica le notifiche dopo la finestra', async () => {
    const c = await setup();
    const s = new FakeScheduler();
    const deps = c.depsWith(s);
    const co = createSyncCoordinator(deps, { coalesceMs: 10 });
    const off = attachSyncToEvents(deps.events, co);
    const v = await addVehicle(c);
    await addManual(c, v, 'Gommista', '2026-10-22');
    c.bus.emit({ type: 'data-changed', scope: 'reminders', vehicleId: v });
    c.bus.emit({ type: 'data-changed', scope: 'reminders', vehicleId: v });
    expect(s.store.size).toBe(0);
    await tick(80);
    expect(s.store.size).toBe(5);
    expect(s.calls.filter((x) => x.op === 'schedule')).toHaveLength(1); // due eventi, una sola esecuzione
    expect(co.getState().lastReport).toMatchObject({ planned: 5, scheduled: 5 });
    off();
    co.dispose();
  });
});
