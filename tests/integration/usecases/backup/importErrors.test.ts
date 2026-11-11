// Importazione: file non riconosciuti, versioni nuove, ZIP corrotti, zip-slip, hash alterati, dati incoerenti e ROLLBACK TOTALE
// (AC-11 punti 2 e 3). Dopo ogni errore il database, gli allegati e la cartella temporanea sono esattamente come prima.
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, importBackup, inspectBackup, upgradeBackup } from '@/usecases/backup';
import type { BackupDocument } from '@/usecases/backup';
import { insertRow, fuelLogRow, vehicleRow } from '../../../support/db';
import { ulidOf } from '../../../support/fakes';
import { backupZipFrom, cloneDoc, readBackup, sha256, zipOf } from './craft';
import { count, dirContents, errorCode, fullState, jpegBytes, makeBackupEnv, pdfBytes, seedGarage, unwrap, type BackupEnv, type Garage } from './harness';

let a: BackupEnv; // sorgente del backup
let ga: Garage;
let t: BackupEnv; // dispositivo di destinazione, con dati propri
let doc: BackupDocument;
let files: Record<string, Uint8Array>;
let goodZip: Uint8Array;

beforeEach(async () => {
  a = await makeBackupEnv();
  ga = await seedGarage(a);
  const exp = unwrap(await exportBackup(a.deps));
  ({ doc, files } = await readBackup(a, exp.path));
  goodZip = new Uint8Array(await a.files.read(exp.path));

  t = await makeBackupEnv({ idStart: 700_000 });
  const local = await insertRow(t.db, 'vehicles', vehicleRow({ id: ulidOf(900), plate: 'LOCALE1', nickname: 'Auto locale' }));
  await insertRow(t.db, 'fuel_logs', fuelLogRow(local));
  const { addAttachment } = await import('@/usecases/attachments');
  unwrap(await addAttachment(t.deps, { parent: { type: 'vehicle', id: local }, file: await t.pick('locale.pdf', pdfBytes(77), 'application/pdf'), title: 'Locale' }));
});
afterEach(() => {
  a.cleanup();
  t.cleanup();
});

/** Importa e verifica che non sia cambiato nulla: database, allegati, cartella temporanea, eventi. */
async function expectRejected(source: Uint8Array | string, mode: 'replace' | 'merge', code: string, deps = t.deps): Promise<void> {
  const state = await fullState(t);
  const attachments = await dirContents(t, t.dirs.attachments);
  t.events.length = 0;
  const r = await importBackup(deps, source, { mode });
  expect(errorCode(r)).toBe(code);
  expect(await fullState(t)).toBe(state);
  expect(await dirContents(t, t.dirs.attachments)).toEqual(attachments);
  expect(await t.files.list(t.dirs.temp)).toEqual([]);
  expect(await t.files.list(t.dirs.backups)).toEqual([]); // nessuna copia di sicurezza inutile
  expect(t.events.filter((e) => e.type === 'backup-imported')).toEqual([]);
}

describe('file non riconosciuti', () => {
  const json = (o: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(o));
  const cases: [string, () => Uint8Array][] = [
    ['byte casuali', () => new Uint8Array([1, 2, 3, 4, 5])],
    ['file vuoto', () => new Uint8Array(0)],
    ['un PDF', () => pdfBytes(1)],
    ['ZIP senza manifest.json', () => zipOf({ 'data.json': '{}' })],
    ['ZIP senza data.json', () => zipOf({ 'manifest.json': '{}' })],
    ['ZIP di un altro programma', () => zipOf({ 'foto.txt': 'ciao' })],
    ['manifest di un altro formato', () => zipOf({ 'manifest.json': JSON.stringify({ format: 'autogarage.backup', files: [] }), 'data.json': '{}' })],
    ['JSON di un altro formato', () => json({ format: 'autogarage.backup', formatVersion: 1, data: {} })],
    ['JSON qualunque', () => json({ a: 1 })],
  ];
  it.each(cases)('%s -> NOT_A_BACKUP', async (_name, make) => {
    await expectRejected(make(), 'replace', 'NOT_A_BACKUP');
    expect(errorCode(await inspectBackup(t.deps, make()))).toBe('NOT_A_BACKUP');
  });

  it('un percorso che non esiste -> SOURCE_UNREADABLE', async () => {
    await expectRejected(join(t.root, 'non-esiste.zip'), 'replace', 'SOURCE_UNREADABLE');
    expect(errorCode(await inspectBackup(t.deps, join(t.root, 'non-esiste.zip')))).toBe('SOURCE_UNREADABLE');
  });
});

