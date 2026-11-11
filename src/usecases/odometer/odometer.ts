// Registro chilometri (F-03): `odometer_readings` e' l'unica fonte dei km.
// Validazione nel dominio (validateOdometerReading, stessa regola del trigger), SQL a mano, eventi dopo il commit.
import {
  allowedKmRange,
  validateOdometerReading,
  type OdometerReading,
  type OdometerValidation,
} from '@/domain/odometer';
import { fail, invalid, ok, type Deps, type UsecaseError, type UsecaseResult } from '../context';
import {
  ODOMETER_COLUMNS,
  cleanText,
  insertReading,
  latestReadingOf,
  loadReadings,
  toEntry,
  vehicleExists,
  type OdometerRow,
} from './store';
import { AbortTx, mapSqlError } from './sqlErrors';
import type {
  AddOdometerReadingInput,
  AddOdometerReadingResult,
  ListOdometerOptions,
  OdometerCheck,
  OdometerConflictError,
  OdometerEntry,
} from './types';
import type { CurrentKm } from '@/domain/odometer';

/** `true` se l'errore e' una incoerenza dei km con i dettagli per la finestra a tre scelte. */
export function isOdometerConflict(e: UsecaseError): e is OdometerConflictError {
  return e.code === 'ODO_NON_MONOTONIC' && 'conflicts' in e;
}

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

/** Primo errore bloccante della validazione, tradotto nell'errore tipizzato dei casi d'uso. */
function firstError(v: OdometerValidation, existing: readonly OdometerReading[], readOn: string, id?: string): UsecaseError {
  const e = v.errors[0]!;
  if (e.code === 'INVALID_KM') return { code: 'VALIDATION', field: 'km', message: e.message };
  if (e.code === 'INVALID_DATE') return { code: 'VALIDATION', field: 'readOn', message: e.message };
  if (e.code === 'FUTURE_DATE') return { code: 'FUTURE_DATE' };
  return conflictError(v, existing, readOn, id);
}

/**
 * Verifica una lettura SENZA scriverla: errori bloccanti, avvisi, conflitti, vicini e intervallo ammesso.
 * Per l'avviso di coerenza mentre l'utente digita (S-25). `excludeId`: si sta modificando quella lettura.
 */
export async function checkOdometerReading(
  d: Deps,
  input: { vehicleId: string; km: number; readOn?: string; excludeId?: string },
): Promise<UsecaseResult<OdometerCheck>> {
  if (!(await vehicleExists(d.db, input.vehicleId))) return fail({ code: 'ITEM_NOT_FOUND' });
  const readOn = input.readOn ?? d.clock.todayLocal();
  const existing = await loadReadings(d.db, input.vehicleId);
  const v = validateOdometerReading({ id: input.excludeId, readOn, km: input.km }, existing, { today: d.clock.todayLocal() });
  return ok({ ...v, allowedRange: allowedKmRange(existing, readOn, input.excludeId) });
}

/**
 * Aggiunge una lettura manuale (o importata). Con km incoerenti restituisce `ODO_NON_MONOTONIC` (vedi `isOdometerConflict`
 * per conflitti, vicini e intervallo ammesso); con `resolveConflicts: 'ignore-conflicting'` mette da parte le letture in conflitto.
 * Gli avvisi non bloccanti (salti implausibili) tornano nel risultato.
 */
export async function addOdometerReading(
  d: Deps,
  input: AddOdometerReadingInput,
): Promise<UsecaseResult<AddOdometerReadingResult>> {
  const source = input.source ?? 'manual';
  if (source !== 'manual' && source !== 'import') return invalid('source', 'La provenienza della lettura non è valida.');
  const readOn = input.readOn ?? d.clock.todayLocal();
  try {
    const out = await d.db.transaction(async (tx): Promise<UsecaseResult<AddOdometerReadingResult>> => {
      if (!(await vehicleExists(tx, input.vehicleId))) return fail({ code: 'ITEM_NOT_FOUND' });
      const now = d.clock.nowIso();
      const today = d.clock.todayLocal();
      let existing = await loadReadings(tx, input.vehicleId);
      let v = validateOdometerReading({ readOn, km: input.km }, existing, { today });
      const ignored: string[] = [];
      if (!v.ok && input.resolveConflicts === 'ignore-conflicting' && v.errors.every((e) => e.code === 'NON_MONOTONIC')) {
        for (const c of v.conflicts) {
          await tx.run(`UPDATE odometer_readings SET status = 'ignored', updated_at = ? WHERE id = ?`, [now, c.id]);
          ignored.push(c.id);
        }
        existing = existing.map((r) => (ignored.includes(r.id) ? { ...r, status: 'ignored' as const } : r));
        v = validateOdometerReading({ readOn, km: input.km }, existing, { today });
      }
      if (!v.ok) throw new AbortTx(fail(firstError(v, existing, readOn)));
      const id = d.ids.ulid();
      await insertReading(tx, { id, vehicleId: input.vehicleId, readOn, km: input.km, source, note: cleanText(input.note, 500), nowIso: now });
      const row = await tx.get<OdometerRow>(`SELECT ${ODOMETER_COLUMNS} FROM odometer_readings WHERE id = ?`, [id]);
      return ok({ reading: toEntry(row!), warnings: v.warnings, ignoredReadingIds: ignored, previous: v.previous, next: v.next });
    }, 'exclusive');
    if (out.ok) d.events.emit({ type: 'data-changed', scope: 'odometer', vehicleId: input.vehicleId });
    return out;
  } catch (e) {
    if (e instanceof AbortTx) return e.result as UsecaseResult<AddOdometerReadingResult>;
    const mapped = mapSqlError(e);
    if (mapped) return fail(mapped);
    throw e;
  }
}

