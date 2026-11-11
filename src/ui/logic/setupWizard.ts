// Wizard "Imposta le scadenze" (S-04, SPEC 6.3.3): stato delle risposte e costruzione dell'input di setupDeadlines. Pura.
import { formatDateIt, parseDateIt, parseDistanceInput, toDisplayDistance, type DistanceUnit } from '@/domain/units';
import type { LastDoneSuggestion } from '@/usecases/services';
import type { SetupDeadlinesInput, SetupItemInput, SetupProposal } from '@/usecases/deadlines';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '@/usecases/queries';
import type { ReminderCategory } from '@/domain/reminders';
import { it } from '../i18n/it';

export type LastDoneKind = 'done' | 'unknown' | 'never';

export interface ItemAnswer {
  selected: boolean;
  lastDone: LastDoneKind;
  /** gg/mm/aaaa */
  doneOn: string;
  doneKm: string;
  /** Prossima scadenza dal documento (gg/mm/aaaa). */
  nextDueOn: string;
  /** Revisione: data dell'ultima (gg/mm/aaaa). */
  lastInspectionOn: string;
  /** Bollo: mese di pagamento 1-12. */
  paymentMonth: number | null;
}

export type WizardState = Record<string, ItemAnswer>;
export type ItemErrors = Partial<Record<'doneOn' | 'doneKm' | 'nextDueOn' | 'lastInspectionOn', string>>;
export type WizardErrors = Record<string, ItemErrors>;

export const emptyAnswer = (selected: boolean): ItemAnswer => ({
  selected,
  lastDone: 'unknown',
  doneOn: '',
  doneKm: '',
  nextDueOn: '',
  lastInspectionOn: '',
  paymentMonth: null,
});

/** Lo storico degli interventi: per ogni voce del catalogo l'ultima volta che e' stata fatta (`suggestLastDoneFromHistory`). */
export type HistoryMap = Readonly<Record<string, LastDoneSuggestion>>;

/** La risposta che lo storico propone per una voce ("Quando l'hai fatto l'ultima volta?"), o `null` se non ne sa nulla. */
export function historyAnswer(p: SetupProposal, history: HistoryMap, unit: DistanceUnit): Partial<ItemAnswer> | null {
  if (!p.applies || p.existingItemId !== null) return null;
  const h = history[p.templateId];
  if (!h) return null;
  if (p.question === 'last_done') {
    return { lastDone: 'done', doneOn: formatDateIt(h.doneOn), doneKm: h.doneKm !== null ? String(toDisplayDistance(h.doneKm, unit)) : '' };
  }
  if (p.question === 'inspection') return { lastInspectionOn: formatDateIt(h.doneOn) };
  return null;
}

/** Le voci le cui risposte arrivano dallo storico (per scrivere «Dal tuo storico» accanto ai valori proposti). */
export function historyBacked(proposals: readonly SetupProposal[], history: HistoryMap, unit: DistanceUnit): Record<string, LastDoneSuggestion> {
  const out: Record<string, LastDoneSuggestion> = {};
  for (const p of proposals) if (historyAnswer(p, history, unit) !== null) out[p.templateId] = history[p.templateId] as LastDoneSuggestion;
  return out;
}

/**
 * Parte con le voci pre-selezionate dal catalogo (compatibili e attive di default), tranne quelle gia' presenti. Se l'auto ha
 * uno storico di interventi, «ultimo fatto» e' gia' compilato con data e km dell'intervento piu' recente.
 */
export function initialWizardState(proposals: readonly SetupProposal[], history: HistoryMap = {}, unit: DistanceUnit = 'km'): WizardState {
  const state: WizardState = {};
  for (const p of proposals) {
    const base = emptyAnswer(p.applies && p.preselected && p.existingItemId === null);
    state[p.templateId] = { ...base, ...(historyAnswer(p, history, unit) ?? {}) };
  }
  return state;
}

/**
 * Risposte per l'auto di esempio: solo le voci di cui lo storico dice qualcosa (le altre resterebbero «Da configurare») e il
 * mese del bollo dall'immatricolazione, cosi' l'Oggi mostra subito semafori colorati.
 */
