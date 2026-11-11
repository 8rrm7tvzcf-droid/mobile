// Formattazione italiana MANUALE (SPEC §8.1, data.md §7.4): migliaia con punto, decimali con virgola,
// simbolo dopo l'importo. Niente API di localizzazione del runtime: deterministica su Hermes e su Node, nessun NBSP inatteso,
// nessuna dipendenza dai dati di localizzazione del telefono. Dominio puro.
import { isValidDate, parseDate, weekday } from '@/domain/dates';
import type { DistanceUnit } from './distance';
import { toDisplayDistance } from './distance';

const DASH = '–';

const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Intero con punto delle migliaia: 1234567 -> "1.234.567". Non finito -> "–". */
export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return DASH;
  const t = Math.trunc(n);
  return (t < 0 ? '-' : '') + group(String(Math.abs(t)));
}

/**
 * `v` e' un intero scalato (centesimi con scale 2, millesimi con scale 3). Virgola decimale, migliaia con punto
 * (disattivabili con `grouping: false`). formatScaled(123456, 2) = "1.234,56"; formatScaled(-50, 2) = "-0,50".
 */
export function formatScaled(v: number, scale: number, opts: { grouping?: boolean } = {}): string {
  if (!Number.isFinite(v)) return DASH;
  const grouping = opts.grouping ?? true;
  const r = Math.round(v);
  const neg = r < 0;
  const a = Math.abs(r);
  const p = 10 ** scale;
  const int = Math.floor(a / p);
  const frac = String(a % p).padStart(scale, '0');
  return (neg ? '-' : '') + (grouping ? group(String(int)) : String(int)) + (scale > 0 ? ',' + frac : '');
}

// ---------------------------------------------------------------- denaro

/** Centesimi -> "1.234,56 €". */
export const formatEuro = (cents: number): string => (Number.isFinite(cents) ? `${formatScaled(cents, 2)} €` : DASH);

/** Centesimi -> euro interi arrotondati ("1.235 €"): per riepiloghi dove i centesimi sono rumore. */
export function formatEuroWhole(cents: number): string {
  if (!Number.isFinite(cents)) return DASH;
  const e = cents < 0 ? -Math.round(-cents / 100) : Math.round(cents / 100);
  return `${formatInt(e)} €`;
}

/** Millesimi di euro per unita' -> "1,859" (senza simbolo). */
export const formatPricePerUnit = (milli: number): string => formatScaled(milli, 3, { grouping: false });

/** Prezzo con unita' di misura: formatPriceWithUnit(1859, 'L') = "1,859 €/L". */
export const formatPriceWithUnit = (milli: number, unit: string): string =>
  Number.isFinite(milli) ? `${formatPricePerUnit(milli)} €/${unit}` : DASH;

/** Millesimi di euro al km -> "0,35 €/km" (arrotondato al centesimo, solo per mostrare). */
export const formatEuroPerKm = (milliPerKm: number): string =>
  Number.isFinite(milliPerKm) ? `${formatScaled(Math.round(milliPerKm / 10), 2)} €/km` : DASH;

// ---------------------------------------------------------------- quantita' e distanze

/** Millesimi -> "40,000" (senza unita'). */
export const formatQuantity = (milli: number): string => formatScaled(milli, 3, { grouping: false });

/** formatQuantityWithUnit(40000, 'L') = "40,000 L"; formatQuantityWithUnit(12350, 'kWh') = "12,350 kWh". */
export const formatQuantityWithUnit = (milli: number, unit: string): string =>
  Number.isFinite(milli) ? `${formatQuantity(milli)} ${unit}` : DASH;

/** Km interi -> "12.345 km". */
export const formatKm = (km: number): string => (Number.isFinite(km) ? `${formatInt(km)} km` : DASH);

/** Km canonici -> distanza nell'unita' del veicolo: formatDistance(10000, 'mi') = "6.214 mi". */
export function formatDistance(km: number, unit: DistanceUnit): string {
  if (!Number.isFinite(km)) return DASH;
  return `${formatInt(toDisplayDistance(km, unit))} ${unit}`;
}

