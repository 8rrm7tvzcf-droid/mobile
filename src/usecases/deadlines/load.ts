// Lettura degli ingredienti del motore e applicazione delle modifiche ai promemoria (SQL a mano, SPEC 8.6/8.7).
// Tutte le funzioni lavorano su una connessione/transazione passata dal chiamante (`tx`): mai sul db radice.
import { evaluateRule, resolveLastDone } from '@/domain/maintenance';
import type { Evaluation, ItemCategory, MaintenanceRule, OdometerPoint, ReasonCode } from '@/domain/maintenance';
import { isEmptyChanges, planReminderChanges } from '@/domain/reminders';
import type {
  ClosedCycle,
  OpenReminder,
  ReconcileInput,
  ReconcileItem,
  ReconcilePayment,
  ReconcilePolicy,
  ReminderChanges,
  ReminderFields,
} from '@/domain/reminders';
import type { Clock, SqlDatabase, SqlValue } from '@/domain/ports';
import { parseOffsets } from './internal';
import { loadRateParams } from './rateParams';

interface VehicleRow {
  id: string;
  status: string;
  annual_km_estimate: number | null;
  first_registration_on: string | null;
  deleted_at: string | null;
}
interface ItemRow {
  id: string;
  name: string;
  category: ItemCategory;
  schedule_type: MaintenanceRule['scheduleType'];
  interval_km: number | null;
  interval_months: number | null;
  period_end: 'exact' | 'end_of_month';
  fixed_due_on: string | null;
  baseline_on: string | null;
  baseline_km: number | null;
  soon_days: number;
  soon_km: number;
  notify_offsets_days: string;
  is_active: number;
}
interface CompletionRow {
  item_id: string;
  done_on: string;
  done_km: number | null;
}
interface OpenReminderRow {
  id: string;
  origin: 'generated' | 'manual';
  item_id: string | null;
  policy_id: string | null;
  payment_id: string | null;
  title: string;
  category: OpenReminder['category'];
  due_on: string | null;
  due_km: number | null;
  forecast_on: string | null;
  forecast_confidence: OpenReminder['forecastConfidence'];
  effective_due_on: string | null;
  due_trigger: OpenReminder['dueTrigger'];
  soon_days: number;
  soon_km: number;
  notify_offsets_days: string;
}
interface ClosedCycleRow {
  item_id: string | null;
  policy_id: string | null;
  payment_id: string | null;
  due_on: string | null;
  due_km: number | null;
}

export { loadRateParams };

export function ruleOf(row: Pick<ItemRow, 'schedule_type' | 'interval_km' | 'interval_months' | 'period_end' | 'fixed_due_on' | 'soon_days' | 'soon_km'>): MaintenanceRule {
  return {
    scheduleType: row.schedule_type,
    intervalKm: row.interval_km,
    intervalMonths: row.interval_months,
    periodEnd: row.period_end,
    fixedDueOn: row.fixed_due_on,
    soonDays: row.soon_days,
    soonKm: row.soon_km,
  };
}

/**
 * Legge dal DB tutti gli ingredienti di `ReconcileInput` per un veicolo (voci con l'ultimo fatto gia' risolto, letture km,
 * polizze, rate, promemoria aperti, cicli saltati). `null` se il veicolo non esiste o e' nel cestino.
 */
