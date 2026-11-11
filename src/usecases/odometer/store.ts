// Accesso SQL al registro km (SQL a mano dentro i casi d'uso, SPEC 8.6). Funzioni interne al modulo e a `vehicles`/`demo`.
import type { LocalDate, SqlDatabase } from '@/domain/ports';
import {
  sourceLabelIt,
  type CurrentKm,
  type OdometerReading,
  type OdometerSource,
  type OdometerStatus,
} from '@/domain/odometer';
import type { OdometerEntry } from './types';

export interface OdometerRow {
  id: string;
  vehicle_id: string;
  read_on: string;
  km: number;
  source: OdometerSource;
  status: OdometerStatus;
  note: string | null;
  fuel_log_id: string | null;
  service_record_id: string | null;
  fluid_check_id: string | null;
  obd_session_id: string | null;
  created_at: string;
}

export const ODOMETER_COLUMNS =
  'id, vehicle_id, read_on, km, source, status, note, fuel_log_id, service_record_id, fluid_check_id, obd_session_id, created_at';

export function toEntry(r: OdometerRow): OdometerEntry {
  return {
    id: r.id,
    vehicleId: r.vehicle_id,
    readOn: r.read_on,
    km: r.km,
    source: r.source,
    sourceLabel: sourceLabelIt(r.source),
    status: r.status,
    note: r.note,
    linkedId: r.fuel_log_id ?? r.service_record_id ?? r.fluid_check_id ?? r.obd_session_id ?? null,
    canDelete: r.source === 'manual' || r.source === 'import',
    createdAt: r.created_at,
  };
}

/** Le letture non cancellate di un veicolo (valide e ignorate), nel formato del dominio. */
export async function loadReadings(db: SqlDatabase, vehicleId: string): Promise<OdometerReading[]> {
  const rows = await db.all<{ id: string; read_on: string; km: number; source: OdometerSource; status: OdometerStatus }>(
    'SELECT id, read_on, km, source, status FROM odometer_readings WHERE vehicle_id = ? AND deleted_at IS NULL',
    [vehicleId],
  );
  return rows.map((r) => ({ id: r.id, readOn: r.read_on, km: r.km, source: r.source, status: r.status }));
}

export async function vehicleExists(db: SqlDatabase, vehicleId: string): Promise<boolean> {
  const row = await db.get<{ id: string }>('SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicleId]);
  return row !== undefined;
}

export interface NewReading {
  id: string;
  vehicleId: string;
  readOn: LocalDate;
  km: number;
  source: 'manual' | 'import';
  note: string | null;
  nowIso: string;
}

/** Inserisce una lettura manuale/importata (le altre provenienze le inseriscono i registri che le possiedono). */
export async function insertReading(db: SqlDatabase, r: NewReading): Promise<void> {
  await db.run(
    `INSERT INTO odometer_readings (id, vehicle_id, read_on, km, source, status, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'valid', ?, ?, ?)`,
    [r.id, r.vehicleId, r.readOn, r.km, r.source, r.note, r.nowIso, r.nowIso],
  );
}

/** L'ultima lettura valida (data piu' recente; a parita' di data i km piu' alti), con provenienza. */
export async function latestReadingOf(db: SqlDatabase, vehicleId: string): Promise<CurrentKm | null> {
  const row = await db.get<{ read_on: string; km: number; source: OdometerSource }>(
    `SELECT read_on, km, source FROM odometer_readings
     WHERE vehicle_id = ? AND status = 'valid' AND deleted_at IS NULL
     ORDER BY read_on DESC, km DESC, id DESC LIMIT 1`,
    [vehicleId],
  );
  return row ? { km: row.km, readOn: row.read_on, source: row.source, sourceLabel: sourceLabelIt(row.source) } : null;
}

export const cleanText = (v: string | null | undefined, max: number): string | null => {
  if (v == null) return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, max);
};
