// Round-trip esporta -> cancella -> importa (AC-11): «Sostituisci» e «Unisci» con dati e file identici.
/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addAttachment, attachmentFilePath, getAttachment } from '@/usecases/attachments';
import { exportBackup, getBackupStatus, importBackup, inspectBackup, wipeAllData } from '@/usecases/backup';
import { insertRow, vehicleRow } from '../../../support/db';
import { ulidOf } from '../../../support/fakes';
import { SAMPLE_IDS } from '../../../support/sampleData';
import { backupZipFrom, cloneDoc, readBackup } from './craft';
import { count, dirContents, docOf, jpegBytes, makeBackupEnv, pdfBytes, seedGarage, unwrap, type BackupEnv, type Garage } from './harness';

let a: BackupEnv;
let ga: Garage;
let b: BackupEnv;
beforeEach(async () => {
  a = await makeBackupEnv({ nowIso: '2026-10-08T07:30:00.000Z' });
  ga = await seedGarage(a);
  b = await makeBackupEnv({ nowIso: '2030-01-09T09:00:00.000Z', idStart: 700_000 /* nel 2030: i trigger di updated_at usano l'ora vera del PC */ });
});
afterEach(() => {
  a.cleanup();
  b.cleanup();
});

/** I due file esportati (fattura e libretto) come sono nello storage di A. */
async function exportedFiles(): Promise<Record<string, string>> {
  const all = await dirContents(a, a.dirs.attachments);
  const keep: Record<string, string> = {};
  for (const att of [ga.invoice, ga.registration]) {
    const name = att.storedPath.slice('attachments/'.length);
    keep[name] = all[name] as string;
  }
  return keep;
}