describe('versioni', () => {
  it('formatVersion piu alta -> BACKUP_TOO_NEW (ZIP e JSON), senza scrivere nulla', async () => {
    const newer = { ...cloneDoc(doc), formatVersion: 2 };
    await expectRejected(backupZipFrom(newer, files), 'replace', 'BACKUP_TOO_NEW');
    await expectRejected(new TextEncoder().encode(JSON.stringify(newer)), 'merge', 'BACKUP_TOO_NEW');
    const r = await inspectBackup(t.deps, backupZipFrom(newer, files));
    expect(r).toMatchObject({ ok: false, error: { code: 'BACKUP_TOO_NEW' } });
    expect((r as { error: { message: string } }).error.message).toContain('aggiorna');
  });

  it('schemaVersion piu alta dello schema locale -> BACKUP_TOO_NEW', async () => {
    await expectRejected(backupZipFrom({ ...cloneDoc(doc), schemaVersion: 99 }, files), 'replace', 'BACKUP_TOO_NEW');
  });

  it('formatVersion non valida -> BAD_VERSION', async () => {
    await expectRejected(backupZipFrom({ ...cloneDoc(doc), formatVersion: 0 }, files), 'replace', 'BAD_VERSION');
    await expectRejected(backupZipFrom({ ...cloneDoc(doc), formatVersion: 'uno' }, files), 'replace', 'BAD_VERSION');
  });

  it('la catena di upgrader porta il documento da n a n+1 nell ordine giusto; senza upgrader -> NO_UPGRADER', () => {
    const order: number[] = [];
    const base = { ...cloneDoc(doc), formatVersion: 1 };
    const up = {
      1: (d: BackupDocument): BackupDocument => (order.push(1), { ...d, appVersion: `${d.appVersion}+u1` }),
      2: (d: BackupDocument): BackupDocument => (order.push(2), { ...d, appVersion: `${d.appVersion}+u2` }),
    };
    const out = upgradeBackup(base, up, 3);
    expect(order).toEqual([1, 2]);
    expect(out.formatVersion).toBe(3);
    expect(out.appVersion).toBe('sconosciuta+u1+u2');
    expect(() => upgradeBackup(base, { 1: up[1] }, 3)).toThrowError(/versione 2 alla 3/);
    expect(() => upgradeBackup({ ...base, formatVersion: 4 }, up, 3)).toThrowError(/più recente/);
  });
});

describe('ZIP corrotti e attacchi', () => {
  it('ZIP troncato o con data.json illeggibile -> CORRUPT', async () => {
    await expectRejected(goodZip.slice(0, Math.floor(goodZip.length / 2)), 'replace', 'CORRUPT');
    await expectRejected(zipOf({ 'manifest.json': JSON.stringify({ format: 'mygarage.backup', files: [] }), 'data.json': '{non e json' }), 'replace', 'CORRUPT');
  });

  it.each(['../evil.txt', '/abs/evil.txt', 'attachments/../../evil.txt', 'sub\\evil.txt', 'C:evil.txt', 'a/../../b.txt', 'attachments/sub/x.jpg', 'attachments/x y.jpg'])(
    'zip-slip: la voce %s -> UNSAFE_PATH, nulla scritto',
    async (name) => {
      const zip = backupZipFrom(doc, files, { entries: { [name]: 'contenuto' } });
      await expectRejected(zip, 'replace', 'UNSAFE_PATH');
      await expectRejected(zip, 'merge', 'UNSAFE_PATH');
      expect(await t.files.exists(join(t.root, '..', 'evil.txt'))).toBe(false);
      expect(errorCode(await inspectBackup(t.deps, zip))).toBe('UNSAFE_PATH');
    },
  );

  it('un manifest che elenca un percorso fuori da attachments/ -> UNSAFE_PATH', async () => {
    const bytes = new TextEncoder().encode('x');
    for (const path of ['../x', 'manifest.json.bak', 'attachments/../x.jpg', '/etc/passwd']) {
      const zip = backupZipFrom(doc, {}, { entries: { [path]: bytes }, manifestFiles: [{ path, sha256: sha256(bytes), size: bytes.length }] });
      await expectRejected(zip, 'replace', 'UNSAFE_PATH');
    }
  });

  it('hash o dimensione alterati -> HASH_MISMATCH', async () => {
    const [path, bytes] = Object.entries(files)[0] as [string, Uint8Array];
    const rest = Object.fromEntries(Object.entries(files).slice(1));
    const tampered = new Uint8Array(bytes);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] as number) ^ 0xff;
    // il file nello ZIP non e' quello del manifest
    await expectRejected(backupZipFrom(doc, { ...rest, [path]: tampered }, { manifestFiles: [...Object.entries(rest).map(([p, b]) => ({ path: p, sha256: sha256(b), size: b.length })), { path, sha256: sha256(bytes), size: bytes.length }] }), 'replace', 'HASH_MISMATCH');
    // dimensione diversa nel manifest
    await expectRejected(backupZipFrom(doc, files, { manifestFiles: Object.entries(files).map(([p, b]) => ({ path: p, sha256: sha256(b), size: b.length + 1 })) }), 'replace', 'HASH_MISMATCH');
    // la riga di data.json non corrisponde al file
    const doc2 = cloneDoc(doc);
    (doc2.data['attachments'] as { sha256: string }[])[0]!.sha256 = 'a'.repeat(64);
    await expectRejected(backupZipFrom(doc2, files), 'replace', 'HASH_MISMATCH');
  });

  it('un file elencato nel manifest ma assente -> MISSING_FILE', async () => {
    const [path, bytes] = Object.entries(files)[0] as [string, Uint8Array];
    const rest = Object.fromEntries(Object.entries(files).slice(1));
    const zip = backupZipFrom(doc, rest, { manifestFiles: [...Object.entries(rest).map(([p, b]) => ({ path: p, sha256: sha256(b), size: b.length })), { path, sha256: sha256(bytes), size: bytes.length }] });
    await expectRejected(zip, 'replace', 'MISSING_FILE');
  });

  it('tetto di dimensione: archivio e contenuto decompresso (zip bomb) -> TOO_BIG', async () => {
    expect(errorCode(await importBackup(t.deps, goodZip, { mode: 'replace', maxBytes: 50 }))).toBe('TOO_BIG');
    const bomb = zipOf({ 'riempimento.bin': new Uint8Array(400_000) }); // pochi byte compressi, 400 kB decompressi
    expect(bomb.length).toBeLessThan(5_000);
    expect(errorCode(await importBackup(t.deps, bomb, { mode: 'replace', maxBytes: 100_000 }))).toBe('TOO_BIG');
    expect(errorCode(await inspectBackup(t.deps, bomb, { maxBytes: 100_000 }))).toBe('TOO_BIG');
    expect(await count(t.db, 'vehicles')).toBe(1);
  });
});

