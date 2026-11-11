// Intervento (S-20, S-21, F-35..F-37): valori del modulo, lettura dell'input, dati per i casi d'uso, righe d'elenco e
// "Cosa hai fatto?". Pura: niente React Native.
import type { LocalDate } from '@/domain/dates';
import {
  formatDateIt,
  formatDistance,
  formatEuro,
  formatScaled,
  parseDateIt,
  parseEuroToCents,
  parseMilli,
  toDisplayDistance,
  type DistanceUnit,
} from '@/domain/units';
import {
  INSPECTION_RESULT_LABELS,
  INSPECTION_RESULTS,
  LINE_PRESETS,
  SERVICE_KIND_LABELS,
  SERVICE_PRESETS,
  type AddServiceRecordInput,
  type InspectionResult,
  type LinePreset,
  type OilChangeDetail,
  type OilChangeInput,
  type ServiceFluidKind,
  type ServiceItemSuggestion,
  type ServiceKind,
  type ServiceLine,
  type ServiceLineInput,
  type ServiceLineType,
  type ServiceRecordDetail,
  type ServiceRecordSummary,
  type UpdateServiceRecordPatch,
} from '@/usecases/services';
import type { ChoiceOption } from '../components/Choices';
import { it } from '../i18n/it';
import { parseKmField } from './odometer';

/** Valore speciale della scelta dell'officina: "un'altra officina" (se ne scrive il nome). */
export const NEW_WORKSHOP = '__new';
/** Il tipo di intervento che porta il sotto-modulo del cambio olio. */
const OIL_PRESETS: readonly string[] = ['service', 'oil'];

export interface LineDraft {
  key: string;
  lineType: ServiceLineType;
  description: string;
  /** Importo in euro come scritto ("48,00"). */
  amount: string;
  fluidKind: ServiceFluidKind | null;
}

/** Dati della riga dell'olio e del filtro che il modulo non mostra ma che in modifica non si devono perdere. */
export interface OilCarry {
  hadOil: boolean;
  oilBrand: string | null;
  oilAmountCents: number | null;
  filterPartCode: string | null;
  filterAmountCents: number | null;
}

export interface ServiceFormValues {
  /** Chip scelto tra `SERVICE_PRESETS`; `null` se non e' ancora stato scelto (o in modifica, se non corrisponde a nessuno). */
  presetId: string | null;
  kind: ServiceKind;
  title: string;
  date: string;
  km: string;
  /** '' = nessuna, `NEW_WORKSHOP` = un'altra (si scrive il nome), altrimenti l'id dell'officina. */
  workshop: string;
  newWorkshop: string;
  total: string;
  invoice: string;
  warrantyUntil: string;
  notes: string;
  inspectionResult: InspectionResult | null;
  lines: LineDraft[];
  oilOn: boolean;
  oilSpec: string;
  oilLitres: string;
  oilFilter: boolean;
  carry: OilCarry;
}

export interface LineErrors {
  description?: string;
  amount?: string;
}

export interface ServiceFormErrors {
  type?: string;
  date?: string;
  km?: string;
  total?: string;
  workshop?: string;
  inspection?: string;
  warranty?: string;
  oilLitres?: string;
  lines?: Record<string, LineErrors>;
  form?: string;
}

const NO_CARRY: OilCarry = { hadOil: false, oilBrand: null, oilAmountCents: null, filterPartCode: null, filterAmountCents: null };

let lineSeq = 0;
export const newLineKey = (): string => `riga-${++lineSeq}`;

const centsText = (cents: number): string => formatScaled(cents, 2, { grouping: false });
const litresText = (milli: number): string => {
  const s = formatScaled(milli, 3, { grouping: false });
  return s.includes(',') ? s.replace(/0+$/, '').replace(/,$/, '') : s;
};

// ---------------------------------------------------------------- tipo di intervento (chip)

export const servicePresetOptions: readonly ChoiceOption<string>[] = SERVICE_PRESETS.map((p) => ({ value: p.id, label: p.label }));

