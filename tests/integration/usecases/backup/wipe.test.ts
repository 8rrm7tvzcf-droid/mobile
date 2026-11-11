// «Cancella tutti i dati» (F-09, AC-11 punto 7): notifiche, righe, impostazioni ai predefiniti, cartelle dell'app vuote,
// cataloghi di sistema intatti, verifica finale.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, getBackupStatus, importBackup, wipeAllData } from '@/usecases/backup';
import { addVehicle } from '@/usecases/vehicles';
import { SETTING_DEFAULTS, getSettings } from '@/usecases/settings';
import type { PlannedNotification } from '@/domain/ports';
import { count, makeBackupEnv, seedGarage, unwrap, type BackupEnv, type Garage } from './harness';

let env: BackupEnv;
let g: Garage;
beforeEach(async () => {
  env = await makeBackupEnv();
  g = await seedGarage(env);
});
afterEach(() => env.cleanup());

const USER_TABLES = [
  'vehicles', 'workshops', 'obd_adapters', 'fuel_logs', 'service_records', 'service_lines', 'fluid_checks', 'expenses', 'obd_sessions',
  'telemetry_samples', 'telemetry_rollups', 'dtc_events', 'odometer_readings', 'maintenance_items', 'maintenance_completions',
  'insurance_policies', 'insurance_coverages', 'insurance_payments', 'reminders', 'notification_schedule', 'tyre_sets', 'tyre_fitments',
  'attachments', 'pending_file_deletions',
];

const planned = (key: string): PlannedNotification => ({
  key, hash: 'h', date: '2026-11-01', time: '09:00', channel: 'deadlines', title: 'Scadenza', body: 'Cambio olio',
});

async function populateEverything(): Promise<void> {
  // un backup esportato e uno rimasto a meta', un file orfano e un temporaneo, notifiche pianificate, coda di cancellazione
  unwrap(await exportBackup(env.deps));
  await env.files.write(`${env.dirs.backups}/pre-v1-to-v2-2026-10-01.db`, new Uint8Array([1, 2, 3]));
  await env.files.write(`${env.dirs.attachments}/orfano.jpg`, new Uint8Array([9, 9]));
  await env.files.write(`${env.dirs.temp}/import-xyz-file.jpg`, new Uint8Array([8]));
  await env.scheduler.schedule([planned('mg1:a'), planned('mg1:b'), planned('mg1:sentinel')], 'Europe/Rome');
  await env.db.run('INSERT INTO pending_file_deletions (stored_path) VALUES (?)', ['attachments/x.pdf']);
  await env.db.run(`INSERT INTO notification_schedule (key, reminder_id, fire_at, tz, hash, planned_at) VALUES ('mg1:a', NULL, '2026-11-01T08:00:00.000Z', 'Europe/Rome', 'h', '2026-10-08T07:30:00.000Z')`);
}

