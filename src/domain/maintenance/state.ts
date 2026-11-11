// Etichette italiane e ordinamento per urgenza degli stati calcolati (data.md 3.5). Dominio puro.
import type { Evaluation, ReasonCode, ReminderState } from './types';

/** Parti di una valutazione che servono a etichettare e ordinare. */
export type StateView = Pick<Evaluation, 'state' | 'effectiveDueOn'> &
  Partial<Pick<Evaluation, 'dueToday' | 'estimated'>>;

const STATE_RANK: Record<ReminderState, number> = { overdue: 0, soon: 1, ok: 2, unknown: 3 };

/**
 * Ordinamento della lista: scaduti (piu' in ritardo prima), poi in arrivo, poi in regola per data; i "da configurare" in fondo.
 * Stabile per elementi pari merito (Array.prototype.sort e' stabile).
 */
export function compareByUrgency(a: StateView, b: StateView): number {
  const byState = STATE_RANK[a.state] - STATE_RANK[b.state];
  if (byState !== 0) return byState;
  const da = a.effectiveDueOn;
  const db = b.effectiveDueOn;
  if (da == null && db == null) return 0;
  if (da == null) return 1;
  if (db == null) return -1;
  return da < db ? -1 : da > db ? 1 : 0;
}

export function sortByUrgency<T extends StateView>(items: readonly T[]): T[] {
  return [...items].sort(compareByUrgency);
}

/** Etichetta UI dello stato ("Scade oggi" non e' "Scaduto"; per le stime "Probabilmente scaduto"). */
export function stateLabel(v: StateView): string {
  switch (v.state) {
    case 'unknown':
      return 'Da configurare';
    case 'ok':
      return 'In regola';
    case 'soon':
      return v.dueToday ? 'Scade oggi' : 'In arrivo';
    case 'overdue':
      return v.estimated ? 'Probabilmente scaduto' : 'Scaduto';
  }
}

/** Cosa chiedere all'utente quando manca un ingrediente (invariante I3). */
export function reasonMessage(code: ReasonCode): string {
  switch (code) {
    case 'NO_LAST_DONE':
      return "Indica quando l'hai fatto l'ultima volta.";
    case 'NO_LAST_KM':
      return "Indica i km dell'ultimo intervento oppure aggiorna il contachilometri.";
    case 'NO_FIXED_DATE':
      return 'Inserisci la data di scadenza.';
    case 'NO_ODOMETER':
      return 'Inserisci i km attuali per stimare la scadenza.';
    case 'RATE_TOO_LOW':
      return "L'auto risulta ferma: nessuna previsione a chilometri.";
    case 'FORECAST_BEYOND_10Y':
      return 'La scadenza a chilometri è oltre i 10 anni: nessuna previsione.';
    case 'CYCLE_SKIPPED':
      return 'Hai saltato questa scadenza: segna «Fatto» quando la esegui per far ripartire il calcolo.';
  }
}
