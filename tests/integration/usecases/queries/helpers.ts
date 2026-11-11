// Helper dei test di letture e notifiche: dipendenze con DB migrato, orologio fisso e bus finto; inserimenti rapidi.
import type { DomainEvent, EventBus, NotificationScheduler, SqlValue } from '@/domain/ports';
import type { Deps, NotificationDeps } from '@/usecases/context';
import { insertRow, itemRow, odometerRow, openBootedDb, reminderRow, vehicleRow } from '../../../support/db';
import type { TestDb } from '../../../support/db';

/** 'Oggi' dei test: 2026-10-08, 07:30 UTC (fuso trattato come UTC). */
export const TODAY = '2026-10-08';

export interface FakeBus extends EventBus {
  events: DomainEvent[];
}

export function fakeBus(): FakeBus {
  const listeners = new Set<(e: DomainEvent) => void>();
  const events: DomainEvent[] = [];
  return {
    events,
    emit: (e) => {
      events.push(e);
      for (const l of [...listeners]) l(e);
    },
    on: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export interface Ctx extends TestDb {
  deps: Deps;
  bus: FakeBus;
  depsWith(scheduler: NotificationScheduler): NotificationDeps;
}

export async function setup(nowIso?: string): Promise<Ctx> {
  const t = await openBootedDb();
  if (nowIso) t.clock.set(nowIso);
  const bus = fakeBus();
  const deps: Deps = { db: t.db, clock: t.clock, ids: t.ids, events: bus };
  return { ...t, deps, bus, depsWith: (scheduler) => ({ ...deps, scheduler }) };
}

type Row = Record<string, SqlValue>;

export const addVehicle = (c: Ctx, o: Row = {}): Promise<string> => insertRow(c.db, 'vehicles', vehicleRow({ nickname: 'Panda', ...o }));
export const addReading = (c: Ctx, vehicleId: string, readOn: string, km: number, o: Row = {}): Promise<string> =>
  insertRow(c.db, 'odometer_readings', odometerRow(vehicleId, readOn, km, o));
export const addItem = (c: Ctx, vehicleId: string, o: Row = {}): Promise<string> => insertRow(c.db, 'maintenance_items', itemRow(vehicleId, o));

/** Promemoria manuale aperto con la scadenza data (cache `effective_due_on` allineata). */
export const addManual = (c: Ctx, vehicleId: string, title: string, dueOn: string | null, o: Row = {}): Promise<string> =>
  insertRow(c.db, 'reminders', reminderRow(vehicleId, { title, due_on: dueOn, effective_due_on: dueOn, ...o }));

/** Promemoria generato da una voce (cache come la scriverebbe la riconciliazione). */
export const addGenerated = (c: Ctx, vehicleId: string, itemId: string, title: string, o: Row = {}): Promise<string> =>
  insertRow(c.db, 'reminders', reminderRow(vehicleId, { origin: 'generated', item_id: itemId, title, ...o }));

export const setSetting = (c: Ctx, key: string, value: unknown): Promise<unknown> =>
  c.db.run(
    `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)],
  );
