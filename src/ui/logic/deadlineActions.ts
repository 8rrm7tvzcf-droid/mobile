// Azioni su una scadenza (S-31): Fatto, Rimanda, Salta. Lettura dei moduli e testi dell'esito. Pura.
import type { SnoozeChoice } from '@/domain/reminders';
import { formatDateIt, formatDistance, parseDateIt, parseDistanceInput, type DistanceUnit } from '@/domain/units';
import type { SnoozeDeadlineResult } from '@/usecases/deadlines';
import { it } from '../i18n/it';

export interface SnoozeOption {
  id: 'tomorrow' | 'days3' | 'days7' | 'km';
  label: string;
  choice: SnoozeChoice;
}

/** "Rimanda": domani, 3 giorni, 1 settimana, dopo N km (SPEC F-25). */
export const SNOOZE_KM = 500;

export const SNOOZE_OPTIONS: readonly SnoozeOption[] = [
  { id: 'tomorrow', label: it.deadlines.snoozeTomorrow, choice: { type: 'tomorrow' } },
  { id: 'days3', label: it.deadlines.snooze3Days, choice: { type: 'days', days: 3 } },
  { id: 'days7', label: it.deadlines.snoozeWeek, choice: { type: 'days', days: 7 } },
  { id: 'km', label: it.deadlines.snoozeKm, choice: { type: 'after_km', km: SNOOZE_KM } },
];

export interface DoneForm {
  date: string;
  km: string;
  notes: string;
}

export type DoneFormErrors = Partial<Record<keyof DoneForm, string>>;

export interface DoneInput {
  doneOn: string;
  doneKm: number | null;
  notes: string | null;
}

/** Legge il modulo "Quando l'hai fatto?": data reale (non nel futuro), km facoltativi. */
export function parseDoneForm(
  form: DoneForm,
  ctx: { today: string; unit: DistanceUnit },
): { ok: true; input: DoneInput } | { ok: false; errors: DoneFormErrors } {
  const errors: DoneFormErrors = {};
  const doneOn = parseDateIt(form.date);
  if (doneOn === null) errors.date = it.common.dateExample;
  else if (doneOn > ctx.today) errors.date = it.common.futureDate;

  let doneKm: number | null = null;
  if (form.km.trim() !== '') {
    doneKm = parseDistanceInput(form.km, ctx.unit);
    if (doneKm === null) errors.km = it.common.kmExample;
  }
  if (doneOn === null || Object.keys(errors).length > 0) return { ok: false, errors };
  const notes = form.notes.trim();
  return { ok: true, input: { doneOn, doneKm, notes: notes === '' ? null : notes } };
}

/** Testo di conferma dopo "Rimanda". */
export function snoozeMessage(res: SnoozeDeadlineResult, unit: DistanceUnit): string {
  if (res.untilKm !== null) return it.deadlines.snoozedKm(formatDistance(res.untilKm, unit));
  return it.deadlines.snoozed(`${formatDateIt(res.untilLocal.date)} alle ${res.untilLocal.time}`);
}

/** "Dopo N km" senza km attuali: il caso d'uso risponde con un errore sul campo `currentKm`. */
export const isMissingKmField = (field: string | undefined): boolean => field === 'currentKm';

/** Provenienza di un "fatto" nello storico. */
export function completionSourceLabel(source: 'service' | 'check' | 'manual' | 'import'): string {
  switch (source) {
    case 'service':
      return 'Intervento';
    case 'check':
      return 'Controllo';
    case 'import':
      return 'Importato';
    default:
      return 'Inserito da te';
  }
}