export async function loadReconcileInput(
  db: SqlDatabase,
  clock: Clock,
  vehicleId: string,
): Promise<ReconcileInput | null> {
  const vehicle = await db.get<VehicleRow>(
    'SELECT id, status, annual_km_estimate, first_registration_on, deleted_at FROM vehicles WHERE id = ?',
    [vehicleId],
  );
  if (!vehicle || vehicle.deleted_at) return null;

  const itemRows = await db.all<ItemRow>(
    `SELECT id, name, category, schedule_type, interval_km, interval_months, period_end, fixed_due_on, baseline_on,
            baseline_km, soon_days, soon_km, notify_offsets_days, is_active
     FROM maintenance_items WHERE vehicle_id = ? AND deleted_at IS NULL ORDER BY sort_order, id`,
    [vehicleId],
  );
  const completionRows = await db.all<CompletionRow>(
    `SELECT c.item_id, c.done_on, c.done_km FROM maintenance_completions c
     JOIN maintenance_items i ON i.id = c.item_id
     WHERE i.vehicle_id = ? AND i.deleted_at IS NULL AND c.deleted_at IS NULL`,
    [vehicleId],
  );
  const byItem = new Map<string, { doneOn: string; doneKm: number | null }[]>();
  for (const c of completionRows) {
    const list = byItem.get(c.item_id) ?? [];
    list.push({ doneOn: c.done_on, doneKm: c.done_km });
    byItem.set(c.item_id, list);
  }
  const items: ReconcileItem[] = itemRows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    rule: ruleOf(r),
    lastDone: resolveLastDone(byItem.get(r.id) ?? [], { baselineOn: r.baseline_on, baselineKm: r.baseline_km }),
    notifyOffsetsDays: parseOffsets(r.notify_offsets_days),
    isActive: r.is_active === 1,
  }));

  const odometer = await loadOdometerPoints(db, vehicleId);

  const policies = (
    await db.all<{ id: string; kind: ReconcilePolicy['kind']; company: string; start_on: string; end_on: string; cancelled_on: string | null }>(
      'SELECT id, kind, company, start_on, end_on, cancelled_on FROM insurance_policies WHERE vehicle_id = ? AND deleted_at IS NULL',
      [vehicleId],
    )
  ).map<ReconcilePolicy>((p) => ({ id: p.id, kind: p.kind, company: p.company, startOn: p.start_on, endOn: p.end_on, cancelledOn: p.cancelled_on }));
  const payments = (
    await db.all<{ id: string; policy_id: string; installment_no: number; due_on: string; paid_on: string | null }>(
      `SELECT p.id, p.policy_id, p.installment_no, p.due_on, p.paid_on FROM insurance_payments p
       JOIN insurance_policies pol ON pol.id = p.policy_id
       WHERE pol.vehicle_id = ? AND pol.deleted_at IS NULL AND p.deleted_at IS NULL`,
      [vehicleId],
    )
  ).map<ReconcilePayment>((p) => ({ id: p.id, policyId: p.policy_id, installmentNo: p.installment_no, dueOn: p.due_on, paidOn: p.paid_on }));

  const openReminders = (
    await db.all<OpenReminderRow>(
      `SELECT id, origin, item_id, policy_id, payment_id, title, category, due_on, due_km, forecast_on, forecast_confidence,
              effective_due_on, due_trigger, soon_days, soon_km, notify_offsets_days
       FROM reminders WHERE vehicle_id = ? AND status = 'open' AND deleted_at IS NULL ORDER BY created_at, id`,
      [vehicleId],
    )
  ).map<OpenReminder>((r) => ({
    id: r.id,
    origin: r.origin,
    itemId: r.item_id,
    policyId: r.policy_id,
    paymentId: r.payment_id,
    title: r.title,
    category: r.category,
    dueOn: r.due_on,
    dueKm: r.due_km,
    forecastOn: r.forecast_on,
    forecastConfidence: r.forecast_confidence,
    effectiveDueOn: r.effective_due_on,
    dueTrigger: r.due_trigger,
    soonDays: r.soon_days,
    soonKm: r.soon_km,
    notifyOffsetsDays: parseOffsets(r.notify_offsets_days),
  }));

  // Solo i cicli SALTATI impediscono la rinascita del promemoria. Quelli completati no: dopo "Fatto" la base cambia e il
  // prossimo nasce; se la base resta uguale (stesso fatto registrato due volte) il prossimo deve comunque esistere.
  const closedCycles = (
    await db.all<ClosedCycleRow>(
      `SELECT item_id, policy_id, payment_id, due_on, due_km FROM reminders
       WHERE vehicle_id = ? AND status = 'skipped' AND origin = 'generated' AND deleted_at IS NULL`,
      [vehicleId],
    )
  ).map<ClosedCycle>((r) => ({ itemId: r.item_id, policyId: r.policy_id, paymentId: r.payment_id, dueOn: r.due_on, dueKm: r.due_km }));

  return {
    today: clock.todayLocal(),
    computedAt: clock.nowIso(),
    vehicle: {
      id: vehicle.id,
      status: vehicle.status,
      annualKmEstimate: vehicle.annual_km_estimate,
      firstRegistrationOn: vehicle.first_registration_on,
    },
    items,
    odometer,
    policies,
    payments,
    openReminders,
    closedCycles,
    rateParams: await loadRateParams(db),
  };
}

/** Letture valide (non ignorate, non nel cestino) del veicolo, in ordine di data. */
export async function loadOdometerPoints(db: SqlDatabase, vehicleId: string): Promise<OdometerPoint[]> {
  const rows = await db.all<{ read_on: string; km: number }>(
    `SELECT read_on, km FROM odometer_readings
     WHERE vehicle_id = ? AND status = 'valid' AND deleted_at IS NULL ORDER BY read_on, km`,
    [vehicleId],
  );
  return rows.map((r) => ({ on: r.read_on, km: r.km }));
}

