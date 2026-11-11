// Accesso SQL ai rifornimenti (SQL a mano dentro i casi d'uso, SPEC 8.6). Interno al modulo.
import {
  SKIP_REASON_TEXT_IT,
  consumptionByTank,
  fuelLabelIt,
  tankOf,
  unitForFuel,
  type ConsumptionEntry,
  type FuelConsumptionLog,
  type FuelType,
  type QuantityUnit,
  type TankKey,
} from '@/domain/fuel';
import type { SqlDatabase, SqlValue } from '@/domain/ports';
import { formatConsumption } from '@/domain/units';
import type { FuelConsumptionView, FuelLogEntry } from './types';

export interface FuelRow {
  id: string;
  vehicle_id: string;
  filled_on: string;
  fuel_type: FuelType;
  grade: string | null;
  quantity_milli: number;
  quantity_unit: QuantityUnit;
  unit_price_milli: number | null;
  total_cents: number;
  is_full: number;
  missed_before: number;
  station: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  km: number | null;
  reading_id: string | null;
  reading_status: 'valid' | 'ignored' | null;
}

/** Colonne del rifornimento con la lettura km collegata (non cancellata) in LEFT JOIN. */
export const FUEL_SELECT = `SELECT f.id, f.vehicle_id, f.filled_on, f.fuel_type, f.grade, f.quantity_milli, f.quantity_unit,
       f.unit_price_milli, f.total_cents, f.is_full, f.missed_before, f.station, f.notes, f.created_at, f.updated_at,
       f.deleted_at, o.km AS km, o.id AS reading_id, o.status AS reading_status
FROM fuel_logs f LEFT JOIN odometer_readings o ON o.fuel_log_id = f.id AND o.deleted_at IS NULL`;

export async function selectFuelRow(db: SqlDatabase, id: string, includeDeleted = false): Promise<FuelRow | undefined> {
  return db.get<FuelRow>(`${FUEL_SELECT} WHERE f.id = ?${includeDeleted ? '' : ' AND f.deleted_at IS NULL'}`, [id]);
}

export function toEntry(r: FuelRow, consumption: FuelConsumptionView | null = null): FuelLogEntry {
  return {
    id: r.id,
    vehicleId: r.vehicle_id,
    filledOn: r.filled_on,
    fuelType: r.fuel_type,
    fuelLabel: fuelLabelIt(r.fuel_type),
    grade: r.grade,
    tank: tankOf(r.fuel_type),
    quantityMilli: r.quantity_milli,
    quantityUnit: r.quantity_unit,
    unitPriceMilli: r.unit_price_milli,
    totalCents: r.total_cents,
    isFull: r.is_full === 1,
    missedBefore: r.missed_before === 1,
    station: r.station,
    notes: r.notes,
    km: r.km,
    odometerReadingId: r.reading_id,
    kmIgnored: r.reading_id !== null && r.reading_status === 'ignored',
    consumption,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Tutti i rifornimenti non cancellati di un veicolo nel formato dei consumi: i km sono quelli della lettura collegata
 * SOLO se la lettura e' valida (una lettura messa da parte non conta). Serve TUTTA la catena, non solo il periodo:
 * il primo pieno di un periodo si confronta con l'ultimo di prima.
 */
export async function loadConsumptionLogs(db: SqlDatabase, vehicleId: string): Promise<FuelConsumptionLog[]> {
  const rows = await db.all<{
    id: string;
    filled_on: string;
    fuel_type: FuelType;
    quantity_milli: number;
    total_cents: number;
    is_full: number;
    missed_before: number;
    created_at: string;
    km: number | null;
  }>(
    `SELECT f.id, f.filled_on, f.fuel_type, f.quantity_milli, f.total_cents, f.is_full, f.missed_before, f.created_at,
            o.km AS km
     FROM fuel_logs f
     LEFT JOIN odometer_readings o ON o.fuel_log_id = f.id AND o.deleted_at IS NULL AND o.status = 'valid'
     WHERE f.vehicle_id = ? AND f.deleted_at IS NULL
     ORDER BY f.filled_on, f.created_at, f.id`,
    [vehicleId],
  );
  return rows.map((r) => ({
    id: r.id,
    on: r.filled_on,
    km: r.km,
    quantityMilli: r.quantity_milli,
    isFull: r.is_full === 1,
    missedBefore: r.missed_before === 1,
    fuelType: r.fuel_type,
    totalCents: r.total_cents,
    createdAt: r.created_at,
  }));
}

/** Il consumo di ogni pieno (id -> vista pronta per la UI), sulla catena per serbatoio di tutti i rifornimenti. */
export function consumptionViews(logs: readonly FuelConsumptionLog[]): Map<string, FuelConsumptionView> {
  const out = new Map<string, FuelConsumptionView>();
  for (const t of consumptionByTank(logs).tanks) {
    for (const e of t.entries) out.set(e.id, viewOf(e, t.tank, t.unit));
  }
  return out;
}

function viewOf(e: ConsumptionEntry, tank: TankKey, unit: QuantityUnit): FuelConsumptionView {
  if (e.computed) {
    return {
      computed: true,
      tank,
      unit,
      per100Centi: e.per100Centi,
      text: formatConsumption(e.per100Centi, unit),
      distanceKm: e.distanceKm,
      quantityMilli: e.quantityMilli,
      costCents: e.costCents,
    };
  }
  return { computed: false, reason: e.reason, text: SKIP_REASON_TEXT_IT[e.reason] };
}

export const unitOf = (fuel: FuelType): QuantityUnit => unitForFuel(fuel);

export async function vehicleExists(db: SqlDatabase, vehicleId: string): Promise<boolean> {
  return (await db.get<{ id: string }>('SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicleId])) !== undefined;
}

export interface VehicleFuelRow {
  id: string;
  fuel_primary: 'petrol' | 'diesel' | 'lpg' | 'cng' | 'electric' | 'hydrogen';
  fuel_secondary: 'petrol' | 'lpg' | 'cng' | 'electric' | null;
  tank_capacity_ml: number | null;
}

export async function loadVehicleFuel(db: SqlDatabase, vehicleId: string): Promise<VehicleFuelRow | undefined> {
  return db.get<VehicleFuelRow>(
    'SELECT id, fuel_primary, fuel_secondary, tank_capacity_ml FROM vehicles WHERE id = ? AND deleted_at IS NULL',
    [vehicleId],
  );
}

/** L'ultimo carburante usato su un veicolo (rifornimento piu' recente non cancellato). */
export async function lastFuelTypeOf(db: SqlDatabase, vehicleId: string): Promise<FuelType | null> {
  const r = await db.get<{ fuel_type: FuelType }>(
    `SELECT fuel_type FROM fuel_logs WHERE vehicle_id = ? AND deleted_at IS NULL
     ORDER BY filled_on DESC, created_at DESC, id DESC LIMIT 1`,
    [vehicleId],
  );
  return r?.fuel_type ?? null;
}

export const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(', ');
export type Params = SqlValue[];

export const cleanText = (v: string | null | undefined, max: number): string | null => {
  if (v == null) return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, max);
};
