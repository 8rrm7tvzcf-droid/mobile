// Rifornimenti (F-39, F-40; SPEC 6.3.8 S-22): aggiunta, modifica, eliminazione (cestino) e ripristino.
// Scritture in transazione con `tx`; la lettura km collegata passa dalla regola di coerenza del registro km;
// eventi 'data-changed' dopo il commit ('fuel' sempre, 'odometer' se il registro km e' cambiato).
import { defaultFuelType, fuelTypesForVehicle, unitForFuel, type FuelType } from '@/domain/fuel';
import { validateOdometerReading } from '@/domain/odometer';
import { formatInt } from '@/domain/units';
import type { SqlDatabase } from '@/domain/ports';
import { fail, ok, type Deps, type UsecaseResult } from '../context';
import { AbortTx, mapSqlError } from '../odometer/sqlErrors';
import { loadReadings } from '../odometer/store';
import {
  NO_KM,
  findLinkedReading,
  trashLinkedReading,
  upsertFuelReading,
  type KmLinkOutcome,
} from './odometerLink';
import {
  cleanText,
  consumptionViews,
  lastFuelTypeOf,
  loadConsumptionLogs,
  loadVehicleFuel,
  selectFuelRow,
  toEntry,
} from './store';
import type {
  AddFuelLogInput,
  AddFuelLogResult,
  DeleteFuelLogResult,
  FuelLogEntry,
  RestoreFuelLogResult,
  UpdateFuelLogInput,
  UpdateFuelLogResult,
} from './types';
import {
  completeNewAmounts,
  fuelNotOfVehicleWarning,
  mergeUpdatedAmounts,
  validateFuelFields,
  type PreparedFuel,
} from './validate';

const MAX_GRADE = 40;
const MAX_STATION = 80;
const MAX_NOTES = 1000;

/** Il rifornimento riletto dal DB con il suo consumo (calcolato sulla catena di tutti i rifornimenti del veicolo). */
export async function readFuelEntry(db: SqlDatabase, id: string): Promise<FuelLogEntry | null> {
  const row = await selectFuelRow(db, id);
  if (!row) return null;
  const views = consumptionViews(await loadConsumptionLogs(db, row.vehicle_id));
  return toEntry(row, row.is_full === 1 ? (views.get(row.id) ?? null) : null);
}

function emitChanges(d: Deps, vehicleId: string, odometerChanged: boolean): void {
  d.events.emit({ type: 'data-changed', scope: 'fuel', vehicleId });
  if (odometerChanged) d.events.emit({ type: 'data-changed', scope: 'odometer', vehicleId });
}

function mapWriteError(e: unknown): UsecaseResult<never> {
  if (e instanceof AbortTx) return e.result as UsecaseResult<never>;
  const mapped = mapSqlError(e);
  if (mapped) return fail(mapped);
  throw e;
}

interface WriteOutcome {
  result: AddFuelLogResult;
  vehicleId: string;
  odometerChanged: boolean;
}

function buildResult(entry: FuelLogEntry, prepared: PreparedFuel, link: KmLinkOutcome, extraWarnings: string[]): AddFuelLogResult {
  return {
    fuelLog: entry,
    consumption: entry.consumption,
    warnings: [...extraWarnings, ...prepared.warnings, ...link.warnings],
    computed: prepared.amounts.computed,
    expectedTotalCents: prepared.expectedTotalCents,
    odometerReadingId: entry.odometerReadingId,
    kmIgnored: link.skipped,
    ignoredReadingIds: link.ignoredReadingIds,
  };
}

/**
 * Aggiunge un rifornimento. Servono due valori tra quantita', prezzo unitario (millesimi) e totale (centesimi): il terzo si
 * calcola in interi. Con `km` crea la lettura collegata nel registro km (stessa coerenza di `addOdometerReading`:
 * `ODO_NON_MONOTONIC` con i dettagli per le tre scelte, oppure `onOdometerConflict`/`resolveConflicts`).
 * Il risultato contiene subito il consumo del tratto chiuso da questo pieno, se calcolabile.
 */
