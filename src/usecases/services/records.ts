// Interventi e tagliandi, cambio olio (SPEC 3.3 F-35..F-37, 6.3.6, AC-06): comandi di scrittura.
// Ogni comando e' UNA transazione esclusiva: record, righe, lettura km collegata (stessa coerenza dell'odometro), completamenti
// delle voci scelte in "Cosa hai fatto?" e riconciliazione dei promemoria. Gli eventi partono dopo il commit.
import { addMonths } from '@/domain/dates';
import { INSPECTION_RULES } from '@/domain/italy';
import { formatDateIt } from '@/domain/units';
import type { LocalDate } from '@/domain/ports';
import { ok } from '../context';
import type { Deps, UsecaseResult } from '../context';
import { reconcileInTx } from '../deadlines/load';
import { reconcileAndDescribe, loadUsableItems, syncServiceCompletions, undoServiceCompletion } from './completions';
import { Abort, abortNotFound, abortValidation, guard, type Tx } from './internal';
import { applyServiceKm } from './odometerLink';
import type { KmOutcome } from './odometerLink';
import { computeSuggestions } from './suggest';
import {
  loadActiveCompletions,
  loadDetail,
  loadLineRows,
  loadLinkedReading,
  loadRecordRow,
  loadVehicleBasics,
} from './store';
import type { LineRow, RecordRow } from './store';
import { normalizeFields } from './validate';
import type { NormalizedFields, NormalizedLine } from './validate';
import { upsertWorkshopInTx } from './workshops';
import type { LineLike, ServiceLike } from './classify';
import type {
  AddServiceRecordInput,
  AddServiceRecordResult,
  DeleteServiceRecordResult,
  KmConflictChoice,
  RestoreServiceRecordResult,
  ServiceLineInput,
  ServiceRecordFields,
  SetServiceCompletionsResult,
  UpdateServiceRecordPatch,
  UpdateServiceRecordResult,
  WorkshopInput,
} from './types';

/** Titolo del promemoria creato dalla revisione con esito "da ripetere" (serve a ritrovarlo se l'intervento cambia o si elimina). */
export const REPEAT_REMINDER_TITLE = 'Rifare la revisione';

// ---------------------------------------------------------------- piccole parti condivise

async function resolveWorkshop(
  tx: Tx,
  d: Deps,
  workshopId: string | null | undefined,
  newWorkshop: WorkshopInput | null | undefined,
  current: string | null = null,
): Promise<string | null> {
  if (newWorkshop) return upsertWorkshopInTx(tx, d, newWorkshop);
  if (!workshopId) return null;
  if (workshopId === current) return workshopId;
  const w = await tx.get<{ id: string }>('SELECT id FROM workshops WHERE id = ? AND deleted_at IS NULL', [workshopId]);
  if (!w) return abortValidation('workshopId', "L'officina non esiste più.");
  return workshopId;
}

