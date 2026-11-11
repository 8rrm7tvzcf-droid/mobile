// Importi di un rifornimento: «due campi qualsiasi calcolano il terzo» (SPEC §6.3.8) e validazione NON bloccante
// del totale e della plausibilita' (F-39). Tutto in interi: quantita' e prezzo in millesimi, totale in centesimi.
import { compareDates, isValidDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/ports';
import {
  MAX_KM,
  expectedTotalCents,
  formatEuro,
  formatInt,
  formatQuantityWithUnit,
  isValidKm,
  quantityFromTotal,
  totalLooksConsistent,
  unitPriceFromTotal,
} from '@/domain/units';
import { FUEL_TYPES, isUnitConsistentWithFuel, unitForFuel, type FuelType, type QuantityUnit } from './types';

export type FuelAmountField = 'quantity' | 'unitPrice' | 'total';

export interface FuelAmounts {
  quantityMilli: number | null;
  unitPriceMilli: number | null;
  totalCents: number | null;
}

export interface FuelAmountsResult extends FuelAmounts {
  /** Il campo calcolato (mai uno di quelli forniti), oppure `null` se non c'era nulla da calcolare. */
  computed: FuelAmountField | null;
}

const has = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Completa il terzo campo quando ne sono noti due; non tocca mai i campi forniti.
 * Con tre campi o con meno di due non calcola nulla (`computed: null`). Dividendo per un prezzo o una quantita'
 * pari a 0 il terzo campo resta `null`.
 */
export function completeFuelAmounts(a: Partial<FuelAmounts>): FuelAmountsResult {
  const q = has(a.quantityMilli) ? a.quantityMilli : null;
  const p = has(a.unitPriceMilli) ? a.unitPriceMilli : null;
  const t = has(a.totalCents) ? a.totalCents : null;
  const base = { quantityMilli: q, unitPriceMilli: p, totalCents: t };
  if (q !== null && p !== null && t === null) {
    return { ...base, totalCents: expectedTotalCents(q, p), computed: 'total' };
  }
  if (t !== null && p !== null && q === null) {
    const v = quantityFromTotal(t, p);
    return { ...base, quantityMilli: v, computed: v === null ? null : 'quantity' };
  }
  if (t !== null && q !== null && p === null) {
    const v = unitPriceFromTotal(t, q);
    return { ...base, unitPriceMilli: v, computed: v === null ? null : 'unitPrice' };
  }
  return { ...base, computed: null };
}

export type FuelIssueCode =
  | 'INVALID_DATE'
  | 'FUTURE_DATE'
  | 'INVALID_QUANTITY'
  | 'INVALID_UNIT'
  | 'INVALID_PRICE'
  | 'INVALID_TOTAL'
  | 'INVALID_KM'
  | 'TOTAL_MISMATCH'
  | 'PRICE_OUT_OF_RANGE'
  | 'QUANTITY_ABOVE_MAX';

export interface FuelIssue {
  code: FuelIssueCode;
  severity: 'error' | 'warning';
  message: string;
}

export interface FuelLogInput {
  filledOn: string;
  fuelType: FuelType;
  /** Se omessa vale l'unita' obbligata del carburante. */
  quantityUnit?: QuantityUnit;
  quantityMilli: number;
  unitPriceMilli?: number | null;
  totalCents: number;
  /** Km collegati (la lettura dell'odometro e' validata a parte da `validateOdometerReading`). */
  km?: number | null;
}

export interface FuelValidation {
  /** `false` solo se un errore bloccante (violerebbe un CHECK del DB). Gli avvisi non bloccano mai. */
  ok: boolean;
  errors: FuelIssue[];
  warnings: FuelIssue[];
  /** Totale atteso (quantita' x prezzo) se il prezzo e' noto: per mostrare «dovrebbe essere 74,36 €». */
  expectedTotalCents: number | null;
}

export interface FuelValidationOptions {
  today: LocalDate;
  /** Quantita' massima plausibile in millesimi (es. serbatoio + 10%): oltre si avvisa. */
  maxQuantityMilli?: number | null;
}

/** Prezzi unitari plausibili in millesimi di euro per unita' (min, max): fuori da qui si chiede di ricontrollare. */
export const PLAUSIBLE_PRICE_MILLI: Record<FuelType, readonly [number, number]> = {
  petrol: [500, 4000],
  diesel: [500, 4000],
  hvo: [500, 4000],
  lpg: [300, 2500],
  cng: [500, 4000],
  electric: [30, 2500],
  hydrogen: [5000, 25000],
  adblue: [200, 6000],
};

const MAX_PRICE_MILLI = 100_000_000; // CHECK unit_price_milli BETWEEN 0 AND 100000000
const MAX_TOTAL_CENTS = 100_000_000_000; // CHECK total_cents BETWEEN 0 AND 100000000000

export function validateFuelLog(input: FuelLogInput, opts: FuelValidationOptions): FuelValidation {
  const errors: FuelIssue[] = [];
  const warnings: FuelIssue[] = [];
  const err = (code: FuelIssueCode, message: string) => errors.push({ code, severity: 'error', message });
  const warn = (code: FuelIssueCode, message: string) => warnings.push({ code, severity: 'warning', message });

  if (!isValidDate(input.filledOn)) err('INVALID_DATE', 'La data non è valida.');
  else if (compareDates(input.filledOn, opts.today) > 0) err('FUTURE_DATE', 'La data del rifornimento è nel futuro.');

  if (!FUEL_TYPES.includes(input.fuelType)) {
    err('INVALID_UNIT', 'Carburante non riconosciuto.');
  } else {
    const unit = input.quantityUnit ?? unitForFuel(input.fuelType);
    if (!isUnitConsistentWithFuel(input.fuelType, unit)) {
      err('INVALID_UNIT', `Per questo carburante l'unità è ${unitForFuel(input.fuelType)}, non ${unit}.`);
    }
  }

  if (!Number.isSafeInteger(input.quantityMilli) || input.quantityMilli <= 0) {
    err('INVALID_QUANTITY', 'La quantità deve essere maggiore di zero.');
  }
  const price = input.unitPriceMilli ?? null;
  if (price !== null && (!Number.isSafeInteger(price) || price < 0 || price > MAX_PRICE_MILLI)) {
    err('INVALID_PRICE', 'Il prezzo unitario non è valido.');
  }
  if (!Number.isSafeInteger(input.totalCents) || input.totalCents < 0 || input.totalCents > MAX_TOTAL_CENTS) {
    err('INVALID_TOTAL', 'Il totale non è valido.');
  }
  if (input.km != null && !isValidKm(input.km)) {
    err('INVALID_KM', `I km devono essere un numero intero tra 0 e ${formatInt(MAX_KM)}.`);
  }

  let expected: number | null = null;
  if (errors.length === 0) {
    const unit = input.quantityUnit ?? unitForFuel(input.fuelType);
    if (price !== null) {
      expected = expectedTotalCents(input.quantityMilli, price);
      if (!totalLooksConsistent(input.totalCents, input.quantityMilli, price)) {
        warn(
          'TOTAL_MISMATCH',
          `Il totale non torna: ricontrolla. ${formatQuantityWithUnit(input.quantityMilli, unit)} per il prezzo indicato fanno ${formatEuro(expected)}, non ${formatEuro(input.totalCents)}.`,
        );
      }
      const [lo, hi] = PLAUSIBLE_PRICE_MILLI[input.fuelType];
      if (price > 0 && (price < lo || price > hi)) {
        warn('PRICE_OUT_OF_RANGE', 'Il prezzo unitario sembra insolito: controlla la virgola.');
      }
    }
    if (opts.maxQuantityMilli != null && input.quantityMilli > opts.maxQuantityMilli) {
      warn(
        'QUANTITY_ABOVE_MAX',
        `${formatQuantityWithUnit(input.quantityMilli, unit)} sono più della capacità prevista (${formatQuantityWithUnit(opts.maxQuantityMilli, unit)}): controlla.`,
      );
    }
  }
  return { ok: errors.length === 0, errors, warnings, expectedTotalCents: expected };
}