/** Punti base (10000 = 100%) -> "34,5 %" (un decimale). Per le quote dei costi. */
export const formatPercentBp = (bp: number): string =>
  Number.isFinite(bp) ? `${formatScaled(Math.round(bp / 10), 1)} %` : DASH;

// ---------------------------------------------------------------- consumi

export type ConsumptionUnit = 'L' | 'kg' | 'kWh';
export type ConsumptionDisplay = 'per100' | 'kmPerUnit' | 'mpgUS' | 'mpgUK';

export const per100ToKmPerL = (per100: number): number => 100 / per100;
export const per100ToMpgUS = (per100: number): number => 235.215 / per100;
export const per100ToMpgUK = (per100: number): number => 282.481 / per100;

/**
 * Consumo in centesimi di unita' per 100 km (643 = 6,43 L/100 km) -> testo.
 * 'per100' (default): "6,43 L/100 km" (kg/100 km, kWh/100 km); 'kmPerUnit': "15,55 km/L";
 * 'mpgUS'/'mpgUK' hanno senso solo per i litri: "36,6 mpg (US)" / "43,9 mpg (UK)" (altrimenti ripiegano su per100).
 */
export function formatConsumption(
  per100Centi: number,
  unit: ConsumptionUnit,
  mode: ConsumptionDisplay = 'per100',
): string {
  if (!Number.isFinite(per100Centi)) return DASH;
  const per100 = per100Centi / 100;
  if (mode !== 'per100' && per100 > 0) {
    if (mode === 'kmPerUnit') return `${formatScaled(Math.round(per100ToKmPerL(per100) * 100), 2)} km/${unit}`;
    if (unit === 'L' && mode === 'mpgUS') return `${formatScaled(Math.round(per100ToMpgUS(per100) * 10), 1)} mpg (US)`;
    if (unit === 'L' && mode === 'mpgUK') return `${formatScaled(Math.round(per100ToMpgUK(per100) * 10), 1)} mpg (UK)`;
  }
  return `${formatScaled(per100Centi, 2)} ${unit}/100 km`;
}

// ---------------------------------------------------------------- date

export const MONTHS_IT = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
] as const;

export const WEEKDAYS_IT = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'] as const;

/** 'YYYY-MM-DD' -> 'gg/mm/aaaa'. Una stringa non valida torna invariata (la UI non deve mai andare in errore). */
export function formatDateIt(ymd: string): string {
  if (!isValidDate(ymd)) return ymd;
  return ymd.split('-').reverse().join('/');
}

/** '2026-10-07' -> "7 ottobre 2026". */
export function formatDateLongIt(ymd: string): string {
  if (!isValidDate(ymd)) return ymd;
  const { y, m, d } = parseDate(ymd);
  return `${d} ${MONTHS_IT[m - 1]} ${y}`;
}

/** '2026-10-07' -> "mercoledì 7 ottobre 2026". */
export function formatDateWithWeekdayIt(ymd: string): string {
  if (!isValidDate(ymd)) return ymd;
  return `${WEEKDAYS_IT[weekday(ymd)]} ${formatDateLongIt(ymd)}`;
}

/** '2026-10' (o una data intera) -> "ottobre 2026". */
export function formatMonthYearIt(ym: string): string {
  const mt = /^(\d{4})-(\d{2})/.exec(ym);
  if (!mt) return ym;
  const m = Number(mt[2]);
  if (m < 1 || m > 12) return ym;
  return `${MONTHS_IT[m - 1]} ${mt[1]}`;
}

/** Plurale italiano semplice: plural(1, 'giorno', 'giorni') = "1 giorno"; plural(3, ...) = "3 giorni". */
export const plural = (n: number, one: string, many: string): string => `${formatInt(n)} ${n === 1 ? one : many}`;