export const presetById = (id: string | null) => SERVICE_PRESETS.find((p) => p.id === id) ?? null;

/** Il chip che corrisponde a tipo e titolo di un intervento gia' salvato (per la modifica). */
export function presetOfRecord(kind: ServiceKind, title: string): string | null {
  const t = title.trim().toLowerCase();
  const byTitle = SERVICE_PRESETS.find((p) => p.kind === kind && p.title.toLowerCase() === t);
  if (byTitle) return byTitle.id;
  // Un titolo diverso dai chip (per esempio scritto a mano): si riconosce solo il tipo "Altro" generico.
  return null;
}

/** Il modulo parte vuoto: data di oggi, ultimo km noto (modificabile). */
export function initialServiceForm(ctx: { today: LocalDate; km: number | null; unit: DistanceUnit }, presetId: string | null = null): ServiceFormValues {
  const base: ServiceFormValues = {
    presetId: null,
    kind: 'other',
    title: '',
    date: formatDateIt(ctx.today),
    km: ctx.km !== null ? String(toDisplayDistance(ctx.km, ctx.unit)) : '',
    workshop: '',
    newWorkshop: '',
    total: '',
    invoice: '',
    warrantyUntil: '',
    notes: '',
    inspectionResult: null,
    lines: [],
    oilOn: false,
    oilSpec: '',
    oilLitres: '',
    oilFilter: true,
    carry: NO_CARRY,
  };
  return presetId ? applyPreset(base, presetId) : base;
}

/** Sceglie un chip: tipo, titolo (se non l'hai cambiato tu) e sotto-modulo del cambio olio. */
export function applyPreset(v: ServiceFormValues, presetId: string): ServiceFormValues {
  const preset = presetById(presetId);
  if (!preset) return v;
  const prev = presetById(v.presetId);
  const titleUntouched = v.title.trim() === '' || (prev !== null && v.title === prev.title);
  return {
    ...v,
    presetId,
    kind: preset.kind,
    title: titleUntouched ? preset.title : v.title,
    inspectionResult: preset.kind === 'inspection' ? v.inspectionResult : null,
    oilOn: presetId === 'oil' ? true : presetId === 'service' ? v.oilOn : v.carry.hadOil && v.oilOn,
  };
}

/** Il sotto-modulo del cambio olio si offre per tagliando e cambio olio (e per un intervento che gia' lo conteneva). */
export const supportsOil = (v: ServiceFormValues): boolean => (v.presetId !== null && OIL_PRESETS.includes(v.presetId)) || v.carry.hadOil;

export const isInspection = (v: ServiceFormValues): boolean => v.kind === 'inspection';

export const inspectionOptions: readonly ChoiceOption<InspectionResult>[] = INSPECTION_RESULTS.map((value) => ({ value, label: INSPECTION_RESULT_LABELS[value] }));

// ---------------------------------------------------------------- righe

export function lineFromPreset(p: LinePreset): LineDraft {
  return { key: newLineKey(), lineType: p.lineType, description: p.description, amount: '', fluidKind: p.fluidKind ?? null };
}

export const customLine = (): LineDraft => ({ key: newLineKey(), lineType: 'other', description: '', amount: '', fluidKind: null });

/** Le righe pronte che non sono gia' nell'elenco (descrizione uguale): evita di proporre due volte lo stesso ricambio. */
export const availableLinePresets = (lines: readonly LineDraft[]): readonly LinePreset[] =>
  LINE_PRESETS.filter((p) => !lines.some((l) => l.description.trim().toLowerCase() === p.description.toLowerCase()));

// ---------------------------------------------------------------- modifica: dal record al modulo