describe('dati incoerenti', () => {
  const mutate = (fn: (d: BackupDocument) => void): Uint8Array => {
    const d = cloneDoc(doc);
    fn(d);
    return backupZipFrom(d, files);
  };
  const rows = (d: BackupDocument, table: string): Record<string, unknown>[] => d.data[table] as unknown as Record<string, unknown>[];

  it('colonne sconosciute, nomi di colonna ostili, valori non scalari, id non validi o duplicati -> BAD_DATA', async () => {
    await expectRejected(mutate((d) => (rows(d, 'vehicles')[0]!['colonna_inventata'] = 1)), 'replace', 'BAD_DATA');
    await expectRejected(mutate((d) => (rows(d, 'vehicles')[0]!['id); DROP TABLE vehicles; --'] = 1)), 'replace', 'BAD_DATA');
    await expectRejected(mutate((d) => (rows(d, 'vehicles')[0]!['notes'] = { a: 1 })), 'replace', 'BAD_DATA');
    await expectRejected(mutate((d) => (rows(d, 'vehicles')[0]!['id'] = 'corto')), 'replace', 'BAD_DATA');
    await expectRejected(mutate((d) => rows(d, 'fuel_logs').push({ ...rows(d, 'fuel_logs')[0]! })), 'replace', 'BAD_DATA');
    await expectRejected(mutate((d) => ((d.data as Record<string, unknown>)['vehicles'] = 'non un elenco')), 'replace', 'BAD_DATA');
    expect(await count(t.db, 'vehicles')).toBe(1); // la tabella vehicles esiste ancora
  });

  it('allegati: percorso verso un altro id o fuori da attachments/ -> UNSAFE_PATH; tipo o contenuto non ammessi -> BAD_DATA', async () => {
    await expectRejected(mutate((d) => (rows(d, 'attachments')[0]!['stored_path'] = 'attachments/01OTHER0000000000000000001.jpg')), 'replace', 'UNSAFE_PATH');
    await expectRejected(mutate((d) => (rows(d, 'attachments')[0]!['stored_path'] = '../../fuori.jpg')), 'replace', 'UNSAFE_PATH');
    await expectRejected(mutate((d) => (rows(d, 'attachments')[0]!['mime_type'] = 'text/html')), 'replace', 'BAD_DATA');
    await expectRejected(mutate((d) => (rows(d, 'attachments')[0]!['sha256'] = 'XYZ')), 'replace', 'BAD_DATA');

    // un eseguibile con l'hash giusto ma estensione e riga da immagine
    const evil = new TextEncoder().encode('MZ\u0090\u0000 programma eseguibile');
    const d2 = cloneDoc(doc);
    const att = rows(d2, 'attachments')[0]!;
    const path = att['stored_path'] as string;
    att['sha256'] = sha256(evil);
    att['size_bytes'] = evil.length;
    await expectRejected(backupZipFrom(d2, { ...files, [path]: evil }), 'replace', 'BAD_DATA');
  });
});

