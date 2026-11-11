// "Fatto" e "Annulla" (SPEC 3.2 F-25, data.md 3.7): completamento con data e km REALI che ricalcola il prossimo
// intervallo, in una sola transazione; annullamento esatto.
import { isValidDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/dates';
import { nextFixedDue, planCompletion, resolveLastDone } from '@/domain/maintenance';
import type { LastDone, ReasonCode, ReminderState } from '@/domain/maintenance';
import { isValidKm } from '@/domain/units';
import { invalid, fail } from '../context';
import type { Deps, UsecaseResult } from '../context';
import { abortNotFound, abortValidation, guard } from './internal';
import { previewItem, reconcileInTx, ruleOf } from './load';
import { doneReadingIdOf, doneReadingNote, loadReminder, registerKm, spawnNextOccurrence } from './reminders';
import { seriesOptionsOf } from './series';
import type { KmRegistration, ReminderRow } from './reminders';

export interface CompleteDeadlineInput {
  /** La voce di manutenzione da segnare "fatta" (anche se non ha un promemoria aperto: "Da configurare")... */
  itemId?: string;
  /** ...oppure il promemoria (generato da una voce, oppure manuale). Esattamente uno dei due. */
  reminderId?: string;
  /** Data REALE in cui e' stato fatto (non nel futuro). */
  doneOn: LocalDate;
  /** Km REALI (facoltativi): creano una lettura nel registro dei km e diventano la nuova base. */
  doneKm?: number | null;
  notes?: string | null;
  /**
   * Cosa fare se i km sono in conflitto con le letture vicine: `fail` (default: errore `ODO_NON_MONOTONIC`, la UI propone
   * "correggi / ignora i km / errore della lettura precedente") oppure `skip_km` (si completa senza km).
   */
  onOdometerConflict?: 'fail' | 'skip_km';
}

export interface DeadlineNext {
  state: ReminderState;
  effectiveDueOn: LocalDate | null;
  reasons: ReasonCode[];
}

export interface CompleteDeadlineResult {
  kind: 'item' | 'manual';
  /** Id del completamento (da passare a `undoCompletion`); null per i promemoria manuali. */
  completionId: string | null;
  itemId: string | null;
  /** Il promemoria passato a `done` (null se non ce n'era uno aperto o la base non e' cambiata). */
  closedReminderId: string | null;
  /** Il promemoria aperto dopo il completamento (il prossimo ciclo, o la prossima occorrenza di una ricorrenza). */
  nextReminderId: string | null;
  /** Lettura km creata dal "Fatto" (null se non c'erano km, esisteva gia' o sono stati ignorati). */
  odometerReadingId: string | null;
  /** I km erano in conflitto e sono stati ignorati (`onOdometerConflict: 'skip_km'`). */
  kmIgnored: boolean;
  /** Avvisi non bloccanti sui km (salto implausibile). */
  warnings: string[];
  /** Stato della voce dopo il completamento (solo per le voci). */
  next: DeadlineNext | null;
}

const sameLastDone = (a: LastDone | null, b: LastDone | null): boolean =>
  a === b || (a !== null && b !== null && a.on === b.on && (a.km ?? null) === (b.km ?? null));

type Tx = Parameters<Parameters<Deps['db']['transaction']>[0]>[0];

async function openReminderIdOfItem(tx: Tx, itemId: string): Promise<string | null> {
  const r = await tx.get<{ id: string }>(
    `SELECT id FROM reminders WHERE item_id = ? AND status = 'open' AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1`,
    [itemId],
  );
  return r?.id ?? null;
}

/**
 * Segna "Fatto" una voce o un promemoria, in UNA transazione (data.md 3.7):
 *  1. valida data e km (la stessa regola del trigger `ODO_NON_MONOTONIC`);
 *  2. crea la lettura km se ci sono i km;
 *  3. inserisce il completamento con `prev_fixed_due_on` (l'annulla ripristina esattamente quel valore);
 *  4. avanza la serie di calendario (bollo, gomme) o azzera la data fissa (bombola);
 *  5. chiude il promemoria aperto (`done`) se la base e' cambiata e riconcilia: il prossimo parte dai valori REALI;
 *  un completamento retrodatato (piu' vecchio dell'ultimo fatto) si registra ma non cambia la base ne' il promemoria.
 * Per un promemoria manuale ricorrente nasce la prossima occorrenza (dopo max(scadenza, oggi)).
 */
export async function completeDeadline(d: Deps, input: CompleteDeadlineInput): Promise<UsecaseResult<CompleteDeadlineResult>> {
  if (!!input.itemId === !!input.reminderId) return invalid('target', 'Indica la voce o il promemoria da completare.');
  if (!isValidDate(input.doneOn)) return invalid('doneOn', 'La data non è valida.');
  if (input.doneOn > d.clock.todayLocal()) return fail({ code: 'FUTURE_DATE' });
  if (input.doneKm != null && !isValidKm(input.doneKm)) {
    return invalid('doneKm', 'I km devono essere un numero intero tra 0 e 2.000.000.');
  }
  const notes = input.notes?.trim() ? input.notes.trim() : null;
  const onConflict = input.onOdometerConflict ?? 'fail';

  let vehicleId = '';
  const result = await guard(() =>
    d.db.transaction(async (tx): Promise<CompleteDeadlineResult> => {
      let itemId = input.itemId ?? null;
      let reminder: ReminderRow | undefined;
      if (input.reminderId) {
        reminder = await loadReminder(tx, input.reminderId);
        if (!reminder) return abortNotFound();
        if (reminder.status !== 'open') return abortValidation('reminderId', 'Questa scadenza è già chiusa.');
        if (reminder.origin === 'generated') {
          if (!reminder.item_id) {
            return abortValidation('reminderId', "Questa scadenza si chiude dall'assicurazione (rinnovo della polizza o rata pagata).");
          }
          itemId = reminder.item_id;
        }
      }

      const now = d.clock.nowIso();

      // ---- promemoria manuale
      if (!itemId && reminder) {
        vehicleId = reminder.vehicle_id;
        const km: KmRegistration = await registerKm(tx, d, {
          vehicleId: reminder.vehicle_id,
          doneOn: input.doneOn,
          km: input.doneKm ?? null,
          note: doneReadingNote(reminder.title),
          onConflict,
        });
        await tx.run(`UPDATE reminders SET status = 'done', completed_on = ?, updated_at = ? WHERE id = ?`, [input.doneOn, now, reminder.id]);
        const spawned = await spawnNextOccurrence(tx, d, reminder);
        await reconcileInTx(tx, d, reminder.vehicle_id);
        return {
          kind: 'manual',
          completionId: null,
          itemId: null,
          closedReminderId: reminder.id,
          nextReminderId: spawned,
          odometerReadingId: km.readingId,
          kmIgnored: km.ignored,
          warnings: km.warnings,
          next: null,
        };
      }

      // ---- voce di manutenzione
      const item = await tx.get<{
        id: string;
        vehicle_id: string;
        name: string;
        schedule_type: 'interval_last_done' | 'interval_calendar' | 'fixed_date';
        interval_km: number | null;
        interval_months: number | null;
        period_end: 'exact' | 'end_of_month';
        fixed_due_on: string | null;
        baseline_on: string | null;
        baseline_km: number | null;
        soon_days: number;
        soon_km: number;
      }>(
        `SELECT id, vehicle_id, name, schedule_type, interval_km, interval_months, period_end, fixed_due_on, baseline_on,
                baseline_km, soon_days, soon_km
         FROM maintenance_items WHERE id = ? AND deleted_at IS NULL`,
        [itemId as string],
      );
      if (!item) return abortNotFound();
      vehicleId = item.vehicle_id;

      const comps = (
        await tx.all<{ done_on: string; done_km: number | null }>(
          'SELECT done_on, done_km FROM maintenance_completions WHERE item_id = ? AND deleted_at IS NULL',
          [item.id],
        )
      ).map((c) => ({ doneOn: c.done_on, doneKm: c.done_km }));
      const baseline = { baselineOn: item.baseline_on, baselineKm: item.baseline_km };
      const before = resolveLastDone(comps, baseline);

      // la lettura km del "Fatto" ha un id derivato da quello del completamento: l'annulla la ritrova esattamente
      const completionId = d.ids.ulid();
      const km = await registerKm(tx, d, {
        vehicleId: item.vehicle_id,
        doneOn: input.doneOn,
        km: input.doneKm ?? null,
        note: doneReadingNote(item.name),
        onConflict,
        readingId: doneReadingIdOf(completionId),
        nowIso: now,
      });

      const series = await seriesOptionsOf(tx, item.id, item.fixed_due_on);
      const plan = planCompletion(ruleOf(item), input.doneOn, km.km, series);
      await tx.run(
        `INSERT INTO maintenance_completions (id, item_id, done_on, done_km, prev_fixed_due_on, source, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?)`,
        [completionId, item.id, input.doneOn, km.km, plan.prevFixedDueOn, notes, now, now],
      );
      if (plan.fixedDueOnChanged) {
        await tx.run('UPDATE maintenance_items SET fixed_due_on = ?, updated_at = ? WHERE id = ?', [plan.newFixedDueOn, now, item.id]);
      }

      const after = resolveLastDone([...comps, { doneOn: input.doneOn, doneKm: km.km }], baseline);
      const baseChanged = plan.fixedDueOnChanged || !sameLastDone(before, after);
      let closedReminderId: string | null = null;
      if (baseChanged) {
        closedReminderId = await openReminderIdOfItem(tx, item.id);
        if (closedReminderId) {
          await tx.run(
            `UPDATE reminders SET status = 'done', completed_on = ?, completion_id = ?, updated_at = ? WHERE id = ?`,
            [input.doneOn, completionId, now, closedReminderId],
          );
        }
      }

      const outcome = await reconcileInTx(tx, d, item.vehicle_id);
      const preview = outcome.input ? previewItem(outcome.input, item.id) : null;
      return {
        kind: 'item',
        completionId,
        itemId: item.id,
        closedReminderId,
        nextReminderId: await openReminderIdOfItem(tx, item.id),
        odometerReadingId: km.readingId,
        kmIgnored: km.ignored,
        warnings: km.warnings,
        next: preview
          ? { state: preview.evaluation.state, effectiveDueOn: preview.evaluation.effectiveDueOn, reasons: preview.evaluation.reasons }
          : null,
      };
    }, 'exclusive'),
  );
  if (!result.ok) return result;
  d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId });
  if (result.value.odometerReadingId) d.events.emit({ type: 'data-changed', scope: 'odometer', vehicleId });
  return result;
}

