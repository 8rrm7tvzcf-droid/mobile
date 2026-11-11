// Lettura km collegata a un rifornimento (`odometer_readings.source = 'fuel'`, `fuel_log_id`): passa dalla STESSA regola di
// coerenza monotona del registro km (`validateOdometerReading` del dominio + trigger SQL), con le stesse tre scelte di
// SPEC 6.3.6 punto 5. Interno al modulo.
//
// `conflictError` e `firstError` replicano le funzioni omonime (non esportate) di `usecases/odometer/odometer.ts`:
// il test `tests/integration/usecases/fuel/odometerLink.test.ts` verifica che l'errore sia identico a quello di
// `addOdometerReading` per lo stesso conflitto.
import {
  allowedKmRange,
  validateOdometerReading,
  type OdometerReading,
  type OdometerValidation,
} from '@/domain/odometer';
import type { LocalDate, SqlDatabase } from '@/domain/ports';
import { fail, type Deps, type UsecaseError } from '../context';
import type { OdometerConflictError } from '../odometer';
import { AbortTx } from '../odometer/sqlErrors';
import { loadReadings } from '../odometer/store';
import type { OdometerConflictChoice } from './types';

function conflictError(v: OdometerValidation, existing: readonly OdometerReading[], readOn: string, id?: string): OdometerConflictError {
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

/** Primo errore bloccante della validazione km, tradotto nell'errore tipizzato dei casi d'uso (campo `km`). */
function firstError(v: OdometerValidation, existing: readonly OdometerReading[], readOn: string, id?: string): UsecaseError {
  const e = v.errors[0]!;
  if (e.code === 'INVALID_KM') return { code: 'VALIDATION', field: 'km', message: e.message };
  if (e.code === 'INVALID_DATE') return { code: 'VALIDATION', field: 'filledOn', message: e.message };
  if (e.code === 'FUTURE_DATE') return { code: 'FUTURE_DATE' };
  return conflictError(v, existing, readOn, id);
}

export interface LinkedReading {
  id: string;
  /** `true` se la lettura e' nel cestino (rifornimento cancellato o km tolti): si puo' riesumare. */
  deleted: boolean;
  /** Istante in cui e' finita nel cestino (null se e' attiva): serve a distinguere i km tolti a mano da quelli spariti con il rifornimento. */
  deletedAt: string | null;
}

/** La lettura collegata a un rifornimento, anche se nel cestino (l'indice unico `ux_odo_fuel` vale per tutte). */
export async function findLinkedReading(db: SqlDatabase, fuelLogId: string): Promise<LinkedReading | null> {
  const r = await db.get<{ id: string; deleted_at: string | null }>(
    'SELECT id, deleted_at FROM odometer_readings WHERE fuel_log_id = ?',
    [fuelLogId],
  );
  return r ? { id: r.id, deleted: r.deleted_at !== null, deletedAt: r.deleted_at } : null;
}

export interface KmLinkOutcome {
  /** La lettura creata/aggiornata; null se non c'e' (nessun km o km lasciati fuori). */
  readingId: string | null;
  /** I km erano in conflitto e sono stati lasciati fuori (`skip_km`). */
  skipped: boolean;
  warnings: string[];
  ignoredReadingIds: string[];
  /** `true` se il registro km e' cambiato (lettura inserita, aggiornata o letture messe da parte). */
  changed: boolean;
}

export const NO_KM: KmLinkOutcome = { readingId: null, skipped: false, warnings: [], ignoredReadingIds: [], changed: false };

/**
 * Crea o aggiorna la lettura km di un rifornimento, validandola come ogni altra lettura. Dentro una transazione aperta
 * (`tx`). In caso di conflitto: `resolveConflicts` mette da parte le letture in conflitto; `skip_km` lascia i km fuori;
 * altrimenti interrompe la transazione con `ODO_NON_MONOTONIC` (con i dettagli per la finestra a tre scelte).
 */
export async function upsertFuelReading(
  tx: SqlDatabase,
  d: Pick<Deps, 'clock' | 'ids'>,
  args: {
    vehicleId: string;
    fuelLogId: string;
    readOn: LocalDate;
    km: number;
    existing: LinkedReading | null;
    onConflict: OdometerConflictChoice;
    resolveConflicts?: 'ignore-conflicting';
  },
): Promise<KmLinkOutcome> {
  const today = d.clock.todayLocal();
  const now = d.clock.nowIso();
  let readings = await loadReadings(tx, args.vehicleId);
  const candidate = { id: args.existing?.id, readOn: args.readOn, km: args.km };
  let v = validateOdometerReading(candidate, readings, { today });
  const ignored: string[] = [];
  if (!v.ok && args.resolveConflicts === 'ignore-conflicting' && v.errors.every((e) => e.code === 'NON_MONOTONIC')) {
    for (const c of v.conflicts) {
      await tx.run(`UPDATE odometer_readings SET status = 'ignored', updated_at = ? WHERE id = ?`, [now, c.id]);
      ignored.push(c.id);
    }
    readings = readings.map((r) => (ignored.includes(r.id) ? { ...r, status: 'ignored' as const } : r));
    v = validateOdometerReading(candidate, readings, { today });
  }
  if (!v.ok) {
    if (args.onConflict === 'skip_km' && v.errors.every((e) => e.code === 'NON_MONOTONIC')) {
      return { ...NO_KM, skipped: true };
    }
    throw new AbortTx(fail(firstError(v, readings, args.readOn, args.existing?.id)));
  }
  const warnings = v.warnings.map((w) => w.message);
  let readingId: string;
  if (args.existing) {
    readingId = args.existing.id;
    // la lettura si "riesuma" se era nel cestino e torna valida se era stata messa da parte: i km sono stati reimmessi
    await tx.run(
      `UPDATE odometer_readings SET read_on = ?, km = ?, status = 'valid', deleted_at = NULL, updated_at = ? WHERE id = ?`,
      [args.readOn, args.km, now, readingId],
    );
  } else {
    readingId = d.ids.ulid();
    await tx.run(
      `INSERT INTO odometer_readings (id, vehicle_id, read_on, km, source, status, fuel_log_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'fuel', 'valid', ?, ?, ?)`,
      [readingId, args.vehicleId, args.readOn, args.km, args.fuelLogId, now, now],
    );
  }
  return { readingId, skipped: false, warnings, ignoredReadingIds: ignored, changed: true };
}

/** Porta nel cestino la lettura collegata (se c'e' e non e' gia' nel cestino). Restituisce `true` se qualcosa e' cambiato. */
export async function trashLinkedReading(tx: SqlDatabase, fuelLogId: string, nowIso: string): Promise<boolean> {
  const r = await tx.run(
    'UPDATE odometer_readings SET deleted_at = ?, updated_at = ? WHERE fuel_log_id = ? AND deleted_at IS NULL',
    [nowIso, nowIso, fuelLogId],
  );
  return r.changes > 0;
}