export function formFromRecord(r: ServiceRecordDetail, unit: DistanceUnit): ServiceFormValues {
  const oilLine: ServiceLine | undefined = r.lines.find((l) => l.category === 'engine_oil');
  const filterLine: ServiceLine | undefined = r.lines.find((l) => l.category === 'oil_filter');
  const hadOil = oilLine !== undefined;
  const lines: LineDraft[] = r.lines
    .filter((l) => l !== oilLine && !(hadOil && l === filterLine))
    .map((l) => ({
      key: newLineKey(),
      lineType: l.lineType,
      description: l.description,
      amount: l.amountCents > 0 ? centsText(l.amountCents) : '',
      fluidKind: l.fluidKind,
    }));
  return {
    presetId: presetOfRecord(r.kind, r.title),
    kind: r.kind,
    title: r.title,
    date: formatDateIt(r.serviceOn),
    km: r.km !== null ? String(toDisplayDistance(r.km, unit)) : '',
    workshop: r.workshop?.id ?? '',
    newWorkshop: '',
    total: centsText(r.totalCents),
    invoice: r.invoiceNumber ?? '',
    warrantyUntil: r.warrantyUntilOn ? formatDateIt(r.warrantyUntilOn) : '',
    notes: r.notes ?? '',
    inspectionResult: r.inspectionResult,
    lines,
    oilOn: hadOil,
    oilSpec: oilLine?.spec ?? '',
    oilLitres: oilLine ? litresText(oilLine.quantityMilli) : '',
    oilFilter: filterLine !== undefined,
    carry: {
      hadOil,
      oilBrand: oilLine?.brand ?? null,
      oilAmountCents: oilLine ? oilLine.amountCents : null,
      filterPartCode: filterLine?.partCode ?? null,
      filterAmountCents: filterLine ? filterLine.amountCents : null,
    },
  };
}

// ---------------------------------------------------------------- dal modulo ai casi d'uso

interface BuildContext {
  today: LocalDate;
  unit: DistanceUnit;
}

interface Common {
  date: LocalDate;
  km: number | null;
  totalCents: number | null;
  lines: ServiceLineInput[];
  oilChange: OilChangeInput | null;
  warrantyUntilOn: LocalDate | null;
}

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

function readCommon(v: ServiceFormValues, ctx: BuildContext): { errors: ServiceFormErrors; common: Common | null } {
  const errors: ServiceFormErrors = {};
  if (v.presetId === null && v.title.trim() === '') errors.type = it.service.typeRequired;

  const date = parseDateIt(v.date);
  if (date === null) errors.date = it.common.dateExample;
  else if (date > ctx.today) errors.date = it.common.futureDate;

  let km: number | null = null;
  if (v.km.trim() !== '') {
    km = parseKmField(v.km, ctx.unit);
    if (km === null) errors.km = it.km.invalidKm;
  }

  let totalCents: number | null = null;
  if (v.total.trim() !== '') {
    totalCents = parseEuroToCents(v.total);
    if (totalCents === null || totalCents < 0) {
      errors.total = it.service.invalidTotal;
      totalCents = null;
    }
  }

  if (v.workshop === NEW_WORKSHOP && v.newWorkshop.trim() === '') errors.workshop = it.service.workshopNameLabel;

  if (v.kind === 'inspection' && v.inspectionResult === null) errors.inspection = it.service.inspectionRequired;

  let warrantyUntilOn: LocalDate | null = null;
  if (v.warrantyUntil.trim() !== '') {
    warrantyUntilOn = parseDateIt(v.warrantyUntil);
    if (warrantyUntilOn === null) errors.warranty = it.common.dateExample;
  }

  const lines: ServiceLineInput[] = [];
  const lineErrors: Record<string, LineErrors> = {};
  for (const l of v.lines) {
    const description = l.description.trim();
    const amountText = l.amount.trim();
    if (description === '' && amountText === '') continue;
    const e: LineErrors = {};
    if (description === '') e.description = it.service.lineNeedsDescription;
    let amountCents: number | null = null;
    if (amountText !== '') {
      amountCents = parseEuroToCents(amountText);
      if (amountCents === null || amountCents < 0) e.amount = it.service.invalidAmount;
    }
    if (e.description || e.amount) {
      lineErrors[l.key] = e;
      continue;
    }
    lines.push({
      lineType: l.lineType,
      description,
      fluidKind: l.fluidKind,
      ...(amountCents !== null ? { amountCents } : {}),
    });
  }
  if (Object.keys(lineErrors).length > 0) errors.lines = lineErrors;

  let oilChange: OilChangeInput | null = null;
  if (v.oilOn && supportsOil(v)) {
    let quantityMilli: number | null = null;
    if (v.oilLitres.trim() !== '') {
      quantityMilli = parseMilli(v.oilLitres);
      if (quantityMilli === null || quantityMilli <= 0) errors.oilLitres = it.service.invalidLitres;
    }
    oilChange = {
      spec: orNull(v.oilSpec),
      quantityMilli,
      brand: v.carry.oilBrand,
      filterReplaced: v.oilFilter,
      filterPartCode: v.carry.filterPartCode,
      oilAmountCents: v.carry.oilAmountCents,
      filterAmountCents: v.carry.filterAmountCents,
    };
  }

  if (Object.keys(errors).length > 0 || date === null) return { errors, common: null };
  return { errors, common: { date, km, totalCents, lines, oilChange, warrantyUntilOn } };
}

