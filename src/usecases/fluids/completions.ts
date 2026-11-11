// Completamento delle voci di controllo da parte di un controllo livelli (data.md 3.7, SPEC 6.3.9 punto 3).
// Stessa logica di `completeDeadline` (usecases/deadlines/complete.ts), che non si puo' riusare tale e quale perche' scrive
// `source = 'manual'` e crea una propria lettura km: qui il completamento e' `source = 'check'` con `fluid_check_id`
// e i km sono quelli della lettura gia' collegata al controllo. L'equivalenza e' garantita da tests/integration/usecases/fluids.
import type { LocalDate } from '@/domain/dates';
import { planCompletion, resolveLastDone } from '@/domain/maintenance';
import type { LastDone } from '@/domain/maintenance';
import type { Fluid } from '@/domain/fluids';
import type { Deps } from '../context';
import type { SqlDatabase } from '@/domain/ports';
import { ruleOf } from '../deadlines/load';
import { FLUID_CHECK_TEMPLATES } from './types';
import type { FluidCompletion } from './types';

const sameLastDone = (a: LastDone | null, b: LastDone | null): boolean =>
  a === b || (a !== null && b !== null && a.on === b.on && (a.km ?? null) === (b.km ?? null));

interface CheckItemRow {
  id: string;
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
}

/**
 * Per ogni voce di controllo del veicolo collegata al fluido (`template_id` del catalogo), non nel cestino:
 *  1. inserisce il completamento `source = 'check'` con `fluid_check_id`, `done_on`, `done_km` e `prev_fixed_due_on`;
 *  2. avanza la data fissa se la regola la usa (le voci di controllo sono "dall'ultimo fatto": di norma non cambia);
 *  3. se la base e' cambiata (un controllo retrodatato non la cambia) chiude il promemoria aperto della voce.
 * La riconciliazione (il prossimo promemoria) la fa il chiamante, una volta, a fine transazione.
 */
export async function completeLinkedItems(
  tx: SqlDatabase,
  d: Pick<Deps, 'clock' | 'ids'>,
  args: { vehicleId: string; checkId: string; fluid: Fluid; checkedOn: LocalDate; km: number | null },
): Promise<FluidCompletion[]> {
  const templateId = FLUID_CHECK_TEMPLATES[args.fluid];
  if (!templateId) return [];
  const items = await tx.all<CheckItemRow>(
    `SELECT id, name, schedule_type, interval_km, interval_months, period_end, fixed_due_on, baseline_on, baseline_km, soon_days, soon_km
     FROM maintenance_items WHERE vehicle_id = ? AND template_id = ? AND deleted_at IS NULL ORDER BY created_at, id`,
    [args.vehicleId, templateId],
  );
  const now = d.clock.nowIso();
  const out: FluidCompletion[] = [];
  for (const item of items) {
    const comps = (
      await tx.all<{ done_on: string; done_km: number | null }>(
        'SELECT done_on, done_km FROM maintenance_completions WHERE item_id = ? AND deleted_at IS NULL',
        [item.id],
      )
    ).map((c) => ({ doneOn: c.done_on, doneKm: c.done_km }));
    const baseline = { baselineOn: item.baseline_on, baselineKm: item.baseline_km };
    const before = resolveLastDone(comps, baseline);

    const plan = planCompletion(ruleOf(item), args.checkedOn, args.km);
    const completionId = d.ids.ulid();
    await tx.run(
      `INSERT INTO maintenance_completions (id, item_id, done_on, done_km, prev_fixed_due_on, source, fluid_check_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'check', ?, ?, ?)`,
      [completionId, item.id, args.checkedOn, args.km, plan.prevFixedDueOn, args.checkId, now, now],
    );
    if (plan.fixedDueOnChanged) {
      await tx.run('UPDATE maintenance_items SET fixed_due_on = ?, updated_at = ? WHERE id = ?', [plan.newFixedDueOn, now, item.id]);
    }

    const after = resolveLastDone([...comps, { doneOn: args.checkedOn, doneKm: args.km }], baseline);
    let closedReminderId: string | null = null;
    if (plan.fixedDueOnChanged || !sameLastDone(before, after)) {
      const open = await tx.get<{ id: string }>(
        `SELECT id FROM reminders WHERE item_id = ? AND status = 'open' AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1`,
        [item.id],
      );
      if (open) {
        await tx.run(
          `UPDATE reminders SET status = 'done', completed_on = ?, completion_id = ?, updated_at = ? WHERE id = ?`,
          [args.checkedOn, completionId, now, open.id],
        );
        closedReminderId = open.id;
      }
    }
    out.push({ completionId, itemId: item.id, itemName: item.name, closedReminderId });
  }
  return out;
}