describe('rollback totale', () => {
  it('conflitto di targa in «Unisci»: PLATE_CONFLICT e nessuna riga a meta, nessun file copiato, temp pulita', async () => {
    await insertRow(t.db, 'vehicles', vehicleRow({ id: ulidOf(901), plate: 'TEST001', nickname: 'Stessa targa, altro ULID' }));
    const preview = unwrap(await inspectBackup(t.deps, goodZip));
    expect(preview.plateConflicts).toEqual([{ plate: 'TEST001', localVehicleId: ulidOf(901), backupVehicleId: ga.vehicleId }]);
    const r = await importBackup(t.deps, goodZip, { mode: 'merge' });
    expect(r).toMatchObject({ ok: false, error: { code: 'PLATE_CONFLICT' } });
    expect((r as { error: { message: string } }).error.message).toContain('Sostituisci');
    await expectRejected(goodZip, 'merge', 'PLATE_CONFLICT');
    // la strada indicata dall'errore: «Sostituisci» funziona
    unwrap(await importBackup(t.deps, goodZip, { mode: 'replace' }));
    expect(await count(t.db, 'vehicles', `plate = 'TEST001'`)).toBe(1);
  });

  it('riferimento rotto in «Sostituisci»: FK_VIOLATION e i dati locali cancellati dentro la transazione tornano tutti', async () => {
    const d = cloneDoc(doc);
    (d.data['fuel_logs'] as unknown as Record<string, unknown>[])[0]!['vehicle_id'] = '01NONESISTENTE00000000000A';
    await expectRejected(backupZipFrom(d, files), 'replace', 'FK_VIOLATION');
    expect(await count(t.db, 'vehicles', `plate = 'LOCALE1'`)).toBe(1);
    expect(await count(t.db, 'attachments')).toBe(1);
  });

  it('un vincolo CHECK violato a meta dell importazione (importo negativo) annulla anche le righe gia inserite', async () => {
    const d = cloneDoc(doc);
    d.data['workshops'] = [{ id: ulidOf(950), name: 'Officina nuova', created_at: '2026-06-01T08:00:00.000Z', updated_at: '2026-06-01T08:00:00.000Z' } as never, ...(d.data['workshops'] ?? [])];
    const logs = d.data['fuel_logs'] as unknown as Record<string, unknown>[];
    logs[logs.length - 1]!['total_cents'] = -5;
    await expectRejected(backupZipFrom(d, files), 'replace', 'CONSTRAINT_VIOLATION');
    await expectRejected(backupZipFrom(d, files), 'merge', 'CONSTRAINT_VIOLATION');
    expect(await count(t.db, 'workshops')).toBe(0); // l'officina nuova, inserita prima dell'errore, non c'e'
  });

  it('chilometri incoerenti con quelli locali in «Unisci»: ODOMETER_CONFLICT', async () => {
    unwrap(await importBackup(t.deps, goodZip, { mode: 'replace' })); // ora il dispositivo ha le letture 10000 (2026-01-01) e 15000 (2026-06-01)
    const d = cloneDoc(doc);
    const at = '2026-10-01T08:00:00.000Z';
    (d.data['odometer_readings'] as unknown as Record<string, unknown>[]).push({
      id: ulidOf(960), vehicle_id: ga.vehicleId, read_on: '2026-02-01', km: 99999, source: 'manual', status: 'valid',
      fuel_log_id: null, service_record_id: null, fluid_check_id: null, obd_session_id: null, note: null, created_at: at, updated_at: at, deleted_at: null,
    });
    await expectRejected(backupZipFrom(d, files), 'merge', 'ODOMETER_CONFLICT');
  });

  it('copia di sicurezza non riuscita: «Sostituisci» non parte, «Unisci» prosegue senza copia', async () => {
    const failing = { ...t.deps, db: { ...t.db, exec: async (sql: string) => (sql.startsWith('VACUUM INTO') ? Promise.reject(new Error('disco pieno')) : t.db.exec(sql)) } };
    await expectRejected(goodZip, 'replace', 'SAFETY_COPY_FAILED', failing);
    expect(await t.files.list(t.dirs.backups)).toEqual([]); // nemmeno un file di copia a meta'
    const merged = unwrap(await importBackup(failing, goodZip, { mode: 'merge' }));
    expect(merged.safetyCopyPath).toBeNull();
    expect(await count(t.db, 'vehicles')).toBe(2);
  });
});