async function insertLines(tx: Tx, d: Deps, recordId: string, lines: readonly NormalizedLine[], now: string): Promise<void> {
  let position = 0;
  for (const l of lines) {
    await tx.run(
      `INSERT INTO service_lines (id, service_record_id, position, line_type, description, quantity_milli, unit_price_cents, amount_cents,
                                  part_code, brand, spec, fluid_kind, warranty_months, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.ids.ulid(), recordId, position++, l.lineType, l.description, l.quantityMilli, l.unitPriceCents, l.amountCents,
        l.partCode, l.brand, l.spec, l.fluidKind, l.warrantyMonths, now, now,
      ],
    );
  }
}

const rowToInput = (l: LineRow): ServiceLineInput => ({
  lineType: l.line_type,
  description: l.description,
  quantityMilli: l.quantity_milli,
  unitPriceCents: l.unit_price_cents,
  amountCents: l.amount_cents,
  partCode: l.part_code,
  brand: l.brand,
  spec: l.spec,
  fluidKind: l.fluid_kind,
  warrantyMonths: l.warranty_months,
});

/**
 * Le voci da completare: quelle scelte (`completeItemIds`), `'suggested'` = le pre-selezionate, piu' quelle indicate riga per riga.
 * `null` = "lascia le voci attuali" (solo in modifica, senza nuove scelte). Le voci esplicite devono essere attive e dello stesso veicolo.
 */
async function resolveDesired(
  tx: Tx,
  p: {
    choice: readonly string[] | 'suggested' | undefined;
    lineItemIds: readonly string[];
    vehicleId: string;
    like: ServiceLike;
    serviceOn: LocalDate;
    recordId: string | null;
    keepWhenUnspecified: boolean;
  },
): Promise<string[] | null> {
  const explicit = p.choice && p.choice !== 'suggested' ? [...p.choice] : [];
  let ids: string[];
  if (p.choice === 'suggested') {
    const sug = await computeSuggestions(tx, p.vehicleId, p.like, { serviceOn: p.serviceOn, excludeRecordId: p.recordId });
    ids = sug.filter((s) => s.preselected).map((s) => s.itemId);
  } else if (p.choice) {
    ids = explicit;
  } else if (p.keepWhenUnspecified) {
    if (p.lineItemIds.length === 0) return null;
    ids = p.recordId ? (await loadActiveCompletions(tx, p.recordId)).map((c) => c.item_id) : [];
  } else {
    ids = [];
  }
  const mustExist = [...new Set([...explicit, ...p.lineItemIds])];
  if (mustExist.length > 0) {
    const usable = await loadUsableItems(tx, p.vehicleId, mustExist);
    if (usable.size !== mustExist.length) {
      return abortValidation('completeItemIds', 'Una delle voci scelte non esiste più, non è attiva o appartiene a un altro veicolo.');
    }
  }
  return [...new Set([...ids, ...p.lineItemIds])];
}

async function findRepeatReminder(tx: Tx, vehicleId: string, serviceOn: LocalDate): Promise<string | null> {
  const r = await tx.get<{ id: string }>(
    `SELECT id FROM reminders WHERE vehicle_id = ? AND origin = 'manual' AND title = ? AND due_on = ? AND status = 'open' AND deleted_at IS NULL
     ORDER BY created_at, id LIMIT 1`,
    [vehicleId, REPEAT_REMINDER_TITLE, addMonths(serviceOn, INSPECTION_RULES.repeat.params.withinMonths)],
  );
  return r?.id ?? null;
}

/** "Rifare la revisione" entro un mese di calendario dalla revisione con esito "da ripetere" (SPEC 6.3.6 punto 4). */
async function insertRepeatReminder(tx: Tx, d: Deps, vehicleId: string, serviceOn: LocalDate): Promise<string> {
  const id = d.ids.ulid();
  const now = d.clock.nowIso();
  await tx.run(
    `INSERT INTO reminders (id, vehicle_id, origin, title, notes, category, due_on, soon_days, soon_km, notify_offsets_days, status, created_at, updated_at)
     VALUES (?, ?, 'manual', ?, ?, 'legal', ?, 14, 0, '[7,3,0]', 'open', ?, ?)`,
    [
      id,
      vehicleId,
      REPEAT_REMINDER_TITLE,
      `Esito «da ripetere» della revisione del ${formatDateIt(serviceOn)}: dopo le riparazioni va rifatta entro un mese.`,
      addMonths(serviceOn, INSPECTION_RULES.repeat.params.withinMonths),
      now,
      now,
    ],
  );
  return id;
}

async function dropRepeatReminder(tx: Tx, d: Deps, vehicleId: string, serviceOn: LocalDate): Promise<boolean> {
  const id = await findRepeatReminder(tx, vehicleId, serviceOn);
  if (!id) return false;
  const now = d.clock.nowIso();
  await tx.run('UPDATE reminders SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
  return true;
}

function emitChanges(d: Deps, vehicleId: string, e: { odometer: boolean; reminders: boolean }): void {
  d.events.emit({ type: 'data-changed', scope: 'service', vehicleId });
  if (e.reminders) d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId });
  if (e.odometer) d.events.emit({ type: 'data-changed', scope: 'odometer', vehicleId });
}

/** Esito di una transazione di salvataggio: il risultato per il chiamante e cosa e' cambiato (per gli eventi). */
interface SaveResult {
  result: AddServiceRecordResult;
  flags: { odometer: boolean; reminders: boolean };
  vehicleId: string;
}

const likeOf = (n: NormalizedFields, lines: readonly LineLike[]): ServiceLike => ({
  kind: n.kind,
  title: n.title,
  inspectionResult: n.inspectionResult,
  lines,
});

// ---------------------------------------------------------------- aggiungi

/**
 * Registra un intervento (S-20): data, km, officina, tipo, costo totale e righe, e le voci che completa ("Cosa hai fatto?").
 * In UNA transazione: record, righe, lettura km collegata (`source = 'service'`, con la regola di coerenza dell'odometro),
 * completamenti `source = 'service'` delle voci scelte (il prossimo intervallo parte da data e km REALI) e, per la revisione
 * "da ripetere", il promemoria "Rifare la revisione" entro un mese. Il totale sta sul record: le righe sono dettaglio
 * (nessun doppione nei costi, vista `v_costs`).
 *
 * Errori: `VALIDATION` (campo + messaggio), `FUTURE_DATE`, `ITEM_NOT_FOUND` (auto), `ODO_NON_MONOTONIC` con i dettagli per la
 * finestra a tre scelte (`isOdometerConflict`; scelta con `onOdometerConflict`).
 */
export async function addServiceRecord(d: Deps, input: AddServiceRecordInput): Promise<UsecaseResult<AddServiceRecordResult>> {
  const checked = normalizeFields(input, d.clock.todayLocal());
  if (!checked.ok) return checked;
  const n = checked.value;
  const onConflict: KmConflictChoice = input.onOdometerConflict ?? 'fail';

  const res = await guard(() =>
    d.db.transaction(async (tx): Promise<SaveResult> => {
      const vehicle = await loadVehicleBasics(tx, input.vehicleId);
      if (!vehicle) return abortNotFound();
      const workshopId = await resolveWorkshop(tx, d, input.workshopId, input.newWorkshop);
      const lines = n.lines ?? [];
      const desired = await resolveDesired(tx, {
        choice: input.completeItemIds,
        lineItemIds: n.lineItemIds,
        vehicleId: input.vehicleId,
        like: likeOf(n, lines),
        serviceOn: n.serviceOn,
        recordId: null,
        keepWhenUnspecified: false,
      });

      const now = d.clock.nowIso();
      const id = d.ids.ulid();
      await tx.run(
        `INSERT INTO service_records (id, vehicle_id, service_on, kind, title, workshop_id, total_cents, invoice_number, paid_on,
                                      warranty_until_on, inspection_result, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.vehicleId, n.serviceOn, n.kind, n.title, workshopId, n.totalCents, n.invoiceNumber, n.paidOn, n.warrantyUntilOn, n.inspectionResult, n.notes, now, now],
      );
      await insertLines(tx, d, id, lines, now);
      const km = await applyServiceKm(tx, d, { recordId: id, vehicleId: input.vehicleId, serviceOn: n.serviceOn, km: n.km, onConflict });
      const sync = await syncServiceCompletions(tx, d, {
        recordId: id, vehicleId: input.vehicleId, serviceOn: n.serviceOn, doneKm: km.km, desired: desired ?? [], stamp: now,
      });
      const repeatReminderId = n.inspectionResult === 'repeat' ? await insertRepeatReminder(tx, d, input.vehicleId, n.serviceOn) : null;
      const completions = await reconcileAndDescribe(tx, d, { recordId: id, vehicleId: input.vehicleId, unit: vehicle.distance_unit, createdIds: sync.createdIds });
      return {
        result: {
          record: (await loadDetail(tx, id, { completions }))!,
          completions,
          odometerReadingId: km.readingId,
          kmIgnored: km.kmIgnored,
          ignoredReadingIds: km.ignoredReadingIds,
          warnings: [...n.warnings, ...km.warnings, ...sync.warnings],
          repeatReminderId,
        },
        flags: { odometer: km.changed, reminders: sync.createdIds.size > 0 || repeatReminderId !== null },
        vehicleId: input.vehicleId,
      };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  emitChanges(d, res.value.vehicleId, res.value.flags);
  return ok(res.value.result);
}

// ---------------------------------------------------------------- modifica

/**
 * Modifica un intervento. I campi `undefined` restano; `lines` sostituisce tutte le righe; `completeItemIds` sostituisce
 * l'insieme delle voci completate. Se cambiano data o km i completamenti si annullano ESATTAMENTE e si ricreano coi valori
 * nuovi (i prossimi intervalli ripartono da li'); quelli invariati non si toccano. La lettura km collegata si crea, corregge
 * o toglie (km `null`) con la stessa coerenza dell'aggiunta.
 */
export async function updateServiceRecord(d: Deps, recordId: string, patch: UpdateServiceRecordPatch): Promise<UsecaseResult<UpdateServiceRecordResult>> {
  const onConflict: KmConflictChoice = patch.onOdometerConflict ?? 'fail';
  const res = await guard(() =>
    d.db.transaction(async (tx): Promise<SaveResult> => {
      const row = await loadRecordRow(tx, recordId);
      if (!row) return abortNotFound();
      const vehicle = await loadVehicleBasics(tx, row.vehicle_id);
      if (!vehicle) return abortNotFound();
      const reading = await loadLinkedReading(tx, recordId);
      const activeKm = reading && reading.deleted_at === null ? reading.km : null;
      const oldLines = await loadLineRows(tx, recordId);

      const kind = patch.kind ?? row.kind;
      const merged: ServiceRecordFields = {
        serviceOn: patch.serviceOn ?? row.service_on,
        kind,
        title: patch.title !== undefined ? patch.title : row.title,
        km: patch.km !== undefined ? patch.km : activeKm,
        workshopId: patch.workshopId !== undefined ? patch.workshopId : row.workshop_id,
        totalCents: patch.totalCents !== undefined ? patch.totalCents : row.total_cents,
        invoiceNumber: patch.invoiceNumber !== undefined ? patch.invoiceNumber : row.invoice_number,
        paidOn: patch.paidOn !== undefined ? patch.paidOn : row.paid_on,
        warrantyUntilOn: patch.warrantyUntilOn !== undefined ? patch.warrantyUntilOn : row.warranty_until_on,
        notes: patch.notes !== undefined ? patch.notes : row.notes,
        inspectionResult: patch.inspectionResult !== undefined ? patch.inspectionResult : kind === 'inspection' ? row.inspection_result : null,
        lines: patch.lines !== undefined ? patch.lines : patch.oilChange ? oldLines.map(rowToInput) : undefined,
        oilChange: patch.oilChange,
      };
      const checked = normalizeFields(merged, d.clock.todayLocal());
      if (!checked.ok) throw new Abort(checked.error);
      const n = checked.value;

      const workshopId =
        patch.newWorkshop || patch.workshopId !== undefined
          ? await resolveWorkshop(tx, d, patch.workshopId, patch.newWorkshop, row.workshop_id)
          : row.workshop_id;
      const effectiveLines = n.lines ?? oldLines.map((l) => ({ lineType: l.line_type, fluidKind: l.fluid_kind, description: l.description }));
      const desired = await resolveDesired(tx, {
        choice: patch.completeItemIds,
        lineItemIds: n.lineItemIds,
        vehicleId: row.vehicle_id,
        like: likeOf(n, effectiveLines),
        serviceOn: n.serviceOn,
        recordId,
        keepWhenUnspecified: true,
      });

      const now = d.clock.nowIso();
      await tx.run(
        `UPDATE service_records SET service_on = ?, kind = ?, title = ?, workshop_id = ?, total_cents = ?, invoice_number = ?, paid_on = ?,
                warranty_until_on = ?, inspection_result = ?, notes = ?, updated_at = ? WHERE id = ?`,
        [n.serviceOn, n.kind, n.title, workshopId, n.totalCents, n.invoiceNumber, n.paidOn, n.warrantyUntilOn, n.inspectionResult, n.notes, now, recordId],
      );
      if (n.lines) {
        await tx.run('DELETE FROM service_lines WHERE service_record_id = ?', [recordId]);
        await insertLines(tx, d, recordId, n.lines, now);
      }
      const km = await applyServiceKm(tx, d, { recordId, vehicleId: row.vehicle_id, serviceOn: n.serviceOn, km: n.km, onConflict });
      const sync = await syncServiceCompletions(tx, d, {
        recordId, vehicleId: row.vehicle_id, serviceOn: n.serviceOn, doneKm: km.km, desired, stamp: now,
      });

      const oldRepeat = row.kind === 'inspection' && row.inspection_result === 'repeat';
      const newRepeat = n.inspectionResult === 'repeat';
      const unchangedRepeat = oldRepeat && newRepeat && row.service_on === n.serviceOn;
      let repeatReminderId: string | null = null;
      let repeatChanged = false;
      if (unchangedRepeat) {
        repeatReminderId = await findRepeatReminder(tx, row.vehicle_id, n.serviceOn);
      } else {
        if (oldRepeat) repeatChanged = await dropRepeatReminder(tx, d, row.vehicle_id, row.service_on);
        if (newRepeat) {
          repeatReminderId = await insertRepeatReminder(tx, d, row.vehicle_id, n.serviceOn);
          repeatChanged = true;
        }
      }

      const completions = await reconcileAndDescribe(tx, d, { recordId, vehicleId: row.vehicle_id, unit: vehicle.distance_unit, createdIds: sync.createdIds });
      return {
        result: {
          record: (await loadDetail(tx, recordId, { completions }))!,
          completions,
          odometerReadingId: km.readingId,
          kmIgnored: km.kmIgnored,
          ignoredReadingIds: km.ignoredReadingIds,
          warnings: [...n.warnings, ...km.warnings, ...sync.warnings],
          repeatReminderId,
        },
        flags: { odometer: km.changed, reminders: sync.createdIds.size > 0 || sync.removed.length > 0 || repeatChanged },
        vehicleId: row.vehicle_id,
      };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  emitChanges(d, res.value.vehicleId, res.value.flags);
  return ok(res.value.result);
}

// ---------------------------------------------------------------- "Cosa hai fatto?" dopo il salvataggio

/**
 * "Cosa hai fatto?" (S-21) dopo aver salvato l'intervento: porta le voci completate a `itemIds` (`'suggested'` = le
 * pre-selezionate). Le voci tolte si annullano ESATTAMENTE, quelle aggiunte partono da data e km reali dell'intervento.
 */
export async function setServiceCompletions(
  d: Deps,
  recordId: string,
  itemIds: readonly string[] | 'suggested',
): Promise<UsecaseResult<SetServiceCompletionsResult>> {
  const res = await guard(() =>
    d.db.transaction(async (tx) => {
      const row = await loadRecordRow(tx, recordId);
      if (!row) return abortNotFound();
      const vehicle = await loadVehicleBasics(tx, row.vehicle_id);
      if (!vehicle) return abortNotFound();
      const reading = await loadLinkedReading(tx, recordId);
      const doneKm = reading && reading.deleted_at === null ? reading.km : null;
      const lines = (await loadLineRows(tx, recordId)).map((l) => ({ lineType: l.line_type, fluidKind: l.fluid_kind, description: l.description }));
      const desired = await resolveDesired(tx, {
        choice: itemIds,
        lineItemIds: [],
        vehicleId: row.vehicle_id,
        like: { kind: row.kind, title: row.title, inspectionResult: row.inspection_result, lines },
        serviceOn: row.service_on,
        recordId,
        keepWhenUnspecified: false,
      });
      const now = d.clock.nowIso();
      const sync = await syncServiceCompletions(tx, d, {
        recordId, vehicleId: row.vehicle_id, serviceOn: row.service_on, doneKm, desired: desired ?? [], stamp: now,
      });
      const completions = await reconcileAndDescribe(tx, d, { recordId, vehicleId: row.vehicle_id, unit: vehicle.distance_unit, createdIds: sync.createdIds });
      return {
        value: { completions, removedCompletionIds: sync.removed.map((r) => r.completionId), warnings: sync.warnings } satisfies SetServiceCompletionsResult,
        vehicleId: row.vehicle_id,
        changed: sync.createdIds.size > 0 || sync.removed.length > 0,
      };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  if (res.value.changed) emitChanges(d, res.value.vehicleId, { odometer: false, reminders: true });
  return ok(res.value.value);
}

// ---------------------------------------------------------------- elimina e ripristina

/**
 * Elimina un intervento (cestino, SPEC 6.3.6 punto 6): in UNA transazione annulla ESATTAMENTE i completamenti collegati
 * (ripristina le date fisse, riapre i promemoria, il prossimo torna a quello di prima), mette nel cestino la lettura km
 * collegata e toglie il promemoria "Rifare la revisione" nato dall'esito "da ripetere". I costi escono da `v_costs`.
 */
export async function deleteServiceRecord(d: Deps, recordId: string): Promise<UsecaseResult<DeleteServiceRecordResult>> {
  const res = await guard(() =>
    d.db.transaction(async (tx) => {
      const row = await loadRecordRow(tx, recordId);
      if (!row) return abortNotFound();
      const now = d.clock.nowIso();
      const removedCompletionIds: string[] = [];
      const reopenedReminderIds: string[] = [];
      for (const c of await loadActiveCompletions(tx, recordId)) {
        const r = await undoServiceCompletion(tx, d, c.id, now);
        removedCompletionIds.push(c.id);
        if (r.reopenedReminderId) reopenedReminderIds.push(r.reopenedReminderId);
      }
      if (row.kind === 'inspection' && row.inspection_result === 'repeat') await dropRepeatReminder(tx, d, row.vehicle_id, row.service_on);
      await tx.run('UPDATE service_records SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, recordId]);
      const reading = await loadLinkedReading(tx, recordId);
      let removedReadingId: string | null = null;
      if (reading && reading.deleted_at === null) {
        await tx.run('UPDATE odometer_readings SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, reading.id]);
        removedReadingId = reading.id;
      }
      await reconcileInTx(tx, d, row.vehicle_id);
      return { value: { removedCompletionIds, reopenedReminderIds, removedReadingId } satisfies DeleteServiceRecordResult, vehicleId: row.vehicle_id };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  const v = res.value.value;
  emitChanges(d, res.value.vehicleId, { odometer: v.removedReadingId !== null, reminders: v.removedCompletionIds.length > 0 });
  return ok(v);
}

/**
 * Ripristina un intervento dal cestino: torna il record, la lettura km collegata (con la regola di coerenza: `onOdometerConflict`)
 * e i completamenti che l'eliminazione aveva annullato, ricalcolati da data e km dell'intervento. Le voci nel frattempo
 * eliminate o disattivate non si ricompletano (`skippedItemIds`). `ITEM_NOT_FOUND` se l'intervento non e' nel cestino.
 */
export async function restoreServiceRecord(
  d: Deps,
  recordId: string,
  opts: { onOdometerConflict?: KmConflictChoice } = {},
): Promise<UsecaseResult<RestoreServiceRecordResult>> {
  const onConflict: KmConflictChoice = opts.onOdometerConflict ?? 'fail';
  const res = await guard(() =>
    d.db.transaction(async (tx) => {
      const row: RecordRow | undefined = await loadRecordRow(tx, recordId, true);
      if (!row || row.deleted_at === null) return abortNotFound();
      const vehicle = await loadVehicleBasics(tx, row.vehicle_id);
      if (!vehicle) return abortNotFound();
      const stamp = row.deleted_at;
      const tomb = await tx.all<{ item_id: string }>(
        'SELECT DISTINCT item_id FROM maintenance_completions WHERE service_record_id = ? AND deleted_at = ?',
        [recordId, stamp],
      );
      const reading = await loadLinkedReading(tx, recordId);
      const readingKm = reading && reading.deleted_at === stamp ? reading.km : null;

      const now = d.clock.nowIso();
      await tx.run('UPDATE service_records SET deleted_at = NULL, updated_at = ? WHERE id = ?', [now, recordId]);
      const km: KmOutcome =
        readingKm !== null
          ? await applyServiceKm(tx, d, { recordId, vehicleId: row.vehicle_id, serviceOn: row.service_on, km: readingKm, onConflict })
          : { readingId: null, km: null, kmIgnored: false, ignoredReadingIds: [], warnings: [], changed: false };
      const sync = await syncServiceCompletions(tx, d, {
        recordId, vehicleId: row.vehicle_id, serviceOn: row.service_on, doneKm: km.km, desired: tomb.map((t) => t.item_id), stamp: now,
      });
      if (row.kind === 'inspection' && row.inspection_result === 'repeat' && !(await findRepeatReminder(tx, row.vehicle_id, row.service_on))) {
        await insertRepeatReminder(tx, d, row.vehicle_id, row.service_on);
      }
      const completions = await reconcileAndDescribe(tx, d, { recordId, vehicleId: row.vehicle_id, unit: vehicle.distance_unit, createdIds: sync.createdIds });
      const value: RestoreServiceRecordResult = {
        record: (await loadDetail(tx, recordId, { completions }))!,
        completions,
        restoredReadingId: km.readingId,
        kmIgnored: km.kmIgnored,
        skippedItemIds: sync.skippedItemIds,
        warnings: [...km.warnings, ...sync.warnings],
      };
      return { value, vehicleId: row.vehicle_id, odometer: km.changed };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  emitChanges(d, res.value.vehicleId, { odometer: res.value.odometer, reminders: true });
  return ok(res.value.value);
}

