// Compatibilita' dei template con l'alimentazione del veicolo (catalogo SPEC 7.1, `service_templates.applies_to`).
// I tag veicolo si derivano da powertrain e alimentazioni e NON si salvano mai (src/data/seeds/catalog.ts).
export type VehicleTag = 'combustion' | 'petrol' | 'diesel' | 'gas' | 'bev';

export interface FuelProfile {
  powertrain: string;
  fuelPrimary: string;
  fuelSecondary?: string | null;
}

const COMBUSTION_FUELS = ['petrol', 'diesel', 'lpg', 'cng'];

/**
 * - combustion: ha un motore a combustione (ice, mhev, hev, phev con almeno un carburante liquido o gassoso);
 * - petrol / diesel: carburante primario o secondario benzina; diesel solo se primario;
 * - gas: GPL o metano, primario o secondario;
 * - bev: elettrico puro (powertrain 'bev', oppure alimentazione solo elettrica senza motore termico).
 */
export function vehicleTags(v: FuelProfile): VehicleTag[] {
  const fuels = [v.fuelPrimary, v.fuelSecondary ?? null].filter((f): f is string => !!f);
  const hasThermalFuel = fuels.some((f) => COMBUSTION_FUELS.includes(f));
  const thermalPowertrain = ['ice', 'mhev', 'hev', 'phev'].includes(v.powertrain);
  const tags: VehicleTag[] = [];
  const combustion = thermalPowertrain && hasThermalFuel;
  if (combustion) tags.push('combustion');
  if (combustion && fuels.includes('petrol')) tags.push('petrol');
  if (combustion && v.fuelPrimary === 'diesel') tags.push('diesel');
  if (fuels.includes('lpg') || fuels.includes('cng')) tags.push('gas');
  if (v.powertrain === 'bev' || (!hasThermalFuel && v.fuelPrimary === 'electric' && v.powertrain !== 'fcev')) tags.push('bev');
  return tags;
}

/** `appliesTo` nullo = vale per tutti; altrimenti basta un tag in comune. */
export function templateApplies(appliesTo: readonly string[] | null | undefined, tags: readonly string[]): boolean {
  if (!appliesTo || appliesTo.length === 0) return true;
  return appliesTo.some((t) => tags.includes(t));
}
