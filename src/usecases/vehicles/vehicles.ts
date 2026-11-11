// Garage multi-veicolo (F-01, F-02, F-05): aggiunta, modifica, archivio (venduta/rottamata), cestino e ripristino.
// SQL a mano dentro i casi d'uso, scritture in transazione con `tx`, eventi di dominio dopo il commit.
import { addDays, compareDates, diffDays, isValidDate } from '@/domain/dates';
import { sourceLabelIt, type CurrentKm, type OdometerSource } from '@/domain/odometer';
import { isValidKm } from '@/domain/units';
import { runPendingFileDeletions } from '../attachments/pending';
import { fail, invalid, ok, type Deps, type FileDeps, type UsecaseResult } from '../context';
import { AbortTx, isUniqueOn, mapSqlError } from '../odometer/sqlErrors';
import { insertReading, latestReadingOf } from '../odometer/store';
import { readSetting } from '../settings';
import {
  findDuplicate,
  insertVehicleRow,
  nextSortOrder,
  selectVehicle,
  toInput,
  toVehicle,
  updateVehicleRow,
  type VehicleRow,
} from './store';
import type {
  AddVehicleInput,
  ArchiveVehicleInput,
  ListVehiclesOptions,
  TrashedVehicle,
  UpdateVehicleInput,
  VehicleDetail,
  VehicleInput,
  VehicleSummary,
} from './types';
import { derivePowertrain, fuelCombinationError, validateVehicleInput } from './validate';

const DUP_VIN = 'Questo VIN è già nel tuo garage.';

async function detailOf(d: Pick<Deps, 'db'>, row: VehicleRow): Promise<VehicleDetail> {
  return { ...toVehicle(row), currentKm: await latestReadingOf(d.db, row.id) };
}

/** Traduce gli errori SQL noti (targa/VIN duplicati, trigger) in errori tipizzati; rilancia gli altri. */
function mapWriteError(e: unknown): UsecaseResult<never> {
  if (e instanceof AbortTx) return e.result as UsecaseResult<never>;
  const mapped = mapSqlError(e);
  if (mapped) return fail(mapped);
  if (isUniqueOn(e, 'vehicles.vin')) return invalid('vin', DUP_VIN);
  throw e;
}

/**
 * Aggiunge un'auto. Obbligatori solo marca, modello e alimentazione primaria. Targa e VIN sono normalizzati;
 * una targa gia' presente in un'altra auto non eliminata da' `DUPLICATE_PLATE`. `initialKm` crea la prima lettura dell'odometro.
 */
export async function addVehicle(d: Deps, input: AddVehicleInput): Promise<UsecaseResult<VehicleDetail>> {
  const today = d.clock.todayLocal();
  const checked = validateVehicleInput(input, { today, defaultDistanceUnit: await readSetting(d.db, 'units.distance') });
  if (!checked.ok) return invalid(checked.field, checked.message);
  const fields = checked.value;

  const initialKm = input.initialKm ?? null;
  const initialKmOn = input.initialKmOn ?? today;
  if (initialKm !== null) {
    if (!isValidKm(initialKm)) return invalid('initialKm', 'I km devono essere un numero intero tra 0 e 2.000.000.');
    if (!isValidDate(initialKmOn)) return invalid('initialKmOn', 'La data della lettura non è valida.');
    if (compareDates(initialKmOn, today) > 0) return fail({ code: 'FUTURE_DATE' });
  }

  try {
    const id = await d.db.transaction(async (tx): Promise<string> => {
      if (await findDuplicate(tx, 'plate', fields.plate, null)) throw new AbortTx(fail({ code: 'DUPLICATE_PLATE' }));
      if (await findDuplicate(tx, 'vin', fields.vin, null)) throw new AbortTx(invalid('vin', DUP_VIN));
      const now = d.clock.nowIso();
      const vehicleId = d.ids.ulid();
      await insertVehicleRow(tx, { id: vehicleId, fields, sortOrder: await nextSortOrder(tx), nowIso: now });
      if (initialKm !== null) {
        await insertReading(tx, {
          id: d.ids.ulid(),
          vehicleId,
          readOn: initialKmOn,
          km: initialKm,
          source: 'manual',
          note: null,
          nowIso: now,
        });
      }
      return vehicleId;
    }, 'exclusive');
    d.events.emit({ type: 'data-changed', scope: 'vehicles', vehicleId: id });
    if (initialKm !== null) d.events.emit({ type: 'data-changed', scope: 'odometer', vehicleId: id });
    return ok(await detailOf(d, (await selectVehicle(d.db, id))!));
  } catch (e) {
    return mapWriteError(e);
  }
}

