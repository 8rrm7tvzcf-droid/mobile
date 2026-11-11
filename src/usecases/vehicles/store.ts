// Accesso SQL ai veicoli (SQL a mano dentro i casi d'uso). Usato anche da `demo`.
import type { SqlDatabase, SqlValue } from '@/domain/ports';
import type {
  Powertrain,
  PrimaryFuel,
  SecondaryFuel,
  Transmission,
  Vehicle,
  VehicleInput,
  VehicleStatus,
} from './types';
import type { VehicleFields } from './validate';

export interface VehicleRow {
  id: string;
  nickname: string | null;
  plate: string | null;
  plate_country: string;
  vin: string | null;
  make: string;
  model: string;
  trim: string | null;
  model_year: number | null;
  first_registration_on: string | null;
  powertrain: Powertrain;
  fuel_primary: PrimaryFuel;
  fuel_secondary: SecondaryFuel | null;
  engine_cc: number | null;
  power_kw: number | null;
  euro_class: string | null;
  color: string | null;
  transmission: Transmission | null;
  tank_capacity_ml: number | null;
  distance_unit: 'km' | 'mi';
  annual_km_estimate: number | null;
  purchase_on: string | null;
  purchase_km: number | null;
  purchase_price_cents: number | null;
  status: VehicleStatus;
  sold_on: string | null;
  sold_km: number | null;
  sold_price_cents: number | null;
  notes: string | null;
  sort_order: number;
  is_demo: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const VEHICLE_COLUMNS =
  'id, nickname, plate, plate_country, vin, make, model, trim, model_year, first_registration_on, powertrain, ' +
  'fuel_primary, fuel_secondary, engine_cc, power_kw, euro_class, color, transmission, tank_capacity_ml, distance_unit, ' +
  'annual_km_estimate, purchase_on, purchase_km, purchase_price_cents, status, sold_on, sold_km, sold_price_cents, ' +
  'notes, sort_order, is_demo, created_at, updated_at, deleted_at';

export const displayNameOf = (v: { nickname: string | null; make: string; model: string }): string =>
  v.nickname && v.nickname.trim() !== '' ? v.nickname : `${v.make} ${v.model}`;

export function toVehicle(r: VehicleRow): Vehicle {
  return {
    id: r.id,
    nickname: r.nickname,
    displayName: displayNameOf(r),
    plate: r.plate,
    plateCountry: r.plate_country,
    vin: r.vin,
    make: r.make,
    model: r.model,
    trim: r.trim,
    modelYear: r.model_year,
    firstRegistrationOn: r.first_registration_on,
    powertrain: r.powertrain,
    fuelPrimary: r.fuel_primary,
    fuelSecondary: r.fuel_secondary,
    engineCc: r.engine_cc,
    powerKw: r.power_kw,
    euroClass: r.euro_class,
    color: r.color,
    transmission: r.transmission,
    tankCapacityMl: r.tank_capacity_ml,
    distanceUnit: r.distance_unit,
    annualKmEstimate: r.annual_km_estimate,
    purchaseOn: r.purchase_on,
    purchaseKm: r.purchase_km,
    purchasePriceCents: r.purchase_price_cents,
    status: r.status,
    soldOn: r.sold_on,
    soldKm: r.sold_km,
    soldPriceCents: r.sold_price_cents,
    notes: r.notes,
    sortOrder: r.sort_order,
    isDemo: r.is_demo === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

/** Colonne scritte da `VehicleFields`, nell'ordine dei valori di `fieldValues`. */
const FIELD_COLUMNS: readonly [column: string, key: keyof VehicleFields][] = [
  ['nickname', 'nickname'],
  ['plate', 'plate'],
  ['plate_country', 'plateCountry'],
  ['vin', 'vin'],
  ['make', 'make'],
  ['model', 'model'],
  ['trim', 'trim'],
  ['model_year', 'modelYear'],
  ['first_registration_on', 'firstRegistrationOn'],
  ['powertrain', 'powertrain'],
  ['fuel_primary', 'fuelPrimary'],
  ['fuel_secondary', 'fuelSecondary'],
  ['engine_cc', 'engineCc'],
  ['power_kw', 'powerKw'],
  ['euro_class', 'euroClass'],
  ['color', 'color'],
  ['transmission', 'transmission'],
  ['tank_capacity_ml', 'tankCapacityMl'],
  ['distance_unit', 'distanceUnit'],
  ['annual_km_estimate', 'annualKmEstimate'],
  ['purchase_on', 'purchaseOn'],
  ['purchase_km', 'purchaseKm'],
  ['purchase_price_cents', 'purchasePriceCents'],
  ['notes', 'notes'],
];

const fieldValues = (f: VehicleFields): SqlValue[] => FIELD_COLUMNS.map(([, k]) => f[k] as SqlValue);

export async function selectVehicle(db: SqlDatabase, id: string, includeDeleted = false): Promise<VehicleRow | undefined> {
  return db.get<VehicleRow>(
    `SELECT ${VEHICLE_COLUMNS} FROM vehicles WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`,
    [id],
  );
}

export async function nextSortOrder(db: SqlDatabase): Promise<number> {
  const row = await db.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM vehicles WHERE deleted_at IS NULL');
  return (row?.n ?? -1) + 1;
}

export interface NewVehicle {
  id: string;
  fields: VehicleFields;
  sortOrder: number;
  isDemo?: boolean;
  nowIso: string;
}

export async function insertVehicleRow(db: SqlDatabase, v: NewVehicle): Promise<void> {
  const cols = FIELD_COLUMNS.map(([c]) => c);
  await db.run(
    `INSERT INTO vehicles (id, ${cols.join(', ')}, sort_order, is_demo, created_at, updated_at)
     VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?, ?, ?)`,
    [v.id, ...fieldValues(v.fields), v.sortOrder, v.isDemo ? 1 : 0, v.nowIso, v.nowIso],
  );
}

export async function updateVehicleRow(db: SqlDatabase, id: string, f: VehicleFields, nowIso: string): Promise<void> {
  await db.run(
    `UPDATE vehicles SET ${FIELD_COLUMNS.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    [...fieldValues(f), nowIso, id],
  );
}

/** Un'altra auto non eliminata con la stessa targa (o VIN). */
export async function findDuplicate(
  db: SqlDatabase,
  column: 'plate' | 'vin',
  value: string | null,
  exceptId: string | null,
): Promise<boolean> {
  if (value === null) return false;
  const row = await db.get<{ id: string }>(
    `SELECT id FROM vehicles WHERE ${column} = ? AND deleted_at IS NULL AND id <> ? LIMIT 1`,
    [value, exceptId ?? ''],
  );
  return row !== undefined;
}

/** Dati del veicolo come `VehicleInput`, per fondere una modifica parziale e rivalidare tutto. */
export function toInput(v: Vehicle): VehicleInput {
  return {
    nickname: v.nickname,
    plate: v.plate,
    plateCountry: v.plateCountry,
    vin: v.vin,
    make: v.make,
    model: v.model,
    trim: v.trim,
    modelYear: v.modelYear,
    firstRegistrationOn: v.firstRegistrationOn,
    powertrain: v.powertrain,
    fuelPrimary: v.fuelPrimary,
    fuelSecondary: v.fuelSecondary,
    engineCc: v.engineCc,
    powerKw: v.powerKw,
    euroClass: v.euroClass,
    color: v.color,
    transmission: v.transmission,
    tankCapacityMl: v.tankCapacityMl,
    distanceUnit: v.distanceUnit,
    annualKmEstimate: v.annualKmEstimate,
    purchaseOn: v.purchaseOn,
    purchaseKm: v.purchaseKm,
    purchasePriceCents: v.purchasePriceCents,
    notes: v.notes,
  };
}