export type ServiceBuildResult<T> = { ok: true; input: T } | { ok: false; errors: ServiceFormErrors };

/** Nuovo intervento: dati per `addServiceRecord`, oppure gli errori in italiano per campo. */
export function buildAddServiceInput(vehicleId: string, v: ServiceFormValues, ctx: BuildContext): ServiceBuildResult<AddServiceRecordInput> {
  const { errors, common } = readCommon(v, ctx);
  if (!common) return { ok: false, errors };
  const input: AddServiceRecordInput = {
    vehicleId,
    serviceOn: common.date,
    kind: v.kind,
    title: v.title.trim() === '' ? null : v.title.trim(),
    km: common.km,
    totalCents: common.totalCents,
    invoiceNumber: orNull(v.invoice),
    warrantyUntilOn: common.warrantyUntilOn,
    inspectionResult: v.kind === 'inspection' ? v.inspectionResult : null,
    notes: orNull(v.notes),
    lines: common.lines,
    oilChange: common.oilChange,
  };
  if (v.workshop === NEW_WORKSHOP) input.newWorkshop = { name: v.newWorkshop.trim() };
  else if (v.workshop !== '') input.workshopId = v.workshop;
  return { ok: true, input };
}

/** Modifica: i km si mandano solo se li hai cambiati (come per i rifornimenti); righe e cambio olio sostituiscono quelli di prima. */
export function buildUpdateServicePatch(v: ServiceFormValues, original: ServiceFormValues, ctx: BuildContext): ServiceBuildResult<UpdateServiceRecordPatch> {
  const { errors, common } = readCommon(v, ctx);
  if (!common) return { ok: false, errors };
  const patch: UpdateServiceRecordPatch = {
    serviceOn: common.date,
    kind: v.kind,
    title: v.title.trim() === '' ? null : v.title.trim(),
    totalCents: common.totalCents,
    invoiceNumber: orNull(v.invoice),
    warrantyUntilOn: common.warrantyUntilOn,
    notes: orNull(v.notes),
    lines: common.lines,
  };
  if (v.kind === 'inspection') patch.inspectionResult = v.inspectionResult;
  if (common.oilChange) patch.oilChange = common.oilChange;
  if (v.km.trim() !== original.km.trim()) patch.km = common.km;
  if (v.workshop === NEW_WORKSHOP) patch.newWorkshop = { name: v.newWorkshop.trim() };
  else patch.workshopId = v.workshop === '' ? null : v.workshop;
  return { ok: true, input: patch };
}

