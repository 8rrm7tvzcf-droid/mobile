// Validazione e normalizzazione dei campi di un intervento (SPEC 6.3.6, AC-06): funzioni pure, messaggi in italiano
// pronti per la UI. Tutti gli importi sono interi (centesimi, millesimi): niente float.
import { isValidDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/ports';
import { formatEuro, isValidKm } from '@/domain/units';
import { fail, ok } from '../context';
import type { UsecaseResult } from '../context';
import { Abort, abortValidation } from './internal';
import { lineCategoryOf } from './classify';
import {
  FLUID_KINDS,
  INSPECTION_RESULTS,
  LINE_TYPES,
  SERVICE_KINDS,
  SERVICE_KIND_LABELS,
  type InspectionResult,
  type OilChangeInput,
  type ServiceFluidKind,
  type ServiceKind,
  type ServiceLineInput,
  type ServiceLineType,
  type ServiceRecordFields,
  type ServiceWarning,
  type WorkshopInput,
} from './types';

export const MAX_CENTS = 100_000_000_000;
export const MAX_LINES = 100;
const MAX_QUANTITY_MILLI = 1_000_000_000;

export interface NormalizedLine {
  lineType: ServiceLineType;
  description: string;
  quantityMilli: number;
  unitPriceCents: number | null;
  amountCents: number;
  partCode: string | null;
  brand: string | null;
  spec: string | null;
  fluidKind: ServiceFluidKind | null;
  warrantyMonths: number | null;
}

export interface NormalizedFields {
  serviceOn: LocalDate;
  kind: ServiceKind;
  title: string;
  km: number | null;
  workshopId: string | null;
  totalCents: number;
  invoiceNumber: string | null;
  paidOn: LocalDate | null;
  warrantyUntilOn: LocalDate | null;
  inspectionResult: InspectionResult | null;
  notes: string | null;
  /** Null se le righe non sono state indicate (in modifica restano quelle esistenti). */
  lines: NormalizedLine[] | null;
  /** Voci indicate riga per riga (`lines[].completesItemIds`), senza doppioni. */
  lineItemIds: string[];
  warnings: ServiceWarning[];
}

const isCents = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_CENTS;

function text(v: string | null | undefined, max: number, field: string, label: string): string | null {
  if (v == null) return null;
  const t = v.trim();
  if (t.length > max) return abortValidation(field, `${label}: al massimo ${max} caratteri.`);
  return t === '' ? null : t;
}

function checkDate(v: string | null | undefined, field: string): LocalDate | null {
  if (v == null || v === '') return null;
  if (!isValidDate(v)) return abortValidation(field, 'La data non è valida.');
  return v;
}

/** Le righe del cambio olio (F-37): olio con specifica e litri, filtro. */
export function oilChangeLines(oil: OilChangeInput): ServiceLineInput[] {
  const spec = oil.spec?.trim() || null;
  const lines: ServiceLineInput[] = [
    {
      lineType: 'fluid',
      fluidKind: 'engine_oil',
      description: spec ? `Olio motore ${spec}` : 'Olio motore',
      spec,
      brand: oil.brand ?? null,
      quantityMilli: oil.quantityMilli ?? undefined,
      amountCents: oil.oilAmountCents ?? 0,
    },
  ];
  if (oil.filterReplaced) {
    lines.push({
      lineType: 'part',
      description: 'Filtro olio',
      partCode: oil.filterPartCode ?? null,
      amountCents: oil.filterAmountCents ?? 0,
    });
  }
  return lines;
}

/** Aggiunge le righe del cambio olio solo se non ci sono gia' (una riga d'olio motore / di filtro olio). */
export function withOilChange(lines: readonly ServiceLineInput[], oil: OilChangeInput | null | undefined): ServiceLineInput[] {
  const out = [...lines];
  if (!oil) return out;
  const hasOil = out.some((l) => lineCategoryOf({ lineType: l.lineType, fluidKind: l.fluidKind, description: l.description }) === 'engine_oil');
  const hasFilter = out.some((l) => lineCategoryOf({ lineType: l.lineType, fluidKind: l.fluidKind, description: l.description }) === 'oil_filter');
  for (const l of oilChangeLines(oil)) {
    const cat = lineCategoryOf({ lineType: l.lineType, fluidKind: l.fluidKind, description: l.description });
    if ((cat === 'engine_oil' && hasOil) || (cat === 'oil_filter' && hasFilter)) continue;
    out.push(l);
  }
  return out;
}

function normalizeLine(l: ServiceLineInput, i: number): NormalizedLine {
  const at = (f: string): string => `lines[${i}].${f}`;
  if (!LINE_TYPES.includes(l.lineType)) abortValidation(at('lineType'), 'Il tipo di riga non è valido.');
  const description = (l.description ?? '').trim();
  if (description.length < 1 || description.length > 200) abortValidation(at('description'), 'Descrivi la riga (da 1 a 200 caratteri).');
  const quantityMilli = l.quantityMilli ?? 1000;
  if (!Number.isInteger(quantityMilli) || quantityMilli <= 0 || quantityMilli > MAX_QUANTITY_MILLI) {
    abortValidation(at('quantityMilli'), 'La quantità deve essere un numero positivo.');
  }
  const unitPriceCents = l.unitPriceCents ?? null;
  if (unitPriceCents !== null && !isCents(unitPriceCents)) abortValidation(at('unitPriceCents'), 'Il prezzo unitario non è valido.');
  let amountCents: number;
  if (l.amountCents != null) {
    if (!isCents(l.amountCents)) return abortValidation(at('amountCents'), "L'importo della riga non è valido.");
    amountCents = l.amountCents;
  } else if (unitPriceCents !== null) {
    const product = quantityMilli * unitPriceCents;
    if (!Number.isSafeInteger(product)) return abortValidation(at('amountCents'), "L'importo della riga è troppo grande.");
    amountCents = Math.round(product / 1000);
    if (!isCents(amountCents)) return abortValidation(at('amountCents'), "L'importo della riga è troppo grande.");
  } else {
    amountCents = 0;
  }
  const fluidKind = l.fluidKind ?? null;
  if (fluidKind !== null) {
    if (!FLUID_KINDS.includes(fluidKind)) abortValidation(at('fluidKind'), 'Il tipo di fluido non è valido.');
    if (l.lineType !== 'fluid') abortValidation(at('fluidKind'), 'Il tipo di fluido vale solo per le righe «Fluido».');
  }
  const warrantyMonths = l.warrantyMonths ?? null;
  if (warrantyMonths !== null && (!Number.isInteger(warrantyMonths) || warrantyMonths < 1 || warrantyMonths > 240)) {
    abortValidation(at('warrantyMonths'), 'La garanzia deve essere da 1 a 240 mesi.');
  }
  return {
    lineType: l.lineType,
    description,
    quantityMilli,
    unitPriceCents,
    amountCents,
    partCode: text(l.partCode, 60, at('partCode'), 'Codice ricambio'),
    brand: text(l.brand, 60, at('brand'), 'Marca'),
    spec: text(l.spec, 120, at('spec'), 'Specifica'),
    fluidKind,
    warrantyMonths,
  };
}

/**
 * Controlla e normalizza i campi di un intervento. `today` e' la data di oggi (un intervento non puo' essere nel futuro:
 * errore `FUTURE_DATE`, come per i km). Non tocca il database: l'esistenza di officina e voci la verifica il caso d'uso.
 */
export function normalizeFields(f: ServiceRecordFields, today: LocalDate): UsecaseResult<NormalizedFields> {
  try {
    if (typeof f.serviceOn !== 'string' || !isValidDate(f.serviceOn)) abortValidation('serviceOn', 'La data non è valida.');
    if (f.serviceOn > today) throw new Abort({ code: 'FUTURE_DATE' });
    if (!SERVICE_KINDS.includes(f.kind)) abortValidation('kind', 'Il tipo di intervento non è valido.');

    const rawTitle = f.title?.trim() ?? '';
    if (rawTitle.length > 120) abortValidation('title', 'Il titolo può avere al massimo 120 caratteri.');
    const title = rawTitle === '' ? SERVICE_KIND_LABELS[f.kind] : rawTitle;

    const km = f.km ?? null;
    if (km !== null && !isValidKm(km)) abortValidation('km', 'I km devono essere un numero intero tra 0 e 2.000.000.');

    const inspectionResult = f.inspectionResult ?? null;
    if (f.kind === 'inspection') {
      if (inspectionResult === null || !INSPECTION_RESULTS.includes(inspectionResult)) {
        abortValidation('inspectionResult', "Indica l'esito della revisione: regolare, da ripetere o sospesa.");
      }
    } else if (inspectionResult !== null) {
      abortValidation('inspectionResult', "L'esito vale solo per la revisione.");
    }

    let lines: NormalizedLine[] | null = null;
    const lineItemIds: string[] = [];
    if (f.lines !== undefined || f.oilChange) {
      const inputs = withOilChange(f.lines ?? [], f.oilChange);
      if (inputs.length > MAX_LINES) abortValidation('lines', `Al massimo ${MAX_LINES} righe.`);
      lines = inputs.map((l, i) => normalizeLine(l, i));
      for (const l of inputs) for (const id of l.completesItemIds ?? []) if (!lineItemIds.includes(id)) lineItemIds.push(id);
    }

    let totalCents: number;
    if (f.totalCents != null) {
      if (!isCents(f.totalCents)) abortValidation('totalCents', 'Il totale deve essere un importo intero e non negativo (in centesimi).');
      totalCents = f.totalCents;
    } else {
      totalCents = (lines ?? []).reduce((s, l) => s + l.amountCents, 0);
      if (!isCents(totalCents)) abortValidation('totalCents', 'Il totale è troppo grande.');
    }

    const warnings: ServiceWarning[] = [];
    if (lines) {
      const sum = lines.reduce((s, l) => s + l.amountCents, 0);
      if (sum > 0 && sum !== totalCents) {
        warnings.push({
          code: 'TOTAL_MISMATCH',
          message: `Il totale (${formatEuro(totalCents)}) è diverso dalla somma delle righe (${formatEuro(sum)}): controlla IVA, sconti o righe mancanti.`,
        });
      }
    }

    return ok({
      serviceOn: f.serviceOn,
      kind: f.kind,
      title,
      km,
      workshopId: f.workshopId ?? null,
      totalCents,
      invoiceNumber: text(f.invoiceNumber, 40, 'invoiceNumber', 'Numero fattura'),
      paidOn: checkDate(f.paidOn, 'paidOn'),
      warrantyUntilOn: checkDate(f.warrantyUntilOn, 'warrantyUntilOn'),
      inspectionResult,
      notes: text(f.notes, 4000, 'notes', 'Note'),
      lines,
      lineItemIds,
      warnings,
    });
  } catch (e) {
    if (e instanceof Abort) return fail(e.error);
    throw e;
  }
}

export interface NormalizedWorkshop {
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  isFavorite: boolean;
}

/** Campi di un'officina: solo quelli presenti in `w` vengono controllati (per la modifica parziale). */
export function normalizeWorkshop(w: Partial<WorkshopInput>): UsecaseResult<Partial<NormalizedWorkshop>> {
  try {
    const out: Partial<NormalizedWorkshop> = {};
    if (w.name !== undefined) {
      const name = (w.name ?? '').trim();
      if (name.length < 1 || name.length > 80) abortValidation('name', "Il nome dell'officina deve avere da 1 a 80 caratteri.");
      out.name = name;
    }
    if (w.phone !== undefined) out.phone = text(w.phone, 30, 'phone', 'Telefono');
    if (w.email !== undefined) {
      out.email = text(w.email, 120, 'email', 'Email');
      if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) abortValidation('email', "L'indirizzo email non è valido.");
    }
    if (w.website !== undefined) out.website = text(w.website, 200, 'website', 'Sito web');
    if (w.address !== undefined) out.address = text(w.address, 200, 'address', 'Indirizzo');
    if (w.city !== undefined) out.city = text(w.city, 80, 'city', 'Città');
    if (w.notes !== undefined) out.notes = text(w.notes, 1000, 'notes', 'Note');
    if (w.isFavorite !== undefined) out.isFavorite = !!w.isFavorite;
    return ok(out);
  } catch (e) {
    if (e instanceof Abort) return fail(e.error);
    throw e;
  }
}