const COLUMN: Record<keyof ReminderFields, string> = {
  title: 'title',
  category: 'category',
  dueOn: 'due_on',
  dueKm: 'due_km',
  forecastOn: 'forecast_on',
  forecastConfidence: 'forecast_confidence',
  effectiveDueOn: 'effective_due_on',
  dueTrigger: 'due_trigger',
  soonDays: 'soon_days',
  soonKm: 'soon_km',
  notifyOffsetsDays: 'notify_offsets_days',
};

const colValue = (v: unknown): SqlValue => (Array.isArray(v) ? JSON.stringify(v) : ((v ?? null) as SqlValue));

/** Scrive le modifiche calcolate da `planReminderChanges` (rimozioni, aggiornamenti, creazioni, chiusure). */
export async function applyReminderChanges(
  tx: SqlDatabase,
  ids: { ulid(): string },
  vehicleId: string,
  changes: ReminderChanges,
  nowIso: string,
): Promise<void> {
  for (const r of changes.remove) {
    await tx.run('UPDATE reminders SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [nowIso, nowIso, r.id]);
  }
  for (const u of changes.update) {
    const keys = Object.keys(u.patch) as (keyof ReminderFields)[];
    if (keys.length === 0) continue;
    const sets = keys.map((k) => `${COLUMN[k]} = ?`);
    const params: SqlValue[] = keys.map((k) => colValue(u.patch[k]));
    await tx.run(`UPDATE reminders SET ${sets.join(', ')}, computed_at = ?, updated_at = ? WHERE id = ?`, [
      ...params,
      u.computedAt,
      nowIso,
      u.id,
    ]);
  }
  for (const c of changes.create) {
    await tx.run(
      `INSERT INTO reminders (id, vehicle_id, origin, item_id, policy_id, payment_id, title, category, due_on, due_km,
         forecast_on, forecast_confidence, effective_due_on, due_trigger, soon_days, soon_km, notify_offsets_days,
         status, computed_at, created_at, updated_at)
       VALUES (?, ?, 'generated', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      [
        ids.ulid(),
        vehicleId,
        c.itemId,
        c.policyId,
        c.paymentId,
        c.title,
        c.category,
        c.dueOn,
        c.dueKm,
        c.forecastOn,
        c.forecastConfidence,
        c.effectiveDueOn,
        c.dueTrigger,
        c.soonDays,
        c.soonKm,
        JSON.stringify(c.notifyOffsetsDays),
        c.computedAt,
        nowIso,
        nowIso,
      ],
    );
  }
  for (const c of changes.close) {
    await tx.run(
      `UPDATE reminders SET status = 'done', completed_on = ?, updated_at = ? WHERE id = ? AND status = 'open'`,
      [c.completedOn, nowIso, c.id],
    );
  }
}

export interface ReconcileOutcome {
  input: ReconcileInput | null;
  changes: ReminderChanges;
  changed: boolean;
}

const EMPTY: ReminderChanges = { create: [], update: [], close: [], remove: [] };

/** Riconciliazione dentro una transazione gia' aperta (la usano tutti i casi d'uso di scrittura del modulo). */
export async function reconcileInTx(
  tx: SqlDatabase,
  d: { clock: Clock; ids: { ulid(): string } },
  vehicleId: string,
): Promise<ReconcileOutcome> {
  const input = await loadReconcileInput(tx, d.clock, vehicleId);
  if (!input) return { input: null, changes: EMPTY, changed: false };
  const changes = planReminderChanges(input);
  const changed = !isEmptyChanges(changes);
  if (changed) await applyReminderChanges(tx, d.ids, vehicleId, changes, d.clock.nowIso());
  return { input, changes, changed };
}

export interface ItemPreview {
  itemId: string;
  name: string;
  evaluation: Evaluation;
}

/** Valutazione di una voce con gli stessi ingredienti del motore (serve ai riepiloghi: "prossima scadenza", semaforo). */
export function previewItem(input: ReconcileInput, itemId: string): ItemPreview | null {
  const item = input.items.find((i) => i.id === itemId);
  if (!item) return null;
  const evaluation = evaluateRule({
    today: input.today,
    rule: item.rule,
    lastDone: item.lastDone,
    odometer: input.odometer,
    vehicle: { annualKmEstimate: input.vehicle.annualKmEstimate, firstRegistrationOn: input.vehicle.firstRegistrationOn },
    rateParams: input.rateParams,
  });
  return { itemId, name: item.name, evaluation };
}

export type { ReasonCode };