export interface UndoCompletionResult {
  itemId: string;
  /** Il promemoria riaperto (null se non ce n'era uno collegato). */
  reopenedReminderId: string | null;
  /** La lettura km creata dal "Fatto", rimossa (null se non c'era). */
  removedReadingId: string | null;
}

/** Nucleo dell'annullamento, dentro una transazione gia' aperta (lo usa anche `reopenReminder`). */
export async function undoCompletionInTx(tx: Tx, d: Deps, completionId: string): Promise<UndoCompletionResult & { vehicleId: string }> {
  const comp = await tx.get<{
    id: string;
    item_id: string;
    done_on: string;
    done_km: number | null;
    prev_fixed_due_on: string | null;
    vehicle_id: string;
    schedule_type: 'interval_last_done' | 'interval_calendar' | 'fixed_date';
    interval_km: number | null;
    interval_months: number | null;
    period_end: 'exact' | 'end_of_month';
    fixed_due_on: string | null;
    soon_days: number;
    soon_km: number;
  }>(
    `SELECT c.id, c.item_id, c.done_on, c.done_km, c.prev_fixed_due_on, i.vehicle_id, i.schedule_type,
            i.interval_km, i.interval_months, i.period_end, i.fixed_due_on, i.soon_days, i.soon_km
     FROM maintenance_completions c JOIN maintenance_items i ON i.id = c.item_id
     WHERE c.id = ? AND c.deleted_at IS NULL AND i.deleted_at IS NULL`,
    [completionId],
  );
  if (!comp) return abortNotFound();
  const now = d.clock.nowIso();

  const newest = await tx.get<{ id: string }>(
    'SELECT id FROM maintenance_completions WHERE item_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1',
    [comp.item_id],
  );
  const isNewest = newest?.id === comp.id;
  await tx.run('UPDATE maintenance_completions SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, comp.id]);

  // ripristino esatto della data di calendario, ma solo se nessuno l'ha cambiata dopo (ne' un altro completamento)
  if (isNewest && comp.schedule_type !== 'interval_last_done') {
    const rule = ruleOf({ ...comp, fixed_due_on: comp.prev_fixed_due_on });
    const expected = nextFixedDue(rule, comp.done_on, await seriesOptionsOf(tx, comp.item_id, comp.prev_fixed_due_on));
    if (comp.fixed_due_on === expected && expected !== comp.prev_fixed_due_on) {
      await tx.run('UPDATE maintenance_items SET fixed_due_on = ?, updated_at = ? WHERE id = ?', [comp.prev_fixed_due_on, now, comp.item_id]);
    }
  }

  // la lettura km creata da questo "Fatto": si ritrova dall'id derivato da quello del completamento (mai da note o istanti);
  // se l'utente l'ha corretta nel frattempo (data o km diversi) non e' piu' quella del "Fatto" e resta
  let removedReadingId: string | null = null;
  if (comp.done_km != null) {
    const reading = await tx.get<{ id: string }>(
      `SELECT id FROM odometer_readings
       WHERE id = ? AND vehicle_id = ? AND read_on = ? AND km = ? AND source = 'manual' AND deleted_at IS NULL`,
      [doneReadingIdOf(comp.id), comp.vehicle_id, comp.done_on, comp.done_km],
    );
    if (reading) {
      await tx.run('UPDATE odometer_readings SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, reading.id]);
      removedReadingId = reading.id;
    }
  }

  // riapre il promemoria chiuso da questo completamento (e toglie il "prossimo" che era nato)
  let reopenedReminderId: string | null = null;
  if (isNewest) {
    const closed = await tx.get<{ id: string }>(
      `SELECT id FROM reminders WHERE completion_id = ? AND status = 'done' AND deleted_at IS NULL`,
      [comp.id],
    );
    if (closed) {
      await tx.run(
        `UPDATE reminders SET deleted_at = ?, updated_at = ?
         WHERE item_id = ? AND status = 'open' AND deleted_at IS NULL AND id <> ?`,
        [now, now, comp.item_id, closed.id],
      );
      await tx.run(
        `UPDATE reminders SET status = 'open', completed_on = NULL, completion_id = NULL, updated_at = ? WHERE id = ?`,
        [now, closed.id],
      );
      reopenedReminderId = closed.id;
    }
  }
  await reconcileInTx(tx, d, comp.vehicle_id);
  return { itemId: comp.item_id, reopenedReminderId, removedReadingId, vehicleId: comp.vehicle_id };
}

/**
 * Annulla un completamento ESATTAMENTE (data.md 3.7): soft delete del completamento, ripristino di `fixed_due_on` da
 * `prev_fixed_due_on`, rimozione della lettura km che il "Fatto" aveva creato, riapertura del promemoria e riconciliazione
 * (il "prossimo" nato dal completamento sparisce). Se dopo questo "Fatto" ce n'e' stato un altro, si annulla solo
 * il completamento indicato (storico), senza riaprire il suo promemoria.
 */
export async function undoCompletion(d: Deps, completionId: string): Promise<UsecaseResult<UndoCompletionResult>> {
  const res = await guard(() => d.db.transaction((tx) => undoCompletionInTx(tx, d, completionId), 'exclusive'));
  if (!res.ok) return res;
  const { vehicleId, ...value } = res.value;
  d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId });
  if (value.removedReadingId) d.events.emit({ type: 'data-changed', scope: 'odometer', vehicleId });
  return { ok: true, value };
}