describe('Sostituisci', () => {
  it('esporta da A e importa in un database nuovo B: dati, file e promemoria identici; export(import(export(DB))) uguale', async () => {
    const exp = unwrap(await exportBackup(a.deps, { appVersion: '0.1.0' }));
    const docA = await docOf(a);
    b.clock.set('2026-10-08T07:30:00.000Z'); // stesso giorno di A: la riconciliazione dei promemoria non cambia nessuna cache

    const preview = unwrap(await inspectBackup(b.deps, exp.path));
    expect(preview).toMatchObject({
      formatVersion: 1,
      schemaVersion: 1,
      appVersion: '0.1.0',
      exportedAt: '2026-10-08T07:30:00.000Z',
      includesTrash: false,
      summary: { vehicles: 1, services: 1, fuelLogs: 2, expenses: 2, policies: 1, attachments: 2 },
      attachmentFiles: 2,
      attachmentsWithoutFile: 0,
      jsonOnly: false,
      localVehicles: 0,
      plateConflicts: [],
    });
    expect(await count(b.db, 'vehicles')).toBe(0); // l'anteprima non scrive nulla

    const r = unwrap(await importBackup(b.deps, exp.path, { mode: 'replace' }));
    const total = Object.values(docA.counts).reduce((n, c) => n + c, 0);
    expect(r).toMatchObject({ mode: 'replace', inserted: total, updated: 0, keptLocal: 0, attachmentFilesInstalled: 2, attachmentsWithoutFile: [], skippedSettings: [] });
    expect(r.backup).toEqual({ exportedAt: '2026-10-08T07:30:00.000Z', appVersion: '0.1.0', formatVersion: 1 });
    expect(b.events.filter((e) => e.type === 'backup-imported')).toHaveLength(1);

    const docB = await docOf(b);
    expect(docB.data).toEqual(docA.data);
    expect(docB.files).toEqual(docA.files);
    expect(docB.counts).toEqual(docA.counts);
    expect(JSON.stringify(docB.data)).toBe(JSON.stringify(docA.data)); // identico anche byte per byte
    expect({ ...docB.settings, 'onboarding.done': null }).toEqual({ ...docA.settings, 'onboarding.done': null });

    expect(await dirContents(b, b.dirs.attachments)).toEqual(await exportedFiles()); // file identici nello storage di B
    expect(await b.db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect((await b.db.get<{ integrity_check: string }>('PRAGMA integrity_check'))?.integrity_check).toBe('ok');
    expect((await getAttachment(b.deps, ga.registration.id))?.expiresOn).toBe('2027-03-15'); // la scadenza del libretto e' ancora collegata
    // le cache dei promemoria sono ricalcolate; il dispositivo resta quello locale
    const reminder = await b.db.get<{ effective_due_on: string | null }>('SELECT effective_due_on FROM reminders WHERE id = ?', [ulidOf(70)]);
    expect(reminder?.effective_due_on).not.toBeNull();
    const device = await b.db.get<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'device.id'`);
    expect(JSON.parse(device?.value as string)).toMatch(/^01TESTID0+90\d\d$/);
    // dopo l'importazione il contatore delle modifiche riparte e l'onboarding e' fatto
    expect((await getBackupStatus(b.deps)).lastBackupAt).toBe('2026-10-08T07:30:00.000Z');
    const onboarding = await b.db.get<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'onboarding.done'`);
    expect(JSON.parse(onboarding?.value as string)).toBe(true);
    // secondo giro: esportare B da lo stesso JSON dei dati di A
    const exp2 = unwrap(await exportBackup(b.deps));
    expect((await readBackup(b, exp2.path)).doc.data).toEqual((await readBackup(a, exp.path)).doc.data);
  });

  it('esporta -> cancella tutti i dati -> importa nello stesso dispositivo: tutto come prima', async () => {
    const exp = unwrap(await exportBackup(a.deps));
    const bytes = new Uint8Array(await a.files.read(exp.path)); // il file condiviso fuori dall'app
    const before = await docOf(a);
    const filesBefore = await exportedFiles();

    const wiped = await wipeAllData({ ...a.deps, scheduler: a.scheduler });
    expect(wiped.complete).toBe(true);
    expect((await docOf(a)).data['vehicles']).toEqual([]);
    expect(await a.files.list(a.dirs.attachments)).toEqual([]);

    unwrap(await importBackup(a.deps, bytes, { mode: 'replace' }));
    const after = await docOf(a);
    expect(after.data).toEqual(before.data);
    expect(after.settings['doc.expiry.' + ga.registration.id]).toBe(ga.registration.deadlineId);
    expect(await dirContents(a, a.dirs.attachments)).toEqual(filesBefore);
  });

  it('su un dispositivo con altri dati li sostituisce: righe e file vecchi spariscono, la copia di sicurezza li conserva', async () => {
    const exp = unwrap(await exportBackup(a.deps));
    // B ha una sua auto con un allegato
    const oldVehicle = await insertRow(b.db, 'vehicles', vehicleRow({ plate: 'OLD9999', nickname: 'Vecchia di B' }));
    const old = unwrap(await addAttachment(b.deps, { parent: { type: 'vehicle', id: oldVehicle }, file: await b.pick('vecchio.pdf', pdfBytes(40), 'application/pdf'), title: 'Vecchio' }));
    const oldFile = attachmentFilePath(b.dirs, old.storedPath) as string;
    expect(await b.files.exists(oldFile)).toBe(true);
    expect(unwrap(await inspectBackup(b.deps, exp.path)).localVehicles).toBe(1);
    const nowB = b.clock.nowIso();

    const r = unwrap(await importBackup(b.deps, exp.path, { mode: 'replace' }));
    expect(await count(b.db, 'vehicles', `id = '${oldVehicle}'`)).toBe(0);
    expect(await count(b.db, 'attachments', `id = '${old.id}'`)).toBe(0);
    expect(await b.files.exists(oldFile)).toBe(false); // il file vecchio e' uscito dalla coda
    expect(await count(b.db, 'pending_file_deletions')).toBe(0);
    expect(Object.keys(await dirContents(b, b.dirs.attachments)).sort()).toEqual(Object.keys(await exportedFiles()).sort());

    // dopo l'importazione il contatore delle modifiche riparte
    expect(await getBackupStatus(b.deps)).toMatchObject({ lastBackupAt: nowB, changesSinceBackup: 0 });
    // la copia di sicurezza e' un database SQLite valido con i dati di prima
    expect(r.safetyCopyPath).toMatch(/pre-import-.*\.db$/);
    expect(r.safetyCopyPath?.startsWith(b.dirs.backups)).toBe(true);
    const copy = new DatabaseSync(r.safetyCopyPath as string, { readOnly: true });
    try {
      const rows = copy.prepare('SELECT plate FROM vehicles').all() as { plate: string }[];
      expect(rows.map((x) => x.plate)).toEqual(['OLD9999']);
    } finally {
      copy.close();
    }
  });

  it('accetta anche i byte del file e un data.json senza allegati (gli allegati restano senza file)', async () => {
    const exp = unwrap(await exportBackup(a.deps));
    const { doc } = await readBackup(a, exp.path);
    const json = new TextEncoder().encode(JSON.stringify(doc));
    const preview = unwrap(await inspectBackup(b.deps, json));
    expect(preview).toMatchObject({ jsonOnly: true, attachmentFiles: 0, attachmentsWithoutFile: 2 });
    const r = unwrap(await importBackup(b.deps, json, { mode: 'replace' }));
    expect(r.attachmentFilesInstalled).toBe(0);
    expect(r.attachmentsWithoutFile.sort()).toEqual([ga.invoice.id, ga.registration.id].sort());
    expect(await count(b.db, 'attachments')).toBe(2);
    expect(await b.files.list(b.dirs.attachments)).toEqual([]);
    expect(await b.db.all('PRAGMA foreign_key_check')).toEqual([]);

    // gli stessi byte dello ZIP funzionano come il percorso
    const c = await makeBackupEnv({ idStart: 800_000 });
    try {
      const zipBytes = new Uint8Array(await a.files.read(exp.path));
      unwrap(await importBackup(c.deps, zipBytes, { mode: 'replace' }));
      expect((await docOf(c)).data).toEqual((await docOf(a)).data);
    } finally {
      c.cleanup();
    }
  });

  it('impostazioni: solo chiavi note e valori validi; quelle locali non si toccano', async () => {
    const exp = unwrap(await exportBackup(a.deps));
    const { doc, files } = await readBackup(a, exp.path);
    const doc2 = cloneDoc(doc);
    doc2.settings = {
      ...doc2.settings,
      'notify.time': 'abc', // non valido
      'unknown.key': 1, // sconosciuta
      'device.id': '01XXXXXXXXXXXXXXXXXXXXXXXX', // locale
      'backup.lastExportAt': '2000-01-01T00:00:00.000Z', // locale
      'notify.enabled': false,
    };
    const r = unwrap(await importBackup(b.deps, backupZipFrom(doc2, files), { mode: 'replace' }));
    expect(r.skippedSettings.sort()).toEqual(['notify.time', 'unknown.key']);
    const get = async (k: string): Promise<unknown> => JSON.parse(((await b.db.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [k])) as { value: string }).value);
    expect(await get('notify.enabled')).toBe(false);
    expect(await get('notify.privacy')).toBe('full');
    expect(await get('notify.time')).toBe('09:00'); // il valore locale resta
    expect(await get('device.id')).not.toBe('01XXXXXXXXXXXXXXXXXXXXXXXX');
    expect(await get('backup.lastExportAt')).toBe('2030-01-09T09:00:00.000Z');
    expect(await count(b.db, 'app_settings', `key = 'unknown.key'`)).toBe(0);
  });
});