describe('wipeAllData', () => {
  it('cancella notifiche, righe, file e impostazioni; lascia i cataloghi di sistema; la verifica e vuota', async () => {
    await populateEverything();
    const templates = await count(env.db, 'service_templates');
    const systemCategories = await count(env.db, 'expense_categories', 'is_system = 1');
    expect(templates).toBeGreaterThan(0);
    expect(systemCategories).toBeGreaterThan(0);
    expect(await count(env.db, 'telemetry_samples')).toBeGreaterThan(0);
    const device = await env.db.get<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'device.id'`);
    env.events.length = 0;

    const report = await wipeAllData({ ...env.deps, scheduler: env.scheduler });

    expect(report).toMatchObject({
      notificationsCancelled: 3,
      notificationsOk: true,
      complete: true,
      verification: { rowsLeft: {}, filesLeft: [] },
    });
    expect(report.filesRemoved).toBeGreaterThanOrEqual(6); // 2 allegati + 1 della demo + orfano + backup + copia + temporaneo
    expect(env.scheduler.store.size).toBe(0);
    for (const t of USER_TABLES) expect(await count(env.db, t), t).toBe(0);
    expect(await count(env.db, 'expense_categories', 'is_system = 0')).toBe(0);
    // cataloghi di sistema e identificatore del dispositivo restano
    expect(await count(env.db, 'service_templates')).toBe(templates);
    expect(await count(env.db, 'expense_categories', 'is_system = 1')).toBe(systemCategories);
    expect((await env.db.get<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'device.id'`))?.value).toBe(device?.value);
    expect(await count(env.db, 'migrations_log')).toBe(1);
    // impostazioni ai predefiniti
    const settings = await getSettings(env.deps);
    for (const [k, v] of Object.entries(SETTING_DEFAULTS)) expect((settings as unknown as Record<string, unknown>)[k], k).toEqual(v);
    expect(settings.deviceId).not.toBeNull();
    expect(await count(env.db, 'app_settings', `key LIKE 'doc.expiry.%'`)).toBe(0);
    // cartelle dell'app vuote, anche dal file system
    for (const dir of [env.dirs.attachments, env.dirs.backups, env.dirs.temp]) expect(await env.files.list(dir)).toEqual([]);
    // la UI e le notifiche ripartono dal vuoto
    expect(env.events).toContainEqual({ type: 'data-changed', scope: 'vehicles' });
    expect(env.events).toContainEqual({ type: 'data-changed', scope: 'settings' });
    expect(env.events).toContainEqual({ type: 'data-changed', scope: 'reminders' });
    expect(await getBackupStatus(env.deps)).toMatchObject({ hasData: false, lastBackupAt: null, needsReminder: false });
    expect(env.scheduler.calls.some((c) => c.op === 'cancel' && c.keys?.length === 3)).toBe(true);
  });

  it('e idempotente e lascia un database utilizzabile', async () => {
    await populateEverything();
    await wipeAllData({ ...env.deps, scheduler: env.scheduler });
    const second = await wipeAllData({ ...env.deps, scheduler: env.scheduler });
    expect(second).toMatchObject({ notificationsCancelled: 0, filesRemoved: 0, complete: true });
    // si riparte dall'onboarding: si puo' aggiungere un'auto e importare un backup
    const v = unwrap(await addVehicle(env.deps, { make: 'Fiat', model: 'Panda', fuelPrimary: 'petrol' }));
    expect(v.id).toHaveLength(26);
    expect(await count(env.db, 'vehicles')).toBe(1);
  });

  it('se il sistema non permette di annullare le notifiche lo segnala ma cancella comunque i dati', async () => {
    await populateEverything();
    env.scheduler.failOn = 'listScheduled';
    const report = await wipeAllData({ ...env.deps, scheduler: env.scheduler });
    expect(report.notificationsOk).toBe(false);
    expect(report.notificationsCancelled).toBe(0);
    expect(report.complete).toBe(true);
    expect(await count(env.db, 'vehicles')).toBe(0);
  });

  it('riporta cio che non e riuscito a togliere (e si puo ripetere)', async () => {
    await populateEverything();
    const stubborn = `${env.dirs.attachments}/orfano.jpg`;
    const failing = {
      ...env.deps,
      scheduler: env.scheduler,
      fs: { ...env.deps.fs, files: { ...env.files, remove: async (p: string) => (p === stubborn ? Promise.reject(new Error('bloccato')) : env.files.remove(p)) } },
    };
    const report = await wipeAllData(failing);
    expect(report.complete).toBe(false);
    expect(report.verification.filesLeft).toEqual(['attachments/orfano.jpg']);
    expect(report.verification.rowsLeft).toEqual({});
    const retry = await wipeAllData({ ...env.deps, scheduler: env.scheduler });
    expect(retry.complete).toBe(true);
  });

  it('un backup esportato prima della cancellazione si importa dopo: l app riparte con tutti i dati', async () => {
    const exp = unwrap(await exportBackup(env.deps));
    const bytes = new Uint8Array(await env.files.read(exp.path));
    await wipeAllData({ ...env.deps, scheduler: env.scheduler });
    expect(await env.files.list(env.dirs.backups)).toEqual([]); // il backup dentro l'app e' sparito: resta solo quello condiviso fuori
    const r = unwrap(await importBackup(env.deps, bytes, { mode: 'replace' }));
    expect(r.attachmentFilesInstalled).toBe(2);
    expect(await count(env.db, 'vehicles', `id = '${g.vehicleId}'`)).toBe(1);
  });
});
