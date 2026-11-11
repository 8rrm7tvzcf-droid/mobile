// Lettura km collegata a un intervento (`odometer_readings.source = 'service'`): stessa coerenza monotona del registro km
// (domain/odometer, la regola del trigger ODO_NON_MONOTONIC) con le tre scelte di SPEC 6.3.6 punto 5.
import { allowedKmRange, validateOdometerReading } from '@/domain/odometer';
import type { OdometerReading, OdometerValidation } from '@/domain/odometer';
import type { LocalDate } from '@/domain/ports';
import type { Deps, UsecaseError } from '../context';
import type { OdometerConflictError } from '../odometer';
import { Abort, type Tx } from './internal';
import { loadLinkedReading } from './store';
import type { KmConflictChoice, ServiceWarning } from './types';

/** Le letture non cancellate di un veicolo nel formato del dominio. */
export async function loadReadings(tx: Tx, vehicleId: string): Promise<OdometerReading[]> {
  const rows = await tx.all<{ id: string; read_on: string; km: number; source: OdometerReading['source']; status: OdometerReading['status'] }>(
    'SELECT id, read_on, km, source, status FROM odometer_readings WHERE vehicle_id = ? AND deleted_at IS NULL',
    [vehicleId],
  );
  return rows.map((r) => ({ id: r.id, readOn: r.read_on, km: r.km, source: r.source, status: r.status }));
}

function conflictError(v: OdometerValidation, existing: readonly OdometerReading[], readOn: LocalDate, id?: string): OdometerConflictError {
  const issue = v.errors.find((e) => e.code === 'NON_MONOTONIC');
  return {
    code: 'ODO_NON_MONOTONIC',
    message: issue?.message ?? 'I km non sono coerenti con le letture vicine.',
    conflicts: v.conflicts,
    previous: v.previous,
    next: v.next,
    allowedRange: allowedKmRange(existing, readOn, id),
  };
}

/** Il primo errore bloccante come errore tipizzato (con i dettagli per la finestra a tre scelte se e' una incoerenza). */
function blockingError(v: OdometerValidation, existing: readonly OdometerReading[], readOn: LocalDate, id?: string): UsecaseError {
  const first = v.errors[0]!;
  if (first.code === 'INVALID_KM') return { code: 'VALIDATION', field: 'km', message: first.message };
  if (first.code === 'INVALID_DATE') return { code: 'VALIDATION', field: 'serviceOn', message: first.message };
  if (first.code === 'FUTURE_DATE') return { code: 'FUTURE_DATE' };
  return conflictError(v, existing, readOn, id);
}

export interface KmOutcome {
  /** La lettura collegata dopo l'operazione (null se non c'e'). */
  readingId: string | null;
  /** Km da usare nei completamenti. */
  km: number | null;
  /** Conflitto ignorato con `skip_km`: il registro km non e' stato toccato. */
  kmIgnored: boolean;
  ignoredReadingIds: string[];
  warnings: ServiceWarning[];
  /** La lettura e' stata creata, modificata, riattivata o tolta. */
  changed: boolean;
}

/**
 * Allinea la lettura collegata all'intervento ai km indicati: la crea, la corregge, la riattiva o la toglie (km nullo).
 * Si chiama DOPO l'inserimento del record (la lettura lo referenzia). In caso di incoerenza segue `onConflict`.
 */
export async function applyServiceKm(
  tx: Tx,
  d: Pick<Deps, 'clock' | 'ids'>,
  a: { recordId: string; vehicleId: string; serviceOn: LocalDate; km: number | null; onConflict: KmConflictChoice },
): Promise<KmOutcome> {
  const existing = await loadLinkedReading(tx, a.recordId);
  const active = existing && existing.deleted_at === null ? existing : undefined;
  const now = d.clock.nowIso();
  const none: KmOutcome = { readingId: null, km: null, kmIgnored: false, ignoredReadingIds: [], warnings: [], changed: false };

  if (a.km === null) {
    if (!active) return none;
    await tx.run('UPDATE odometer_readings SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, active.id]);
    return { ...none, changed: true };
  }

  let readings = await loadReadings(tx, a.vehicleId);
  const cand = { id: active?.id, readOn: a.serviceOn, km: a.km, status: active?.status ?? ('valid' as const) };
  const opts = { today: d.clock.todayLocal() };
  let v = validateOdometerReading(cand, readings, opts);
  const ignored: string[] = [];
  if (!v.ok) {
    const onlyConflict = v.errors.every((e) => e.code === 'NON_MONOTONIC');
    if (onlyConflict && a.onConflict === 'skip_km') {
      return { ...none, readingId: active?.id ?? null, km: active?.km ?? null, kmIgnored: true };
    }
    if (onlyConflict && a.onConflict === 'ignore_conflicting') {
      for (const c of v.conflicts) {
        await tx.run(`UPDATE odometer_readings SET status = 'ignored', updated_at = ? WHERE id = ?`, [now, c.id]);
        ignored.push(c.id);
      }
      readings = readings.map((r) => (ignored.includes(r.id) ? { ...r, status: 'ignored' as const } : r));
      v = validateOdometerReading(cand, readings, opts);
    }
    if (!v.ok) throw new Abort(blockingError(v, readings, a.serviceOn, active?.id));
  }

  const warnings: ServiceWarning[] = v.warnings.map((w) => ({
    code: w.code === 'VERY_HIGH_KM' ? 'KM_VERY_HIGH' : 'KM_IMPLAUSIBLE',
    message: w.message,
  }));

  let readingId: string;
  let changed = true;
  if (existing) {
    readingId = existing.id;
    if (existing.deleted_at !== null || existing.read_on !== a.serviceOn || existing.km !== a.km) {
      await tx.run(
        `UPDATE odometer_readings SET read_on = ?, km = ?, status = ?, deleted_at = NULL, updated_at = ? WHERE id = ?`,
        [a.serviceOn, a.km, existing.deleted_at !== null ? 'valid' : existing.status, now, existing.id],
      );
    } else {
      changed = ignored.length > 0;
    }
  } else {
    readingId = d.ids.ulid();
    await tx.run(
      `INSERT INTO odometer_readings (id, vehicle_id, read_on, km, source, status, service_record_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'service', 'valid', ?, ?, ?)`,
      [readingId, a.vehicleId, a.serviceOn, a.km, a.recordId, now, now],
    );
  }
  return { readingId, km: a.km, kmIgnored: false, ignoredReadingIds: ignored, warnings, changed };
}