/** Il registro di un veicolo, dal piu' recente (data, poi km). Vuoto se il veicolo non esiste. */
export async function listOdometerReadings(
  d: Pick<Deps, 'db'>,
  vehicleId: string,
  opts: ListOdometerOptions = {},
): Promise<OdometerEntry[]> {
  const includeIgnored = opts.includeIgnored ?? true;
  const limit = opts.limit !== undefined ? Math.max(1, Math.floor(opts.limit)) : -1; // -1 = nessun limite in SQLite
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const rows = await d.db.all<OdometerRow>(
    `SELECT ${ODOMETER_COLUMNS} FROM odometer_readings
     WHERE vehicle_id = ? AND deleted_at IS NULL${includeIgnored ? '' : " AND status = 'valid'"}
     ORDER BY read_on DESC, km DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [vehicleId, limit, offset],
  );
  return rows.map(toEntry);
}

/** I km attuali: l'ultima lettura valida con provenienza e data; null se non ce ne sono. */
export async function latestOdometer(d: Pick<Deps, 'db'>, vehicleId: string): Promise<CurrentKm | null> {
  return latestReadingOf(d.db, vehicleId);
}

/**
 * Mette da parte una lettura errata (`ignored`: resta nel registro ma esce da calcoli e controlli) o la ripristina
 * (`ignored = false`; se i km non sono piu' coerenti torna `ODO_NON_MONOTONIC`).
 */
export async function markReadingIgnored(
  d: Deps,
  readingId: string,
  ignored = true,
): Promise<UsecaseResult<OdometerEntry>> {
  try {
    const out = await d.db.transaction(async (tx): Promise<UsecaseResult<OdometerEntry>> => {
      const row = await tx.get<OdometerRow>(
        `SELECT ${ODOMETER_COLUMNS} FROM odometer_readings WHERE id = ? AND deleted_at IS NULL`,
        [readingId],
      );
      if (!row) return fail({ code: 'ITEM_NOT_FOUND' });
      const target = ignored ? 'ignored' : 'valid';
      if (row.status === target) return ok(toEntry(row));
      if (!ignored) {
        const existing = await loadReadings(tx, row.vehicle_id);
        const v = validateOdometerReading({ id: row.id, readOn: row.read_on, km: row.km }, existing, {
          today: '9999-12-31', // una lettura gia' registrata non diventa "futura": conta solo la coerenza
        });
        if (!v.ok) throw new AbortTx(fail(firstError(v, existing, row.read_on, row.id)));
      }
      await tx.run('UPDATE odometer_readings SET status = ?, updated_at = ? WHERE id = ?', [target, d.clock.nowIso(), readingId]);
      return ok(toEntry({ ...row, status: target }));
    }, 'exclusive');
    if (out.ok) d.events.emit({ type: 'data-changed', scope: 'odometer', vehicleId: out.value.vehicleId });
    return out;
  } catch (e) {
    if (e instanceof AbortTx) return e.result as UsecaseResult<OdometerEntry>;
    const mapped = mapSqlError(e);
    if (mapped) return fail(mapped);
    throw e;
  }
}

/** Elimina (cestino) una lettura manuale o importata. Le altre seguono il rifornimento/intervento/controllo che le ha create. */
export async function deleteOdometerReading(d: Deps, readingId: string): Promise<UsecaseResult<void>> {
  const out = await d.db.transaction(async (tx): Promise<UsecaseResult<string>> => {
    const row = await tx.get<OdometerRow>(
      `SELECT ${ODOMETER_COLUMNS} FROM odometer_readings WHERE id = ? AND deleted_at IS NULL`,
      [readingId],
    );
    if (!row) return fail({ code: 'ITEM_NOT_FOUND' });
    if (row.source !== 'manual' && row.source !== 'import') {
      return invalid('source', 'Questa lettura è collegata a un altro registro: modifica o elimina da lì il rifornimento, l’intervento o il controllo.');
    }
    const now = d.clock.nowIso();
    await tx.run('UPDATE odometer_readings SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, readingId]);
    return ok(row.vehicle_id);
  }, 'exclusive');
  if (!out.ok) return out;
  d.events.emit({ type: 'data-changed', scope: 'odometer', vehicleId: out.value });
  return ok(undefined);
}
