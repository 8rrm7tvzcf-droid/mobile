// Presentazione di un'auto: alimentazione, riga di sottotitolo, elenco "Dati". Pura.
import { formatDateIt } from '@/domain/units';
import type { Powertrain, PrimaryFuel, SecondaryFuel, Vehicle } from '@/usecases/vehicles';
import { it } from '../i18n/it';

export interface FuelFields {
  fuelPrimary: PrimaryFuel;
  fuelSecondary: SecondaryFuel | null;
  powertrain: Powertrain;
}

/** Nomi della seconda alimentazione dentro una frase: le sigle restano maiuscole. */
const SECONDARY_NAMES: Record<SecondaryFuel, string> = { lpg: 'GPL', cng: 'metano', petrol: 'benzina', electric: 'elettrica' };

/** "Benzina + GPL", "Benzina + elettrica (ibrida plug-in)", "Gasolio · ibrida leggera". */
export function fuelText(v: FuelFields): string {
  const names = it.vehicleForm.fuelOptions;
  const primary = names[v.fuelPrimary];
  if (v.fuelSecondary === 'electric') return `${primary} + elettrica (${it.vehicleForm.powertrainOptions.phev.toLowerCase()})`;
  if (v.fuelSecondary) return `${primary} + ${SECONDARY_NAMES[v.fuelSecondary]}`;
  if (v.powertrain === 'mhev' || v.powertrain === 'hev') return `${primary} · ${it.vehicleForm.powertrainOptions[v.powertrain].toLowerCase()}`;
  return primary;
}

/** "Fiat Panda 1.2 Easy". */
export const makeModelText = (v: Pick<Vehicle, 'make' | 'model' | 'trim'>): string => [v.make, v.model, v.trim].filter(Boolean).join(' ');

export interface DataRow {
  label: string;
  value: string;
}

export function dataRows(v: Vehicle): DataRow[] {
  const none = it.vehicle.noValue;
  return [
    { label: it.vehicle.plate, value: v.plate ?? none },
    ...(v.vin ? [{ label: it.vehicle.vin, value: v.vin }] : []),
    { label: it.vehicle.fuel, value: fuelText(v) },
    { label: it.vehicle.year, value: v.modelYear === null ? none : String(v.modelYear) },
    { label: it.vehicle.firstRegistration, value: v.firstRegistrationOn ? formatDateIt(v.firstRegistrationOn) : none },
  ];
}
