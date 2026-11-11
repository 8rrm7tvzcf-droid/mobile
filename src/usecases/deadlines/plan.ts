// Dalle risposte del wizard "Imposta le scadenze" ai dati della voce (baseline / data fissa): logica pura, senza SQL.
// Principio I3 (SPEC 8.3): nessun dato inventato. Con "non lo so" la voce resta "Da configurare"; le scadenze di
// revisione e bollo si calcolano con le regole del dominio italiano (`@/domain/italy`), e una data letta sul documento
// (override manuale) vince sempre sul calcolo.
import { addDays, addMonths, endOfMonth, isValidDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/dates';
import {
  INSPECTION_WARNING,
  inspectionDue,
  roadTaxNextDue,
  roadTaxRegionForProvince,
  ROAD_TAX_WARNING,
} from '@/domain/italy';
import type { InspectionOutcome, UnknownReason } from '@/domain/italy';
import { isValidKm } from '@/domain/units';
import { abortValidation } from './internal';
import { nextAnchorOn } from './templates';
import type { SetupVehicle, TemplateRow } from './templates';

/** Risposta a "Quando l'hai fatto l'ultima volta?". */
export type LastDoneAnswer =
  | { kind: 'done'; on: LocalDate; km?: number | null }
  | { kind: 'unknown' }
  | { kind: 'never' };

export interface SetupItemInput {
  templateId: string;
  /** Voci a intervallo dall'ultimo fatto. Default: "non lo so". */
  lastDone?: LastDoneAnswer;
  /**
   * Prossima scadenza letta sul documento (revisione, bollo, cartellino della bombola, gomme): vince sul calcolo.
   * Per le voci a data fissa o di calendario e' l'unico dato richiesto.
   */
  nextDueOn?: LocalDate | null;
  /** Bollo: MESE DI PAGAMENTO (1-12), non il mese di "scadenza" mostrato da ACI. */
  paymentMonth?: number | null;
  /** Bollo: sigla di provincia (serve alle eccezioni regionali del primo pagamento); sconosciuta = nessuna eccezione. */
  provinceCode?: string | null;
  /** Revisione: ultima revisione eseguita (anche dalla ricevuta) ed esito. */
  inspection?: { lastInspectionOn?: LocalDate | null; outcome?: InspectionOutcome | null };
  /** Personalizzazioni rispetto al template (i valori del catalogo sono indicativi). */
  overrides?: { name?: string; intervalKm?: number | null; intervalMonths?: number | null; notifyEnabled?: boolean };
}

export type SetupReasonExtra = Extract<UnknownReason, 'INSPECTION_SUSPENDED'>;

/** Dati da scrivere sulla voce (le colonne che dipendono dalle risposte dell'utente). */
export interface ItemPlan {
  baselineOn: LocalDate | null;
  baselineKm: number | null;
  fixedDueOn: LocalDate | null;
  periodEnd: 'exact' | 'end_of_month';
  /** Come e' stata ricavata la scadenza ('manual', 'first_registration', ...), null se non e' stata ricavata. */
  basis: string | null;
  warning: string | null;
  extraReasons: SetupReasonExtra[];
}

export interface EffectiveIntervals {
  intervalKm: number | null;
  intervalMonths: number | null;
}

const field = (idx: number, f: string): string => `items[${idx}].${f}`;

function checkDate(idx: number, f: string, value: string, today: LocalDate, allowFuture: boolean): void {
  if (!isValidDate(value)) abortValidation(field(idx, f), 'La data non è valida.');
  if (!allowFuture && value > today) abortValidation(field(idx, f), 'La data non può essere nel futuro.');
}

/** Intervalli effettivi (template + personalizzazioni), validati come i CHECK dello schema. */
export function effectiveIntervals(t: TemplateRow, input: SetupItemInput, idx: number): EffectiveIntervals {
  const o = input.overrides ?? {};
  const intervalKm = o.intervalKm !== undefined ? o.intervalKm : t.interval_km;
  const intervalMonths = o.intervalMonths !== undefined ? o.intervalMonths : t.interval_months;
  if (intervalKm != null && (!Number.isInteger(intervalKm) || intervalKm < 100 || intervalKm > 1_000_000)) {
    abortValidation(field(idx, 'overrides.intervalKm'), "L'intervallo in km deve essere un numero intero tra 100 e 1.000.000.");
  }
  if (intervalMonths != null && (!Number.isInteger(intervalMonths) || intervalMonths < 1 || intervalMonths > 240)) {
    abortValidation(field(idx, 'overrides.intervalMonths'), "L'intervallo in mesi deve essere un numero intero tra 1 e 240.");
  }
  if (t.schedule_type === 'interval_last_done' && intervalKm == null && intervalMonths == null) {
    abortValidation(field(idx, 'overrides'), 'Serve almeno un intervallo: in km o in mesi.');
  }
  if (t.schedule_type === 'interval_calendar' && intervalMonths == null) {
    abortValidation(field(idx, 'overrides.intervalMonths'), 'Serve la ripetizione in mesi.');
  }
  if (t.schedule_type === 'fixed_date' && (intervalKm != null || intervalMonths != null)) {
    abortValidation(field(idx, 'overrides'), 'Una scadenza a data fissa non ha intervalli.');
  }
  return { intervalKm, intervalMonths };
}

/** Base `b` tale che la scadenza calcolata dal motore da `b` sia esattamente `dueOn` (serve agli override manuali). */
export function baselineForDue(dueOn: LocalDate, months: number, endOfMonthRule: boolean): LocalDate | null {
  const due = (b: LocalDate): LocalDate => (endOfMonthRule ? endOfMonth(addMonths(b, months)) : addMonths(b, months));
  const first = addMonths(dueOn, -months);
  for (const delta of [0, 1, -1, 2, -2, 3, -3]) {
    const candidate = delta === 0 ? first : addDays(first, delta);
    if (due(candidate) === dueOn) return candidate;
  }
  return null;
}

const NO_PLAN: ItemPlan = {
  baselineOn: null,
  baselineKm: null,
  fixedDueOn: null,
  periodEnd: 'exact',
  basis: null,
  warning: null,
  extraReasons: [],
};

/** Voce a intervallo dall'ultimo fatto: risposta "data e km" / "non lo so" / "mai fatto". */
function planLastDone(t: TemplateRow, input: SetupItemInput, v: SetupVehicle, today: LocalDate, idx: number): ItemPlan {
  const base: ItemPlan = { ...NO_PLAN, periodEnd: t.period_end };
  const answer = input.lastDone ?? { kind: 'unknown' };
  if (answer.kind === 'unknown') return base;
  if (answer.kind === 'done') {
    checkDate(idx, 'lastDone.on', answer.on, today, false);
    if (answer.km != null && !isValidKm(answer.km)) {
      abortValidation(field(idx, 'lastDone.km'), 'I km devono essere un numero intero tra 0 e 2.000.000.');
    }
    return { ...base, baselineOn: answer.on, baselineKm: answer.km ?? null, basis: 'last_done' };
  }
  // "mai fatto": si parte dalla vita del veicolo. Con la prima immatricolazione i km di partenza sono 0; altrimenti
  // dall'acquisto (con i km all'acquisto, se noti). Se il veicolo non ha nessuna data, non si inventa: resta da configurare.
  if (v.firstRegistrationOn) {
    return { ...base, baselineOn: v.firstRegistrationOn, baselineKm: 0, basis: 'never_done_since_registration' };
  }
  if (v.purchaseOn) {
    return { ...base, baselineOn: v.purchaseOn, baselineKm: v.purchaseKm, basis: 'never_done_since_purchase' };
  }
  return base;
}

/** Revisione (SPEC 7.2): dal documento, dall'ultima revisione o dalla prima immatricolazione; mai inventata. */
function planInspection(
  input: SetupItemInput,
  v: SetupVehicle,
  today: LocalDate,
  idx: number,
  months: number,
): ItemPlan {
  const base: ItemPlan = { ...NO_PLAN, periodEnd: 'end_of_month', warning: INSPECTION_WARNING };
  const manual = input.nextDueOn ?? null;
  const asManual = (due: LocalDate, basis: string, warning: string): ItemPlan => {
    const eom = due === endOfMonth(due);
    const b = baselineForDue(due, months, eom);
    if (b == null) abortValidation(field(idx, 'nextDueOn'), 'Non riesco a impostare questa data di revisione.');
    return { ...base, baselineOn: b, periodEnd: eom ? 'end_of_month' : 'exact', basis, warning };
  };
  if (manual) {
    checkDate(idx, 'nextDueOn', manual, today, true);
    const res = inspectionDue({ firstRegisteredOn: v.firstRegistrationOn ?? manual, manualDueOn: manual });
    return asManual(manual, res.basis, res.warningText);
  }
  const insp = input.inspection;
  if (insp?.lastInspectionOn) {
    checkDate(idx, 'inspection.lastInspectionOn', insp.lastInspectionOn, today, false);
    const res = inspectionDue({
      firstRegisteredOn: v.firstRegistrationOn ?? insp.lastInspectionOn,
      lastInspectionOn: insp.lastInspectionOn,
      lastOutcome: insp.outcome ?? 'regular',
    });
    if (res.reasonCode === 'INSPECTION_SUSPENDED') {
      return { ...base, basis: res.basis, warning: res.warningText, extraReasons: ['INSPECTION_SUSPENDED'] };
    }
    if (res.basis === 'repeat' && res.dueOn) return asManual(res.dueOn, 'repeat', res.warningText);
    return { ...base, baselineOn: insp.lastInspectionOn, basis: res.basis, warning: res.warningText };
  }
  if (v.firstRegistrationOn) {
    const first = inspectionDue({ firstRegisteredOn: v.firstRegistrationOn });
    // auto con meno di 4 anni: la prima scadenza e' ancora davanti (o nel mese corrente); altrimenti serve l'ultima revisione
    if (first.dueOn !== null && first.dueOn >= today) {
      // base = immatricolazione + 24 mesi: la regola (24 mesi, fine mese) da' immatricolazione + 48 mesi a fine mese
      const b = months === 24 ? addMonths(v.firstRegistrationOn, 24) : baselineForDue(first.dueOn, months, true);
      if (b == null) abortValidation(field(idx, 'inspection'), 'Non riesco a impostare la prima revisione.');
      return { ...base, baselineOn: b, basis: first.basis, warning: first.warningText };
    }
  }
  return base;
}

/** Bollo (SPEC 7.3): la scadenza e' l'ultimo giorno del mese di pagamento; l'importo non si calcola mai. */
function planRoadTax(t: TemplateRow, input: SetupItemInput, v: SetupVehicle, today: LocalDate, idx: number): ItemPlan {
  const base: ItemPlan = { ...NO_PLAN, periodEnd: t.period_end, warning: ROAD_TAX_WARNING };
  if (input.nextDueOn) {
    checkDate(idx, 'nextDueOn', input.nextDueOn, today, true);
    return { ...base, fixedDueOn: input.nextDueOn, basis: 'manual' };
  }
  const month = input.paymentMonth ?? null;
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) {
    abortValidation(field(idx, 'paymentMonth'), 'Il mese di pagamento deve essere un numero da 1 a 12.');
  }
  if (month === null && !v.firstRegistrationOn) return base; // niente mese e niente immatricolazione: non si inventa
  const res = roadTaxNextDue(today, {
    registeredOn: v.firstRegistrationOn ?? today,
    paymentMonth: month,
    region: roadTaxRegionForProvince(input.provinceCode ?? ''),
  });
  return { ...base, fixedDueOn: res.dueOn, basis: res.basis, warning: res.warningText };
}