describe('dopo l importazione', () => {
  it('le colonne cache dei promemoria si ricalcolano sempre: un valore sbagliato nel file non sopravvive', async () => {
    const exp = unwrap(await exportBackup(a.deps));
    const { doc, files } = await readBackup(a, exp.path);
    const tampered = cloneDoc(doc);
    const reminder = (tampered.data['reminders'] as unknown as Record<string, unknown>[]).find((r) => r['id'] === ulidOf(70)) as Record<string, unknown>;
    expect(reminder['effective_due_on']).toBe('2027-03-01');
    reminder['effective_due_on'] = '2031-01-01';
    reminder['forecast_on'] = '2040-01-01';
    unwrap(await importBackup(b.deps, backupZipFrom(tampered, files), { mode: 'replace' }));
    const after = await b.db.get<{ effective_due_on: string; forecast_on: string | null }>('SELECT effective_due_on, forecast_on FROM reminders WHERE id = ?', [ulidOf(70)]);
    expect(after?.effective_due_on).toBe('2027-03-01'); // ricalcolato dalla regola e dall'ultimo intervento
    expect(after?.forecast_on).not.toBe('2040-01-01');
    expect(b.events.some((e) => e.type === 'data-changed' && e.scope === 'reminders')).toBe(true); // la riconciliazione ha cambiato qualcosa
    expect(b.events[b.events.length - 1]).toEqual({ type: 'backup-imported' }); // l'evento che fa ripianificare le notifiche arriva per ultimo
  });
});

