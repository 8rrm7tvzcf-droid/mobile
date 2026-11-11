// Wizard "Imposta le scadenze" (SPEC 3.2 F-20, 6.3.3; data.md 1.5 "Istanziazione dei template"): crea le voci di
// manutenzione dai template del catalogo con le risposte dell'utente. Una transazione; poi riconcilia i promemoria.
import type { LocalDate } from '@/domain/dates';
import type { UnknownReason } from '@/domain/italy';
import type { ItemCategory, ReasonCode, ReminderState, ScheduleType } from '@/domain/maintenance';
import type { Deps, UsecaseResult } from '../context';
import { Abort, abortValidation, guard } from './internal';
import { previewItem, reconcileInTx } from './load';
import { effectiveIntervals, planSetupItem } from './plan';
import type { SetupItemInput } from './plan';
import { TEMPLATE_COLUMNS, loadSetupVehicle } from './templates';
import type { TemplateRow } from './templates';

export type { LastDoneAnswer, SetupItemInput } from './plan';

export interface SetupDeadlinesInput {
  vehicleId: string;
  items: SetupItemInput[];
}

/** Motivo per cui la voce e' "Da configurare" o ha solo una parte dei dati (principio I3: mai dati inventati). */
export type SetupReason = ReasonCode | UnknownReason;

export interface SetupItemResult {
  templateId: string;
  itemId: string;
  name: string;
  category: ItemCategory;
  scheduleType: ScheduleType;
  /** `already_exists`: la voce c'era gia' sul veicolo (il wizard e' ripetibile) e non viene modificata. */
  status: 'created' | 'already_exists';
  /** Semaforo della voce per il riepilogo finale (ok / soon / overdue / unknown = "Da configurare"). */
  state: ReminderState;
  effectiveDueOn: LocalDate | null;
  /** Motivi per cui mancano ingredienti (vuoto se la voce e' completa). */
  reasons: SetupReason[];
  /** Come e' stata ricavata la scadenza: 'last_done', 'manual', 'first_registration', 'renewal_payment_month'... */
  basis: string | null;
  /** Avvertenza della regola italiana (revisione, bollo) da mostrare accanto alla scadenza. */
  warning: string | null;
}

export interface SetupDeadlinesResult {
  vehicleId: string;
  items: SetupItemResult[];
  /** Quante voci sono state create / gia' presenti / ancora da configurare. */
  createdCount: number;
  existingCount: number;
  toConfigureCount: number;
}

/**
 * Crea le voci scelte nel wizard. Per ogni voce:
 *  - copia regole e preavvisi dal template (`template_id` e `template_version` ne tracciano l'origine);
 *  - risposta "data e km" -> baseline; "non lo so" -> nessuna baseline, la voce resta "Da configurare" e non produce
 *    promemoria; "mai fatto" -> baseline dalla prima immatricolazione (km 0) o dall'acquisto, altrimenti da configurare;
 *  - revisione: dalla data letta sul documento, dall'ultima revisione o dalla prima immatricolazione (auto sotto i 4 anni);
 *  - bollo: dal mese di pagamento (o dalla data inserita); gomme stagionali: prossima occorrenza del 15/11 e del 15/4.
 * Il wizard e' ripetibile: una voce gia' presente (stesso template, non nel cestino) non viene duplicata ne' modificata.
 */