/**
 * Modifica parziale: i campi omessi non cambiano, `null` svuota un campo facoltativo. Si rivalida l'auto intera
 * (targa, VIN, combinazione di alimentazioni...). Se cambia l'alimentazione e il tipo di motorizzazione non e' piu'
 * coerente, viene ricavato di nuovo dall'alimentazione.
 */
export async function updateVehicle(
  d: Deps,
  vehicleId: string,
  patch: UpdateVehicleInput,
): Promise<UsecaseResult<VehicleDetail>> {
  const defaultDistanceUnit = await readSetting(d.db, 'units.distance');
  try {
    await d.db.transaction(async (tx): Promise<void> => {
      const row = await selectVehicle(tx, vehicleId);
      if (!row) throw new AbortTx(fail({ code: 'ITEM_NOT_FOUND' }));
      const current = toVehicle(row);
      const merged: Record<string, unknown> = { ...toInput(current) };
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) merged[k] = v;
      const next = merged as unknown as VehicleInput;
      if (patch.powertrain === undefined) {
        const secondary = next.fuelSecondary ?? null;
        const stillOk =
          (patch.fuelPrimary === undefined && patch.fuelSecondary === undefined) ||
          fuelCombinationError(next.fuelPrimary, secondary, current.powertrain) === null;
        next.powertrain = stillOk ? current.powertrain : derivePowertrain(next.fuelPrimary, secondary);
      }
      const checked = validateVehicleInput(next, { today: d.clock.todayLocal(), defaultDistanceUnit });
      if (!checked.ok) throw new AbortTx(invalid(checked.field, checked.message));
      const f = checked.value;
      if (current.soldOn && f.purchaseOn && compareDates(current.soldOn, f.purchaseOn) < 0) {
        throw new AbortTx(invalid('purchaseOn', "La data d'acquisto è successiva a quella di vendita."));
      }
      if (await findDuplicate(tx, 'plate', f.plate, vehicleId)) throw new AbortTx(fail({ code: 'DUPLICATE_PLATE' }));
      if (await findDuplicate(tx, 'vin', f.vin, vehicleId)) throw new AbortTx(invalid('vin', DUP_VIN));
      await updateVehicleRow(tx, vehicleId, f, d.clock.nowIso());
    }, 'exclusive');
  } catch (e) {
    return mapWriteError(e);
  }
  d.events.emit({ type: 'data-changed', scope: 'vehicles', vehicleId });
  return ok(await detailOf(d, (await selectVehicle(d.db, vehicleId))!));
}

/**
 * Segna l'auto come venduta, rottamata o archiviata. Un'auto non attiva non genera promemoria ne' notifiche
 * (chi riconcilia le scadenze guarda `status`). Per «venduta» e «rottamata» si registrano data (default oggi), km e prezzo.
 */
export async function archiveVehicle(
  d: Deps,
  vehicleId: string,
  input: ArchiveVehicleInput,
): Promise<UsecaseResult<VehicleDetail>> {
  const status = input.status;
  if (status !== 'sold' && status !== 'scrapped' && status !== 'archived') return invalid('status', 'Lo stato non è valido.');
  const today = d.clock.todayLocal();
  const withSale = status !== 'archived';
  const soldOn = withSale ? (input.soldOn ?? today) : null;
  const soldKm = withSale ? (input.soldKm ?? null) : null;
  const soldPrice = withSale ? (input.soldPriceCents ?? null) : null;
  if (soldOn !== null) {
    if (!isValidDate(soldOn)) return invalid('soldOn', 'La data non è valida.');
    if (compareDates(soldOn, today) > 0) return fail({ code: 'FUTURE_DATE' });
  }
  if (soldKm !== null && !isValidKm(soldKm)) return invalid('soldKm', 'I km devono essere un numero intero tra 0 e 2.000.000.');
  if (soldPrice !== null && (!Number.isInteger(soldPrice) || soldPrice < 0 || soldPrice > 100_000_000_000)) {
    return invalid('soldPriceCents', 'Il prezzo non è valido.');
  }
  try {
    await d.db.transaction(async (tx): Promise<void> => {
      const row = await selectVehicle(tx, vehicleId);
      if (!row) throw new AbortTx(fail({ code: 'ITEM_NOT_FOUND' }));
      if (soldOn !== null && row.purchase_on !== null && compareDates(soldOn, row.purchase_on) < 0) {
        throw new AbortTx(invalid('soldOn', "La data di vendita è precedente a quella d'acquisto."));
      }
      await tx.run(
        `UPDATE vehicles SET status = ?, sold_on = ?, sold_km = ?, sold_price_cents = ?, updated_at = ? WHERE id = ?`,
        [status, soldOn, soldKm, soldPrice, d.clock.nowIso(), vehicleId],
      );
    }, 'exclusive');
  } catch (e) {
    return mapWriteError(e);
  }
  d.events.emit({ type: 'data-changed', scope: 'vehicles', vehicleId });
  return ok(await detailOf(d, (await selectVehicle(d.db, vehicleId))!));
}

