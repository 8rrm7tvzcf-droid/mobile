// Esportazione del backup (F-06, AC-11): ZIP con manifest, data.json versionato e allegati; cosa si esclude; stato del backup.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, getBackupStatus, KEEP_BACKUPS } from '@/usecases/backup';
import type { BackupDocument } from '@/usecases/backup';
import { attachmentFilePath } from '@/usecases/attachments';
import { insertRow, vehicleRow } from '../../../support/db';
import { ulidOf } from '../../../support/fakes';
import { count, docOf, errorCode, makeBackupEnv, seedGarage, unwrap, type BackupEnv, type Garage } from './harness';

let env: BackupEnv;
let g: Garage;
beforeEach(async () => {
  env = await makeBackupEnv();
  g = await seedGarage(env);
});
afterEach(() => env.cleanup());

const text = (b: Uint8Array): string => new TextDecoder().decode(b);

async function openZip(path: string): Promise<{ entries: Map<string, Uint8Array>; doc: BackupDocument; manifest: { files: { path: string; sha256: string; size: number }[]; format: string } }> {
  const entries = new Map(env.deps.fs.zip.unzip(await env.files.read(path)).map((e) => [e.name, e.bytes] as const));
  return {
    entries,
    doc: JSON.parse(text(entries.get('data.json') as Uint8Array)) as BackupDocument,
    manifest: JSON.parse(text(entries.get('manifest.json') as Uint8Array)) as { files: { path: string; sha256: string; size: number }[]; format: string },
  };
}

