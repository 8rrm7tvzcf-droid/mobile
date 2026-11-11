// Date di calendario 'YYYY-MM-DD' senza fuso orario (SPEC §8.1, §8.3).
// Solo aritmetica intera: niente Date, niente orologio, niente Intl. Dominio puro.
import type { LocalDate } from '../ports';

export type { LocalDate };

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

export function isValidDate(s: string): s is LocalDate {
  const mt = RE.exec(s);
  if (!mt) return false;
  const y = Number(mt[1]);
  const m = Number(mt[2]);
  const d = Number(mt[3]);
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export interface DateParts {
  y: number;
  m: number;
  d: number;
}

export function parseDate(s: LocalDate): DateParts {
  if (!isValidDate(s)) throw new RangeError(`Data non valida: ${s}`);
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) };
}

export function makeDate(y: number, m: number, d: number): LocalDate {
  const s = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (!isValidDate(s)) throw new RangeError(`Data non valida: ${s}`);
  return s;
}

/** Giorni dal 1970-01-01 (algoritmo days_from_civil di H. Hinnant). */
export function toEpochDay(s: LocalDate): number {
  const { y: y0, m, d } = parseDate(s);
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromEpochDay(n: number): LocalDate {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return makeDate(m <= 2 ? y + 1 : y, m, d);
}

export function addDays(s: LocalDate, n: number): LocalDate {
  return fromEpochDay(toEpochDay(s) + n);
}

/** Aggiunge mesi con clamp a fine mese (31 gen + 1 mese = 28/29 feb). */
export function addMonths(s: LocalDate, n: number): LocalDate {
  const { y, m, d } = parseDate(s);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12 + 12) % 12 + 1;
  return makeDate(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addYears(s: LocalDate, n: number): LocalDate {
  return addMonths(s, n * 12);
}

export function endOfMonth(s: LocalDate): LocalDate {
  const { y, m } = parseDate(s);
  return makeDate(y, m, daysInMonth(y, m));
}

/** Differenza in giorni b - a (positiva se b e' dopo a). */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return toEpochDay(b) - toEpochDay(a);
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0; // ISO: l'ordine lessicografico coincide con quello cronologico
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a <= b ? a : b;
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a >= b ? a : b;
}

/** Giorno della settimana: 0 = domenica ... 6 = sabato. */
export function weekday(s: LocalDate): number {
  return (((toEpochDay(s) + 4) % 7) + 7) % 7; // 1970-01-01 era giovedi
}

function lastSundayEpochDay(y: number, m: number): number {
  const last = toEpochDay(makeDate(y, m, daysInMonth(y, m)));
  return last - weekday(fromEpochDay(last));
}

/**
 * Scarto UTC in minuti dell'Europa centrale (Italia: CET +60 / CEST +120) all'istante `utcMinutes` (minuti dall'epoca UTC).
 * L'ora legale europea va dall'ultima domenica di marzo alle 01:00 UTC all'ultima domenica di ottobre alle 01:00 UTC.
 * Serve a convertire ora locale e UTC attorno al cambio dell'ora senza `Intl` (SPEC 8.1): lo scarto dipende
 * dall'istante che si converte, non da quello in cui si converte.
 */
export function centralEuropeOffsetMinutes(utcMinutes: number): number {
  const y = parseDate(fromEpochDay(Math.floor(utcMinutes / 1440))).y;
  const start = lastSundayEpochDay(y, 3) * 1440 + 60;
  const end = lastSundayEpochDay(y, 10) * 1440 + 60;
  return utcMinutes >= start && utcMinutes < end ? 120 : 60;
}
