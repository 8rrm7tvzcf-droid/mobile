// Helper dei test sul database: DB migrato e popolato, istantanea dello schema, inserimenti grezzi.
/// <reference types="node" />
import type { SqlDatabase, SqlValue } from '@/domain/ports';
import { bootDatabase } from '@/data/db/boot';
import { openNodeDb, type NodeSqlDatabase } from './nodeSqlite';
import { fixedClock, sequentialIds, ulidOf, type TestClock } from './fakes';

export interface TestDb {
  db: NodeSqlDatabase;
  clock: TestClock;
  ids: ReturnType<typeof sequentialIds>;
}

/** DB in memoria con PRAGMA, migrazioni e seed applicati (la sequenza di avvio completa, passi 1-3). */
export async function openBootedDb(path = ':memory:'): Promise<TestDb> {
  const db = openNodeDb(path);
  const clock = fixedClock();
  const ids = sequentialIds(9000); // gli ID del seed (device.id) non collidono con quelli dei test
  await bootDatabase(db, { appVersion: 'test', deps: { clock, ids }, strictChecksums: true, pragmas: { journalMode: 'skip' } });
  return { db, clock, ids };
}

/** `SELECT type, name, sql FROM sqlite_master` in forma di testo stabile: serve al confronto con l'istantanea. */
export async function schemaSnapshot(db: SqlDatabase): Promise<string> {
  const rows = await db.all<{ type: string; name: string; sql: string }>(
    `SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type, name`,
  );
  return rows.map((r) => `-- ${r.type} ${r.name}\n${r.sql};\n`).join('\n');
}

/** Inserisce una riga con le colonne date e restituisce il suo `id` (se presente). */
export async function insertRow(db: SqlDatabase, table: string, row: Record<string, SqlValue>): Promise<string> {
  const cols = Object.keys(row);
  await db.run(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => row[c] as SqlValue),
  );
  return String(row['id'] ?? '');
}

let counter = 100;
/** ID univoco per i test che non si curano del valore. */
export const nextId = (): string => ulidOf(counter++);

const NOW = '2026-10-08T07:30:00.000Z';

type Row = Record<string, SqlValue>;
export const vehicleRow = (o: Row = {}): Row => ({
  id: nextId(),
  make: 'Fiat',
  model: 'Panda',
  fuel_primary: 'petrol',
  created_at: NOW,
  updated_at: NOW,
  ...o,
});
export const fuelLogRow = (vehicleId: string, o: Row = {}): Row => ({
  id: nextId(),
  vehicle_id: vehicleId,
  filled_on: '2026-09-01',
  fuel_type: 'petrol',
  quantity_milli: 30000,
  quantity_unit: 'L',
  total_cents: 5500,
  created_at: NOW,
  updated_at: NOW,
  ...o,
});
export const serviceRow = (vehicleId: string, o: Row = {}): Row => ({
  id: nextId(),
  vehicle_id: vehicleId,
  service_on: '2026-03-01',
  kind: 'scheduled',
  title: 'Tagliando',
  total_cents: 21000,
  created_at: NOW,
  updated_at: NOW,
  ...o,
});
export const odometerRow = (vehicleId: string, readOn: string, km: number, o: Row = {}): Row => ({
  id: nextId(),
  vehicle_id: vehicleId,
  read_on: readOn,
  km,
  source: 'manual',
  created_at: NOW,
  updated_at: NOW,
  ...o,
});
export const policyRow = (vehicleId: string, o: Row = {}): Row => ({
  id: nextId(),
  vehicle_id: vehicleId,
  kind: 'rca',
  company: 'Compagnia',
  start_on: '2026-01-01',
  end_on: '2027-01-01',
  premium_cents: 40000,
  created_at: NOW,
  updated_at: NOW,
  ...o,
});
export const itemRow = (vehicleId: string, o: Row = {}): Row => ({
  id: nextId(),
  vehicle_id: vehicleId,
  name: 'Cambio olio',
  category: 'maintenance',
  schedule_type: 'interval_last_done',
  interval_km: 15000,
  interval_months: 12,
  created_at: NOW,
  updated_at: NOW,
  ...o,
});
export const reminderRow = (vehicleId: string, o: Row = {}): Row => ({
  id: nextId(),
  vehicle_id: vehicleId,
  origin: 'manual',
  title: 'Promemoria',
  due_on: '2026-12-01',
  created_at: NOW,
  updated_at: NOW,
  ...o,
});

/** Esegue `fn` e restituisce il messaggio dell'errore lanciato (o null se non lancia). */
export async function errorOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
