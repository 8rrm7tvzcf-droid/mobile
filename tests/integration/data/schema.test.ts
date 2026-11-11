/// <reference types="node" />
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from '@/data/db/migrations';
import { TOUCH_TABLES } from '@/data/db/migrations/0001_init';
import { openBootedDb, schemaSnapshot } from '../../support/db';

const SNAPSHOT = fileURLToPath(new URL('../../fixtures/db/schema.snapshot.sql', import.meta.url));

describe('schema: snapshot e struttura', () => {
  it('lo schema coincide con l\'istantanea committata (una modifica involontaria a una migrazione vecchia fa fallire)', async () => {
    const { db } = await openBootedDb();
    const actual = await schemaSnapshot(db);
    if (process.env['UPDATE_SNAPSHOT'] === '1' || !existsSync(SNAPSHOT)) {
      writeFileSync(SNAPSHOT, actual, 'utf8');
    }
    const expected = readFileSync(SNAPSHOT, 'utf8');
    expect(actual.replace(/\r\n/g, '\n')).toBe(expected.replace(/\r\n/g, '\n'));
  });

  it('conta tabelle, indici, trigger e viste attesi (28 / 74 / 26 / 3)', async () => {
    const { db } = await openBootedDb();
    const rows = await db.all<{ type: string; n: number }>(
      `SELECT type, count(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' OR type = 'index' GROUP BY type`,
    );
    const by = Object.fromEntries(rows.map((r) => [r.type, r.n]));
    // 28 tabelle (+ sqlite_sequence, esclusa); 74 indici inclusi gli automatici; 3 viste;
    // 26 trigger = 23 di data.md + 1 touch di odometer_readings + 2 di M-5

    expect(by['table']).toBe(28);
    expect(by['index']).toBe(74);
    expect(by['trigger']).toBe(26);
    expect(by['view']).toBe(3);
  });

  it('tutte le tabelle sono STRICT', async () => {
    const { db } = await openBootedDb();
    const rows = await db.all<{ name: string; strict: number }>(
      `SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%'`,
    );
    expect(rows).toHaveLength(28);
    expect(rows.filter((r) => r.strict !== 1).map((r) => r.name)).toEqual([]);
  });

  it('ogni tabella con updated_at ha il suo trigger trg_<tabella>_touch (21)', async () => {
    const { db } = await openBootedDb();
    expect(TOUCH_TABLES).toHaveLength(21);
    const triggers = (
      await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_%_touch'`)
    ).map((r) => r.name);
    expect(triggers.sort()).toEqual(TOUCH_TABLES.map((t) => `trg_${t}_touch`).sort());
    // e viceversa: ogni tabella con colonna updated_at (tranne app_settings, che la gestisce il repository) e' coperta
    const withUpdatedAt = await db.all<{ name: string }>(
      `SELECT m.name FROM sqlite_master m, pragma_table_info(m.name) c
       WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND c.name = 'updated_at' ORDER BY m.name`,
    );
    const uncovered = withUpdatedAt.map((r) => r.name).filter((n) => !(TOUCH_TABLES as readonly string[]).includes(n));
    expect(uncovered).toEqual(['app_settings']);
  });

  it('user_version e migrations_log riflettono le migrazioni applicate', async () => {
    const { db } = await openBootedDb();
    expect(await db.get('PRAGMA user_version')).toEqual({ user_version: LATEST_SCHEMA_VERSION });
    const log = await db.all<{ version: number; name: string; checksum: string; app_version: string }>(
      'SELECT version, name, checksum, app_version FROM migrations_log ORDER BY version',
    );
    expect(log.map((l) => l.version)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(log[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(log[0]?.app_version).toBe('test');
  });

  it('integrity_check e foreign_key_check sono puliti dopo il boot', async () => {
    const { db } = await openBootedDb();
    expect(await db.all('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
  });
});
