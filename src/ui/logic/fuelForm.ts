// Rifornimento (S-22, F-39): due valori su tre calcolano il terzo senza toccare i campi scritti dall'utente,
// lettura dell'input, costruzione dei dati per i casi d'uso, consumo del tratto e righe d'elenco. Pura.
import type { FuelType, QuantityUnit } from '@/domain/fuel';
import {
  TOTAL_TOLERANCE_CENTS,
  expectedTotalCents,
  formatDateIt,
  formatDistance,
  formatEuro,
  formatQuantityWithUnit,
  formatScaled,
  parseDateIt,
  parseEuroToCents,
  parseMilli,
  quantityFromTotal,
  toDisplayDistance,
  unitPriceFromTotal,
  type DistanceUnit,
} from '@/domain/units';
import type {
  AddFuelLogInput,
  FuelConsumptionView,
  FuelFormDefaults,
  FuelLogEntry,
  FuelTankSummary,
  UpdateFuelLogInput,
} from '@/usecases/fuel';
import { it } from '../i18n/it';
import { parseKmField } from './odometer';

export type AmountField = 'quantity' | 'unitPrice' | 'total';

const FIELDS: readonly AmountField[] = ['quantity', 'unitPrice', 'total'];

export interface AmountState {
  quantity: string;
  unitPrice: string;
  total: string;
  /** I campi che l'utente ha scritto a mano: gli altri sono valori predefiniti o calcolati. */
  edited: readonly AmountField[];
}

export interface AmountResolution {
  /** I valori da passare al caso d'uso: quelli scritti a mano (e, nel nuovo rifornimento, il prezzo predefinito che serve). */
  payload: { quantityMilli?: number; unitPriceMilli?: number; totalCents?: number };
  /** Il campo che si calcola da solo. */
  computed: AmountField | null;
  /** Cosa mostrare nei tre campi: il testo scritto, oppure il valore calcolato. */
  shown: { quantity: string; unitPrice: string; total: string };
  errors: Partial<Record<AmountField, string>>;
  /** Nuovo rifornimento con meno di due valori. */
  incomplete: boolean;
  /** Tutti e tre i valori scritti, ma il totale non torna (piu' di 2 centesimi). */
  mismatch: boolean;
}

const ERRORS: Record<AmountField, string> = {
  quantity: it.fuel.invalidQuantity,
  unitPrice: it.fuel.invalidPrice,
  total: it.fuel.invalidTotal,
};

const parseField = (f: AmountField, text: string): number | null => (f === 'total' ? parseEuroToCents(text) : parseMilli(text));

/** "35,500" -> "35,5"; "40,000" -> "40". */
export function quantityText(milli: number): string {
  const s = formatScaled(milli, 3, { grouping: false });
  return s.includes(',') ? s.replace(/0+$/, '').replace(/,$/, '') : s;
}

export const priceText = (milli: number): string => formatScaled(milli, 3, { grouping: false });
export const totalText = (cents: number): string => formatScaled(cents, 2, { grouping: false });

function computeMissing(missing: AmountField, v: Partial<Record<AmountField, number>>): number | null {
  const q = v.quantity;
  const p = v.unitPrice;
  const t = v.total;
  if (missing === 'total' && q !== undefined && p !== undefined) return expectedTotalCents(q, p);
  if (missing === 'quantity' && t !== undefined && p !== undefined) return quantityFromTotal(t, p);
  if (missing === 'unitPrice' && t !== undefined && q !== undefined) return unitPriceFromTotal(t, q);
  return null;
}

/**
 * `mode = 'new'`: due valori scritti calcolano il terzo; con un valore solo si usa il prezzo predefinito (se c'e').
 * `mode = 'edit'`: come i casi d'uso di modifica: cambiando quantita' o prezzo si ricalcola il totale, cambiando il totale
 * si ricalcola il prezzo; con due campi scritti si ricalcola il terzo.
 */
