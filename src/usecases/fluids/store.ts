// Accesso SQL al controllo livelli (SQL a mano dentro i casi d'uso, SPEC 8.6). Uso INTERNO al modulo.
import type { LocalDate, SqlDatabase } from '@/domain/ports';
import { allowedKmRange, validateOdometerReading } from '@/domain/odometer';
import type { OdometerReading, OdometerValidation } from '@/domain/odometer';
import { fluidLabelIt, levelLabelIt } from '@/domain/fluids';
import type { Fluid, FluidLevel } from '@/domain/fluids';
import type { Deps, UsecaseError } from '../context';
import { Abort } from '../deadlines/internal';
import { loadReadings } from '../odometer/store';
import type { OdometerConflictError } from '../odometer/types';
import type { FluidCheckEntry } from './types';

export interface FluidCheckRow {
  id: string;
  vehicle_id: string;
  checked_on: LocalDate;
  fluid: Fluid;
  level: FluidLevel;
  added_ml: number | null;
  value_millibar: number | null;
  product: string | null;
  notes: string | null;
  created_at: string;
  reading_id: string | null;
  km: number | null;
}

/** I km del controllo vengono dalla lettura collegata, se esiste ed e' valida (una lettura messa da parte non conta). */
export const FLUID_CHECK_SELECT = `
  SELECT f.id, f.vehicle_id, f.checked_on, f.fluid, f.level, f.added_ml, f.value_millibar, f.product, f.notes, f.created_at,
         o.id AS reading_id, CASE WHEN o.status = 'valid' THEN o.km END AS km
  FROM fluid_checks f
  LEFT JOIN odometer_readings o ON o.fluid_check_id = f.id AND o.deleted_at IS NULL`;

export function toEntry(r: FluidCheckRow): FluidCheckEntry {
  return {
    id: r.id,
    vehicleId: r.vehicle_id,
    checkedOn: r.checked_on,
    fluid: r.fluid,
    level: r.level,
    addedMl: r.added_ml,
    valueMillibar: r.value_millibar,
    km: r.km,
    fluidLabelIt: fluidLabelIt(r.fluid),
    levelLabelIt: levelLabelIt(r.fluid, r.level),
    product: r.product,
    notes: r.notes,
    odometerReadingId: r.reading_id,
    createdAt: r.created_at,
  };
}

export async function loadCheck(db: SqlDatabase, checkId: string): Promise<FluidCheckEntry | null> {
  const row = await db.get<FluidCheckRow>(`${FLUID_CHECK_SELECT} WHERE f.id = ? AND f.deleted_at IS NULL`, [checkId]);
  return row ? toEntry(row) : null;
}

/** Tutti i controlli non cancellati di un veicolo, dal piu' recente (data, poi ordine di creazione). */
export async function loadChecks(db: SqlDatabase, vehicleId: string): Promise<FluidCheckEntry[]> {
  const rows = await db.all<FluidCheckRow>(
    `${FLUID_CHECK_SELECT} WHERE f.vehicle_id = ? AND f.deleted_at IS NULL ORDER BY f.checked_on DESC, f.created_at DESC, f.id DESC`,
    [vehicleId],
  );
  return rows.map(toEntry);
}

export const cleanText = (v: string | null | undefined, max: number): string | null => {
  if (v == null) return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, max);
};

/** Come `conflictError` di usecases/odometer: `ODO_NON_MONOTONIC` con i dettagli per la finestra a tre scelte. */
export function conflictError(
  v: OdometerValidation,
  existing: readonly OdometerReading[],
  readOn: LocalDate,
): OdometerConflictError {
  const issue = v.errors.find((e) => e.code === 'NON_MONOTONIC');
  return {
    code: 'ODO_NON_MONOTONIC',
    message: issue?.message ?? 'I km non sono coerenti con le letture vicine.',
    conflicts: v.conflicts,
    previous: v.previous,
    next: v.next,
    allowedRange: allowedKmRange(existing, readOn),
  };
}

function firstError(v: OdometerValidation, existing: readonly OdometerReading[], readOn: LocalDate): UsecaseError {
  const e = v.errors[0] as OdometerValidation['errors'][number];
  if (e.code === 'INVALID_KM') return { code: 'VALIDATION', field: 'km', message: e.message };
  if (e.code === 'INVALID_DATE') return { code: 'VALIDATION', field: 'checkedOn', message: e.message };
  if (e.code === 'FUTURE_DATE') return { code: 'FUTURE_DATE' };
  return conflictError(v, existing, readOn);
}

export interface LinkedKm {
  /** Km da usare nel completamento (null se assenti o ignorati). */
  km: number | null;
  /** Lettura creata (null se non c'erano km o sono stati ignorati). */
  readingId: string | null;
  ignored: boolean;
  ignoredReadingIds: string[];
  warnings: string[];
}

/**
 * Crea la lettura km collegata al controllo (`source = 'fluid_check'`, `fluid_check_id`), con la STESSA regola di coerenza
 * monotona del registro km (`validateOdometerReading`, stessa del trigger). Il controllo deve esistere gia' nella transazione.
 */
export async function registerLinkedKm(
  tx: SqlDatabase,
  d: Pick<Deps, 'clock' | 'ids'>,
  args: {
    vehicleId: string;
    checkId: string;
    checkedOn: LocalDate;
    km: number | null;
    onConflict: 'fail' | 'skip_km' | 'ignore-conflicting';
  },
): Promise<LinkedKm> {
  if (args.km == null) return { km: null, readingId: null, ignored: false, ignoredReadingIds: [], warnings: [] };
  const today = d.clock.todayLocal();
  const now = d.clock.nowIso();
  let existing = await loadReadings(tx, args.vehicleId);
  const candidate = { readOn: args.checkedOn, km: args.km, source: 'fluid_check' as const };
  let v = validateOdometerReading(candidate, existing, { today });
  const ignoredReadingIds: string[] = [];
  if (!v.ok && v.errors.every((e) => e.code === 'NON_MONOTONIC')) {
    if (args.onConflict === 'skip_km') return { km: null, readingId: null, ignored: true, ignoredReadingIds, warnings: [] };
    if (args.onConflict === 'ignore-conflicting') {
      for (const c of v.conflicts) {
        await tx.run(`UPDATE odometer_readings SET status = 'ignored', updated_at = ? WHERE id = ?`, [now, c.id]);
        ignoredReadingIds.push(c.id);
      }
      existing = existing.map((r) => (ignoredReadingIds.includes(r.id) ? { ...r, status: 'ignored' as const } : r));
      v = validateOdometerReading(candidate, existing, { today });
    }
  }
  if (!v.ok) throw new Abort(firstError(v, existing, args.checkedOn));
  const id = d.ids.ulid();
  await tx.run(
    `INSERT INTO odometer_readings (id, vehicle_id, read_on, km, source, status, fluid_check_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'fluid_check', 'valid', ?, ?, ?)`,
    [id, args.vehicleId, args.checkedOn, args.km, args.checkId, now, now],
  );
  return { km: args.km, readingId: id, ignored: false, ignoredReadingIds, warnings: v.warnings.map((w) => w.message) };
}
