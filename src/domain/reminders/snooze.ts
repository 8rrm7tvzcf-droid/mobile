// Snooze (rimando) dei promemoria (data.md 3.6, SPEC 8.3). Dominio puro: lavora su data/ora LOCALI; la conversione
// da/verso istanti UTC (`snoozed_until`) spetta a chi conosce il fuso del dispositivo (strato piattaforma).
import { addDays } from '@/domain/dates';
import type { Result } from '@/domain/ports';
import type { LocalDateTime } from './types';

export const SNOOZE_DEFAULT_KM = 500;
/** Scadenza di sicurezza dello snooze "dopo N km": se l'utente non aggiorna i km il promemoria non resta zittito per sempre. */
export const SNOOZE_KM_SAFETY_DAYS = 30;
export const DEFAULT_NOTIFY_TIME = '09:00';

/** Preset: "Domani alle 09:00", "Fra 3 giorni", "Fra 1 settimana" (days: 7), "Dopo N km" (default +500). */
export type SnoozeChoice =
  | { type: 'tomorrow' }
  | { type: 'days'; days: number }
  | { type: 'after_km'; km?: number };

export interface SnoozeTarget {
  /** Fine dello snooze (o scadenza di sicurezza per "dopo N km"), da convertire in istante UTC per `snoozed_until`. */
  untilLocal: LocalDateTime;
  /** `snooze_until_km` per "dopo N km", altrimenti null. */
  untilKm: number | null;
}

export type SnoozeError = { code: 'NO_ODOMETER' } | { code: 'INVALID_SNOOZE' };

/**
 * Calcola la fine dello snooze. Lo snooze NON cambia la scadenza: nasconde il promemoria da "Da fare" e dalle notifiche.
 * "Dopo N km" richiede i km attuali; senza lettura ritorna NO_ODOMETER (nessun valore inventato).
 */
export function computeSnooze(
  choice: SnoozeChoice,
  now: LocalDateTime,
  options: { currentKm?: number | null; notifyTime?: string } = {},
): Result<SnoozeTarget, SnoozeError> {
  const time = options.notifyTime ?? DEFAULT_NOTIFY_TIME;
  switch (choice.type) {
    case 'tomorrow':
      return { ok: true, value: { untilLocal: { date: addDays(now.date, 1), time }, untilKm: null } };
    case 'days': {
      if (!Number.isInteger(choice.days) || choice.days < 1) return { ok: false, error: { code: 'INVALID_SNOOZE' } };
      return { ok: true, value: { untilLocal: { date: addDays(now.date, choice.days), time }, untilKm: null } };
    }
    case 'after_km': {
      const km = choice.km ?? SNOOZE_DEFAULT_KM;
      if (!Number.isInteger(km) || km < 1) return { ok: false, error: { code: 'INVALID_SNOOZE' } };
      if (options.currentKm == null) return { ok: false, error: { code: 'NO_ODOMETER' } };
      return {
        ok: true,
        value: {
          untilLocal: { date: addDays(now.date, SNOOZE_KM_SAFETY_DAYS), time },
          untilKm: options.currentKm + km,
        },
      };
    }
  }
}

export interface SnoozeState {
  snoozedUntilLocal?: LocalDateTime | null;
  snoozeUntilKm?: number | null;
}

function cmp(a: LocalDateTime, b: LocalDateTime): number {
  const x = `${a.date}T${a.time}`;
  const y = `${b.date}T${b.time}`;
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Un promemoria e' rimandato finche' la fine dello snooze e' nel futuro e (per "dopo N km") i km non sono stati raggiunti.
 * Se nel frattempo scade per km lo snooze NON si annulla (scelta esplicita dell'utente).
 */
export function isSnoozed(s: SnoozeState, now: LocalDateTime, currentKm?: number | null): boolean {
  if (!s.snoozedUntilLocal) return false;
  if (cmp(s.snoozedUntilLocal, now) <= 0) return false;
  if (s.snoozeUntilKm != null && currentKm != null && currentKm >= s.snoozeUntilKm) return false;
  return true;
}

/**
 * Fine dello snooze da passare a `planNotifications` (`snoozedUntilLocal`): null se non e' piu' attivo
 * (scaduto, oppure km raggiunti). Cosi' i km raggiunti fanno tornare subito il promemoria alle notifiche normali.
 */
export function activeSnoozeUntil(s: SnoozeState, now: LocalDateTime, currentKm?: number | null): LocalDateTime | null {
  return isSnoozed(s, now, currentKm) ? (s.snoozedUntilLocal as LocalDateTime) : null;
}
