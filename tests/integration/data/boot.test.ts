// Sequenza di avvio del database (SPEC 8.6 / data.md 2.5), passi 1-3, e gestione degli errori.
/// <reference types="node" />
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVacuumBackup } from '@/data/db/backup';
import { bootDatabase, DatabaseBootError, openDatabase, type BootOptions } from '@/data/db/boot';
import { MIGRATIONS } from '@/data/db/migrations';
import { compareVersions, MIN_SQLITE_VERSION, readPragmas, SqliteTooOldError } from '@/data/db/pragmas';
import { SchemaTooNewError } from '@/data/db/migrate';
import type { Migration } from '@/data/db/types';
import type { SqlDatabase } from '@/domain/ports';
import { ADAPTERS, type OpenedDb } from '../../support/adapters';
import { insertRow, vehicleRow } from '../../support/db';
import { fixedClock, sequentialIds } from '../../support/fakes';
import { migrationFuelLng } from '../../support/migrations';
import { createNodeFileStore, makeTempDir } from '../../support/nodeFileStore';
import { openNodeDb } from '../../support/nodeSqlite';

const baseOpts = (over: Partial<BootOptions> = {}): BootOptions => ({
  appVersion: '1.0.0',
  deps: { clock: fixedClock(), ids: sequentialIds(9000) },
  strictChecksums: true,
  ...over,
});

async function boot(db: SqlDatabase, over: Partial<BootOptions> = {}): Promise<DatabaseBootError | null> {
  try {
    await bootDatabase(db, baseOpts(over));
    return null;
  } catch (e) {
    if (e instanceof DatabaseBootError) return e;
    throw e;
  }
}