describe('sessioni OBD', () => {
  it('viaggiano senza telemetria e con seq riassegnato; adattatore e codici errore compresi', async () => {
    const at = '2026-06-01T08:00:00.000Z';
    await insertRow(a.db, 'obd_adapters', { id: ulidOf(300), name: 'ELM', transport: 'ble', address: 'AA:BB:CC', created_at: at, updated_at: at });
    await insertRow(a.db, 'obd_sessions', { id: ulidOf(320), seq: 7, vehicle_id: ga.vehicleId, adapter_id: ulidOf(300), kind: 'snapshot', started_at: at, created_at: at, updated_at: at });
    await a.db.run('INSERT INTO telemetry_samples (session_seq, pid, t_ms, value) VALUES (7, 12, 0, 850)');
    await a.db.run(`UPDATE dtc_events SET session_id = ?, updated_at = '2026-06-02T00:00:00.000Z' WHERE id = ?`, [ulidOf(320), ulidOf(112)]);
    const exp = unwrap(await exportBackup(a.deps));
    const { doc } = await readBackup(a, exp.path);
    expect(doc.data['obd_adapters']).toHaveLength(1);
    expect(doc.data['obd_sessions']).toHaveLength(1);
    expect(doc.data['obd_sessions']?.[0]).not.toHaveProperty('seq');
    expect(doc.data['telemetry_samples']).toBeUndefined();

    b.clock.set('2026-10-08T07:30:00.000Z'); // stesso giorno di A: le cache dei promemoria non cambiano
    unwrap(await importBackup(b.deps, exp.path, { mode: 'replace' }));
    expect(await b.db.all('SELECT seq FROM obd_sessions')).toEqual([{ seq: 1 }]);
    expect(await count(b.db, 'telemetry_samples')).toBe(0);
    expect((await b.db.get<{ session_id: string }>('SELECT session_id FROM dtc_events WHERE id = ?', [ulidOf(112)]))?.session_id).toBe(ulidOf(320));
    expect((await docOf(b)).data).toEqual((await docOf(a)).data);

    // in «Unisci» il numero d'ordine continua da quello locale
    const c = await makeBackupEnv({ idStart: 800_000 });
    try {
      const own = await insertRow(c.db, 'vehicles', vehicleRow({ plate: 'ALTRA01' }));
      await insertRow(c.db, 'obd_sessions', { id: ulidOf(330), seq: 3, vehicle_id: own, kind: 'snapshot', started_at: at, created_at: at, updated_at: at });
      unwrap(await importBackup(c.deps, exp.path, { mode: 'merge' }));
      expect(await c.db.all('SELECT seq FROM obd_sessions ORDER BY seq')).toEqual([{ seq: 3 }, { seq: 4 }]);
    } finally {
      c.cleanup();
    }
  });
});

