// Validazione di un controllo livelli: replica in TypeScript i `CHECK` di `fluid_checks` (data.md §1.3, SPEC §8.2 M-1)
// con messaggi in italiano, cosi' la UI non legge mai testi di SQLite. Dominio puro.
import { compareDates, isValidDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/ports';
import { formatInt, isValidKm, isValidTyreMillibar, parseScaled, MAX_TYRE_MILLIBAR, MIN_TYRE_MILLIBAR } from '@/domain/units';
import { FLUIDS, FLUID_LEVELS, type Fluid, type FluidLevel } from './types';

export type FluidIssueCode =
  | 'INVALID_DATE'
  | 'FUTURE_DATE'
  | 'INVALID_FLUID'
  | 'INVALID_LEVEL'
  | 'INVALID_ADDED_AMOUNT'
  | 'ADDED_WITHOUT_TOP_UP'
  | 'INVALID_PRESSURE'
  | 'PRESSURE_ON_OTHER_FLUID'
  | 'INVALID_KM';

export interface FluidIssue {
  code: FluidIssueCode;
  message: string;
}

export interface FluidCheckInput {
  checkedOn: string;
  fluid: string;
  level: string;
  addedMl?: number | null;
  valueMillibar?: number | null;
  km?: number | null;
}

export interface FluidValidation {
  ok: boolean;
  errors: FluidIssue[];
}

export const MAX_ADDED_ML = 100_000;

export function validateFluidCheck(input: FluidCheckInput, opts: { today: LocalDate }): FluidValidation {
  const errors: FluidIssue[] = [];
  const err = (code: FluidIssueCode, message: string) => errors.push({ code, message });

  if (!isValidDate(input.checkedOn)) err('INVALID_DATE', 'La data non è valida.');
  else if (compareDates(input.checkedOn, opts.today) > 0) err('FUTURE_DATE', 'La data del controllo è nel futuro.');

  const fluidOk = (FLUIDS as readonly string[]).includes(input.fluid);
  if (!fluidOk) err('INVALID_FLUID', 'Fluido non riconosciuto.');
  const levelOk = (FLUID_LEVELS as readonly string[]).includes(input.level);
  if (!levelOk) err('INVALID_LEVEL', 'Esito non riconosciuto.');

  if (input.addedMl != null) {
    if (levelOk && input.level !== 'topped_up') {
      err('ADDED_WITHOUT_TOP_UP', 'La quantità si indica solo se hai rabboccato.');
    } else if (!Number.isInteger(input.addedMl) || input.addedMl < 1 || input.addedMl > MAX_ADDED_ML) {
      err('INVALID_ADDED_AMOUNT', `La quantità aggiunta deve essere tra 1 ml e ${formatInt(MAX_ADDED_ML / 1000)} litri.`);
    }
  }
  if (input.valueMillibar != null) {
    if (fluidOk && input.fluid !== 'tyre_pressure') {
      err('PRESSURE_ON_OTHER_FLUID', 'La pressione si indica solo per i pneumatici.');
    } else if (!isValidTyreMillibar(input.valueMillibar)) {
      err(
        'INVALID_PRESSURE',
        `La pressione deve essere tra ${formatInt(MIN_TYRE_MILLIBAR)} e ${formatInt(MAX_TYRE_MILLIBAR)} millibar (0,5 e 6 bar).`,
      );
    }
  }
  if (input.km != null && !isValidKm(input.km)) err('INVALID_KM', 'I km devono essere un numero intero tra 0 e 2.000.000.');
  return { ok: errors.length === 0, errors };
}

/**
 * Quantita' aggiunta scritta dall'utente -> millilitri interi. `unit`: 'ml' ("250") o 'L' ("0,5", "1.5").
 * `null` se illeggibile, zero, o con troppi decimali (nessun arrotondamento silenzioso).
 */
export function parseAddedMl(input: string, unit: 'ml' | 'L'): number | null {
  const s = input.replace(/ml|l/gi, '');
  const v = unit === 'L' ? parseScaled(s, 3, { thousands: 'none' }) : parseScaled(s, 0, { thousands: 'none' });
  return v !== null && v > 0 ? v : null;
}

export const isFluid = (v: string): v is Fluid => (FLUIDS as readonly string[]).includes(v);
export const isFluidLevel = (v: string): v is FluidLevel => (FLUID_LEVELS as readonly string[]).includes(v);