export async function addFuelLog(d: Deps, input: AddFuelLogInput): Promise<UsecaseResult<AddFuelLogResult>> {
  const filledOn = input.filledOn ?? d.clock.todayLocal();
  const km = input.km ?? null;
  try {
    const out = await d.db.transaction(async (tx): Promise<UsecaseResult<WriteOutcome>> => {
      const vehicle = await loadVehicleFuel(tx, input.vehicleId);
      if (!vehicle) return fail({ code: 'ITEM_NOT_FOUND' });
      const cfg = { fuelPrimary: vehicle.fuel_primary, fuelSecondary: vehicle.fuel_secondary };
      const fuelType: FuelType = input.fuelType ?? defaultFuelType(cfg, await lastFuelTypeOf(tx, vehicle.id));
      const amounts = completeNewAmounts({
        quantityMilli: input.quantityMilli ?? null,
        unitPriceMilli: input.unitPriceMilli ?? null,
        totalCents: input.totalCents ?? null,
      });
      if (!amounts.ok) return amounts;
      const prepared = validateFuelFields(
        { filledOn, fuelType, unit: input.quantityUnit ?? unitForFuel(fuelType), amounts: amounts.value, km },
        { today: d.clock.todayLocal(), tankCapacityMl: vehicle.tank_capacity_ml, isPrimaryFuel: fuelType === vehicle.fuel_primary },
      );
      if (!prepared.ok) return prepared;
      const a = prepared.value.amounts;
      const id = d.ids.ulid();
      const now = d.clock.nowIso();
      await tx.run(
        `INSERT INTO fuel_logs (id, vehicle_id, filled_on, fuel_type, grade, quantity_milli, quantity_unit, unit_price_milli,
                                total_cents, is_full, missed_before, station, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          vehicle.id,
          filledOn,
          fuelType,
          cleanText(input.grade, MAX_GRADE),
          a.quantityMilli,
          unitForFuel(fuelType),
          a.unitPriceMilli,
          a.totalCents,
          input.isFull === false ? 0 : 1,
          input.missedBefore ? 1 : 0,
          cleanText(input.station, MAX_STATION),
          cleanText(input.notes, MAX_NOTES),
          now,
          now,
        ],
      );
      let link: KmLinkOutcome = NO_KM;
      if (km !== null) {
        link = await upsertFuelReading(tx, d, {
          vehicleId: vehicle.id,
          fuelLogId: id,
          readOn: filledOn,
          km,
          existing: null,
          onConflict: input.onOdometerConflict ?? 'fail',
          resolveConflicts: input.resolveConflicts,
        });
      }
      const entry = (await readFuelEntry(tx, id))!;
      const extra = fuelNotOfVehicleWarning(fuelType, fuelTypesForVehicle(cfg));
      return ok({ result: buildResult(entry, prepared.value, link, extra ? [extra] : []), vehicleId: vehicle.id, odometerChanged: link.changed });
    }, 'exclusive');
    if (!out.ok) return out;
    emitChanges(d, out.value.vehicleId, out.value.odometerChanged);
    return ok(out.value.result);
  } catch (e) {
    return mapWriteError(e);
  }
}

/**
 * Modifica un rifornimento (campi non indicati = invariati). Quantita', prezzo e totale: quello non indicato si ricalcola.
 * `km`: nuovo valore, `null` per togliere i km (la lettura collegata va nel cestino), omesso = invariati. Se la data cambia
 * la lettura km collegata segue la nuova data (con la stessa verifica di coerenza).
 */
export async function updateFuelLog(d: Deps, id: string, patch: UpdateFuelLogInput): Promise<UsecaseResult<UpdateFuelLogResult>> {
  try {
    const out = await d.db.transaction(async (tx): Promise<UsecaseResult<WriteOutcome>> => {
      const row = await selectFuelRow(tx, id);
      if (!row) return fail({ code: 'ITEM_NOT_FOUND' });
      const vehicle = await loadVehicleFuel(tx, row.vehicle_id);
      if (!vehicle) return fail({ code: 'ITEM_NOT_FOUND' });
      const cfg = { fuelPrimary: vehicle.fuel_primary, fuelSecondary: vehicle.fuel_secondary };
      const filledOn = patch.filledOn ?? row.filled_on;
      const fuelType = patch.fuelType ?? row.fuel_type;
      const kmTouched = patch.km !== undefined;
      const newKm = kmTouched ? (patch.km ?? null) : row.km;
      const dateChanged = filledOn !== row.filled_on;

      const amounts = mergeUpdatedAmounts(
        { quantityMilli: row.quantity_milli, unitPriceMilli: row.unit_price_milli, totalCents: row.total_cents },
        patch,
      );
      if (!amounts.ok) return amounts;
      const prepared = validateFuelFields(
        { filledOn, fuelType, unit: patch.quantityUnit ?? unitForFuel(fuelType), amounts: amounts.value, km: newKm },
        { today: d.clock.todayLocal(), tankCapacityMl: vehicle.tank_capacity_ml, isPrimaryFuel: fuelType === vehicle.fuel_primary },
      );
      if (!prepared.ok) return prepared;
      const a = prepared.value.amounts;
      const now = d.clock.nowIso();
      await tx.run(
        `UPDATE fuel_logs SET filled_on = ?, fuel_type = ?, grade = ?, quantity_milli = ?, quantity_unit = ?, unit_price_milli = ?,
                total_cents = ?, is_full = ?, missed_before = ?, station = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
        [
          filledOn,
          fuelType,
          patch.grade !== undefined ? cleanText(patch.grade, MAX_GRADE) : row.grade,
          a.quantityMilli,
          unitForFuel(fuelType),
          a.unitPriceMilli,
          a.totalCents,
          patch.isFull !== undefined ? (patch.isFull ? 1 : 0) : row.is_full,
          patch.missedBefore !== undefined ? (patch.missedBefore ? 1 : 0) : row.missed_before,
          patch.station !== undefined ? cleanText(patch.station, MAX_STATION) : row.station,
          patch.notes !== undefined ? cleanText(patch.notes, MAX_NOTES) : row.notes,
          now,
          id,
        ],
      );

      let link: KmLinkOutcome = NO_KM;
      if (newKm === null) {
        if (kmTouched) link = { ...NO_KM, changed: await trashLinkedReading(tx, id, now) };
      } else if (kmTouched || dateChanged) {
        const existing = await findLinkedReading(tx, id);
        if (!kmTouched && row.reading_status === 'ignored' && existing) {
          // solo la data cambia e la lettura era messa da parte: la data la segue, senza rimetterla tra quelle valide
          await tx.run('UPDATE odometer_readings SET read_on = ?, updated_at = ? WHERE id = ?', [filledOn, now, existing.id]);
          link = { ...NO_KM, readingId: existing.id, changed: true };
        } else {
          link = await upsertFuelReading(tx, d, {
            vehicleId: vehicle.id,
            fuelLogId: id,
            readOn: filledOn,
            km: newKm,
            existing,
            onConflict: patch.onOdometerConflict ?? 'fail',
            resolveConflicts: patch.resolveConflicts,
          });
        }
      }
      const entry = (await readFuelEntry(tx, id))!;
      const extra = fuelNotOfVehicleWarning(fuelType, fuelTypesForVehicle(cfg));
      return ok({ result: buildResult(entry, prepared.value, link, extra ? [extra] : []), vehicleId: vehicle.id, odometerChanged: link.changed });
    }, 'exclusive');
    if (!out.ok) return out;
    emitChanges(d, out.value.vehicleId, out.value.odometerChanged);
    return ok(out.value.result);
  } catch (e) {
    return mapWriteError(e);
  }
}