/** Rimette in garage un'auto venduta, rottamata o archiviata (torna `active` e si cancellano i dati di vendita). */
export async function reactivateVehicle(d: Deps, vehicleId: string): Promise<UsecaseResult<VehicleDetail>> {
  const changed = await d.db.transaction(async (tx) => {
    const r = await tx.run(
      `UPDATE vehicles SET status = 'active', sold_on = NULL, sold_km = NULL, sold_price_cents = NULL, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [d.clock.nowIso(), vehicleId],
    );
    return r.changes;
  }, 'exclusive');
  if (changed === 0) return fail({ code: 'ITEM_NOT_FOUND' });
  d.events.emit({ type: 'data-changed', scope: 'vehicles', vehicleId });
  return ok(await detailOf(d, (await selectVehicle(d.db, vehicleId))!));
}

/** Giorno dopo il quale il cestino elimina definitivamente (data dell'eliminazione + giorni di permanenza). */
export const purgeDateOf = (deletedAtIso: string, retentionDays: number): string => addDays(deletedAtIso.slice(0, 10), retentionDays);

/**
 * Manda l'auto nel cestino (eliminazione recuperabile per `trash.retentionDays`, di norma 30 giorni). La conferma con
 * il nome dell'auto e' compito della UI. L'auto esce dal garage, dai promemoria e dalle notifiche; i suoi dati restano.
 */
export async function deleteVehicle(d: Deps, vehicleId: string): Promise<UsecaseResult<{ purgeOn: string }>> {
  const retention = await readSetting(d.db, 'trash.retentionDays');
  const now = d.clock.nowIso();
  const changed = await d.db.transaction(async (tx) => {
    const r = await tx.run('UPDATE vehicles SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, vehicleId]);
    return r.changes;
  }, 'exclusive');
  if (changed === 0) return fail({ code: 'ITEM_NOT_FOUND' });
  d.events.emit({ type: 'data-changed', scope: 'vehicles', vehicleId });
  return ok({ purgeOn: purgeDateOf(now, retention) });
}

/**
 * Ripristina un'auto dal cestino. Se nel frattempo un'altra auto usa la stessa targa torna `DUPLICATE_PLATE`
 * (stessa regola per il VIN, come errore di validazione sul campo `vin`).
 */
export async function restoreVehicle(d: Deps, vehicleId: string): Promise<UsecaseResult<VehicleDetail>> {
  try {
    await d.db.transaction(async (tx): Promise<void> => {
      const row = await selectVehicle(tx, vehicleId, true);
      if (!row || row.deleted_at === null) throw new AbortTx(fail({ code: 'ITEM_NOT_FOUND' }));
      if (await findDuplicate(tx, 'plate', row.plate, vehicleId)) throw new AbortTx(fail({ code: 'DUPLICATE_PLATE' }));
      if (await findDuplicate(tx, 'vin', row.vin, vehicleId)) throw new AbortTx(invalid('vin', DUP_VIN));
      await tx.run('UPDATE vehicles SET deleted_at = NULL, updated_at = ? WHERE id = ?', [d.clock.nowIso(), vehicleId]);
    }, 'exclusive');
  } catch (e) {
    return mapWriteError(e);
  }
  d.events.emit({ type: 'data-changed', scope: 'vehicles', vehicleId });
  return ok(await detailOf(d, (await selectVehicle(d.db, vehicleId))!));
}

/** Le auto nel cestino, dalla piu' recente, con il giorno dell'eliminazione definitiva. */
export async function listTrashedVehicles(d: Deps): Promise<TrashedVehicle[]> {
  const retention = await readSetting(d.db, 'trash.retentionDays');
  const today = d.clock.todayLocal();
  const rows = await d.db.all<{ id: string; nickname: string | null; make: string; model: string; plate: string | null; deleted_at: string }>(
    'SELECT id, nickname, make, model, plate, deleted_at FROM vehicles WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC',
  );
  return rows.map((r) => {
    const purgeOn = purgeDateOf(r.deleted_at, retention);
    return {
      id: r.id,
      displayName: r.nickname && r.nickname.trim() !== '' ? r.nickname : `${r.make} ${r.model}`,
      plate: r.plate,
      deletedAt: r.deleted_at,
      purgeOn,
      daysLeft: Math.max(0, diffDays(today, purgeOn)),
    };
  });
}

/**
 * «Elimina definitivamente»: cancella a cascata l'auto nel cestino, le sue righe e (per trigger) accoda i file da rimuovere;
 * dopo il commit i file si rimuovono subito (come `removeAttachment` permanente): libretto e polizze non restano nello
 * storage fino al prossimo avvio. Se la pulizia non riesce le voci restano in coda e si riprovano all'avvio.
 */
export async function purgeVehicle(d: FileDeps, vehicleId: string): Promise<UsecaseResult<void>> {
  const changed = await d.db.transaction(async (tx) => {
    const r = await tx.run('DELETE FROM vehicles WHERE id = ? AND deleted_at IS NOT NULL', [vehicleId]);
    return r.changes;
  }, 'exclusive');
  if (changed === 0) return fail({ code: 'ITEM_NOT_FOUND' });
  try {
    await runPendingFileDeletions(d);
  } catch {
    // le righe sono gia' sparite: la coda si svuota al prossimo avvio (runPendingFileDeletions)
  }
  d.events.emit({ type: 'data-changed', scope: 'vehicles', vehicleId });
  return ok(undefined);
}

/** Svuota le auto nel cestino da piu' di `trash.retentionDays` giorni. Da chiamare all'avvio. Restituisce quante ne ha eliminate. */
export async function purgeExpiredTrash(d: Deps): Promise<number> {
  const trashed = await listTrashedVehicles(d);
  const today = d.clock.todayLocal();
  const expired = trashed.filter((t) => compareDates(t.purgeOn, today) <= 0).map((t) => t.id);
  if (expired.length === 0) return 0;
  await d.db.transaction(async (tx) => {
    for (const id of expired) await tx.run('DELETE FROM vehicles WHERE id = ? AND deleted_at IS NOT NULL', [id]);
  }, 'exclusive');
  d.events.emit({ type: 'data-changed', scope: 'vehicles' });
  return expired.length;
}

/** Il garage (S-11): le auto non eliminate con ultimo km e stato, le attive per prime. */
export async function listVehicles(d: Pick<Deps, 'db'>, opts: ListVehiclesOptions = {}): Promise<VehicleSummary[]> {
  const rows = await d.db.all<VehicleRow>(
    `SELECT * FROM vehicles WHERE deleted_at IS NULL${opts.includeDemo === false ? ' AND is_demo = 0' : ''}
     ORDER BY (status = 'active') DESC, sort_order, created_at, id`,
  );
  const latest = await d.db.all<{ vehicle_id: string; read_on: string; km: number; source: OdometerSource }>(
    `SELECT o.vehicle_id, o.read_on, o.km, o.source FROM odometer_readings o
     WHERE o.status = 'valid' AND o.deleted_at IS NULL AND o.id = (
       SELECT o2.id FROM odometer_readings o2
       WHERE o2.vehicle_id = o.vehicle_id AND o2.status = 'valid' AND o2.deleted_at IS NULL
       ORDER BY o2.read_on DESC, o2.km DESC, o2.id DESC LIMIT 1)`,
  );
  const kmByVehicle = new Map<string, CurrentKm>(
    latest.map((r) => [r.vehicle_id, { km: r.km, readOn: r.read_on, source: r.source, sourceLabel: sourceLabelIt(r.source) }]),
  );
  const wanted = opts.statuses;
  return rows
    .map((r) => toVehicle(r))
    .filter((v) => wanted === undefined || wanted.includes(v.status))
    .map((v) => ({
      id: v.id,
      displayName: v.displayName,
      nickname: v.nickname,
      plate: v.plate,
      make: v.make,
      model: v.model,
      modelYear: v.modelYear,
      powertrain: v.powertrain,
      fuelPrimary: v.fuelPrimary,
      fuelSecondary: v.fuelSecondary,
      status: v.status,
      isActive: v.status === 'active',
      isDemo: v.isDemo,
      distanceUnit: v.distanceUnit,
      sortOrder: v.sortOrder,
      currentKm: kmByVehicle.get(v.id) ?? null,
    }));
}

/** La scheda di un'auto con i km attuali. Null se non esiste (o e' nel cestino, salvo `includeDeleted`). */
export async function getVehicle(
  d: Pick<Deps, 'db'>,
  vehicleId: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<VehicleDetail | null> {
  const row = await selectVehicle(d.db, vehicleId, opts.includeDeleted ?? false);
  return row ? detailOf(d, row) : null;
}
