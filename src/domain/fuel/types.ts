// Carburanti e unita' di misura dei rifornimenti (F-39, F-40; data.md `fuel_logs`, SPEC §8.1 e §8.2 M-2).
// Quantita' in millesimi dell'unita' (ml, g, Wh): litri per benzina/gasolio/GPL/AdBlue/HVO, kg per metano e idrogeno,
// kWh per l'elettrico: la stessa coerenza che il `CHECK` impone al DB.

export const FUEL_TYPES = ['petrol', 'diesel', 'lpg', 'cng', 'electric', 'hydrogen', 'adblue', 'hvo'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export type QuantityUnit = 'L' | 'kg' | 'kWh';

/** Carburanti dichiarabili sul veicolo (`vehicles.fuel_primary` / `fuel_secondary`). */
export type VehicleFuel = 'petrol' | 'diesel' | 'lpg' | 'cng' | 'electric' | 'hydrogen';

export const FUEL_LABELS_IT: Record<FuelType, string> = {
  petrol: 'Benzina',
  diesel: 'Gasolio',
  lpg: 'GPL',
  cng: 'Metano',
  electric: 'Elettricità',
  hydrogen: 'Idrogeno',
  adblue: 'AdBlue',
  hvo: 'HVO',
};

export const fuelLabelIt = (fuel: FuelType): string => FUEL_LABELS_IT[fuel];

/** L'unita' obbligata per ogni carburante (corrisponde al `CHECK` di `fuel_logs`). */
export function unitForFuel(fuel: FuelType): QuantityUnit {
  switch (fuel) {
    case 'cng':
    case 'hydrogen':
      return 'kg';
    case 'electric':
      return 'kWh';
    default:
      return 'L';
  }
}

export const isUnitConsistentWithFuel = (fuel: FuelType, unit: QuantityUnit): boolean => unitForFuel(fuel) === unit;

/**
 * Il serbatoio che un carburante riempie. Gasolio e HVO sono lo STESSO serbatoio: i consumi pieno-a-pieno
 * si calcolano per serbatoio, non per etichetta. L'AdBlue non e' un carburante: non ha consumi.
 */
export type TankKey = 'petrol' | 'diesel' | 'lpg' | 'cng' | 'electric' | 'hydrogen';

export const TANK_ORDER: readonly TankKey[] = ['petrol', 'diesel', 'lpg', 'cng', 'electric', 'hydrogen'];

export function tankOf(fuel: FuelType): TankKey | null {
  switch (fuel) {
    case 'adblue':
      return null;
    case 'hvo':
      return 'diesel';
    default:
      return fuel;
  }
}

/** Il carburante "principale" di un serbatoio (per etichette e unita'). */
export const TANK_LABELS_IT: Record<TankKey, string> = {
  petrol: 'Benzina',
  diesel: 'Gasolio / HVO',
  lpg: 'GPL',
  cng: 'Metano',
  electric: 'Elettricità',
  hydrogen: 'Idrogeno',
};

export interface VehicleFuelConfig {
  fuelPrimary: VehicleFuel;
  fuelSecondary?: VehicleFuel | null;
}

/** Piu' di un serbatoio (benzina + GPL o metano, o ibrido plug-in benzina + elettrico). */
export const isBifuel = (v: VehicleFuelConfig): boolean => v.fuelSecondary != null && v.fuelSecondary !== v.fuelPrimary;

/**
 * I carburanti tra cui scegliere nel modulo del rifornimento, nell'ordine: primario, secondario,
 * poi (solo per i diesel) HVO e AdBlue.
 */
export function fuelTypesForVehicle(v: VehicleFuelConfig): FuelType[] {
  const out: FuelType[] = [v.fuelPrimary];
  if (v.fuelSecondary != null && v.fuelSecondary !== v.fuelPrimary) out.push(v.fuelSecondary);
  if (v.fuelPrimary === 'diesel') out.push('hvo', 'adblue');
  return out;
}

/** Il carburante da preselezionare: l'ultimo usato se ancora valido per il veicolo, altrimenti il primario. */
export function defaultFuelType(v: VehicleFuelConfig, lastUsed?: FuelType | null): FuelType {
  const allowed = fuelTypesForVehicle(v);
  return lastUsed != null && allowed.includes(lastUsed) ? lastUsed : v.fuelPrimary;
}