/** Voci di calendario o a data fissa: data dal documento/cartellino, oppure (gomme) la prossima occorrenza dell'ancora. */
function planNextDue(t: TemplateRow, input: SetupItemInput, today: LocalDate, idx: number): ItemPlan {
  const base: ItemPlan = { ...NO_PLAN, periodEnd: t.period_end };
  if (input.nextDueOn) {
    checkDate(idx, 'nextDueOn', input.nextDueOn, today, true);
    return { ...base, fixedDueOn: input.nextDueOn, basis: 'manual' };
  }
  if (t.anchor_month != null && t.anchor_day != null) {
    return { ...base, fixedDueOn: nextAnchorOn(today, t.anchor_month, t.anchor_day), basis: 'template_anchor' };
  }
  return base;
}

export function planSetupItem(
  t: TemplateRow,
  input: SetupItemInput,
  v: SetupVehicle,
  today: LocalDate,
  idx: number,
  intervals: EffectiveIntervals,
): ItemPlan {
  if (t.id === 'tpl_inspection') return planInspection(input, v, today, idx, intervals.intervalMonths ?? 24);
  if (t.id === 'tpl_road_tax') return planRoadTax(t, input, v, today, idx);
  if (t.schedule_type === 'interval_last_done') return planLastDone(t, input, v, today, idx);
  return planNextDue(t, input, today, idx);
}
