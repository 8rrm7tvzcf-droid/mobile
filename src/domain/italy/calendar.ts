// Stato di una scadenza, date dei promemoria e giorni lavorativi. Dominio puro: l'orologio e' sempre un parametro.
import { addDays, diffDays, weekday, type LocalDate } from '@/domain/dates';

/** '1 giorno' / '2 giorni' (plurale italiano). */
export function daysIt(n: number): string {
  return `${n} ${n === 1 ? 'giorno' : 'giorni'}`;
}

export type DeadlineState = 'valid' | 'due_today' | 'overdue';

export interface DeadlineStatus {
  readonly state: DeadlineState;
  /** Giorni che mancano (0 = scade oggi); null se scaduta. */
  readonly daysLeft: number | null;
  /** Giorni di ritardo (>= 1); null se non scaduta. */
  readonly daysOverdue: number | null;
  /** Testo per l'utente: 'Scade tra 5 giorni', 'Scade oggi', 'Scaduta da 1 giorno'. */
  readonly label: string;
}

/**
 * Una scadenza e' valida fino al giorno stesso incluso e «superata» dal giorno dopo (REG §0).
 * Vettori R7 (scade oggi, 0 giorni) e R8 (scaduta da 1 giorno).
 */
export function deadlineStatus(today: LocalDate, dueOn: LocalDate): DeadlineStatus {
  const left = diffDays(today, dueOn);
  if (left > 0) {
    return {
      state: 'valid',
      daysLeft: left,
      daysOverdue: null,
      label: left === 1 ? 'Scade domani' : `Scade tra ${daysIt(left)}`,
    };
  }
  if (left === 0) return { state: 'due_today', daysLeft: 0, daysOverdue: null, label: 'Scade oggi' };
  return { state: 'overdue', daysLeft: null, daysOverdue: -left, label: `Scaduta da ${daysIt(-left)}` };
}

/** Date dei promemoria: `dueOn` meno ciascun preavviso in giorni (0 = il giorno stesso), in ordine crescente e senza doppioni. */
export function reminderDates(dueOn: LocalDate, leadDays: readonly number[]): LocalDate[] {
  return uniqueSorted(leadDays.map((n) => addDays(dueOn, -n)));
}

/** Date dei promemoria a partire da un'ancora (es. data di autentica): ancora piu' ciascuno scarto in giorni. */
export function datesAfter(anchor: LocalDate, afterDays: readonly number[]): LocalDate[] {
  return uniqueSorted(afterDays.map((n) => addDays(anchor, n)));
}

function uniqueSorted(dates: LocalDate[]): LocalDate[] {
  return [...new Set(dates)].sort();
}

export function isWeekend(date: LocalDate): boolean {
  const w = weekday(date);
  return w === 0 || w === 6;
}

/**
 * Primo giorno lavorativo a partire da `date` (incluso). `isHoliday` fornisce i festivi (il dominio non li conosce).
 * ATTENZIONE: il calcolo di default delle scadenze NON applica lo slittamento (SPEC §7.3, scelta prudenziale:
 * la regola e' di confidenza media); la funzione serve per mostrare, se richiesto, «si puo' pagare fino al...».
 */
export function nextBusinessDay(date: LocalDate, isHoliday: (d: LocalDate) => boolean = () => false): LocalDate {
  let d = date;
  while (isWeekend(d) || isHoliday(d)) d = addDays(d, 1);
  return d;
}
