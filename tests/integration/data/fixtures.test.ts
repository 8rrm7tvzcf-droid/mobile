// Upgrade da fixture (data.md 2.4 punto 2): per ogni versione dello schema si conserva un DB di esempio
// (tests/fixtures/db/vN.sqlite, dati SINTETICI, nessuna targa o VIN reali) che si migra fino all'ultima versione
// e poi si controlla con integrity_check, foreign_key_check e le query chiave.
//
// Per rigenerare v1.sqlite (consentito SOLO finche' la versione 1 non e' stata rilasciata; dopo il rilascio e'
// immutabile e le modifiche allo schema diventano una migrazione 0002):
//   BUILD_FIXTURES=1 npx vitest run tests/integration/data/fixtures.test.ts
/// <reference types="node" />
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bootDatabase } from '@/data/db/boot';
import { readUserVersion } from '@/data/db/migrate';
import { MIGRATIONS } from '@/data/db/migrations';
import { fixedClock, sequentialIds } from '../../support/fakes';
import { migrationFuelLng } from '../../support/migrations';
import { makeTempDir } from '../../support/nodeFileStore';
import { openNodeDb } from '../../support/nodeSqlite';
import { populateSampleData, SAMPLE_EXPECTED, SAMPLE_IDS } from '../../support/sampleData';

const FIXTURE_DIR = fileURLToPath(new URL('../../fixtures/db/', import.meta.url));
const V1 = join(FIXTURE_DIR, 'v1.sqlite');

async function buildV1(): Promise<void> {
  const tmp = makeTempDir();
  try {
    const work = join(tmp.dir, 'work.db');
    const db = openNodeDb(work);
    await bootDatabase(db, {
      appVersion: 'fixture-v1',
      deps: { clock: fixedClock('2026-06-01T08:00:00.000Z'), ids: sequentialIds(5000) },
      strictChecksums: true,
    });
    await populateSampleData(db);
    mkdirSync(dirname(V1), { recursive: true });
    if (existsSync(V1)) rmSync(V1);
    await db.exec(`VACUUM INTO '${V1.replace(/'/g, "''")}'`); // un solo file, senza -wal
    await db.close();
  } finally {
    tmp.cleanup();
  }
}

beforeAll(async () => {
  if (process.env['BUILD_FIXTURES'] === '1' || !existsSync(V1)) await buildV1();
});

describe('fixture v1.sqlite -> ultima versione', () => {
  let tmp: ReturnType<typeof makeTempDir> | undefined;
  afterEach(() => {
    tmp?.cleanup();
    tmp = undefined;
  });

  const openCopy = (): ReturnType<typeof openNodeDb> => {
    tmp = makeTempDir();
    const path = join(tmp.dir, 'copia.db');
    copyFileSync(V1, path); // la fixture non si modifica mai: si lavora su una copia
    return openNodeDb(path);
  };
  const deps = { clock: fixedClock('2026-10-08T07:30:00.000Z'), ids: sequentialIds(8000) };
  const hint = 'Se hai modificato 0001_init prima del rilascio: BUILD_FIXTURES=1 npx vitest run tests/integration/data/fixtures.test.ts';

  it('il file della fixture e uno schema v1 valido e si apre con il boot (checksum compresi)', async () => {
    const db = openCopy();
    expect(await readUserVersion(db)).toBe(1);
    const res = await bootDatabase(db, { appVersion: 'test', deps, strictChecksums: true }).catch((e: unknown) => {
      throw new Error(`${hint}\n${e instanceof Error ? e.message : String(e)}`);
    });
    expect(res.migration).toEqual({ from: 1, to: MIGRATIONS.length, applied: [] });
    expect(await db.all('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
    await db.close();
  });

  it('le query chiave danno i valori attesi sui dati della fixture', async () => {
    const db = openCopy();
    await bootDatabase(db, { appVersion: 'test', deps, strictChecksums: true });
    const v1 = SAMPLE_IDS.vehicle1;
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM vehicles'))?.n).toBe(SAMPLE_EXPECTED.vehicles);
    expect(await db.get('SELECT km, as_of FROM v_vehicle_odometer WHERE vehicle_id = ?', [v1])).toEqual({
      km: SAMPLE_EXPECTED.currentKm, as_of: SAMPLE_EXPECTED.currentKmAsOf,
    });
    const costs = await db.all<{ source: string; cents: number }>(
      'SELECT source, SUM(cents) AS cents FROM v_costs WHERE vehicle_id = ? GROUP BY source ORDER BY source',
      [v1],
    );
    expect(Object.fromEntries(costs.map((c) => [c.source, c.cents]))).toEqual(SAMPLE_EXPECTED.costsByVehicle1);
    expect(await db.get('SELECT last_done_on, last_done_km FROM v_item_last_done WHERE item_id = ?', [SAMPLE_IDS.itemOil])).toEqual({
      last_done_on: SAMPLE_EXPECTED.lastDoneOnOil, last_done_km: SAMPLE_EXPECTED.lastDoneKmOil,
    });
    expect(
      (await db.get<{ n: number }>(`SELECT count(*) AS n FROM reminders WHERE status = 'open' AND deleted_at IS NULL`))?.n,
    ).toBe(SAMPLE_EXPECTED.openReminders);
    // i trigger e i vincoli sono vivi anche su un file creato in passato
    await expect(
      db.run(
        `INSERT INTO odometer_readings (id, vehicle_id, read_on, km, source) VALUES ('01TESTID000000000000000888', ?, '2026-02-01', 99999, 'manual')`,
        [v1],
      ),
    ).rejects.toThrow(/ODO_NON_MONOTONIC/);
    // i seed completano il catalogo: l'upsert non tocca i dati dell'utente
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM service_templates'))?.n).toBe(27);
    expect((await db.get<{ template_id: string }>('SELECT template_id FROM maintenance_items WHERE id = ?', [SAMPLE_IDS.itemOil]))?.template_id).toBe('tpl_oil_change');
    await db.close();
  });

  it('upgrade da v1 con una migrazione successiva (ricostruzione di tabella): i dati restano e i vincoli nuovi valgono', async () => {
    const db = openCopy();
    const res = await bootDatabase(db, { appVersion: 'test', deps, strictChecksums: true, migrations: [...MIGRATIONS, migrationFuelLng] });
    expect(res.migration).toEqual({ from: 1, to: 2, applied: [2] });
    expect(await db.all('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM fuel_logs'))?.n).toBe(2);
    const costs = await db.get<{ cents: number }>(`SELECT SUM(cents) AS cents FROM v_costs WHERE vehicle_id = ? AND source = 'fuel'`, [SAMPLE_IDS.vehicle1]);
    expect(costs?.cents).toBe(SAMPLE_EXPECTED.costsByVehicle1.fuel);
    await db.close();
  });
});
