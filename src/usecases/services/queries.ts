// Letture di interventi e tagliandi (S-13 timeline, S-14 dettaglio): elenco con filtri, dettaglio. Sola lettura.
import type { LocalDate } from '@/domain/ports';
import type { Deps } from '../context';
import { placeholders } from './internal';
import { loadDetail } from './store';
import { SERVICE_KIND_LABELS } from './types';
import type { InspectionResult, ServiceFilters, ServiceKind, ServiceRecordDetail, ServiceRecordSummary } from './types';

interface SummaryRow {
  id: string;
  vehicle_id: string;
  service_on: LocalDate;
  kind: ServiceKind;
  title: string;
  workshop_id: string | null;
  workshop_name: string | null;
  total_cents: number;
  invoice_number: string | null;
  inspection_result: InspectionResult | null;
  notes: string | null;
  km: number | null;
  line_count: number;
  oil_lines: number;
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

/**
 * Gli interventi di un veicolo (non nel cestino), dal piu' recente (data, poi km). Filtri per tipo, periodo (estremi inclusi),
 * officina e testo (titolo, note, fattura, descrizione delle righe). Vuoto se il veicolo non ha interventi.
 */
export async function listServiceRecords(d: Pick<Deps, 'db'>, vehicleId: string, filters: ServiceFilters = {}): Promise<ServiceRecordSummary[]> {
  const where: string[] = ['s.vehicle_id = ?', 's.deleted_at IS NULL'];
  const params: (string | number)[] = [vehicleId];
  if (filters.kinds && filters.kinds.length > 0) {
    where.push(`s.kind IN (${placeholders(filters.kinds.length)})`);
    params.push(...filters.kinds);
  }
  if (filters.from) {
    where.push('s.service_on >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('s.service_on <= ?');
    params.push(filters.to);
  }
  if (filters.workshopId) {
    where.push('s.workshop_id = ?');
    params.push(filters.workshopId);
  }
  const text = filters.text?.trim();
  if (text) {
    const like = `%${escapeLike(text)}%`;
    where.push(
      `(s.title LIKE ? ESCAPE '\\' OR s.notes LIKE ? ESCAPE '\\' OR s.invoice_number LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM service_lines l WHERE l.service_record_id = s.id AND l.description LIKE ? ESCAPE '\\'))`,
    );
    params.push(like, like, like, like);
  }
  const limit = filters.limit !== undefined ? Math.max(1, Math.floor(filters.limit)) : -1; // -1 = nessun limite in SQLite
  const offset = Math.max(0, Math.floor(filters.offset ?? 0));

  const rows = await d.db.all<SummaryRow>(
    `SELECT s.id, s.vehicle_id, s.service_on, s.kind, s.title, s.workshop_id, w.name AS workshop_name, s.total_cents, s.invoice_number,
            s.inspection_result, s.notes,
            (SELECT o.km FROM odometer_readings o WHERE o.service_record_id = s.id AND o.deleted_at IS NULL) AS km,
            (SELECT COUNT(*) FROM service_lines l WHERE l.service_record_id = s.id) AS line_count,
            (SELECT COUNT(*) FROM service_lines l WHERE l.service_record_id = s.id AND l.fluid_kind = 'engine_oil') AS oil_lines
     FROM service_records s LEFT JOIN workshops w ON w.id = s.workshop_id
     WHERE ${where.join(' AND ')}
     ORDER BY s.service_on DESC, km DESC, s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  if (rows.length === 0) return [];

  const names = new Map<string, string[]>();
  const done = await d.db.all<{ service_record_id: string; name: string }>(
    `SELECT c.service_record_id, i.name FROM maintenance_completions c JOIN maintenance_items i ON i.id = c.item_id
     WHERE c.deleted_at IS NULL AND c.service_record_id IN (${placeholders(rows.length)}) ORDER BY i.sort_order, i.name, c.id`,
    rows.map((r) => r.id),
  );
  for (const c of done) {
    const list = names.get(c.service_record_id) ?? [];
    list.push(c.name);
    names.set(c.service_record_id, list);
  }

  return rows.map((r) => ({
    id: r.id,
    vehicleId: r.vehicle_id,
    serviceOn: r.service_on,
    kind: r.kind,
    kindLabel: SERVICE_KIND_LABELS[r.kind],
    title: r.title,
    workshopId: r.workshop_id,
    workshopName: r.workshop_name,
    totalCents: r.total_cents,
    km: r.km,
    lineCount: r.line_count,
    hasOil: r.oil_lines > 0,
    inspectionResult: r.inspection_result,
    invoiceNumber: r.invoice_number,
    notes: r.notes,
    completedItemNames: names.get(r.id) ?? [],
  }));
}

/**
 * Un intervento completo (righe, officina, km, cambio olio, voci completate). `null` se non esiste o e' nel cestino
 * (con `includeDeleted` si legge anche dal cestino). I completamenti qui non portano il "prossimo" (`next` nullo): quello
 * lo calcolano i comandi che scrivono.
 */
export async function getServiceRecord(
  d: Pick<Deps, 'db'>,
  recordId: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<ServiceRecordDetail | null> {
  return loadDetail(d.db, recordId, { includeDeleted: opts.includeDeleted ?? false });
}