export function demoWizardState(proposals: readonly SetupProposal[], history: HistoryMap, unit: DistanceUnit): WizardState {
  const state = initialWizardState(proposals, history, unit);
  for (const p of proposals) {
    const a = state[p.templateId];
    if (!a || !a.selected) continue;
    if (p.question === 'last_done' && a.lastDone !== 'done') a.selected = false;
    if (p.question === 'road_tax' && p.suggestedDueOn) a.paymentMonth = Number(p.suggestedDueOn.slice(5, 7));
  }
  return state;
}

export const selectedCount = (state: WizardState): number => Object.values(state).filter((a) => a.selected).length;

export interface ProposalGroup {
  category: ReminderCategory;
  label: string;
  items: SetupProposal[];
}

/** Solo le voci compatibili con l'auto, raggruppate per categoria nell'ordine della SPEC. */
export function groupProposals(proposals: readonly SetupProposal[]): ProposalGroup[] {
  const groups: ProposalGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const items = proposals.filter((p) => p.applies && p.category === category);
    if (items.length > 0) groups.push({ category, label: CATEGORY_LABELS[category], items });
  }
  return groups;
}

type Built = { ok: true; input: SetupDeadlinesInput } | { ok: false; errors: WizardErrors };

/** Trasforma le risposte nell'input del caso d'uso; gli errori di lettura sono per voce e in italiano. */
export function buildSetupInput(
  vehicleId: string,
  proposals: readonly SetupProposal[],
  state: WizardState,
  ctx: { today: string; unit: DistanceUnit },
): Built {
  const items: SetupItemInput[] = [];
  const errors: WizardErrors = {};

  for (const p of proposals) {
    const a = state[p.templateId];
    if (!a || !a.selected || !p.applies || p.existingItemId !== null) continue;
    const e: ItemErrors = {};
    const item: SetupItemInput = { templateId: p.templateId };

    const readDate = (text: string, key: keyof ItemErrors, allowFuture: boolean): string | null => {
      if (text.trim() === '') return null;
      const parsed = parseDateIt(text);
      if (parsed === null) {
        e[key] = it.common.dateExample;
        return null;
      }
      if (!allowFuture && parsed > ctx.today) {
        e[key] = it.common.futureDate;
        return null;
      }
      return parsed;
    };

    switch (p.question) {
      case 'last_done': {
        if (a.lastDone === 'done') {
          const on = readDate(a.doneOn, 'doneOn', false);
          if (a.doneOn.trim() === '') e.doneOn = it.common.dateExample;
          let km: number | null = null;
          if (a.doneKm.trim() !== '') {
            km = parseDistanceInput(a.doneKm, ctx.unit);
            if (km === null) e.doneKm = it.common.kmExample;
          }
          if (on !== null) item.lastDone = { kind: 'done', on, km };
        } else {
          item.lastDone = { kind: a.lastDone };
        }
        break;
      }
      case 'inspection': {
        const last = readDate(a.lastInspectionOn, 'lastInspectionOn', false);
        const next = readDate(a.nextDueOn, 'nextDueOn', true);
        if (last !== null) item.inspection = { lastInspectionOn: last };
        if (next !== null) item.nextDueOn = next;
        break;
      }
      case 'road_tax': {
        if (a.paymentMonth !== null) item.paymentMonth = a.paymentMonth;
        const next = readDate(a.nextDueOn, 'nextDueOn', true);
        if (next !== null) item.nextDueOn = next;
        break;
      }
      case 'next_due': {
        const next = readDate(a.nextDueOn, 'nextDueOn', true);
        if (next !== null) item.nextDueOn = next;
        break;
      }
    }

    if (Object.keys(e).length > 0) errors[p.templateId] = e;
    items.push(item);
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { vehicleId, items } };
}

/** Testo dell'invito sotto una voce che richiede una risposta particolare. */
export function questionTitle(p: SetupProposal): string {
  switch (p.question) {
    case 'last_done':
      return it.setup.questionLastDone;
    case 'inspection':
      return it.setup.inspectionLast;
    case 'road_tax':
      return it.setup.roadTaxMonth;
    default:
      return it.setup.nextDue;
  }
}