export function resolveAmounts(state: AmountState, mode: 'new' | 'edit'): AmountResolution {
  const errors: Partial<Record<AmountField, string>> = {};
  const values: Partial<Record<AmountField, number>> = {};
  const edited = FIELDS.filter((f) => state.edited.includes(f) && state[f].trim() !== '');
  for (const f of edited) {
    const v = parseField(f, state[f]);
    if (v === null || v <= 0) errors[f] = ERRORS[f];
    else values[f] = v;
  }

  // Con un solo valore scritto, l'altro che serve per il calcolo e' quello predefinito (o quello gia' salvato).
  const base: Partial<Record<AmountField, number>> = { ...values };
  let weak: AmountField | null = null;
  if (edited.length === 1 && Object.keys(errors).length === 0) {
    const only = edited[0] as AmountField;
    weak = mode === 'new' ? (only === 'unitPrice' ? null : 'unitPrice') : only === 'quantity' ? 'unitPrice' : 'quantity';
    if (weak) {
      const w = parseField(weak, state[weak]);
      if (w !== null && w > 0) base[weak] = w;
    }
  }

  const known = Object.keys(base).length;
  let computed: AmountField | null = null;
  let computedValue: number | null = null;
  if (known === 2 && Object.keys(errors).length === 0) {
    const missing = FIELDS.find((f) => base[f] === undefined) as AmountField;
    computedValue = computeMissing(missing, base);
    if (computedValue !== null && computedValue > 0) computed = missing;
  }

  const payload: AmountResolution['payload'] = {};
  const send = (f: AmountField, v: number): void => {
    if (f === 'quantity') payload.quantityMilli = v;
    else if (f === 'unitPrice') payload.unitPriceMilli = v;
    else payload.totalCents = v;
  };
  for (const f of FIELDS) {
    const v = values[f];
    if (v !== undefined) send(f, v);
  }
  if (mode === 'new' && weak && base[weak] !== undefined) send(weak, base[weak] as number);

  const shown = { quantity: state.quantity, unitPrice: state.unitPrice, total: state.total };
  if (computed === 'quantity') shown.quantity = quantityText(computedValue as number);
  if (computed === 'unitPrice') shown.unitPrice = priceText(computedValue as number);
  if (computed === 'total') shown.total = totalText(computedValue as number);

  const mismatch =
    edited.length === 3 &&
    values.quantity !== undefined &&
    values.unitPrice !== undefined &&
    values.total !== undefined &&
    Math.abs(expectedTotalCents(values.quantity, values.unitPrice) - values.total) > TOTAL_TOLERANCE_CENTS;

  return {
    payload,
    computed,
    shown,
    errors,
    incomplete: mode === 'new' && Object.keys(errors).length === 0 && known < 2,
    mismatch,
  };
}

// ---------------------------------------------------------------- valori del modulo

export interface FuelFormValues extends AmountState {
  fuelType: FuelType;
  date: string;
  km: string;
  isFull: boolean;
  missedBefore: boolean;
  station: string;
  grade: string;
  notes: string;
}

export interface FuelFormErrors {
  quantity?: string;
  unitPrice?: string;
  total?: string;
  date?: string;
  km?: string;
  form?: string;
}

const kmField = (km: number, unit: DistanceUnit): string => String(toDisplayDistance(km, unit));

/** Valori di partenza: ultimo carburante, ultimo prezzo, ultima stazione e km suggeriti (sempre modificabili). */
export function initialFuelForm(defaults: FuelFormDefaults, unit: DistanceUnit): FuelFormValues {
  const price = defaults.lastUnitPriceMilli[defaults.fuelType];
  return {
    fuelType: defaults.fuelType,
    date: formatDateIt(defaults.today),
    quantity: '',
    unitPrice: price !== undefined ? priceText(price) : '',
    total: '',
    edited: [],
    km: defaults.suggestedKm ? kmField(defaults.suggestedKm.km, unit) : '',
    isFull: true,
    missedBefore: false,
    station: defaults.lastStation ?? '',
    grade: defaults.lastGrade[defaults.fuelType] ?? '',
    notes: '',
  };
}