describe.each(ADAPTERS)('bootDatabase su $name', (adapter) => {
  const opened: OpenedDb[] = [];
  const open = async (): Promise<SqlDatabase> => {
    const o = await adapter.open();
    opened.push(o);
    return o.db;
  };
  afterEach(async () => {
    for (const o of opened.splice(0)) await o.close();
  });

  it('primo avvio: PRAGMA, migrazioni e seed (27 template, 13 categorie, impostazioni)', async () => {
    const db = await open();
    const { migration, sqliteVersion } = await bootDatabase(db, baseOpts());
    expect(migration).toEqual({ from: 0, to: MIGRATIONS.length, applied: [1] });
    expect(sqliteVersion).toMatch(/^3\.\d+\.\d+/);
    expect(compareVersions(sqliteVersion, MIN_SQLITE_VERSION)).toBeGreaterThanOrEqual(0);
    const count = async (t: string) => (await db.get<{ n: number }>(`SELECT count(*) AS n FROM ${t}`))?.n;
    expect(await count('service_templates')).toBe(27);
    expect(await count('expense_categories')).toBe(13);
    expect(await count('app_settings')).toBe(17);
    expect(await count('migrations_log')).toBe(1);
    expect((await readPragmas(db)).foreign_keys).toBe(1);
    expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('secondo avvio: nessuna migrazione e nessuna modifica ai dati', async () => {
    const db = await open();
    await bootDatabase(db, baseOpts());
    const v = await insertRow(db, 'vehicles', vehicleRow({ nickname: 'Panda' }));
    const deviceId = (await db.get<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'device.id'`))?.value;
    const { migration } = await bootDatabase(db, baseOpts());
    expect(migration.applied).toEqual([]);
    expect(await db.get('SELECT nickname FROM vehicles WHERE id = ?', [v])).toEqual({ nickname: 'Panda' });
    expect(await db.get(`SELECT value FROM app_settings WHERE key = 'device.id'`)).toEqual({ value: deviceId });
  });
});

describe('bootDatabase: errori (DatabaseBootError con fase e tipo)', () => {
  it('schema piu nuovo dell\'app -> kind schema-too-new, nessuna scrittura, db disponibile per l\'esportazione', async () => {
    const db = openNodeDb();
    await db.exec('PRAGMA user_version = 99');
    const err = await boot(db);
    expect(err).toBeInstanceOf(DatabaseBootError);
    expect(err).toMatchObject({ stage: 'migrate', kind: 'schema-too-new', name: 'DatabaseBootError' });
    expect(err?.cause).toBeInstanceOf(SchemaTooNewError);
    expect(err?.db).toBe(db);
    expect(err?.message).toMatch(/piu' nuovo dell'app/);
    // nessuna scrittura: niente tabelle, niente seed
    expect(await db.get(`SELECT name FROM sqlite_master WHERE type = 'table'`)).toBeUndefined();
    expect(await db.get('PRAGMA user_version')).toEqual({ user_version: 99 });
    await db.close();
  });

  it('file sconosciuto -> kind unknown-database', async () => {
    const db = openNodeDb();
    await db.exec('CREATE TABLE altro (id INTEGER)');
    expect(await boot(db)).toMatchObject({ stage: 'migrate', kind: 'unknown-database' });
    await db.close();
  });

  it('migrazione modificata -> checksum-mismatch in modalita strict; con strict spento solo un avviso', async () => {
    const db = openNodeDb();
    await bootDatabase(db, baseOpts());
    const tampered: Migration = { ...(MIGRATIONS[0] as Migration), up: [...(MIGRATIONS[0] as Migration).up, 'SELECT 1'] };
    expect(await boot(db, { migrations: [tampered] })).toMatchObject({ stage: 'migrate', kind: 'checksum-mismatch' });
    const warn = vi.fn();
    expect(await boot(db, { migrations: [tampered], strictChecksums: false, onWarn: warn })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    await db.close();
  });

  it('migrazione che fallisce -> migration-failed, DB com\'era e seed non eseguiti', async () => {
    const db = openNodeDb();
    await bootDatabase(db, baseOpts());
    const broken: Migration = { version: 2, name: 'rotta', up: ['CREATE TABLE a (x INTEGER) STRICT', 'SELECT * FROM non_esiste'] };
    const err = await boot(db, { migrations: [...MIGRATIONS, broken] });
    expect(err).toMatchObject({ stage: 'migrate', kind: 'migration-failed' });
    expect(await db.get('PRAGMA user_version')).toEqual({ user_version: 1 });
    expect(await db.get(`SELECT name FROM sqlite_master WHERE name = 'a'`)).toBeUndefined();
    await db.close();
  });

  it('seed che fallisce -> seed-failed (le migrazioni gia applicate restano)', async () => {
    const db = openNodeDb();
    const err = await boot(db, {
      deps: {
        clock: fixedClock(),
        ids: {
          ulid: () => {
            throw new Error('generatore guasto');
          },
        },
      },
    });
    expect(err).toMatchObject({ stage: 'seed', kind: 'seed-failed' });
    expect(err?.message).toBe('generatore guasto');
    // il seed e una transazione sola: nessun seed parziale
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM service_templates'))?.n).toBe(0);
    expect(await db.get('PRAGMA user_version')).toEqual({ user_version: 1 });
    // al riavvio con un generatore sano si completa
    expect(await boot(db)).toBeNull();
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM service_templates'))?.n).toBe(27);
    await db.close();
  });

  it('SQLite troppo vecchio (senza STRICT) -> sqlite-too-old prima di toccare lo schema', async () => {
    const real = openNodeDb();
    const old: SqlDatabase = {
      ...real,
      get: async <T>(sql: string, params?: unknown[]) =>
        /sqlite_version/.test(sql) ? ({ v: '3.36.0' } as T) : real.get<T>(sql, params as never),
    };
    const err = await boot(old);
    expect(err).toMatchObject({ stage: 'pragmas', kind: 'sqlite-too-old' });
    expect(err?.cause).toBeInstanceOf(SqliteTooOldError);
    expect(err?.message).toMatch(/SQLite 3\.36\.0 troppo vecchio: serve la 3\.37\.0/);
    expect(await real.get(`SELECT name FROM sqlite_master WHERE type = 'table'`)).toBeUndefined();
    await real.close();
  });

  it('PRAGMA che falliscono -> pragma-failed', async () => {
    const db = openNodeDb();
    await db.close(); // connessione chiusa: ogni istruzione fallisce
    expect(await boot(db)).toMatchObject({ stage: 'pragmas', kind: 'pragma-failed' });
  });
});

describe('compareVersions', () => {
  it('confronta numericamente e non per testo', () => {
    expect(compareVersions('3.37.0', '3.37.0')).toBe(0);
    expect(compareVersions('3.36.9', '3.37.0')).toBeLessThan(0);
    expect(compareVersions('3.100.0', '3.37.0')).toBeGreaterThan(0); // 100 > 37 anche se '1' < '3' come testo
    expect(compareVersions('3.37', '3.37.0')).toBe(0);
    expect(compareVersions('3.37.1', '3.37')).toBeGreaterThan(0);
  });
});

describe('openDatabase', () => {
  it("apre con l'opener della piattaforma e avvia; se l'avvio fallisce l'errore porta il db ancora aperto", async () => {
    const opened = await openDatabase(async () => openNodeDb(), baseOpts());
    expect(opened.boot.migration.to).toBe(MIGRATIONS.length);
    await opened.db.close();

    const newer = openNodeDb();
    await newer.exec('PRAGMA user_version = 42');
    let caught: unknown;
    try {
      await openDatabase(async () => newer, baseOpts());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DatabaseBootError);
    expect((caught as DatabaseBootError).db).toBe(newer);
    expect(await newer.all('SELECT 1 AS ok')).toEqual([{ ok: 1 }]); // ancora utilizzabile (es. per "Esporta DB grezzo")
    await newer.close();
  });
});

describe('boot con copia di sicurezza', () => {
  let tmp: ReturnType<typeof makeTempDir> | undefined;
  afterEach(() => {
    tmp?.cleanup();
    tmp = undefined;
  });

  it('upgrade di un DB con dati: la copia VACUUM INTO viene scritta prima della migrazione', async () => {
    tmp = makeTempDir();
    const files = createNodeFileStore(tmp.dir);
    const db = openNodeDb(join(tmp.dir, 'mygarage.db'));
    const clock = fixedClock('2026-10-08T07:30:00.000Z');
    await bootDatabase(db, baseOpts({ deps: { clock, ids: sequentialIds(9000) } }));
    await insertRow(db, 'vehicles', vehicleRow({ nickname: 'Panda' }));

    const dir = join(tmp.dir, 'backups');
    const backup = createVacuumBackup(db, {
      dir,
      files,
      nowIso: () => clock.nowIso(),
      ensureDir: async (d) => {
        await files.write(join(d, '.keep'), new Uint8Array());
      },
    });
    const spy = vi.fn(backup);
    const { migration } = await bootDatabase(db, baseOpts({ migrations: [...MIGRATIONS, migrationFuelLng], backup: spy }));
    expect(migration).toEqual({ from: 1, to: 2, applied: [2] });
    expect(spy).toHaveBeenCalledWith(1, 2);
    const copies = readdirSync(dir).filter((n) => n.endsWith('.db'));
    expect(copies).toEqual(['pre-v1-to-v2-2026-10-08T07-30-00-000Z.db']);
    expect(existsSync(join(dir, copies[0] ?? ''))).toBe(true);
    await db.close();
  });
});
