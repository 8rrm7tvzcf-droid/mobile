import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composeAppRoot, type ComposeInput } from '@/bootstrap/compose';
import { hasReplan } from '@/bootstrap/types';
import type { ReplanPipeline } from '@/bootstrap/replan';
import type { NotificationScheduler, ObdTransport } from '@/domain/ports';
import { createSimpleEventBus } from '@/platform/events/simpleEventBus';
import { openBootedDb, vehicleRow, insertRow } from '../../support/db';
import { fakeFileServices } from './fakeFileServices';

// hashService (importato dal FileStore in memoria) legge expo-crypto: qui non serve, i test passano l'SHA-256 di node
vi.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: vi.fn() }));

const scheduler: NotificationScheduler = {
  getPermission: async () => 'granted',
  requestPermission: async () => 'granted',
  listScheduled: async () => [],
  schedule: async () => undefined,
  cancel: async () => undefined,
};
const fakeTransport = { kind: 'simulated' } as unknown as ObdTransport;

async function build(over: Partial<ComposeInput> = {}) {
  const { db, clock, ids } = await openBootedDb();
  const events = createSimpleEventBus();
  const order: string[] = [];
  const pipeline: ReplanPipeline = {
    reconcileAll: vi.fn(async () => {
      order.push('all');
    }),
    reconcileVehicle: vi.fn(async (_d, id: string) => {
      order.push(`v:${id}`);
    }),
    syncNotifications: vi.fn(async () => {
      order.push('sync');
    }),
  };
  const log = vi.fn();
  const fs = fakeFileServices();
  const input: ComposeInput = { db, clock, ids, events, scheduler, fs, pipeline, createTransport: () => fakeTransport, log, ...over };
  return { db, clock, events, pipeline, order, log, input, fs };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('composeAppRoot: avvio (passi 4-6)', () => {
  it('passo 4: la manutenzione elimina dal cestino cio\' che e\' li\' da oltre 30 giorni', async () => {
    const { db, input } = await build();
    const old = await insertRow(db, 'vehicles', vehicleRow({ deleted_at: '2026-01-01T00:00:00.000Z' }));
    const recent = await insertRow(db, 'vehicles', vehicleRow({ deleted_at: '2026-10-01T00:00:00.000Z' }));
    await composeAppRoot(input);
    expect(await db.get('SELECT id FROM vehicles WHERE id = ?', [old])).toBeUndefined();
    expect(await db.get('SELECT id FROM vehicles WHERE id = ?', [recent])).toBeDefined();
  });

  it("passo 5: riconcilia tutti i promemoria e poi sincronizza le notifiche, PRIMA di restituire l'AppRoot", async () => {
    const { input, order } = await build();
    await composeAppRoot(input);
    expect(order).toEqual(['all', 'sync']);
  });

  it('passo 4: la coda dei file da cancellare si svuota usando fs.files (allegati rimossi dal cestino)', async () => {
    const { db, input, fs } = await build();
    await fs.files.write('attachments/OLD.pdf', new Uint8Array([1, 2, 3]));
    await fs.files.write('attachments/KEEP.pdf', new Uint8Array([4]));
    await db.run('INSERT INTO pending_file_deletions (stored_path) VALUES (?)', ['attachments/OLD.pdf']);
    await composeAppRoot(input);
    expect(await fs.files.exists('attachments/OLD.pdf')).toBe(false);
    expect(await fs.files.exists('attachments/KEEP.pdf')).toBe(true);
    expect(await db.get('SELECT id FROM pending_file_deletions')).toBeUndefined();
  });

  it("passo 4: la cartella temporanea si svuota all'avvio, le altre cartelle restano intatte", async () => {
    const { input, fs } = await build();
    await fs.files.write(`${fs.dirs.temp}/export-1/MyGarage.zip`, new Uint8Array([1]));
    await fs.files.write(`${fs.dirs.temp}/picked/foto.jpg`, new Uint8Array([2]));
    await fs.files.write(`${fs.dirs.backups}/pre-v1.db`, new Uint8Array([3]));
    await fs.files.write(`${fs.dirs.attachments}/A.pdf`, new Uint8Array([4]));
    await composeAppRoot(input);
    expect(await fs.files.list(fs.dirs.temp)).toEqual([]);
    expect(await fs.files.list(fs.dirs.backups)).toEqual(['pre-v1.db']);
    expect(await fs.files.list(fs.dirs.attachments)).toEqual(['A.pdf']);
  });

  it("un errore nella pulizia della cartella temporanea non blocca l'avvio e finisce nel log", async () => {
    const { input, fs, log } = await build();
    vi.spyOn(fs.files, 'list').mockRejectedValueOnce(new Error('disco pieno'));
    await expect(composeAppRoot(input)).resolves.toBeDefined();
    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toContain('disco pieno');
  });

  it("un errore nella pipeline non blocca l'avvio e finisce nel log", async () => {
    const { input, pipeline, log } = await build();
    (pipeline.reconcileAll as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('reconcile rotta'));
    (pipeline.syncNotifications as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('sync rotta'));
    await expect(composeAppRoot(input)).resolves.toBeDefined();
    const text = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(text).toContain('reconcile rotta');
    expect(text).toContain('sync rotta');
  });

  it("se il passo 5 e' troppo lento l'avvio prosegue dopo il tempo massimo", async () => {
    const { input, pipeline } = await build({ startupTimeoutMs: 3000 });
    (pipeline.syncNotifications as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise<void>(() => undefined));
    let done = false;
    const p = composeAppRoot(input).then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(2900);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await p;
    expect(done).toBe(true);
  });
});

describe('composeAppRoot: AppRoot', () => {
  it('espone i servizi per file sia in deps.fs sia in files (stesso oggetto)', async () => {
    const { input, fs } = await build();
    const root = await composeAppRoot(input);
    expect(root.deps.fs).toBe(fs);
    expect(root.files).toBe(fs);
    expect(root.deps.fs.dirs).toEqual({ attachments: 'attachments', backups: 'backups', temp: 'temp' });
  });

  it('ha la forma del contratto: deps (con scheduler), obd.createTransport, dispose', async () => {
    const { input, db, clock, events } = await build();
    const root = await composeAppRoot(input);
    expect(root.deps.db).toBe(db);
    expect(root.deps.clock).toBe(clock);
    expect(root.deps.events).toBe(events);
    expect(root.deps.scheduler).toBe(scheduler);
    expect(typeof root.deps.ids.ulid()).toBe('string');
    expect(root.obd.createTransport()).toBe(fakeTransport);
    expect(root.obd.service.getState().phase).toBe('idle');
    expect(typeof root.obd.service.openDemo).toBe('function');
    expect(typeof root.dispose).toBe('function');
    expect(hasReplan(root)).toBe(true);
  });

  it('createTransport passa le opzioni alla factory', async () => {
    const createTransport = vi.fn(() => fakeTransport);
    const { input } = await build({ createTransport });
    const root = await composeAppRoot(input);
    root.obd.createTransport({ deviceId: 'AA:BB' });
    expect(createTransport).toHaveBeenCalledWith({ deviceId: 'AA:BB' });
  });

  it('dopo l\'avvio ogni scrittura (evento data-changed) rimette in moto promemoria e notifiche, coalescendo', async () => {
    const { input, events, order } = await build();
    await composeAppRoot(input);
    order.length = 0;
    events.emit({ type: 'data-changed', scope: 'service', vehicleId: 'veh1' });
    events.emit({ type: 'data-changed', scope: 'odometer', vehicleId: 'veh1' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(order).toEqual(['v:veh1', 'sync']);
  });

  it('dispose smette di ascoltare, chiude il database ed e\' idempotente', async () => {
    const { input, db, events, order } = await build();
    const closeSpy = vi.spyOn(db, 'close');
    const root = await composeAppRoot(input);
    order.length = 0;
    await root.dispose();
    await root.dispose();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    events.emit({ type: 'data-changed', scope: 'vehicles' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(order).toEqual([]);
  });
});