describe('Unisci', () => {
  it('upsert per id: vince updated_at piu recente, le righe nuove si inseriscono, i dati locali non si cancellano mai', async () => {
    // A: un adattatore OBD collegato all'auto (lo stesso apparecchio ha un altro ULID su B)
    const at = '2026-06-01T08:00:00.000Z';
    await insertRow(a.db, 'obd_adapters', { id: ulidOf(300), name: 'ELM di A', transport: 'ble', address: 'AA:BB:CC', created_at: at, updated_at: at });
    await a.db.run(`UPDATE vehicles SET preferred_adapter_id = ?, updated_at = '2026-06-02T08:00:00.000Z' WHERE id = ?`, [ulidOf(300), ga.vehicleId]);

    const first = unwrap(await exportBackup(a.deps));
    unwrap(await importBackup(b.deps, first.path, { mode: 'replace' })); // B = A
    // B ha il proprio adattatore con lo stesso indirizzo: in «Unisci» il backup si riallaccia a quello locale
    await b.db.run('DELETE FROM obd_adapters');
    await insertRow(b.db, 'obd_adapters', { id: ulidOf(301), name: 'ELM di B', transport: 'ble', address: 'AA:BB:CC', created_at: at, updated_at: at });
    await b.db.run(`UPDATE vehicles SET preferred_adapter_id = ?, updated_at = '2026-06-03T08:00:00.000Z' WHERE id = ?`, [ulidOf(301), ga.vehicleId]);

    // modifiche: B tocca un rifornimento (piu' recente del backup) e ha un officina solo sua
    await b.db.run(`UPDATE fuel_logs SET total_cents = 9999, updated_at = '2026-10-09T08:00:00.000Z' WHERE id = ?`, [ulidOf(50)]);
    await insertRow(b.db, 'workshops', { id: ulidOf(310), name: 'Solo su B', created_at: at, updated_at: at });
    // A: cambia il titolo dell'intervento (piu' recente), aggiunge un rifornimento e un nuovo allegato
    a.clock.set('2026-10-10T10:00:00.000Z');
    await a.db.run(`UPDATE service_records SET title = 'Tagliando completo', updated_at = '2026-10-10T09:00:00.000Z' WHERE id = ?`, [ga.serviceId]);
    await insertRow(a.db, 'fuel_logs', {
      id: ulidOf(54), vehicle_id: ga.vehicleId, filled_on: '2026-10-05', fuel_type: 'petrol', quantity_milli: 25000, quantity_unit: 'L', total_cents: 4800,
      created_at: '2026-10-05T08:00:00.000Z', updated_at: '2026-10-05T08:00:00.000Z',
    });
    const extra = unwrap(await addAttachment(a.deps, { parent: { type: 'vehicle', id: ga.vehicleId }, file: await a.pick('foto.jpg', jpegBytes(30), 'image/jpeg'), title: 'Foto nuova' }));
    const second = unwrap(await exportBackup(a.deps));

    const stateBefore = await docOf(b);
    const r = unwrap(await importBackup(b.deps, second.path, { mode: 'merge' }));

    expect(r.byTable['service_records']).toEqual({ inserted: 0, updated: 1, keptLocal: 0 });
    expect(r.byTable['fuel_logs']).toEqual({ inserted: 1, updated: 0, keptLocal: 2 }); // il 50 e' piu' recente su B
    expect(r.byTable['attachments']).toEqual({ inserted: 1, updated: 0, keptLocal: 2 });
    expect(r.byTable['obd_adapters']).toEqual({ inserted: 0, updated: 0, keptLocal: 1 });
    expect(r.attachmentFilesInstalled).toBe(1);
    expect(r.inserted).toBe(2);
    expect(r.updated).toBe(1);

    const total = async (id: string): Promise<number> => ((await b.db.get<{ t: number }>('SELECT total_cents AS t FROM fuel_logs WHERE id = ?', [id])) as { t: number }).t;
    expect(await total(ulidOf(50))).toBe(9999); // vince il locale
    expect(await total(ulidOf(54))).toBe(4800); // riga nuova
    const title = await b.db.get<{ title: string }>('SELECT title FROM service_records WHERE id = ?', [ga.serviceId]);
    expect(title?.title).toBe('Tagliando completo'); // vince il backup
    expect(await count(b.db, 'workshops', `id = '${ulidOf(310)}'`)).toBe(1); // mai cancellato
    const vehicle = await b.db.get<{ preferred_adapter_id: string }>('SELECT preferred_adapter_id FROM vehicles WHERE id = ?', [ga.vehicleId]);
    expect(vehicle?.preferred_adapter_id).toBe(ulidOf(301));
    expect(await count(b.db, 'obd_adapters')).toBe(1);
    // il nuovo allegato ha il suo file; quelli vecchi sono rimasti
    expect(await b.files.exists(attachmentFilePath(b.dirs, extra.storedPath) as string)).toBe(true);
    expect(Object.keys(await dirContents(b, b.dirs.attachments))).toHaveLength(3);
    expect(await b.db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(await count(b.db, 'fuel_logs')).toBe((stateBefore.data['fuel_logs'] ?? []).length + 1);

    // una seconda unione dello stesso file non cambia piu' nulla
    const again = unwrap(await importBackup(b.deps, second.path, { mode: 'merge' }));
    expect({ inserted: again.inserted, updated: again.updated }).toEqual({ inserted: 0, updated: 0 });
    expect(again.attachmentFilesInstalled).toBe(0);
  });

  it('un file locale mancante si ripara dal backup quando la riga e identica', async () => {
    const exp = unwrap(await exportBackup(a.deps));
    unwrap(await importBackup(b.deps, exp.path, { mode: 'replace' }));
    const lost = attachmentFilePath(b.dirs, ga.invoice.storedPath) as string;
    await b.files.remove(lost);
    const r = unwrap(await importBackup(b.deps, exp.path, { mode: 'merge' }));
    expect({ inserted: r.inserted, updated: r.updated }).toEqual({ inserted: 0, updated: 0 });
    expect(r.attachmentFilesInstalled).toBe(1);
    expect(await b.files.exists(lost)).toBe(true);
  });

  it('non tocca l auto demo locale ne il cestino', async () => {
    const exp = unwrap(await exportBackup(a.deps));
    await insertRow(b.db, 'vehicles', vehicleRow({ id: ulidOf(77), is_demo: 1, nickname: 'Demo di B' }));
    await insertRow(b.db, 'vehicles', vehicleRow({ id: ulidOf(78), plate: 'GONE001', deleted_at: '2026-09-01T00:00:00.000Z' }));
    unwrap(await importBackup(b.deps, exp.path, { mode: 'merge' }));
    expect(await count(b.db, 'vehicles', `id IN ('${ulidOf(77)}', '${ulidOf(78)}')`)).toBe(2);
    expect(await count(b.db, 'vehicles', `id = '${SAMPLE_IDS.vehicle1}'`)).toBe(1);
  });
});
