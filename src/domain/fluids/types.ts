// Controllo livelli (F-44; data.md `fluid_checks`, SPEC §8.2 M-1): fluidi, esiti e il record di un controllo.
// Dominio puro. La pressione dei pneumatici e' in MILLIBAR interi (500..6000).
import type { LocalDate } from '@/domain/ports';

/** I fluidi del `CHECK` di `fluid_checks.fluid`, piu' `tyre_pressure` (M-1). */
export const FLUIDS = [
  'engine_oil',
  'coolant',
  'brake_fluid',
  'washer',
  'adblue',
  'power_steering',
  'gearbox_oil',
  'tyre_pressure',
  'other',
] as const;
export type Fluid = (typeof FLUIDS)[number];

/** Gli elementi dell'elenco S-24, nell'ordine in cui compaiono (SPEC §6.3.9). `other` si sceglie solo a mano. */
export const CHECKLIST_FLUIDS: readonly Fluid[] = [
  'engine_oil',
  'coolant',
  'brake_fluid',
  'washer',
  'adblue',
  'power_steering',
  'gearbox_oil',
  'tyre_pressure',
];

/** OK, basso, rabboccato (o gonfiato), alto. */
export const FLUID_LEVELS = ['ok', 'low', 'topped_up', 'high'] as const;
export type FluidLevel = (typeof FLUID_LEVELS)[number];

/** Una riga di `fluid_checks` (solo non cancellate). I km vengono dalla lettura collegata, se l'utente li ha inseriti. */
export interface FluidCheck {
  id: string;
  checkedOn: LocalDate;
  fluid: Fluid;
  level: FluidLevel;
  /** Solo con `level = 'topped_up'` (1..100.000 ml). */
  addedMl?: number | null;
  /** Solo per `tyre_pressure` (500..6000 millibar). */
  valueMillibar?: number | null;
  /** Km della lettura collegata al controllo. */
  km?: number | null;
}

/** I dati del veicolo che decidono quali fluidi hanno senso. */
export interface FluidVehicle {
  fuelPrimary: 'petrol' | 'diesel' | 'lpg' | 'cng' | 'electric' | 'hydrogen';
  fuelSecondary?: 'petrol' | 'lpg' | 'cng' | 'electric' | null;
  powertrain?: 'ice' | 'mhev' | 'hev' | 'phev' | 'bev' | 'fcev' | null;
}
