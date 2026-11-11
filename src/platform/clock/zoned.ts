// Conversione fra "data + ora di calendario" e istanti UTC, per un fuso IANA qualsiasi (SPEC 8.4, data.md rischio 7).
// Il dominio ragiona solo in date di calendario 'YYYY-MM-DD' e orari 'HH:MM': la conversione verso l'istante in cui la
// notifica deve scattare vive qui, nello strato platform, perche' dipende da Intl (Hermes) e dal fuso del dispositivo.
// Nessun orologio: tutte le funzioni sono pure rispetto ai parametri.
import { parseDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/ports';

const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Formattatore (in cache) che scompone un istante nei campi di calendario del fuso `timeZone`. Lancia RangeError se il fuso non esiste. */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** true se `timeZone` e' un identificatore che Intl conosce (es. 'Europe/Rome'); 'GMT+1' e simili dipendono dal motore. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

/** Campi di calendario dell'istante `ms` (millisecondi UTC) nel fuso `timeZone`. */
export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out['year'] ?? 1970,
    month: out['month'] ?? 1,
    day: out['day'] ?? 1,
    hour: (out['hour'] ?? 0) % 24, // alcuni motori scrivono la mezzanotte come 24
    minute: out['minute'] ?? 0,
    second: out['second'] ?? 0,
  };
}

/** Scarto del fuso (ora locale meno UTC) in millisecondi, all'istante `ms`. */
export function tzOffsetMs(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Data di calendario e ora 'HH:MM' dell'istante `ms` nel fuso `timeZone`. */
export function localDateTimeOf(ms: number, timeZone: string): { date: LocalDate; time: string } {
  const p = zonedParts(ms, timeZone);
  return { date: `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-${pad2(p.day)}`, time: `${pad2(p.hour)}:${pad2(p.minute)}` };
}

/**
 * L'istante in cui l'orologio a muro di `timeZone` segna `date` + `time`.
 * Casi dell'ora legale (stessa regola di `new Date(y, m, d, h, mm)` e della disambiguazione "compatible" di Temporal):
 *   - ora ripetuta (25/10/2026 02:30 a Roma) -> la PRIMA delle due;
 *   - ora inesistente (28/03/2027 02:30 a Roma) -> si usa lo scarto di prima del salto: scatta alle 03:30 locali.
 */
export function localToInstant(date: LocalDate, time: string, timeZone: string): Date {
  const { y, m, d } = parseDate(date);
  const mt = /^(\d{2}):(\d{2})$/.exec(time);
  const hh = mt ? Number(mt[1]) : NaN;
  const mm = mt ? Number(mt[2]) : NaN;
  if (!mt || hh > 23 || mm > 59) throw new RangeError(`Ora non valida: ${time}`);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const before = tzOffsetMs(naive - DAY_MS, timeZone);
  const after = tzOffsetMs(naive + DAY_MS, timeZone);
  const valid: number[] = [];
  for (const offset of new Set([before, after])) {
    const candidate = naive - offset;
    if (tzOffsetMs(candidate, timeZone) === offset) valid.push(candidate);
  }
  if (valid.length > 0) return new Date(Math.min(...valid));
  return new Date(naive - before);
}
