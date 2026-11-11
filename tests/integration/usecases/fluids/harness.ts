// Helper dei test di controllo livelli e assicurazioni: DB migrato con seed, orologio fisso (oggi = 2026-10-08), ID sequenziali,
// bus di eventi che registra, e qualche scorciatoia per preparare il garage.
import { expect } from 'vitest';
import type { DomainEvent, SqlDatabase, SqlValue } from '@/domain/ports';
import type { Deps, UsecaseResult } from '@/usecases/context';
import { reconcileVehicle, setupDeadlines } from '@/usecases/deadlines';
import type { SetupItemInput } from '@/usecases/deadlines';
import { addVehicle } from '@/usecases/vehicles';
import { openBootedDb } from '../../../support/db';
import { FIXED_NOW, sequentialIds } from '../../../support/fakes';
import type { TestClock } from '../../../support/fakes';
import type { NodeSqlDatabase } from '../../../support/nodeSqlite';

export interface Env {
  deps: Deps;
  db: NodeSqlDatabase;
  clock: TestClock;
  events: DomainEvent[];
  clearEvents(): void;
}

export async function makeEnv(nowIso: string = FIXED_NOW): Promise<Env> {
  const booted = await openBootedDb();
  booted.clock.set(nowIso);
  const events: DomainEvent[] = [];
  const deps: Deps = {
    db: booted.db,
    clock: booted.clock,
    ids: sequentialIds(1000), // gli ID del seed (9000+) non collidono
    events: { emit: (e) => void events.push(e), on: () => () => undefined },
  };
  return { deps, db: booted.db, clock: booted.clock, events, clearEvents: () => void events.splice(0) };
}

export function unwrap<T>(r: UsecaseResult<T>): T {
  if (!r.ok) throw new Error(`risultato inatteso: ${JSON.stringify(r.error)}`);
  return r.value;
}

export function errorOf<T>(r: UsecaseResult<T>): { code: string; field?: string; message?: string } {
  if (r.ok) throw new Error('il risultato doveva essere un errore');
  return r.error as { code: string; field?: string; message?: string };
}

type Row = Record<string, SqlValue>;

export const rows = (db: SqlDatabase, sql: string, params: SqlValue[] = []): Promise<Row[]> => db.all(sql, params);

export async function count(db: SqlDatabase, table: string, where = '1=1', params: SqlValue[] = []): Promise<number> {
  const r = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, params);
  return r?.n ?? 0;
}

/** Un'auto a benzina con 10.000 km il 2026-01-01 e 15.000 il 2026-06-01 (ordine cronologico coerente). */
export async function makeVehicle(env: Env, o: { fuelPrimary?: 'petrol' | 'diesel' | 'electric'; km?: boolean } = {}): Promise<string> {
  const v = unwrap(
    await addVehicle(env.deps, {
      make: 'Fiat',
      model: 'Panda',
      fuelPrimary: o.fuelPrimary ?? 'petrol',
      firstRegistrationOn: '2020-03-15',
    }),
  );
  if (o.km !== false) {
    await env.db.run(
      `INSERT INTO odometer_readings (id, vehicle_id, read_on, km, source, status, created_at, updated_at)
       VALUES ('01TESTODO000000000000000A1', ?, '2026-01-01', 10000, 'manual', 'valid', ?, ?),
              ('01TESTODO000000000000000A2', ?, '2026-06-01', 15000, 'manual', 'valid', ?, ?)`,
      [v.id, FIXED_NOW, FIXED_NOW, v.id, FIXED_NOW, FIXED_NOW],
    );
  }
  env.clearEvents();
  return v.id;
}

/** Crea le voci dal catalogo con il wizard "Imposta le scadenze" e riconcilia (le voci hanno `template_id`). */
export async function setupItems(env: Env, vehicleId: string, items: SetupItemInput[]): Promise<Record<string, string>> {
  const res = unwrap(await setupDeadlines(env.deps, { vehicleId, items }));
  await reconcileVehicle(env.deps, vehicleId);
  env.clearEvents();
  return Object.fromEntries(res.items.map((i) => [i.templateId, i.itemId]));
}

export const openReminders = (db: SqlDatabase, vehicleId: string): Promise<Row[]> =>
  db.all(`SELECT * FROM reminders WHERE vehicle_id = ? AND status = 'open' AND deleted_at IS NULL ORDER BY effective_due_on, id`, [vehicleId]);

/** I1: al massimo un promemoria aperto per voce, per polizza e per rata. */
export async function expectAtMostOneOpen(db: SqlDatabase, vehicleId: string): Promise<void> {
  for (const col of ['item_id', 'policy_id', 'payment_id']) {
    const dup = await db.all(
      `SELECT ${col}, COUNT(*) AS n FROM reminders WHERE vehicle_id = ? AND status = 'open' AND deleted_at IS NULL AND ${col} IS NOT NULL
       GROUP BY ${col} HAVING COUNT(*) > 1`,
      [vehicleId],
    );
    expect(dup).toEqual([]);
  }
}