/** Campo del caso d'uso -> campo del modulo. */
export function serviceErrorField(field: string | undefined): keyof ServiceFormErrors {
  if (!field) return 'form';
  if (field === 'serviceOn' || field === 'date') return 'date';
  if (field === 'km') return 'km';
  if (field === 'totalCents') return 'total';
  if (field === 'workshopId' || field === 'name') return 'workshop';
  if (field === 'inspectionResult') return 'inspection';
  if (field === 'warrantyUntilOn') return 'warranty';
  return 'form';
}

// ---------------------------------------------------------------- elenco e dettaglio

export type ServiceFilterKind = 'all' | 'scheduled' | 'repair' | 'inspection' | 'tyres' | 'other';

export const SERVICE_FILTER_KINDS: Record<ServiceFilterKind, readonly ServiceKind[] | undefined> = {
  all: undefined,
  scheduled: ['scheduled'],
  repair: ['repair'],
  inspection: ['inspection'],
  tyres: ['tyres'],
  other: ['bodywork', 'accessories', 'diagnostic', 'other'],
};

export const serviceFilterOptions: readonly ChoiceOption<ServiceFilterKind>[] = [
  { value: 'all', label: it.service.filterAll },
  { value: 'scheduled', label: SERVICE_KIND_LABELS.scheduled },
  { value: 'repair', label: SERVICE_KIND_LABELS.repair },
  { value: 'inspection', label: SERVICE_KIND_LABELS.inspection },
  { value: 'tyres', label: SERVICE_KIND_LABELS.tyres },
  { value: 'other', label: it.service.filterOther },
];

export function serviceRowSubtitle(s: ServiceRecordSummary, unit: DistanceUnit): string {
  const parts: (string | null)[] = [formatDateIt(s.serviceOn), s.workshopName, s.km !== null ? formatDistance(s.km, unit) : null];
  return parts.filter((p): p is string => Boolean(p)).join(' · ');
}

export const serviceAmountText = (s: Pick<ServiceRecordSummary, 'totalCents'>): string | null => (s.totalCents > 0 ? formatEuro(s.totalCents) : null);

export function serviceRowA11y(s: ServiceRecordSummary, unit: DistanceUnit): string {
  return [s.title, serviceRowSubtitle(s, unit), serviceAmountText(s), s.inspectionResult ? INSPECTION_RESULT_LABELS[s.inspectionResult] : null]
    .filter((p): p is string => Boolean(p))
    .join('. ');
}

export const serviceCompletedText = (s: ServiceRecordSummary): string | null =>
  s.completedItemNames.length > 0 ? it.service.completedRow(s.completedItemNames.join(', ')) : null;

export function serviceSummaryText(list: readonly ServiceRecordSummary[]): string {
  return it.service.summary(list.length, formatEuro(list.reduce((sum, s) => sum + s.totalCents, 0)));
}

export const oilDetailText = (o: OilChangeDetail): string => it.service.oilLine(o.spec, `${litresText(o.quantityMilli)} L`, o.filterReplaced);

/** L'importo di una riga, o niente se non e' stato indicato (non si scrive «0,00 €»). */
export const lineAmountText = (l: Pick<ServiceLine, 'amountCents'>): string => (l.amountCents > 0 ? formatEuro(l.amountCents) : '');

// ---------------------------------------------------------------- "Cosa hai fatto?"

/** Le righe di un intervento gia' salvato nel formato dei suggerimenti. */
export const suggestionLines = (r: Pick<ServiceRecordDetail, 'lines'>): ServiceLineInput[] =>
  r.lines.map((l) => ({ lineType: l.lineType, description: l.description, fluidKind: l.fluidKind }));

export const preselectedIds = (s: readonly ServiceItemSuggestion[]): string[] => s.filter((x) => x.preselected).map((x) => x.itemId);

export const toggleId = (ids: readonly string[], id: string): string[] => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

/** Riga di una voce proposta: nome, perche' e' proposta (o perche' no). */
export function suggestionDescription(s: ServiceItemSuggestion): string | null {
  if (s.reason) return s.reason;
  return null;
}
