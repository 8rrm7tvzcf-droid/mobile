// Lettura del catalogo dei template (`service_templates`) e del veicolo, comune al wizard e al catalogo (SPEC 6.3.3, 7.1).
import { daysInMonth, makeDate, parseDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/dates';
import type { ItemCategory, ScheduleType } from '@/domain/maintenance';
import type { SqlDatabase } from '@/domain/ports';
import { vehicleTags } from './applicability';
import type { VehicleTag } from './applicability';

export interface TemplateRow {
  id: string;
  version: number;
  name_it: string;
  category: ItemCategory;
  schedule_type: ScheduleType;
  interval_km: number | null;
  interval_months: number | null;
  period_end: 'exact' | 'end_of_month';
  anchor_month: number | null;
  anchor_day: number | null;
  soon_days: number;
  soon_km: number;
  notify_offsets_days: string;
  applies_to: string | null;
  default_enabled: number;
  is_indicative: number;
  note_it: string | null;
  sort_order: number;
}

export interface SetupVehicle {
  id: string;
  status: string;
  powertrain: string;
  fuelPrimary: string;
  fuelSecondary: string | null;
  firstRegistrationOn: LocalDate | null;
  purchaseOn: LocalDate | null;
  purchaseKm: number | null;
  tags: VehicleTag[];
}

export const TEMPLATE_COLUMNS =
  'id, version, name_it, category, schedule_type, interval_km, interval_months, period_end, anchor_month, anchor_day, soon_days, soon_km, notify_offsets_days, applies_to, default_enabled, is_indicative, note_it, sort_order';

export async function loadSetupVehicle(db: SqlDatabase, vehicleId: string): Promise<SetupVehicle | null> {
  const r = await db.get<{
    id: string;
    status: string;
    powertrain: string;
    fuel_primary: string;
    fuel_secondary: string | null;
    first_registration_on: string | null;
    purchase_on: string | null;
    purchase_km: number | null;
  }>(
    `SELECT id, status, powertrain, fuel_primary, fuel_secondary, first_registration_on, purchase_on, purchase_km
     FROM vehicles WHERE id = ? AND deleted_at IS NULL`,
    [vehicleId],
  );
  if (!r) return null;
  return {
    id: r.id,
    status: r.status,
    powertrain: r.powertrain,
    fuelPrimary: r.fuel_primary,
    fuelSecondary: r.fuel_secondary,
    firstRegistrationOn: r.first_registration_on,
    purchaseOn: r.purchase_on,
    purchaseKm: r.purchase_km,
    tags: vehicleTags({ powertrain: r.powertrain, fuelPrimary: r.fuel_primary, fuelSecondary: r.fuel_secondary }),
  };
}

export function parseAppliesTo(json: string | null): string[] | null {
  if (!json) return null;
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

/** Prossima occorrenza (oggi compreso) del giorno ancorato `mese/giorno`: le gomme stagionali (15/11 e 15/4). */
export function nextAnchorOn(today: LocalDate, month: number, day: number): LocalDate {
  const { y } = parseDate(today);
  const at = (year: number): LocalDate => makeDate(year, month, Math.min(day, daysInMonth(year, month)));
  const thisYear = at(y);
  return thisYear >= today ? thisYear : at(y + 1);
}