export async function setupDeadlines(d: Deps, input: SetupDeadlinesInput): Promise<UsecaseResult<SetupDeadlinesResult>> {
  const today = d.clock.todayLocal();
  const result = await guard(() =>
    d.db.transaction(async (tx) => {
      const vehicle = await loadSetupVehicle(tx, input.vehicleId);
      if (!vehicle) throw new Abort({ code: 'ITEM_NOT_FOUND' });

      const ids = [...new Set(input.items.map((i) => i.templateId))];
      const templates = new Map<string, TemplateRow>();
      if (ids.length > 0) {
        const rows = await tx.all<TemplateRow>(
          `SELECT ${TEMPLATE_COLUMNS} FROM service_templates WHERE id IN (${ids.map(() => '?').join(',')})`,
          ids,
        );
        for (const r of rows) templates.set(r.id, r);
      }
      const existing = new Map<string, string>();
      const existingRows = await tx.all<{ id: string; template_id: string }>(
        'SELECT id, template_id FROM maintenance_items WHERE vehicle_id = ? AND deleted_at IS NULL AND template_id IS NOT NULL ORDER BY created_at, id',
        [input.vehicleId],
      );
      for (const e of existingRows) if (!existing.has(e.template_id)) existing.set(e.template_id, e.id);

      type Pending = { templateId: string; itemId: string; created: boolean; basis: string | null; warning: string | null; extra: UnknownReason[] };
      const pending: Pending[] = [];
      const now = d.clock.nowIso();

      for (let idx = 0; idx < input.items.length; idx++) {
        const item = input.items[idx] as SetupItemInput;
        const t = templates.get(item.templateId) ?? abortValidation(`items[${idx}].templateId`, 'Questa voce non è nel catalogo.');
        const already = existing.get(t.id);
        if (already) {
          pending.push({ templateId: t.id, itemId: already, created: false, basis: null, warning: null, extra: [] });
          continue;
        }
        const intervals = effectiveIntervals(t, item, idx);
        const plan = planSetupItem(t, item, vehicle, today, idx, intervals);
        const name = (item.overrides?.name ?? t.name_it).trim();
        if (name.length < 1 || name.length > 80) {
          abortValidation(`items[${idx}].overrides.name`, 'Il nome deve avere da 1 a 80 caratteri.');
        }
        const id = d.ids.ulid();
        await tx.run(
          `INSERT INTO maintenance_items (id, vehicle_id, template_id, template_version, name, category, schedule_type,
             interval_km, interval_months, period_end, fixed_due_on, baseline_on, baseline_km, soon_days, soon_km,
             notify_offsets_days, notify_enabled, is_active, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          [
            id,
            input.vehicleId,
            t.id,
            t.version,
            name,
            t.category,
            t.schedule_type,
            intervals.intervalKm,
            intervals.intervalMonths,
            plan.periodEnd,
            plan.fixedDueOn,
            plan.baselineOn,
            plan.baselineKm,
            t.soon_days,
            t.soon_km,
            t.notify_offsets_days,
            item.overrides?.notifyEnabled === false ? 0 : 1,
            t.sort_order,
            now,
            now,
          ],
        );
        existing.set(t.id, id); // lo stesso template ripetuto nell'input non si duplica
        pending.push({ templateId: t.id, itemId: id, created: true, basis: plan.basis, warning: plan.warning, extra: plan.extraReasons });
      }

      const outcome = await reconcileInTx(tx, d, input.vehicleId);
      const items: SetupItemResult[] = [];
      for (const p of pending) {
        const preview = outcome.input ? previewItem(outcome.input, p.itemId) : null;
        const t = templates.get(p.templateId) as TemplateRow;
        const row = await tx.get<{ name: string }>('SELECT name FROM maintenance_items WHERE id = ?', [p.itemId]);
        const ev = preview?.evaluation;
        items.push({
          templateId: p.templateId,
          itemId: p.itemId,
          name: row?.name ?? t.name_it,
          category: t.category,
          scheduleType: t.schedule_type,
          status: p.created ? 'created' : 'already_exists',
          state: ev?.state ?? 'unknown',
          effectiveDueOn: ev?.effectiveDueOn ?? null,
          reasons: [...(ev?.reasons ?? []), ...p.extra],
          basis: p.basis,
          warning: p.warning,
        });
      }
      return {
        vehicleId: input.vehicleId,
        items,
        createdCount: items.filter((i) => i.status === 'created').length,
        existingCount: items.filter((i) => i.status === 'already_exists').length,
        toConfigureCount: items.filter((i) => i.status === 'created' && i.state === 'unknown').length,
        changed: pending.some((p) => p.created) || outcome.changed,
      };
    }, 'exclusive'),
  );
  if (!result.ok) return result;
  const { changed, ...value } = result.value;
  if (changed) d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId: input.vehicleId });
  return { ok: true, value };
}
