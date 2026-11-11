// "Cosa hai fatto?" (SPEC F-36, data.md 3.7): completamenti di voci di manutenzione collegati a un intervento
// (`maintenance_completions.source = 'service'`, `service_record_id`). Stessa logica di `completeDeadline` (data e km REALI,
// `prev_fixed_due_on`, chiusura del promemoria aperto) e annullamento ESATTO tramite `undoCompletionInTx`.
// La riconciliazione dei promemoria (`reconcileInTx`) e' chiamata dal caso d'uso a fine transazione.
import { resolveLastDone, planCompletion } from '@/domain/maintenance';
import type { Evaluation, LastDone } from '@/domain/maintenance';
import type { LocalDate } from '@/domain/ports';
import type { DistanceUnit } from '@/domain/units';
import { formatDateIt, formatDistance } from '@/domain/units';
import type { Deps } from '../context';
import { undoCompletionInTx } from '../deadlines/complete';
import { previewItem, reconcileInTx, ruleOf } from '../deadlines/load';
import { placeholders, type Tx } from './internal';
import { completionInfo, loadActiveCompletions } from './store';
import type { ServiceCompletionInfo, ServiceWarning } from './types';

export interface ItemRow {
  id: string;
  vehicle_id: string;
  name: string;
  template_id: string | null;
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

const ITEM_COLUMNS =
  'id, vehicle_id, name, template_id, schedule_type, interval_km, interval_months, period_end, fixed_due_on, baseline_on, baseline_km, soon_days, soon_km';

/** Le voci attive (non eliminate) del veicolo fra quelle indicate; quelle mancanti non compaiono. */
export async function loadUsableItems(tx: Tx, vehicleId: string, ids: readonly string[]): Promise<Map<string, ItemRow>> {
  const out = new Map<string, ItemRow>();
  if (ids.length === 0) return out;
  const rows = await tx.all<ItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM maintenance_items
     WHERE vehicle_id = ? AND deleted_at IS NULL AND is_active = 1 AND id IN (${placeholders(ids.length)})`,
    [vehicleId, ...ids],
  );
  for (const r of rows) out.set(r.id, r);
  return out;
}

const sameLastDone = (a: LastDone | null, b: LastDone | null): boolean =>
  a === b || (a !== null && b !== null && a.on === b.on && (a.km ?? null) === (b.km ?? null));

/**
 * Segna "fatta" una voce per l'intervento, come `completeDeadline` (data.md 3.7 passi 3-5): completamento con
 * `prev_fixed_due_on`, avanzamento della serie di calendario, chiusura del promemoria aperto se la base cambia.
 * Un completamento retrodatato (piu' vecchio dell'ultimo fatto) si registra ma non cambia base ne' promemoria.
 */
export async function createServiceCompletion(
  tx: Tx,
  d: Pick<Deps, 'clock' | 'ids'>,
  p: { item: ItemRow; doneOn: LocalDate; doneKm: number | null; recordId: string },
): Promise<{ completionId: string; duplicate: boolean }> {
  const { item } = p;
  const now = d.clock.nowIso();
  const comps = (
    await tx.all<{ done_on: string; done_km: number | null }>(
      'SELECT done_on, done_km FROM maintenance_completions WHERE item_id = ? AND deleted_at IS NULL',
      [item.id],
    )
  ).map((c) => ({ doneOn: c.done_on, doneKm: c.done_km }));
  const baseline = { baselineOn: item.baseline_on, baselineKm: item.baseline_km };
  const before = resolveLastDone(comps, baseline);

  const plan = planCompletion(ruleOf(item), p.doneOn, p.doneKm);
  const completionId = d.ids.ulid();
  await tx.run(
    `INSERT INTO maintenance_completions (id, item_id, done_on, done_km, prev_fixed_due_on, source, service_record_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'service', ?, NULL, ?, ?)`,
    [completionId, item.id, p.doneOn, p.doneKm, plan.prevFixedDueOn, p.recordId, now, now],
  );
  if (plan.fixedDueOnChanged) {
    await tx.run('UPDATE maintenance_items SET fixed_due_on = ?, updated_at = ? WHERE id = ?', [plan.newFixedDueOn, now, item.id]);
  }

  const after = resolveLastDone([...comps, { doneOn: p.doneOn, doneKm: p.doneKm }], baseline);
  if (plan.fixedDueOnChanged || !sameLastDone(before, after)) {
    const open = await tx.get<{ id: string }>(
      `SELECT id FROM reminders WHERE item_id = ? AND status = 'open' AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1`,
      [item.id],
    );
    if (open) {
      await tx.run(`UPDATE reminders SET status = 'done', completed_on = ?, completion_id = ?, updated_at = ? WHERE id = ?`, [
        p.doneOn,
        completionId,
        now,
        open.id,
      ]);
    }
  }
  return { completionId, duplicate: comps.some((c) => c.doneOn === p.doneOn) };
}

/**
 * Annulla ESATTAMENTE un completamento dell'intervento (ripristina `fixed_due_on`, riapre il promemoria, riconcilia).
 * Se la voce nel frattempo e' stata eliminata il completamento si annulla senza ripristini. `stamp` e' l'istante comune
 * di tutte le annullamenti dell'operazione: `restoreServiceRecord` li riconosce da quello.
 */
export async function undoServiceCompletion(tx: Tx, d: Deps, completionId: string, stamp: string): Promise<{ reopenedReminderId: string | null }> {
  const alive = await tx.get<{ id: string }>(
    `SELECT c.id FROM maintenance_completions c JOIN maintenance_items i ON i.id = c.item_id
     WHERE c.id = ? AND c.deleted_at IS NULL AND i.deleted_at IS NULL`,
    [completionId],
  );
  const reopenedReminderId = alive ? (await undoCompletionInTx(tx, d, completionId)).reopenedReminderId : null;
  await tx.run('UPDATE maintenance_completions SET deleted_at = ?, updated_at = ? WHERE id = ?', [stamp, stamp, completionId]);
  return { reopenedReminderId };
}

export interface SyncOutcome {
  createdIds: Set<string>;
  removed: { completionId: string; itemId: string }[];
  reopenedReminderIds: string[];
  skippedItemIds: string[];
  warnings: ServiceWarning[];
}

/**
 * Porta i completamenti dell'intervento all'insieme di voci voluto. Quelli che restano uguali (stessa voce, stessa data,
 * stessi km) non si toccano: niente rumore sui promemoria. Gli altri si annullano esattamente e si ricreano coi valori nuovi.
 * `desired = null` significa "le stesse voci di adesso" (le ricalcola se data o km sono cambiati).
 */
export async function syncServiceCompletions(
  tx: Tx,
  d: Deps,
  a: { recordId: string; vehicleId: string; serviceOn: LocalDate; doneKm: number | null; desired: readonly string[] | null; stamp: string },
): Promise<SyncOutcome> {
  const out: SyncOutcome = { createdIds: new Set(), removed: [], reopenedReminderIds: [], skippedItemIds: [], warnings: [] };
  const existing = await loadActiveCompletions(tx, a.recordId);
  const wanted = a.desired === null ? existing.map((e) => e.item_id) : [...new Set(a.desired)];
  const wantedSet = new Set(wanted);

  const retained = new Set<string>();
  for (const e of existing) {
    if (wantedSet.has(e.item_id) && e.done_on === a.serviceOn && e.done_km === a.doneKm) {
      retained.add(e.item_id);
      continue;
    }
    const r = await undoServiceCompletion(tx, d, e.id, a.stamp);
    out.removed.push({ completionId: e.id, itemId: e.item_id });
    if (r.reopenedReminderId) out.reopenedReminderIds.push(r.reopenedReminderId);
  }

  const toCreate = wanted.filter((id) => !retained.has(id));
  const items = await loadUsableItems(tx, a.vehicleId, toCreate);
  for (const id of toCreate) {
    const item = items.get(id);
    if (!item) {
      out.skippedItemIds.push(id);
      out.warnings.push({ code: 'ITEM_SKIPPED', message: 'Una voce di manutenzione non esiste più o non è attiva: non è stata segnata come fatta.' });
      continue;
    }
    const r = await createServiceCompletion(tx, d, { item, doneOn: a.serviceOn, doneKm: a.doneKm, recordId: a.recordId });
    out.createdIds.add(r.completionId);
    if (r.duplicate) {
      out.warnings.push({
        code: 'DUPLICATE_COMPLETION',
        message: `«${item.name}» risulta già fatta il ${formatDateIt(a.serviceOn)}: controlla di non aver registrato due volte lo stesso lavoro.`,
      });
    }
  }
  return out;
}

/** "Prossimo cambio olio: tra 15.000 km o il 07/10/2027, il primo dei due." (null se la voce non e' calcolabile). */
export function nextTextOf(name: string, ev: Evaluation, unit: DistanceUnit): string | null {
  if (ev.state === 'unknown') return null;
  const n = name.charAt(0).toLowerCase() + name.slice(1);
  const date = ev.dueOn ? formatDateIt(ev.dueOn) : null;
  const km =
    ev.dueKm != null ? (ev.kmLeft != null && ev.kmLeft > 0 ? `tra ${formatDistance(ev.kmLeft, unit)}` : `ai ${formatDistance(ev.dueKm, unit)}`) : null;
  if (km && date) return `Prossimo ${n}: ${km} o il ${date}, il primo dei due.`;
  if (km) return `Prossimo ${n}: ${km}.`;
  if (date) return `Prossimo ${n}: entro il ${date}.`;
  return null;
}

/**
 * Riconcilia i promemoria del veicolo (una volta sola, a fine operazione) e restituisce i completamenti attivi
 * dell'intervento con lo stato della voce ricalcolato sui valori reali.
 */
export async function reconcileAndDescribe(
  tx: Tx,
  d: Pick<Deps, 'clock' | 'ids'>,
  a: { recordId: string; vehicleId: string; unit: DistanceUnit; createdIds: ReadonlySet<string> },
): Promise<ServiceCompletionInfo[]> {
  const outcome = await reconcileInTx(tx, d, a.vehicleId);
  const rows = await loadActiveCompletions(tx, a.recordId);
  return rows.map((r) => {
    const preview = outcome.input ? previewItem(outcome.input, r.item_id) : null;
    const next = preview
      ? { state: preview.evaluation.state, effectiveDueOn: preview.evaluation.effectiveDueOn, reasons: preview.evaluation.reasons }
      : null;
    return completionInfo(r, a.createdIds.has(r.id), next, preview ? nextTextOf(r.name, preview.evaluation, a.unit) : null);
  });
}