/** Cambio carburante (auto bifuel): il prezzo e la gradazione seguono il nuovo carburante se non li hai scritti tu. */
export function switchFuelType(values: FuelFormValues, defaults: FuelFormDefaults, fuelType: FuelType): FuelFormValues {
  const price = defaults.lastUnitPriceMilli[fuelType];
  return {
    ...values,
    fuelType,
    unitPrice: values.edited.includes('unitPrice') ? values.unitPrice : price !== undefined ? priceText(price) : '',
    grade: defaults.lastGrade[fuelType] ?? '',
  };
}

/** Valori di un rifornimento gia' salvato, per la modifica. */
export function formFromEntry(e: FuelLogEntry, unit: DistanceUnit): FuelFormValues {
  return {
    fuelType: e.fuelType,
    date: formatDateIt(e.filledOn),
    quantity: quantityText(e.quantityMilli),
    unitPrice: e.unitPriceMilli !== null ? priceText(e.unitPriceMilli) : '',
    total: totalText(e.totalCents),
    edited: [],
    km: e.km !== null ? kmField(e.km, unit) : '',
    isFull: e.isFull,
    missedBefore: e.missedBefore,
    station: e.station ?? '',
    grade: e.grade ?? '',
    notes: e.notes ?? '',
  };
}

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

export type BuildResult<T> = { ok: true; input: T; resolution: AmountResolution } | { ok: false; errors: FuelFormErrors };

interface BuildContext {
  today: string;
  unit: DistanceUnit;
}

function commonErrors(v: FuelFormValues, ctx: BuildContext): { errors: FuelFormErrors; date: string | null; km: number | null; kmGiven: boolean } {
  const errors: FuelFormErrors = {};
  const date = parseDateIt(v.date);
  if (date === null) errors.date = it.common.dateExample;
  else if (date > ctx.today) errors.date = it.common.futureDate;
  const kmGiven = v.km.trim() !== '';
  const km = kmGiven ? parseKmField(v.km, ctx.unit) : null;
  if (kmGiven && km === null) errors.km = it.km.invalidKm;
  return { errors, date, km, kmGiven };
}

/** Nuovo rifornimento: legge i campi e prepara i dati per `addFuelLog`, oppure elenca gli errori in italiano. */
export function buildAddFuelInput(vehicleId: string, v: FuelFormValues, ctx: BuildContext): BuildResult<AddFuelLogInput> {
  const { errors, date, km } = commonErrors(v, ctx);
  const resolution = resolveAmounts(v, 'new');
  Object.assign(errors, resolution.errors);
  if (resolution.incomplete) errors.form = it.fuel.needTwoValues;
  if (Object.keys(errors).length > 0 || date === null) return { ok: false, errors };
  const input: AddFuelLogInput = {
    vehicleId,
    filledOn: date,
    fuelType: v.fuelType,
    ...resolution.payload,
    isFull: v.isFull,
    missedBefore: v.missedBefore,
    grade: orNull(v.grade),
    station: orNull(v.station),
    notes: orNull(v.notes),
    km,
  };
  return { ok: true, input, resolution };
}

/** Modifica: i km si mandano solo se li hai cambiati (cosi' non si rivalidano quelli di prima). */
export function buildUpdateFuelInput(v: FuelFormValues, original: FuelFormValues, ctx: BuildContext): BuildResult<UpdateFuelLogInput> {
  const { errors, date, km } = commonErrors(v, ctx);
  const resolution = resolveAmounts(v, 'edit');
  Object.assign(errors, resolution.errors);
  if (Object.keys(errors).length > 0 || date === null) return { ok: false, errors };
  const input: UpdateFuelLogInput = {
    filledOn: date,
    fuelType: v.fuelType,
    ...resolution.payload,
    isFull: v.isFull,
    missedBefore: v.missedBefore,
    grade: orNull(v.grade),
    station: orNull(v.station),
    notes: orNull(v.notes),
  };
  if (v.km.trim() !== original.km.trim()) input.km = km;
  return { ok: true, input, resolution };
}

