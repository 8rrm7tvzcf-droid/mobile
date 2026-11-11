// Conversione istante UTC <-> data/ora locali SENZA Intl (SPEC 8.1): lo scarto del fuso si ricava dall'orologio
// iniettato (`nowIso` contro `nowLocal`) e vale per l'istante corrente. Per istanti o date di un altro giorno lo scarto puo'
// essere diverso (cambio dell'ora legale): per l'Italia (Europe/Rome) si usa la regola dell'ora legale europea, calcolata
// sull'istante convertito e non su quello in cui si converte (`utcOffsetAt`); per gli altri fusi resta lo scarto di adesso.
import { centralEuropeOffsetMinutes, fromEpochDay, toEpochDay } from '@/domain/dates';
import type { Clock } from '@/domain/ports';
import type { LocalDateTime } from '@/domain/reminders';

const minutesOf = (date: string, time: string): number => {
  const h = Number(time.slice(0, 2));
  const m = Number(time.slice(3, 5));
  return toEpochDay(date) * 1440 + h * 60 + m;
};

/** Somma minuti (anche negativi) a una data/ora locale, riportando il giorno. */
export function addMinutes(dt: LocalDateTime, minutes: number): LocalDateTime {
  const total = minutesOf(dt.date, dt.time) + minutes;
  const day = Math.floor(total / 1440);
  const rem = total - day * 1440;
  const hh = String(Math.floor(rem / 60)).padStart(2, '0');
  const mm = String(rem % 60).padStart(2, '0');
  return { date: fromEpochDay(day), time: `${hh}:${mm}` };
}

/** Scarto in minuti fra ora locale e UTC adesso (es. +120 in estate a Roma). */
export function utcOffsetMinutes(clock: Clock): number {
  const nowUtc = clock.nowIso();
  const loc = clock.nowLocal();
  return minutesOf(loc.date, loc.time) - minutesOf(nowUtc.slice(0, 10), nowUtc.slice(11, 16));
}

/** 'YYYY-MM-DDTHH:MM:SS.mmmZ' -> data e ora locali, con lo scarto dato. */
export function utcToLocal(iso: string, offsetMin: number): LocalDateTime {
  return addMinutes({ date: iso.slice(0, 10), time: iso.slice(11, 16) }, offsetMin);
}

/** Fusi che seguono l'ora legale dell'Europa centrale (CET/CEST) e che l'app conosce senza `Intl`. */
const CENTRAL_EUROPE_ZONES: ReadonlySet<string> = new Set(['Europe/Rome', 'Europe/Vatican', 'Europe/San_Marino']);

/**
 * Scarto in minuti fra ora locale e UTC all'istante `utcMs` (millisecondi UTC), che puo' essere lontano da adesso.
 * Per l'Europa centrale e' la regola dell'ora legale (CET +60 / CEST +120), purche' spieghi lo scarto che l'orologio
 * osserva adesso: un orologio che dichiara Roma ma segna un altro scarto (orologio finto, UTC trattato come locale) o un fuso
 * non europeo mantengono lo scarto di adesso, come prima.
 */
export function utcOffsetAt(clock: Clock, utcMs: number): number {
  const now = utcOffsetMinutes(clock);
  if (!CENTRAL_EUROPE_ZONES.has(clock.timeZone())) return now;
  if (centralEuropeOffsetMinutes(Math.floor(Date.parse(clock.nowIso()) / 60000)) !== now) return now;
  return centralEuropeOffsetMinutes(Math.floor(utcMs / 60000));
}

/** Istante UTC ISO -> data e ora locali, con lo scarto di QUELL'istante (non di adesso). */
export function isoToLocal(iso: string, clock: Clock): LocalDateTime {
  return utcToLocal(iso, utcOffsetAt(clock, Date.parse(iso)));
}

/**
 * Data e ora locali -> istante UTC ISO con millisecondi, con lo scarto del giorno di DESTINAZIONE (un rimando a domani
 * alle 09:00 attraversa il cambio dell'ora: lo scarto di adesso darebbe un'ora di meno o di piu'). Ora ripetuta (02:30 del
 * cambio d'autunno): la prima delle due; ora inesistente (02:30 del cambio di primavera): scarto di prima del salto.
 */
export function localToIso(local: LocalDateTime, clock: Clock): string {
  const naiveMs = minutesOf(local.date, local.time) * 60000;
  const before = utcOffsetAt(clock, naiveMs - 86_400_000);
  const after = utcOffsetAt(clock, naiveMs + 86_400_000);
  const valid: number[] = [];
  for (const offset of new Set([before, after])) {
    const candidate = naiveMs - offset * 60000;
    if (utcOffsetAt(clock, candidate) === offset) valid.push(candidate);
  }
  return new Date(valid.length > 0 ? Math.min(...valid) : naiveMs - before * 60000).toISOString();
}
