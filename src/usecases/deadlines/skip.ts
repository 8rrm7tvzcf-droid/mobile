// "Salta" e riapertura (SPEC 3.2 F-25, data.md 3.7): chiude un'occorrenza senza registrare un "fatto" e la riapre.
import { nextFixedDue, planCompletion } from '@/domain/maintenance';
import type { Deps, UsecaseResult } from '../context';
import { abortNotFound, abortValidation, guard } from './internal';
import { reconcileInTx, ruleOf } from './load';
import { dropSpawnedOccurrence, loadReminder, spawnNextOccurrence } from './reminders';
import { undoCompletionInTx } from './complete';
import { seriesOptionsOf } from './series';

interface ItemRule {
  id: string;
  schedule_type: 'interval_last_done' | 'interval_calendar' | 'fixed_date';
  interval_km: number | null;
  interval_months: number | null;
  period_end: 'exact' | 'end_of_month';
  fixed_due_on: string | null;
  soon_days: number;
  soon_km: number;
}

const ITEM_RULE_SQL =
  'SELECT id, schedule_type, interval_km, interval_months, period_end, fixed_due_on, soon_days, soon_km FROM maintenance_items WHERE id = ? AND deleted_at IS NULL';

export interface SkipDeadlineResult {
  reminderId: string;
  /** Il promemoria aperto che nasce dopo il salto (serie di calendario, ricorrenza manuale); null altrimenti. */
  nextReminderId: string | null;
}

/**
 * Salta l'occorrenza: il promemoria passa a `skipped` e la sua notifica non parte piu'. Non e' un "fatto" (nessun completamento).
 * Cosa succede alla regola dipende dal tipo: serie di calendario (bollo, gomme) -> la serie avanza alla data successiva;
 * data fissa (bombola) -> torna "Da configurare" finche' non si inserisce la nuova scadenza; "dall'ultimo fatto" -> la regola
 * non cambia e il promemoria non rinasce finche' non si registra un "fatto" o si modifica la regola (ciclo saltato).
 * Promemoria manuale ricorrente -> nasce la prossima occorrenza. Si riapre con `reopenReminder`.
 */
export async function skipDeadline(d: Deps, reminderId: string): Promise<UsecaseResult<SkipDeadlineResult>> {
  let vehicleId = '';
  const res = await guard(() =>
    d.db.transaction(async (tx): Promise<SkipDeadlineResult> => {
      const rem = await loadReminder(tx, reminderId);
      if (!rem) return abortNotFound();
      if (rem.status !== 'open') return abortValidation('reminderId', 'Questa scadenza è già chiusa.');
      vehicleId = rem.vehicle_id;
      const today = d.clock.todayLocal();
      const now = d.clock.nowIso();

      await tx.run(`UPDATE reminders SET status = 'skipped', completed_on = ?, updated_at = ? WHERE id = ?`, [today, now, rem.id]);
      let spawned: string | null = null;
      if (rem.origin === 'manual') {
        spawned = await spawnNextOccurrence(tx, d, rem);
      } else if (rem.item_id) {
        const item = await tx.get<ItemRule>(ITEM_RULE_SQL, [rem.item_id]);
        if (item) {
          const plan = planCompletion(ruleOf(item), today, null, await seriesOptionsOf(tx, item.id, item.fixed_due_on));
          if (plan.fixedDueOnChanged) {
            await tx.run('UPDATE maintenance_items SET fixed_due_on = ?, updated_at = ? WHERE id = ?', [plan.newFixedDueOn, now, item.id]);
          }
        }
      }
      await reconcileInTx(tx, d, rem.vehicle_id);
      if (rem.item_id) {
        const next = await tx.get<{ id: string }>(
          `SELECT id FROM reminders WHERE item_id = ? AND status = 'open' AND deleted_at IS NULL LIMIT 1`,
          [rem.item_id],
        );
        spawned = next?.id ?? null;
      }
      return { reminderId: rem.id, nextReminderId: spawned };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId });
  return res;
}

export interface ReopenReminderResult {
  reminderId: string;
}

/**
 * Annulla la chiusura di un promemoria: un "Salta" (rimette la serie di calendario dov'era), un "Fatto" di un promemoria
 * manuale (toglie la prossima occorrenza), oppure un "Fatto" di una voce (equivale a `undoCompletion`).
 * Non riapre i promemoria che si chiudono da soli (rata pagata, polizza rinnovata).
 */
export async function reopenReminder(d: Deps, reminderId: string): Promise<UsecaseResult<ReopenReminderResult>> {
  let vehicleId = '';
  const res = await guard(() =>
    d.db.transaction(async (tx): Promise<ReopenReminderResult> => {
      const rem = await loadReminder(tx, reminderId);
      if (!rem) return abortNotFound();
      vehicleId = rem.vehicle_id;
      if (rem.status === 'open') return abortValidation('reminderId', 'La scadenza è già aperta.');
      if (rem.completion_id) {
        await undoCompletionInTx(tx, d, rem.completion_id);
        return { reminderId: rem.id };
      }
      if (rem.origin === 'generated' && rem.status === 'done') {
        return abortValidation('reminderId', 'Questa scadenza si è chiusa da sola (rata pagata o polizza rinnovata).');
      }
      const now = d.clock.nowIso();
      if (rem.origin === 'manual') {
        await dropSpawnedOccurrence(tx, now, rem);
      } else {
        // un eventuale promemoria nato dopo il salto (prossimo ciclo) lascia il posto a questo
        const sourceCol = rem.item_id ? 'item_id' : rem.policy_id ? 'policy_id' : 'payment_id';
        const sourceId = rem.item_id ?? rem.policy_id ?? rem.payment_id;
        await tx.run(
          `UPDATE reminders SET deleted_at = ?, updated_at = ? WHERE ${sourceCol} = ? AND status = 'open' AND deleted_at IS NULL AND id <> ?`,
          [now, now, sourceId, rem.id],
        );
        if (rem.item_id) {
          const item = await tx.get<ItemRule>(ITEM_RULE_SQL, [rem.item_id]);
          if (item && item.schedule_type !== 'interval_last_done') {
            // ripristina la data solo se e' esattamente quella lasciata dal "Salta" (nessuna modifica dell'utente nel frattempo)
            const expected = nextFixedDue(
              ruleOf({ ...item, fixed_due_on: rem.due_on }),
              rem.completed_on ?? d.clock.todayLocal(),
              await seriesOptionsOf(tx, item.id, rem.due_on),
            );
            if (item.fixed_due_on === expected && expected !== rem.due_on) {
              await tx.run('UPDATE maintenance_items SET fixed_due_on = ?, updated_at = ? WHERE id = ?', [rem.due_on, now, item.id]);
            }
          }
        }
      }
      await tx.run(`UPDATE reminders SET status = 'open', completed_on = NULL, updated_at = ? WHERE id = ?`, [now, rem.id]);
      await reconcileInTx(tx, d, rem.vehicle_id);
      return { reminderId: rem.id };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId });
  return res;
}