/** Campo del caso d'uso -> campo del modulo. */
export function fuelErrorField(field: string | undefined): keyof FuelFormErrors {
  switch (field) {
    case 'quantityMilli':
      return 'quantity';
    case 'unitPriceMilli':
      return 'unitPrice';
    case 'totalCents':
      return 'total';
    case 'filledOn':
    case 'date':
      return 'date';
    case 'km':
      return 'km';
    default:
      return 'form';
  }
}

// ---------------------------------------------------------------- consumo e righe d'elenco

export interface ConsumptionNote {
  /** Il consumo, per esempio "6,43 L/100 km"; `null` se non c'e' ancora. */
  value: string | null;
  /** Spiegazione: su quanti km, oppure perche' non si calcola. */
  detail: string;
}

/** Cosa dire del consumo subito dopo il salvataggio (SPEC S-22 punto 5). */
export function consumptionNote(entry: FuelLogEntry, unit: DistanceUnit, view: FuelConsumptionView | null = entry.consumption): ConsumptionNote {
  if (view?.computed) return { value: view.text, detail: it.fuel.consumptionOver(formatDistance(view.distanceKm, unit)) };
  if (view && !view.computed) return { value: null, detail: view.text };
  if (!entry.isFull) return { value: null, detail: it.fuel.partialNote };
  if (entry.fuelType === 'adblue') return { value: null, detail: it.fuel.adblueNote };
  return { value: null, detail: it.fuel.consumptionUnavailable };
}

export const fuelRowTitle = (e: FuelLogEntry): string => `${formatEuro(e.totalCents)} · ${formatQuantityWithUnit(e.quantityMilli, e.quantityUnit)}`;

export function fuelRowSubtitle(e: FuelLogEntry, unit: DistanceUnit): string {
  const parts: (string | null)[] = [
    formatDateIt(e.filledOn),
    e.fuelLabel,
    e.isFull ? it.fuel.fullShort : it.fuel.partialShort,
    e.station,
    e.km !== null && !e.kmIgnored ? formatDistance(e.km, unit) : null,
  ];
  return parts.filter((p): p is string => Boolean(p)).join(' · ');
}

export const fuelConsumptionText = (e: FuelLogEntry): string | null => (e.consumption?.computed ? e.consumption.text : null);

export function fuelRowA11y(e: FuelLogEntry, unit: DistanceUnit): string {
  const c = fuelConsumptionText(e);
  return [fuelRowTitle(e), fuelRowSubtitle(e, unit), c ? `${it.fuel.consumptionTitle}: ${c}` : null].filter(Boolean).join('. ');
}

export interface TankLine {
  label: string;
  value: string;
}

/** Le righe del riepilogo di un serbatoio: medio, ultimo, migliore, peggiore (solo quelle calcolate). */
export function tankLines(t: FuelTankSummary): TankLine[] {
  const lines: TankLine[] = [];
  if (t.avgText) lines.push({ label: it.fuel.average, value: t.avgText });
  if (t.lastText) lines.push({ label: it.fuel.last, value: t.lastText });
  if (t.bestText && t.count > 1) lines.push({ label: it.fuel.best, value: t.bestText });
  if (t.worstText && t.count > 1) lines.push({ label: it.fuel.worst, value: t.worstText });
  return lines;
}

export const quantityUnitSuffix = (unit: QuantityUnit): string => unit;
export const priceUnitSuffix = (unit: QuantityUnit): string => `€/${unit}`;