/**
 * Elimina un rifornimento (cestino, ripristinabile con `restoreFuelLog`: e' l'«Annulla» del banner dopo il salvataggio).
 * La lettura km collegata segue il rifornimento nel cestino.
 */
export async function deleteFuelLog(d: Deps, id: string): Promise<UsecaseResult<DeleteFuelLogResult>> {
  const out = await d.db.transaction(async (tx): Promise<UsecaseResult<{ vehicleId: string; odometerChanged: boolean }>> => {
    const row = await tx.get<{ vehicle_id: string }>('SELECT vehicle_id FROM fuel_logs WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!row) return fail({ code: 'ITEM_NOT_FOUND' });
    const now = d.clock.nowIso();
    await tx.run('UPDATE fuel_logs SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
    const odometerChanged = await trashLinkedReading(tx, id, now);
    return ok({ vehicleId: row.vehicle_id, odometerChanged });
  }, 'exclusive');
  if (!out.ok) return out;
  emitChanges(d, out.value.vehicleId, out.value.odometerChanged);
  return ok({ id, vehicleId: out.value.vehicleId });
}

/**
 * Ripristina un rifornimento dal cestino con la sua lettura km. Se nel frattempo i km non sono piu' coerenti con le
 * letture registrate, il rifornimento torna senza km (`kmRestored: false`) e la lettura resta nel cestino.
 */
export async function restoreFuelLog(d: Deps, id: string): Promise<UsecaseResult<RestoreFuelLogResult>> {
  try {
    const out = await d.db.transaction(async (tx): Promise<UsecaseResult<{ value: RestoreFuelLogResult; odometerChanged: boolean }>> => {
      const row = await tx.get<{ vehicle_id: string; deleted_at: string | null }>(
        'SELECT vehicle_id, deleted_at FROM fuel_logs WHERE id = ?',
        [id],
      );
      if (!row || row.deleted_at === null) return fail({ code: 'ITEM_NOT_FOUND' });
      if (!(await loadVehicleFuel(tx, row.vehicle_id))) return fail({ code: 'ITEM_NOT_FOUND' });
      const now = d.clock.nowIso();
      await tx.run('UPDATE fuel_logs SET deleted_at = NULL, updated_at = ? WHERE id = ?', [now, id]);
      const warnings: string[] = [];
      let kmRestored = true;
      let odometerChanged = false;
      const link = await findLinkedReading(tx, id);
      // solo la lettura finita nel cestino CON il rifornimento (stesso istante di eliminazione) torna: quella che l'utente
      // aveva tolto a mano prima (km: null) resta nel cestino, cosi' l'«Annulla» riporta lo stato esatto di prima
      if (link?.deleted && link.deletedAt === row.deleted_at) {
        const r = (await tx.get<{ read_on: string; km: number; status: 'valid' | 'ignored' }>(
          'SELECT read_on, km, status FROM odometer_readings WHERE id = ?',
          [link.id],
        ))!;
        const v = validateOdometerReading(
          { id: link.id, readOn: r.read_on, km: r.km, status: r.status },
          await loadReadings(tx, row.vehicle_id),
          { today: '9999-12-31' }, // una lettura gia' registrata non diventa "futura": conta solo la coerenza
        );
        if (v.ok) {
          await tx.run('UPDATE odometer_readings SET deleted_at = NULL, updated_at = ? WHERE id = ?', [now, link.id]);
          odometerChanged = true;
        } else {
          kmRestored = false;
          warnings.push(
            `I ${formatInt(r.km)} km di questo rifornimento non sono più coerenti con le letture registrate nel frattempo: il rifornimento è tornato senza km.`,
          );
        }
      }
      const fuelLog = (await readFuelEntry(tx, id))!;
      return ok({ value: { fuelLog, kmRestored, warnings }, odometerChanged });
    }, 'exclusive');
    if (!out.ok) return out;
    emitChanges(d, out.value.value.fuelLog.vehicleId, out.value.odometerChanged);
    return ok(out.value.value);
  } catch (e) {
    return mapWriteError(e);
  }
}
