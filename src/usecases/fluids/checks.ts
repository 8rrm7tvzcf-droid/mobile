// Controllo livelli in 3 tocchi (F-44, SPEC 6.3.9): registra un controllo, collega i km e completa le voci di controllo;
// l'eliminazione annulla tutto esattamente, nella stessa transazione.
import { validateFluidCheck } from '@/domain/fluids';
import type { FluidIssue, FluidIssueCode } from '@/domain/fluids';
import { fail, invalid } from '../context';
import type { Deps, UsecaseResult } from '../context';
import { abortNotFound, guard } from '../deadlines/internal';
import { undoCompletionInTx } from '../deadlines/complete';
import { reconcileInTx } from '../deadlines/load';
import { vehicleExists } from '../odometer/store';
import { completeLinkedItems } from './completions';
import { getFluidStatusOf } from './queries';
import { cleanText, loadCheck, registerLinkedKm } from './store';
import type { AddFluidCheckInput, AddFluidCheckResult, DeleteFluidCheckResult } from './types';

export const MAX_PRODUCT_LENGTH = 80;
export const MAX_NOTES_LENGTH = 2000;

const FIELD_OF: Record<FluidIssueCode, string> = {
  INVALID_DATE: 'checkedOn',
  FUTURE_DATE: 'checkedOn',
  INVALID_FLUID: 'fluid',
  INVALID_LEVEL: 'level',
  INVALID_ADDED_AMOUNT: 'addedMl',
  ADDED_WITHOUT_TOP_UP: 'addedMl',
  INVALID_PRESSURE: 'valueMillibar',
  PRESSURE_ON_OTHER_FLUID: 'valueMillibar',
  INVALID_KM: 'km',
};

function issueResult(e: FluidIssue): UsecaseResult<never> {
  return e.code === 'FUTURE_DATE' ? fail({ code: 'FUTURE_DATE' }) : invalid(FIELD_OF[e.code], e.message);
}

/**
 * Registra un controllo livelli (fluido, esito, quantita' o pressione facoltative), in UNA transazione:
 *  1. valida con le regole del dominio (stessi limiti dei CHECK della tabella) e inserisce `fluid_checks`;
 *  2. se ci sono km crea la lettura collegata (`source = 'fluid_check'`) con la regola di coerenza monotona del registro km;
 *  3. completa le voci di controllo collegate (olio, pressione, refrigerante/lavavetri, AdBlue) con `source = 'check'`
 *     e `fluid_check_id` (qualunque esito: il controllo e' stato fatto; l'esito "basso" resta nello stato del fluido);
 *  4. riconcilia i promemoria del veicolo (il prossimo parte dal controllo appena fatto).
 * Dopo il commit emette `data-changed` con scope `service` (non esiste uno scope "fluids"), `reminders` e, se c'e' una
 * lettura km, `odometer`.
 */
