// Periodo di calendario per le letture di rifornimenti, spese e costi (SPEC 6.3.8: mese, anno, sempre).
// Le date sono 'YYYY-MM-DD' inclusive. Un estremo mancante (null/undefined) = nessun limite da quel lato ("sempre").
import { addMonths, endOfMonth, isValidDate, makeDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/ports';

export interface DatePeriod {
  from?: LocalDate | null;
  to?: LocalDate | null;
}

/** Un periodo con entrambi gli estremi espliciti (null = illimitato). */
export interface ResolvedPeriod {
  from: LocalDate | null;
  to: LocalDate | null;
}

/** Normalizza un periodo: gli estremi non validi si ignorano (nessun limite), non si lancia mai. */
export function resolvePeriod(p?: DatePeriod | null): ResolvedPeriod {
  const ok = (v: string | null | undefined): LocalDate | null => (typeof v === 'string' && isValidDate(v) ? v : null);
  return { from: ok(p?.from), to: ok(p?.to) };
}

/** Il periodo di un mese: `periodOfMonth('2026-10')` = dal 2026-10-01 al 2026-10-31. */
export function periodOfMonth(month: string): ResolvedPeriod {
  const first = `${month}-01`;
  if (!/^\d{4}-\d{2}$/.test(month) || !isValidDate(first)) return { from: null, to: null };
  return { from: first, to: endOfMonth(first) };
}

/** Il periodo di un anno solare: `periodOfYear(2026)` = dal 2026-01-01 al 2026-12-31. */
export function periodOfYear(year: number): ResolvedPeriod {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return { from: null, to: null };
  return { from: makeDate(year, 1, 1), to: makeDate(year, 12, 31) };
}

/** Gli ultimi `months` mesi interi fino al mese di `today` incluso (es. 12 = da 11 mesi fa a oggi). */
export function periodOfLastMonths(today: LocalDate, months: number): ResolvedPeriod {
  const n = Math.max(1, Math.floor(months));
  const firstOfThisMonth = `${today.slice(0, 7)}-01`;
  return { from: addMonths(firstOfThisMonth, -(n - 1)), to: today };
}

/** `true` se la data cade nel periodo (estremi inclusi). Le stringhe 'YYYY-MM-DD' si confrontano lessicograficamente. */
export function inPeriod(date: LocalDate, p: ResolvedPeriod): boolean {
  return (p.from === null || date >= p.from) && (p.to === null || date <= p.to);
}