describe('exportBackup', () => {
  it('costruisce MyGarage-AAAA-MM-GG.zip in backups/ con manifest, data.json e allegati con hash e dimensioni', async () => {
    const r = unwrap(await exportBackup(env.deps, { appVersion: '0.1.0' }));
    expect(r.fileName).toBe('MyGarage-2026-10-08.zip');
    expect(r.path).toBe(`${env.dirs.backups}/MyGarage-2026-10-08.zip`);
    expect(r.mimeType).toBe('application/zip');
    expect(r.exportedAt).toBe('2026-10-08T07:30:00.000Z');
    expect(r.attachmentFiles).toBe(2);
    expect(r.skippedFiles).toEqual([]);
    expect(r.sizeBytes).toBe((await env.files.read(r.path)).length);

    const { entries, doc, manifest } = await openZip(r.path);
    expect([...entries.keys()].sort()).toEqual(
      ['attachments/' + g.invoice.id + '.pdf', 'attachments/' + g.registration.id + '.jpg', 'data.json', 'manifest.json'].sort(),
    );
    expect(doc).toMatchObject({
      format: 'mygarage.backup',
      formatVersion: 1,
      schemaVersion: 1,
      appVersion: '0.1.0',
      exportedAt: '2026-10-08T07:30:00.000Z',
      includesTrash: false,
    });
    expect(doc.sourceDeviceId).toMatch(/^[0-9A-Z]{26}$/);
    expect(manifest.format).toBe('mygarage.backup');
    for (const f of manifest.files) {
      const bytes = entries.get(f.path) as Uint8Array;
      expect(f.size).toBe(bytes.length);
      expect(f.sha256).toBe(await env.deps.fs.hash.sha256Hex(bytes));
    }
    expect(doc.files.map((f) => f.path).sort()).toEqual(manifest.files.map((f) => f.path).sort());
    // i byte dello ZIP sono quelli dello storage
    const real = await env.files.read(attachmentFilePath(env.dirs, g.invoice.storedPath) as string);
    expect(entries.get(g.invoice.storedPath)).toEqual(new Uint8Array(real));
    expect(doc.counts).toEqual(Object.fromEntries(Object.entries(doc.data).map(([k, v]) => [k, v.length])));
  });

  it('esclude telemetria, notification_schedule, pending_file_deletions, migrations_log, cataloghi, impostazioni locali, cestino e auto demo', async () => {
    // dati che NON devono viaggiare
    await env.db.run(`INSERT INTO notification_schedule (key, reminder_id, fire_at, tz, hash, planned_at) VALUES ('mg1:test', NULL, '2026-10-20T07:00:00.000Z', 'Europe/Rome', 'h', '2026-10-08T07:30:00.000Z')`);
    await env.db.run(`INSERT INTO pending_file_deletions (stored_path) VALUES ('attachments/x.jpg')`);
    const r = unwrap(await exportBackup(env.deps));
    const { doc, entries } = await openZip(r.path);
    const json = text(entries.get('data.json') as Uint8Array);

    const vehicleIds = doc.data['vehicles']?.map((v) => v['id']);
    expect(vehicleIds).toEqual([g.vehicleId]); // niente demo, niente auto nel cestino
    expect(json).not.toContain(g.demoId);
    expect(json).not.toContain(g.trashedVehicleId);
    expect(doc.data['fuel_logs']?.map((f) => f['id']).sort()).toEqual([ulidOf(50), ulidOf(51)]); // niente rifornimento cestinato (52) ne figli del veicolo nel cestino (53)
    expect(doc.data['attachments']?.map((a) => a['id']).sort()).toEqual([g.invoice.id, g.registration.id].sort()); // niente allegato della demo
    expect(doc.data['obd_adapters']).toEqual([]); // il simulatore appartiene alla demo
    expect(doc.data['obd_sessions']).toEqual([]);
    expect(doc.data['expense_categories']?.map((c) => c['name_it'])).toEqual(['Autolavaggio']); // categorie di sistema dal seed
    expect(doc.data['workshops']).toHaveLength(1);
    for (const table of ['telemetry_samples', 'telemetry_rollups', 'notification_schedule', 'pending_file_deletions', 'migrations_log', 'service_templates', 'app_settings']) {
      expect(doc.data[table]).toBeUndefined();
    }
    expect(Object.keys(doc.settings)).not.toContain('device.id');
    expect(Object.keys(doc.settings)).not.toContain('backup.lastExportAt');
    expect(doc.settings['notify.time']).toBe('08:30');
    expect(doc.settings['notify.privacy']).toBe('full');
    expect(json).not.toContain('seq"'); // obd_sessions.seq e' locale
    expect(entries.has(`attachments/${g.demoId}.jpg`)).toBe(false);
    expect([...entries.keys()].filter((n) => n.startsWith('attachments/'))).toHaveLength(2);
  });

  it('con includeTrash porta anche il cestino', async () => {
    const r = unwrap(await exportBackup(env.deps, { includeTrash: true }));
    const { doc } = await openZip(r.path);
    expect(doc.includesTrash).toBe(true);
    expect(doc.data['vehicles']?.map((v) => v['id']).sort()).toEqual([g.vehicleId, g.trashedVehicleId].sort());
    expect(doc.data['fuel_logs']).toHaveLength(4);
  });

  it('il legame documento -> scadenza viaggia con le impostazioni, solo se entrambi i lati sono nel backup', async () => {
    const { doc } = await openZip(unwrap(await exportBackup(env.deps)).path);
    const key = `doc.expiry.${g.registration.id}`;
    expect(doc.settings[key]).toBe(g.registration.deadlineId);
    expect(Object.keys(doc.settings).filter((k) => k.startsWith('doc.expiry.'))).toEqual([key]);
  });

  it('registra la data dell ultimo backup ed emette l evento delle impostazioni', async () => {
    expect((await getBackupStatus(env.deps)).lastBackupAt).toBeNull();
    env.clock.set('2030-01-10T07:30:00.000Z'); // i trigger di updated_at usano l'ora vera del PC: l'orologio di prova va oltre
    unwrap(await exportBackup(env.deps));
    const st = await getBackupStatus(env.deps);
    expect(st).toMatchObject({ lastBackupAt: '2030-01-10T07:30:00.000Z', daysSinceLastBackup: 0, hasData: true, changesSinceBackup: 0, needsReminder: false });
    expect(env.events).toContainEqual({ type: 'data-changed', scope: 'settings' });
    const row = await env.db.get<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'backup.lastExportAt'`);
    expect(JSON.parse(row?.value as string)).toBe('2030-01-10T07:30:00.000Z');
  });

  it('un allegato sparito dallo storage non blocca il backup: la riga resta e il file e segnalato', async () => {
    await env.files.remove(attachmentFilePath(env.dirs, g.invoice.storedPath) as string);
    const r = unwrap(await exportBackup(env.deps));
    expect(r.attachmentFiles).toBe(1);
    expect(r.skippedFiles).toEqual([{ attachmentId: g.invoice.id, path: g.invoice.storedPath, reason: 'missing' }]);
    const { doc, entries } = await openZip(r.path);
    expect(doc.data['attachments']).toHaveLength(2);
    expect(doc.files).toHaveLength(1);
    expect(entries.has(g.invoice.storedPath)).toBe(false);
  });

  it('un allegato alterato (hash diverso) blocca l esportazione con HASH_MISMATCH e non scrive nulla', async () => {
    await env.files.write(attachmentFilePath(env.dirs, g.registration.storedPath) as string, new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]));
    const r = await exportBackup(env.deps);
    expect(errorCode(r)).toBe('HASH_MISMATCH');
    expect(await env.files.list(env.dirs.backups)).toEqual([]);
    const row = await env.db.get<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'backup.lastExportAt'`);
    expect(JSON.parse(row?.value as string)).toBeNull();
  });

  it('tiene solo gli ultimi backup nella cartella dell app', async () => {
    for (let day = 1; day <= KEEP_BACKUPS + 2; day++) {
      env.clock.set(`2026-10-${String(day).padStart(2, '0')}T07:30:00.000Z`);
      unwrap(await exportBackup(env.deps));
    }
    const names = (await env.files.list(env.dirs.backups)).sort();
    expect(names).toEqual(['MyGarage-2026-10-03.zip', 'MyGarage-2026-10-04.zip', 'MyGarage-2026-10-05.zip']);
  });

  it('con csv aggiunge la cartella csv/ nella variante scelta', async () => {
    const r = unwrap(await exportBackup(env.deps, { csv: 'excel-it' }));
    const { entries } = await openZip(r.path);
    const csvNames = [...entries.keys()].filter((n) => n.startsWith('csv/')).sort();
    expect(csvNames).toContain('csv/veicoli.csv');
    expect(csvNames).toContain('csv/rifornimenti.csv');
    expect([...(entries.get('csv/veicoli.csv') as Uint8Array).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8
  });

  it('un garage vuoto si esporta comunque', async () => {
    const empty = await makeBackupEnv({ idStart: 900_000 });
    try {
      const r = unwrap(await exportBackup(empty.deps));
      expect(r.attachmentFiles).toBe(0);
      expect((await docOf(empty)).data['vehicles']).toEqual([]);
    } finally {
      empty.cleanup();
    }
  });
});

describe('getBackupStatus', () => {
  it('il banner serve con dati, almeno 5 modifiche e 30 giorni senza backup (F-06, 6.3.4)', async () => {
    const empty = await makeBackupEnv({ idStart: 900_000 });
    try {
      expect(await getBackupStatus(empty.deps)).toMatchObject({ hasData: false, needsReminder: false, changesSinceBackup: 0, lastBackupAt: null, daysSinceLastBackup: null });
    } finally {
      empty.cleanup();
    }

    // mai fatto un backup: il conto dei giorni parte dal primo dato (le righe di prova sono del 2026-06-01: 129 giorni fa)
    let st = await getBackupStatus(env.deps);
    expect(st).toMatchObject({ lastBackupAt: null, daysSinceLastBackup: null, hasData: true, nudgeDays: 14 });
    expect(st.changesSinceBackup).toBeGreaterThanOrEqual(5);
    expect(st.needsReminder).toBe(true);

    // appena fatto: nessuna modifica (orologio nel 2030: i trigger di updated_at usano l'ora vera del PC)
    env.clock.set('2030-01-10T07:30:00.000Z');
    unwrap(await exportBackup(env.deps));
    st = await getBackupStatus(env.deps);
    expect(st).toMatchObject({ changesSinceBackup: 0, needsReminder: false });

    // 4 modifiche e 20 giorni: non basta; alla quinta modifica si
    env.clock.set('2030-01-30T07:30:00.000Z');
    for (let i = 0; i < 4; i++) {
      await insertRow(env.db, 'workshops', { id: `01TESTID0000000000009000${10 + i}`, name: `Officina ${i}`, created_at: '2030-01-30T07:00:00.000Z', updated_at: '2030-01-30T07:00:00.000Z' });
    }
    st = await getBackupStatus(env.deps);
    expect(st).toMatchObject({ changesSinceBackup: 4, daysSinceLastBackup: 20, needsReminder: false });
    await insertRow(env.db, 'workshops', { id: '01TESTID000000000000900014', name: 'Officina 4', created_at: '2030-01-30T07:00:00.000Z', updated_at: '2030-01-30T07:00:00.000Z' });
    st = await getBackupStatus(env.deps);
    expect(st).toMatchObject({ changesSinceBackup: 5, needsReminder: true });

    // le modifiche all'auto demo non contano
    await insertRow(env.db, 'vehicles', vehicleRow({ is_demo: 1, created_at: '2030-01-30T07:00:00.000Z', updated_at: '2030-01-30T07:00:00.000Z' }));
    expect((await getBackupStatus(env.deps)).changesSinceBackup).toBe(5);
    // con meno di nudgeDays giorni dall'ultimo backup il banner non compare
    env.clock.set('2030-01-15T07:30:00.000Z');
    expect((await getBackupStatus(env.deps)).needsReminder).toBe(false);
  });
});