export async function addFluidCheck(d: Deps, input: AddFluidCheckInput): Promise<UsecaseResult<AddFluidCheckResult>> {
  const today = d.clock.todayLocal();
  const checkedOn = input.checkedOn ?? today;
  const km = input.km ?? null;
  const addedMl = input.addedMl ?? null;
  const valueMillibar = input.valueMillibar ?? null;
  const v = validateFluidCheck({ checkedOn, fluid: input.fluid, level: input.level, addedMl, valueMillibar, km }, { today });
  if (!v.ok) return issueResult(v.errors[0] as FluidIssue);

  const product = cleanText(input.product, MAX_PRODUCT_LENGTH + 1);
  if (product !== null && input.level !== 'topped_up') return invalid('product', 'Il prodotto si indica solo se hai rabboccato.');
  if (product !== null && product.length > MAX_PRODUCT_LENGTH) {
    return invalid('product', `Il prodotto può avere al massimo ${MAX_PRODUCT_LENGTH} caratteri.`);
  }
  if (addedMl !== null && input.fluid === 'tyre_pressure') {
    return invalid('addedMl', 'Per i pneumatici si indica la pressione, non la quantità aggiunta.');
  }
  const notes = cleanText(input.notes, MAX_NOTES_LENGTH);

  const res = await guard(() =>
    d.db.transaction(async (tx) => {
      if (!(await vehicleExists(tx, input.vehicleId))) return abortNotFound();
      const now = d.clock.nowIso();
      const checkId = d.ids.ulid();
      await tx.run(
        `INSERT INTO fluid_checks (id, vehicle_id, checked_on, fluid, level, added_ml, value_millibar, product, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [checkId, input.vehicleId, checkedOn, input.fluid, input.level, addedMl, valueMillibar, product, notes, now, now],
      );
      const linked = await registerLinkedKm(tx, d, {
        vehicleId: input.vehicleId,
        checkId,
        checkedOn,
        km,
        onConflict: input.onOdometerConflict ?? 'fail',
      });
      const completions = await completeLinkedItems(tx, d, {
        vehicleId: input.vehicleId,
        checkId,
        fluid: input.fluid,
        checkedOn,
        km: linked.km,
      });
      const outcome = await reconcileInTx(tx, d, input.vehicleId);
      return { checkId, linked, completions, remindersChanged: outcome.changed };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  const { checkId, linked, completions, remindersChanged } = res.value;

  d.events.emit({ type: 'data-changed', scope: 'service', vehicleId: input.vehicleId });
  if (completions.length > 0 || remindersChanged) d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId: input.vehicleId });
  if (linked.readingId || linked.ignoredReadingIds.length > 0) {
    d.events.emit({ type: 'data-changed', scope: 'odometer', vehicleId: input.vehicleId });
  }

  const check = (await loadCheck(d.db, checkId)) as NonNullable<Awaited<ReturnType<typeof loadCheck>>>;
  return {
    ok: true,
    value: {
      check,
      completions,
      odometerReadingId: linked.readingId,
      kmIgnored: linked.ignored,
      ignoredReadingIds: linked.ignoredReadingIds,
      warnings: linked.warnings,
      status: await getFluidStatusOf(d, input.vehicleId, input.fluid),
    },
  };
}

/**
 * Elimina un controllo (cestino, soft delete) con annullamento ESATTO nella stessa transazione:
 *  - ogni completamento collegato (`fluid_check_id`) viene annullato come `undoCompletion` (ripristina `fixed_due_on`
 *    da `prev_fixed_due_on`, riapre il promemoria chiuso e toglie il "prossimo" nato dal completamento);
 *  - la lettura km collegata esce dal registro;
 *  - i promemoria vengono riconciliati.
 * Se dopo il controllo c'e' stato un altro "Fatto" della stessa voce si annulla solo il completamento del controllo (storico),
 * senza riaprire il promemoria. Le letture eventualmente messe da parte con `ignore-conflicting` restano messe da parte
 * (si ripristinano dal registro km).
 */
export async function deleteFluidCheck(d: Deps, checkId: string): Promise<UsecaseResult<DeleteFluidCheckResult>> {
  const res = await guard(() =>
    d.db.transaction(async (tx): Promise<DeleteFluidCheckResult> => {
      const check = await tx.get<{ id: string; vehicle_id: string }>(
        'SELECT id, vehicle_id FROM fluid_checks WHERE id = ? AND deleted_at IS NULL',
        [checkId],
      );
      if (!check) return abortNotFound();
      const now = d.clock.nowIso();

      const comps = await tx.all<{ id: string }>(
        'SELECT id FROM maintenance_completions WHERE fluid_check_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC',
        [check.id],
      );
      const undoneCompletionIds: string[] = [];
      const reopenedReminderIds: string[] = [];
      for (const c of comps) {
        const undone = await undoCompletionInTx(tx, d, c.id);
        undoneCompletionIds.push(c.id);
        if (undone.reopenedReminderId) reopenedReminderIds.push(undone.reopenedReminderId);
      }

      const reading = await tx.get<{ id: string }>(
        'SELECT id FROM odometer_readings WHERE fluid_check_id = ? AND deleted_at IS NULL',
        [check.id],
      );
      if (reading) await tx.run('UPDATE odometer_readings SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, reading.id]);
      await tx.run('UPDATE fluid_checks SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, check.id]);
      await reconcileInTx(tx, d, check.vehicle_id);
      return {
        checkId: check.id,
        vehicleId: check.vehicle_id,
        undoneCompletionIds,
        reopenedReminderIds,
        removedReadingId: reading?.id ?? null,
      };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  const v = res.value;
  d.events.emit({ type: 'data-changed', scope: 'service', vehicleId: v.vehicleId });
  if (v.undoneCompletionIds.length > 0) d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId: v.vehicleId });
  if (v.removedReadingId) d.events.emit({ type: 'data-changed', scope: 'odometer', vehicleId: v.vehicleId });
  return res;
}
