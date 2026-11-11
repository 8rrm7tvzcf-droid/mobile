// Runner delle migrazioni (data.md 2.2-2.4): installazione pulita, idempotenza, ricostruzione di tabella,
// rollback, copia di sicurezza, schema piu' nuovo, checksum, numerazione.
/// <reference types="node" />
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createVacuumBackup, backupFileName, toFsPath } from '@/data/db/backup';
import {
  migrate,
  MigrationChecksumError,
  readUserVersion,
  SchemaTooNewError,
  sortMigrations,
  UnknownDatabaseError,
} from '@/data/db/migrate';
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from '@/data/db/migrations';
import { sha256Hex } from '@/data/db/sha256';
import type { Migration } from '@/data/db/types';
import type { SqlDatabase } from '@/domain/ports';
import { ADAPTERS, type OpenedDb } from '../../support/adapters';
import { errorOf, fuelLogRow, insertRow, vehicleRow } from '../../support/db';
import { migrationFuelLng } from '../../support/migrations';
import { createNodeFileStore, makeTempDir } from '../../support/nodeFileStore';
import { openNodeDb } from '../../support/nodeSqlite';

const m2 = migrationFuelLng;
const opts = { appVersion: '1.2.3', hash: sha256Hex, strictChecksums: true } as const;

describe.each(ADAPTERS)('migrazioni su $name', (adapter) => {
  const opened: OpenedDb[] = [];
  const open = async (): Promise<SqlDatabase> => {
    const o = await adapter.open();
    opened.push(o);
    return o.db;
  };
  afterEach(async () => {
    for (const o of opened.splice(0)) await o.close();
  });

  it('installazione pulita 0 -> N: user_version, migrations_log con checksum e versione app', async () => {
    const db = await open();
    const res = await migrate(db, MIGRATIONS, opts);
    expect(res).toEqual({ from: 0, to: LATEST_SCHEMA_VERSION, applied: [1] });
    expect(await readUserVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    const log = await db.all<{ version: number; name: string; checksum: string; app_version: string }>('SELECT * FROM migrations_log');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ version: 1, name: 'init', app_version: '1.2.3' });
    expect(log[0]?.checksum).toBe(sha256Hex((MIGRATIONS[0] as Migration).up.join(';\n')));
    expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('rieseguire e un no-op (nessuna riga di log in piu, nessuna modifica)', async () => {
    const db = await open();
    await migrate(db, MIGRATIONS, opts);
    const again = await migrate(db, MIGRATIONS, opts);
    expect(again).toEqual({ from: LATEST_SCHEMA_VERSION, to: LATEST_SCHEMA_VERSION, applied: [] });
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM migrations_log'))?.n).toBe(1);
  });

  it("upgrade 1 -> 2 con ricostruzione di tabella: dati e vincoli preservati, FK di nuovo attive", async () => {
    const db = await open();
    await migrate(db, MIGRATIONS, opts);
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const f = await insertRow(db, 'fuel_logs', fuelLogRow(v, { fuel_type: 'hvo', grade: 'HVO100' }));
    await insertRow(db, 'odometer_readings', {
      id: '01TESTID000000000000000500', vehicle_id: v, read_on: '2026-09-01', km: 1000, source: 'fuel', fuel_log_id: f,
      created_at: '2026-10-08T07:30:00.000Z', updated_at: '2026-10-08T07:30:00.000Z',
    });
    expect(await errorOf(() => db.run(`UPDATE fuel_logs SET fuel_type = 'lng', quantity_unit = 'kg' WHERE id = ?`, [f]))).toMatch(/CHECK constraint failed/);

    const res = await migrate(db, [...MIGRATIONS, m2], opts);
    expect(res).toEqual({ from: 1, to: 2, applied: [2] });
    expect(await readUserVersion(db)).toBe(2);
    expect(await db.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 }); // riacceso dal runner
    expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);

    // dati preservati (colonna `grade` compresa)
    expect(await db.get('SELECT fuel_type, grade, total_cents FROM fuel_logs WHERE id = ?', [f])).toEqual({
      fuel_type: 'hvo', grade: 'HVO100', total_cents: 5500,
    });
    // il nuovo valore del CHECK e' accettato, quelli vecchi no se incoerenti
    await db.run(`UPDATE fuel_logs SET fuel_type = 'lng', quantity_unit = 'kg' WHERE id = ?`, [f]);
    expect(await errorOf(() => db.run(`UPDATE fuel_logs SET fuel_type = 'lng', quantity_unit = 'L' WHERE id = ?`, [f]))).toMatch(/CHECK constraint failed/);
    // vista, indice e trigger sono stati ricreati
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM v_costs WHERE vehicle_id = ?', [v]))?.n).toBe(1);
    expect(await db.get(`SELECT name FROM sqlite_master WHERE name = 'ix_fuel_vehicle_date'`)).toEqual({ name: 'ix_fuel_vehicle_date' });
    await db.run(`UPDATE fuel_logs SET created_at = '2020-01-01T00:00:00.000Z', updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`, [f]);
    await db.run(`UPDATE fuel_logs SET station = 'X' WHERE id = ?`, [f]);
    const touched = await db.get<{ updated_at: string }>('SELECT updated_at FROM fuel_logs WHERE id = ?', [f]);
    expect((touched?.updated_at ?? '') > '2020-01-01T00:00:00.000Z').toBe(true);
    // la cascata dal veicolo funziona ancora (anche verso le tabelle che puntano a fuel_logs)
    await db.run('DELETE FROM vehicles WHERE id = ?', [v]);
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM fuel_logs'))?.n).toBe(0);
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM odometer_readings'))?.n).toBe(0);
  });

  it("una migrazione che fallisce a meta' annulla tutto: schema, log e user_version restano com'erano", async () => {
    const db = await open();
    await migrate(db, MIGRATIONS, opts);
    const broken: Migration = {
      version: 2,
      name: 'rotta',
      up: ['CREATE TABLE prova (id INTEGER PRIMARY KEY) STRICT', 'INSERT INTO prova (id) VALUES (1)', 'INSERT INTO tabella_inesistente VALUES (1)'],
    };
    expect(await errorOf(() => migrate(db, [...MIGRATIONS, broken], opts))).toMatch(/no such table/);
    expect(await readUserVersion(db)).toBe(1);
    expect(await db.get(`SELECT name FROM sqlite_master WHERE name = 'prova'`)).toBeUndefined();
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM migrations_log'))?.n).toBe(1);
    // corretta, si applica
    const fixed: Migration = { ...broken, up: broken.up.slice(0, 2) };
    expect((await migrate(db, [...MIGRATIONS, fixed], opts)).applied).toEqual([2]);
    expect(await db.get('SELECT id FROM prova')).toEqual({ id: 1 });
  });

  it('rebuildsTables: se foreign_key_check trova orfani, rollback totale e foreign_keys torna ON', async () => {
    const db = await open();
    await migrate(db, MIGRATIONS, opts);
    const orphaning: Migration = {
      version: 2,
      name: 'orfani',
      rebuildsTables: true,
      up: [
        `INSERT INTO fuel_logs (id, vehicle_id, filled_on, fuel_type, quantity_milli, quantity_unit, total_cents)
         VALUES ('01TESTID000000000000000777', '01TESTID000000000000000999', '2026-01-01', 'petrol', 1000, 'L', 100)`,
      ],
    };
    expect(await errorOf(() => migrate(db, [...MIGRATIONS, orphaning], opts))).toMatch(/FK violate dopo la migrazione 2/);
    expect(await readUserVersion(db)).toBe(1);
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM fuel_logs'))?.n).toBe(0);
    expect(await db.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
  });
});

