// Accesso SQL a interventi, righe, lettura km collegata e officine (SQL a mano dentro i casi d'uso, SPEC 8.6).
import { INSPECTION_RULES } from '@/domain/italy';
import type { LocalDate, SqlDatabase } from '@/domain/ports';
import { lineCategoryOf } from './classify';
import {
  SERVICE_KIND_LABELS,
  type InspectionResult,
  type OilChangeDetail,
  type ServiceCompletionInfo,
  type ServiceFluidKind,
  type ServiceKind,
  type ServiceLine,
  type ServiceLineType,
  type ServiceRecordDetail,
  type Workshop,
  type WorkshopRef,
} from './types';

export interface RecordRow {
  id: string;
  vehicle_id: string;
  service_on: LocalDate;
  kind: ServiceKind;
  title: string;
  workshop_id: string | null;
  total_cents: number;
  invoice_number: string | null;
  paid_on: LocalDate | null;
  warranty_until_on: LocalDate | null;
  inspection_result: InspectionResult | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const RECORD_COLUMNS =
  'id, vehicle_id, service_on, kind, title, workshop_id, total_cents, invoice_number, paid_on, warranty_until_on, inspection_result, notes, created_at, updated_at, deleted_at';

export function loadRecordRow(db: SqlDatabase, id: string, includeDeleted = false): Promise<RecordRow | undefined> {
  return db.get<RecordRow>(`SELECT ${RECORD_COLUMNS} FROM service_records WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`, [id]);
}

export interface LineRow {
  id: string;
  position: number;
  line_type: ServiceLineType;
  description: string;
  quantity_milli: number;
  unit_price_cents: number | null;
  amount_cents: number;
  part_code: string | null;
  brand: string | null;
  spec: string | null;
  fluid_kind: ServiceFluidKind | null;
  warranty_months: number | null;
}

export function loadLineRows(db: SqlDatabase, recordId: string): Promise<LineRow[]> {
  return db.all<LineRow>(
    `SELECT id, position, line_type, description, quantity_milli, unit_price_cents, amount_cents, part_code, brand, spec, fluid_kind, warranty_months
     FROM service_lines WHERE service_record_id = ? ORDER BY position, id`,
    [recordId],
  );
}

export function toLine(r: LineRow): ServiceLine {
  return {
    id: r.id,
    position: r.position,
    lineType: r.line_type,
    description: r.description,
    quantityMilli: r.quantity_milli,
    unitPriceCents: r.unit_price_cents,
    amountCents: r.amount_cents,
    partCode: r.part_code,
    brand: r.brand,
    spec: r.spec,
    fluidKind: r.fluid_kind,
    warrantyMonths: r.warranty_months,
    category: lineCategoryOf({ lineType: r.line_type, fluidKind: r.fluid_kind, description: r.description }),
  };
}

/** Il cambio olio ricavato dalle righe: la riga dell'olio motore (specifica, litri) e la presenza del filtro olio. */
export function oilChangeOf(lines: readonly ServiceLine[]): OilChangeDetail | null {
  const oil = lines.find((l) => l.category === 'engine_oil');
  if (!oil) return null;
  return { spec: oil.spec, quantityMilli: oil.quantityMilli, filterReplaced: lines.some((l) => l.category === 'oil_filter') };
}

export interface LinkedReadingRow {
  id: string;
  read_on: LocalDate;
  km: number;
  status: 'valid' | 'ignored';
  deleted_at: string | null;
}

/** La lettura km collegata all'intervento, anche se nel cestino (l'indice `ux_odo_service` non guarda `deleted_at`). */
export function loadLinkedReading(db: SqlDatabase, recordId: string): Promise<LinkedReadingRow | undefined> {
  return db.get<LinkedReadingRow>('SELECT id, read_on, km, status, deleted_at FROM odometer_readings WHERE service_record_id = ?', [recordId]);
}

export function loadVehicleBasics(db: SqlDatabase, vehicleId: string): Promise<{ id: string; distance_unit: 'km' | 'mi' } | undefined> {
  return db.get('SELECT id, distance_unit FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicleId]);
}

export interface CompletionRow {
  id: string;
  item_id: string;
  done_on: LocalDate;
  done_km: number | null;
  created_at: string;
  name: string;
  template_id: string | null;
}

/** I completamenti non annullati dell'intervento (anche di voci poi eliminate). */
export function loadActiveCompletions(db: SqlDatabase, recordId: string): Promise<CompletionRow[]> {
  return db.all<CompletionRow>(
    `SELECT c.id, c.item_id, c.done_on, c.done_km, c.created_at, i.name, i.template_id
     FROM maintenance_completions c JOIN maintenance_items i ON i.id = c.item_id
     WHERE c.service_record_id = ? AND c.deleted_at IS NULL ORDER BY i.sort_order, i.name, c.id`,
    [recordId],
  );
}

export function completionInfo(r: CompletionRow, isNew: boolean, next: ServiceCompletionInfo['next'] = null, nextText: string | null = null): ServiceCompletionInfo {
  return {
    completionId: r.id,
    itemId: r.item_id,
    itemName: r.name,
    templateId: r.template_id,
    doneOn: r.done_on,
    doneKm: r.done_km,
    isNew,
    next,
    nextText,
  };
}

export function loadWorkshopRef(db: SqlDatabase, id: string): Promise<WorkshopRef | undefined> {
  return db.get<{ id: string; name: string; phone: string | null; city: string | null }>(
    'SELECT id, name, phone, city FROM workshops WHERE id = ?',
    [id],
  );
}

/** Testo informativo sull'esito della revisione (nessuna dichiarazione su dove si possa circolare, W-13). */
export function inspectionNoticeOf(result: InspectionResult | null): string | null {
  if (result === 'repeat') return INSPECTION_RULES.repeat.warningText;
  if (result === 'suspended') return INSPECTION_RULES.suspended.warningText;
  return null;
}

/**
 * L'intervento completo. `completions` e' l'elenco dei completamenti attivi senza il "prossimo" (serve il motore delle
 * scadenze: lo calcolano i comandi che scrivono, passando `completions`).
 */
export async function loadDetail(
  db: SqlDatabase,
  id: string,
  opts: { includeDeleted?: boolean; completions?: ServiceCompletionInfo[] } = {},
): Promise<ServiceRecordDetail | null> {
  const r = await loadRecordRow(db, id, opts.includeDeleted ?? false);
  if (!r) return null;
  const lines = (await loadLineRows(db, id)).map(toLine);
  const reading = await loadLinkedReading(db, id);
  const activeReading = reading && reading.deleted_at === null ? reading : null;
  const completions = opts.completions ?? (await loadActiveCompletions(db, id)).map((c) => completionInfo(c, false));
  return {
    id: r.id,
    vehicleId: r.vehicle_id,
    serviceOn: r.service_on,
    kind: r.kind,
    kindLabel: SERVICE_KIND_LABELS[r.kind],
    title: r.title,
    workshop: r.workshop_id ? ((await loadWorkshopRef(db, r.workshop_id)) ?? null) : null,
    totalCents: r.total_cents,
    linesTotalCents: lines.reduce((s, l) => s + l.amountCents, 0),
    invoiceNumber: r.invoice_number,
    paidOn: r.paid_on,
    warrantyUntilOn: r.warranty_until_on,
    inspectionResult: r.inspection_result,
    inspectionNotice: inspectionNoticeOf(r.inspection_result),
    notes: r.notes,
    km: activeReading ? activeReading.km : null,
    odometerReadingId: activeReading ? activeReading.id : null,
    lines,
    oilChange: oilChangeOf(lines),
    completions,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

// ---------------------------------------------------------------- officine

export interface WorkshopRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  is_favorite: number;
  service_count: number;
  last_service_on: LocalDate | null;
  total_spent_cents: number;
}

/** Colonne di un'officina con l'uso che ne e' stato fatto (interventi non nel cestino). */
export const WORKSHOP_SELECT = `
  SELECT w.id, w.name, w.phone, w.email, w.website, w.address, w.city, w.notes, w.is_favorite,
         (SELECT COUNT(*) FROM service_records s WHERE s.workshop_id = w.id AND s.deleted_at IS NULL) AS service_count,
         (SELECT MAX(s.service_on) FROM service_records s WHERE s.workshop_id = w.id AND s.deleted_at IS NULL) AS last_service_on,
         (SELECT COALESCE(SUM(s.total_cents), 0) FROM service_records s WHERE s.workshop_id = w.id AND s.deleted_at IS NULL) AS total_spent_cents
  FROM workshops w`;

export function toWorkshop(r: WorkshopRow): Workshop {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    website: r.website,
    address: r.address,
    city: r.city,
    notes: r.notes,
    isFavorite: r.is_favorite === 1,
    serviceCount: r.service_count,
    lastServiceOn: r.last_service_on,
    totalSpentCents: r.total_spent_cents,
  };
}

export async function loadWorkshop(db: SqlDatabase, id: string): Promise<Workshop | null> {
  const r = await db.get<WorkshopRow>(`${WORKSHOP_SELECT} WHERE w.id = ? AND w.deleted_at IS NULL`, [id]);
  return r ? toWorkshop(r) : null;
}

