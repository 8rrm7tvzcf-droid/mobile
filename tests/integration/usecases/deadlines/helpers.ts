// Helper dei test delle scadenze: DB migrato e con seed, dipendenze finte (orologio fisso, ID sequenziali, bus di eventi che registra).
import { expect } from 'vitest';
import type { DomainEvent, SqlDatabase, SqlValue } from '@/domain/ports';
import type { Deps, UsecaseResult } from '@/usecases/context';
import { openBootedDb } from '../../../support/db';
import { insertRow, itemRow, odometerRow, policyRow, vehicleRow } from '../../../support/db';
import { fixedClock, sequentialIds } from '../../../support/fakes';
import type { TestClock } from '../../../support/fakes';
import type { NodeSqlDatabase } from '../../../support/nodeSqlite';

export interface Env {
  deps: Deps;
  db: NodeSqlDatabase;
  clock: TestClock;
  events: DomainEvent[];
}

/** Ambiente di test: oggi = 2026-10-08 (orologio fisso; nei test il fuso e' trattato come UTC). */
export async function makeEnv(nowIso = '2026-10-08T07:30:00.000Z'): Promise<Env> {
  const booted = await openBootedDb();
  const clock = fixedClock(nowIso);
  const events: DomainEvent[] = [];
  const deps: Deps = {
    db: booted.db,
    clock,
    ids: sequentialIds(1), // gli ID del seed (9000+) non collidono
    events: { emit: (e) => void events.push(e), on: () => () => undefined },
  };
  return { deps, db: booted.db, clock, events };
}

export function unwrap<T>(r: UsecaseResult<T>): T {
  if (!r.ok) throw new Error(`atteso ok, ottenuto errore: ${JSON.stringify(r.error)}`);
  return r.value;
}

export function errorOf<T>(r: UsecaseResult<T>): { code: string; field?: string; message?: string } {
  if (r.ok) throw new Error('atteso un errore, ottenuto ok');
  return r.error as { code: string; field?: string; message?: string };
}

type Row = Record<string, SqlValue>;

export const addVehicle = (env: Env, o: Row = {}): Promise<string> => insertRow(env.db, 'vehicles', vehicleRow(o));
export const addItem = (env: Env, vehicleId: string, o: Row = {}): Promise<string> => insertRow(env.db, 'maintenance_items', itemRow(vehicleId, o));
export const addOdo = (env: Env, vehicleId: string, readOn: string, km: number): Promise<string> =>
  insertRow(env.db, 'odometer_readings', odometerRow(vehicleId, readOn, km));
export const addPolicy = (env: Env, vehicleId: string, o: Row = {}): Promise<string> => insertRow(env.db, 'insurance_policies', policyRow(vehicleId, o));

/** Righe di una tabella (per confronti prima/dopo), ordinate per id. */
export function rows(db: SqlDatabase, sql: string, params: SqlValue[] = []): Promise<Record<string, SqlValue>[]> {
  return db.all(sql, params);
}

export const openReminders = (db: SqlDatabase, vehicleId: string): Promise<Record<string, SqlValue>[]> =>
  db.all(
    `SELECT * FROM reminders WHERE vehicle_id = ? AND status = 'open' AND deleted_at IS NULL ORDER BY effective_due_on, id`,
    [vehicleId],
  );

/** Un promemoria aperto per voce al massimo (I1). */
export async function expectOneOpenPerItem(db: SqlDatabase, vehicleId: string): Promise<void> {
  const dup = await db.all(
    `SELECT item_id, COUNT(*) AS n FROM reminders WHERE vehicle_id = ? AND status = 'open' AND deleted_at IS NULL AND item_id IS NOT NULL
     GROUP BY item_id HAVING COUNT(*) > 1`,
    [vehicleId],
  );
  expect(dup).toEqual([]);
}
