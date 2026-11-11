// Helper dei test di interventi e officine: DB migrato con seed (template tpl_* inclusi), oggi = 2026-10-08, auto con km, voci reali.
import { expect } from 'vitest';
import type { DomainEvent, SqlDatabase, SqlValue } from '@/domain/ports';
import { reconcileVehicle } from '@/usecases/deadlines';
import type { Deps, UsecaseResult } from '@/usecases/context';
import { insertRow, itemRow, odometerRow, openBootedDb, vehicleRow } from '../../../support/db';
import { fixedClock, sequentialIds } from '../../../support/fakes';
import type { TestClock } from '../../../support/fakes';
import type { NodeSqlDatabase } from '../../../support/nodeSqlite';

export interface Env {
  deps: Deps;
  db: NodeSqlDatabase;
  clock: TestClock;
  events: DomainEvent[];
}

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
export const addOdo = (env: Env, vehicleId: string, readOn: string, km: number): Promise<string> =>
  insertRow(env.db, 'odometer_readings', odometerRow(vehicleId, readOn, km));

/** Voce di manutenzione dal catalogo (per template). */
export const addItem = (env: Env, vehicleId: string, o: Row = {}): Promise<string> => insertRow(env.db, 'maintenance_items', itemRow(vehicleId, o));

export const OIL = { name: 'Cambio olio motore e filtro', template_id: 'tpl_oil_change', baseline_on: '2026-03-01', baseline_km: 12000, interval_km: 15000, interval_months: 12 };
export const SERVICE_MAIN = { name: 'Tagliando', template_id: 'tpl_service_main', baseline_on: '2026-03-01', baseline_km: 12000, interval_km: 15000, interval_months: 12 };
export const CABIN = { name: 'Filtro abitacolo', template_id: 'tpl_cabin_filter', baseline_on: '2026-03-01', baseline_km: 12000, interval_km: 15000, interval_months: 12 };
export const AIR = { name: 'Filtro aria motore', template_id: 'tpl_air_filter', baseline_on: '2026-03-01', baseline_km: 12000, interval_km: 30000, interval_months: 24 };
export const BOLLO = {
  name: 'Bollo auto', template_id: 'tpl_road_tax', category: 'legal', schedule_type: 'interval_calendar', interval_km: null, interval_months: 12,
  fixed_due_on: '2026-08-31', baseline_on: null, baseline_km: null, soon_km: 0,
};
export const INSPECTION = {
  name: 'Revisione periodica', template_id: 'tpl_inspection', category: 'legal', period_end: 'end_of_month', interval_km: null, interval_months: 24,
  baseline_on: '2024-06-10', baseline_km: null, soon_km: 0,
};

export interface Garage {
  env: Env;
  v: string;
  items: Record<string, string>;
}

/** Auto con km (10.000 il 2026-01-01, 15.000 il 2026-06-01) e le voci indicate, riconciliate. */
export async function garage(defs: Record<string, Row> = { oil: OIL }, vehicleExtra: Row = {}): Promise<Garage> {
  const env = await makeEnv();
  const v = await addVehicle(env, { nickname: 'Panda', first_registration_on: '2020-03-15', ...vehicleExtra });
  await addOdo(env, v, '2026-01-01', 10000);
  await addOdo(env, v, '2026-06-01', 15000);
  const items: Record<string, string> = {};
  for (const [key, def] of Object.entries(defs)) items[key] = await addItem(env, v, def);
  await reconcileVehicle(env.deps, v);
  env.events.length = 0;
  return { env, v, items };
}

export const rows = (db: SqlDatabase, sql: string, params: SqlValue[] = []): Promise<Record<string, SqlValue>[]> => db.all(sql, params);

export const openReminders = (db: SqlDatabase, vehicleId: string): Promise<Record<string, SqlValue>[]> =>
  db.all(`SELECT * FROM reminders WHERE vehicle_id = ? AND status = 'open' AND deleted_at IS NULL ORDER BY effective_due_on, id`, [vehicleId]);

/** Il promemoria aperto di una voce. */
export async function openOf(db: SqlDatabase, itemId: string): Promise<Record<string, SqlValue>> {
  const [r] = await db.all(`SELECT * FROM reminders WHERE item_id = ? AND status = 'open' AND deleted_at IS NULL`, [itemId]);
  if (!r) throw new Error('nessun promemoria aperto per la voce');
  return r;
}

/** Stato "visibile" (senza id di scrittura e istanti; dei promemoria chiusi solo i dati, non la cache calcolata): confronta prima/dopo un'aggiunta + eliminazione, o due percorsi equivalenti. */
export async function visible(db: SqlDatabase) {
  return {
    items: await rows(db, 'SELECT name, fixed_due_on, baseline_on, baseline_km, interval_km, interval_months, is_active FROM maintenance_items WHERE deleted_at IS NULL ORDER BY name'),
    completions: await rows(
      db,
      `SELECT i.name, c.done_on, c.done_km, c.prev_fixed_due_on FROM maintenance_completions c JOIN maintenance_items i ON i.id = c.item_id
       WHERE c.deleted_at IS NULL ORDER BY i.name, c.done_on`,
    ),
    reminders: await rows(
      db,
      `SELECT COALESCE(i.name, r.title) AS name, r.origin, r.status, r.due_on, r.due_km, r.completed_on,
              CASE WHEN r.status = 'open' THEN r.effective_due_on END AS effective_due_on,
              CASE WHEN r.status = 'open' THEN r.due_trigger END AS due_trigger,
              CASE WHEN r.status = 'open' THEN r.forecast_on END AS forecast_on
       FROM reminders r LEFT JOIN maintenance_items i ON i.id = r.item_id WHERE r.deleted_at IS NULL ORDER BY name, r.status, r.due_on`,
    ),
    odometer: await rows(db, 'SELECT read_on, km, source, status FROM odometer_readings WHERE deleted_at IS NULL ORDER BY read_on, km'),
  };
}

/** Un promemoria aperto per voce al massimo. */
export async function expectOneOpenPerItem(db: SqlDatabase, vehicleId: string): Promise<void> {
  const dup = await db.all(
    `SELECT item_id, COUNT(*) AS n FROM reminders WHERE vehicle_id = ? AND status = 'open' AND deleted_at IS NULL AND item_id IS NOT NULL
     GROUP BY item_id HAVING COUNT(*) > 1`,
    [vehicleId],
  );
  expect(dup).toEqual([]);
}