describe('migrazioni: regole del runner (su node:sqlite)', () => {
  it('numerazione con buchi rifiutata; l\'ordine di ingresso non conta', async () => {
    const db = openNodeDb();
    const gap: Migration = { version: 3, name: 'buco', up: ['CREATE TABLE x (a INTEGER) STRICT'] };
    expect(await errorOf(() => migrate(db, [...MIGRATIONS, gap], opts))).toMatch(/non consecutive: atteso v2, trovato v3/);
    expect(await errorOf(() => migrate(db, [{ ...MIGRATIONS[0], version: 2 } as Migration], opts))).toMatch(/atteso v1, trovato v2/);
    expect(sortMigrations([m2, ...MIGRATIONS]).map((m) => m.version)).toEqual([1, 2]);
    expect(await readUserVersion(db)).toBe(0); // nulla e' stato toccato
    await db.close();
  });

  it('DB piu nuovo dell\'app: SchemaTooNewError e nessuna scrittura', async () => {
    const db = openNodeDb();
    await migrate(db, [...MIGRATIONS, m2], opts);
    const before = (await db.all('SELECT * FROM migrations_log')).length;
    let caught: unknown;
    try {
      await migrate(db, MIGRATIONS, opts); // app che conosce solo v1, DB a v2
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SchemaTooNewError);
    expect(caught).toMatchObject({ found: 2, supported: 1, name: 'SchemaTooNewError' });
    expect((caught as Error).message).toMatch(/piu' nuovo dell'app/);
    expect((await db.all('SELECT * FROM migrations_log')).length).toBe(before);
    expect(await readUserVersion(db)).toBe(2);
    await db.close();
  });

  it('file sconosciuto (tabelle ma user_version = 0): rifiutato senza toccarlo', async () => {
    const db = openNodeDb();
    await db.exec('CREATE TABLE altro (id INTEGER)');
    expect(await errorOf(() => migrate(db, MIGRATIONS, opts))).toMatch(/file sconosciuto/);
    await expect(migrate(db, MIGRATIONS, opts)).rejects.toBeInstanceOf(UnknownDatabaseError);
    expect(await db.get(`SELECT name FROM sqlite_master WHERE name = 'migrations_log'`)).toBeUndefined();
    await db.close();
  });

  it("checksum: una migrazione modificata dopo l'applicazione e' un errore (strict) o un avviso", async () => {
    const db = openNodeDb();
    await migrate(db, MIGRATIONS, opts);
    const tampered: Migration = { ...(MIGRATIONS[0] as Migration), up: [...(MIGRATIONS[0] as Migration).up, 'SELECT 1'] };
    let strict: unknown;
    try {
      await migrate(db, [tampered], opts);
    } catch (e) {
      strict = e;
    }
    expect(strict).toBeInstanceOf(MigrationChecksumError);
    expect((strict as Error).message).toMatch(/migrazione 1 \(init\) modificata dopo l'applicazione/);

    const warnings: string[] = [];
    const res = await migrate(db, [tampered], { ...opts, strictChecksums: false, onWarn: (m) => warnings.push(m) });
    expect(res.applied).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/modificata dopo l'applicazione/);
    await db.close();
  });

  it('senza migrazioni non fa nulla e non cerca migrations_log', async () => {
    const db = openNodeDb();
    expect(await migrate(db, [], opts)).toEqual({ from: 0, to: 0, applied: [] });
    await db.close();
  });
});

describe('copia di sicurezza pre-migrazione (VACUUM INTO)', () => {
  let tmp: ReturnType<typeof makeTempDir> | undefined;
  afterEach(() => {
    tmp?.cleanup();
    tmp = undefined;
  });

  it('si fa solo se il DB ha gia dati e c\'e da migrare; la copia e apribile, a user_version 1 e con i dati', async () => {
    tmp = makeTempDir();
    const files = createNodeFileStore(tmp.dir);
    const dbPath = join(tmp.dir, 'mygarage.db');
    const db = openNodeDb(dbPath);
    const calls: Array<[number, number]> = [];
    const stamp = { value: '2026-10-08T07:30:00.000Z' };
    const makeBackup = () => createVacuumBackup(db, { dir: join(tmp?.dir ?? '', 'backups'), files, nowIso: () => stamp.value, ensureDir: async (d) => void (await files.write(join(d, '.keep'), new Uint8Array())) });
    const backup = async (from: number, to: number): Promise<void> => {
      calls.push([from, to]);
      await makeBackup()(from, to);
    };

    // installazione pulita: nessuna copia (non c'e' nulla da proteggere)
    await migrate(db, MIGRATIONS, { ...opts, backup });
    expect(calls).toEqual([]);
    const v = await insertRow(db, 'vehicles', vehicleRow({ nickname: 'Panda' }));
    // nessuna migrazione da applicare: nessuna copia
    await migrate(db, MIGRATIONS, { ...opts, backup });
    expect(calls).toEqual([]);

    // upgrade: copia PRIMA di migrare
    await migrate(db, [...MIGRATIONS, m2], { ...opts, backup });
    expect(calls).toEqual([[1, 2]]);
    const name = backupFileName(1, 2, stamp.value);
    expect(name).toBe('pre-v1-to-v2-2026-10-08T07-30-00-000Z.db');
    const copyPath = join(tmp.dir, 'backups', name);
    expect(existsSync(copyPath)).toBe(true);
    const copy = new DatabaseSync(copyPath, { readOnly: true });
    expect(copy.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    expect(copy.prepare('SELECT nickname FROM vehicles WHERE id = ?').get(v)).toEqual({ nickname: 'Panda' });
    copy.close();
    // il DB vero e migrato
    expect(await readUserVersion(db)).toBe(2);
    await db.close();
  });

  it('rotazione: si tengono le ultime N copie (le piu recenti per timestamp)', async () => {
    tmp = makeTempDir();
    const files = createNodeFileStore(tmp.dir);
    const db = openNodeDb(join(tmp.dir, 'mygarage.db'));
    await migrate(db, MIGRATIONS, opts);
    const dir = join(tmp.dir, 'backups');
    const stamps = ['2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'];
    for (const s of stamps) {
      await createVacuumBackup(db, { dir, files, nowIso: () => s, keep: 3, ensureDir: async (d) => void (await files.write(join(d, '.keep'), new Uint8Array())) })(1, 2);
    }
    const left = readdirSync(dir).filter((n) => n.endsWith('.db')).sort();
    expect(left).toEqual(stamps.slice(2).map((s) => backupFileName(1, 2, s)));
    expect(existsSync(join(dir, '.keep'))).toBe(true); // i file estranei non si toccano
    await db.close();
  });

  it('toFsPath toglie file:// e decodifica gli spazi; i percorsi normali restano', () => {
    expect(toFsPath('file:///data/user/0/app/files/SQLite/backups')).toBe('/data/user/0/app/files/SQLite/backups');
    expect(toFsPath('file:///data/My%20Files/x')).toBe('/data/My Files/x');
    expect(toFsPath('C:\\temp\\x')).toBe('C:\\temp\\x');
  });
});
