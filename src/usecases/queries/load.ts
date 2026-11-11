// Caricamento di auto, letture km e scadenze per le letture della UI. SQL a mano (i casi d'uso importano solo il dominio).
// Le scadenze si leggono dalla CACHE `reminders` (promemoria aperti) e, per le voci senza occorrenza aperta,
// si valutano dalla regola: lo stato non si salva mai, si calcola da `oggi` e dai km (data.md 3.5, invariante I4).
import type { LocalDate } from '@/domain/dates';
import { compareByUrgency, dailyMax, evaluateRule, evaluateThresholds, latestPoint, resolveLastDone } from '@/domain/maintenance';
import type { Evaluation, MaintenanceRule, OdometerPoint, VehicleRateProfile } from '@/domain/maintenance';
import type { Clock, SqlDatabase, SqlValue } from '@/domain/ports';
import type { ReminderCategory } from '@/domain/reminders';
import { isSnoozed } from '@/domain/reminders';
import type { DistanceUnit } from '@/domain/units';
import { formatKm } from '@/domain/units';
import { describeEvaluation, CATEGORY_LABELS, ICON_OF_TONE, legalInfoFor, toneOf } from './describe';
import { loadRateParams } from '../deadlines/rateParams';
import { isoToLocal } from './localTime';
import type { DeadlineOrigin, DeadlineRow } from './types';

/** Le auto che partecipano ai promemoria: attive e non nel cestino. */
export interface VehicleInfo {
  id: string;
  label: string;
  nickname: string | null;
  plate: string | null;
  make: string;
  model: string;
  status: string;
  isDemo: boolean;
  distanceUnit: DistanceUnit;
  profile: VehicleRateProfile;
  /** Letture valide del contachilometri (tutte, in ordine di data). */
  odometer: OdometerPoint[];
  currentKm: number | null;
  currentKmText: string | null;
  lastReadingOn: LocalDate | null;
}

interface VehicleDbRow {
  id: string;
  nickname: string | null;
  plate: string | null;
  make: string;
  model: string;
  status: string;
  distance_unit: string;
  annual_km_estimate: number | null;
  first_registration_on: string | null;
  is_demo: number;
}

const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

/** Soprannome oppure "Marca Modello". */
export const vehicleLabel = (v: { nickname: string | null; make: string; model: string }): string =>
  v.nickname && v.nickname.trim() ? v.nickname.trim() : `${v.make} ${v.model}`;

export async function loadVehicleInfos(
  db: SqlDatabase,
  today: LocalDate,
  opts: { vehicleId?: string; activeOnly?: boolean } = {},
): Promise<VehicleInfo[]> {
  const where = ['deleted_at IS NULL'];
  const params: SqlValue[] = [];
  if (opts.vehicleId) {
    where.push('id = ?');
    params.push(opts.vehicleId);
  }
  if (opts.activeOnly) where.push(`status = 'active'`);
  const rows = await db.all<VehicleDbRow>(
    `SELECT id, nickname, plate, make, model, status, distance_unit, annual_km_estimate, first_registration_on, is_demo
       FROM vehicles WHERE ${where.join(' AND ')} ORDER BY sort_order, created_at, id`,
    params,
  );
  if (rows.length === 0) return [];
  const readings = await db.all<{ vehicle_id: string; read_on: string; km: number }>(
    `SELECT vehicle_id, read_on, km FROM odometer_readings
      WHERE status = 'valid' AND deleted_at IS NULL AND vehicle_id IN (${placeholders(rows.length)}) ORDER BY read_on, km`,
    rows.map((r) => r.id),
  );
  const byVehicle = new Map<string, OdometerPoint[]>();
  for (const r of readings) {
    const list = byVehicle.get(r.vehicle_id) ?? [];
    list.push({ on: r.read_on, km: r.km });
    byVehicle.set(r.vehicle_id, list);
  }
  return rows.map((r) => {
    const unit: DistanceUnit = r.distance_unit === 'mi' ? 'mi' : 'km';
    const odometer = byVehicle.get(r.id) ?? [];
    const last = latestPoint(dailyMax(odometer, today));
    return {
      id: r.id,
      label: vehicleLabel(r),
      nickname: r.nickname,
      plate: r.plate,
      make: r.make,
      model: r.model,
      status: r.status,
      isDemo: r.is_demo === 1,
      distanceUnit: unit,
      profile: { annualKmEstimate: r.annual_km_estimate, firstRegistrationOn: r.first_registration_on },
      odometer,
      currentKm: last ? last.km : null,
      currentKmText: last ? formatKm(last.km) : null,
      lastReadingOn: last ? last.on : null,
    };
  });
}

// ---------------------------------------------------------------- promemoria e voci

interface ReminderDbRow {
  id: string;
  vehicle_id: string;
  origin: 'generated' | 'manual';
  item_id: string | null;
  policy_id: string | null;
  payment_id: string | null;
  title: string;
  category: ReminderCategory;
  due_on: string | null;
  due_time: string | null;
  due_km: number | null;
  soon_days: number;
  soon_km: number;
  snoozed_until: string | null;
  snooze_until_km: number | null;
  repeat_every: number | null;
  repeat_unit: 'day' | 'week' | 'month' | 'year' | null;
  item_template_id: string | null;
  item_active: number | null;
  item_deleted_at: string | null;
  policy_kind: string | null;
}

interface ItemDbRow {
  id: string;
  vehicle_id: string;
  template_id: string | null;
  name: string;
  category: Exclude<ReminderCategory, 'insurance'>;
  schedule_type: MaintenanceRule['scheduleType'];
  interval_km: number | null;
  interval_months: number | null;
  period_end: 'exact' | 'end_of_month';
  fixed_due_on: string | null;
  baseline_on: string | null;
  baseline_km: number | null;
  soon_days: number;
  soon_km: number;
}

/** Chiave di un ciclo di una voce: la stessa che usa il motore per non far rinascere un promemoria saltato. */
const cycleKey = (itemId: string, dueOn: string | null, dueKm: number | null): string => `${itemId}|${dueOn ?? ''}|${dueKm ?? ''}`;

/** Valutazione di una voce il cui ciclo e' stato saltato: nessuna scadenza (ne' scaduta, ne' in arrivo, ne' "prossima") fino al prossimo "Fatto". */
function skippedEvaluation(ev: Evaluation): Evaluation {
  return {
    ...ev,
    state: 'unknown',
    dueOn: null,
    dueKm: null,
    forecastOn: null,
    effectiveDueOn: null,
    trigger: null,
    estimated: false,
    kmReached: false,
    dueToday: false,
    daysLeft: null,
    kmLeft: null,
    forecastConfidence: null,
    rate: null,
    reasons: ['CYCLE_SKIPPED'],
  };
}

const originOf = (r: ReminderDbRow): DeadlineOrigin =>
  r.item_id ? 'rule' : r.policy_id ? 'policy' : r.payment_id ? 'installment' : 'manual';

type RowBase = Omit<
  DeadlineRow,
  | 'state' | 'group' | 'tone' | 'icon' | 'label' | 'text' | 'secondaryText' | 'summary' | 'dueOn' | 'dueKm' | 'forecastOn'
  | 'effectiveDueOn' | 'trigger' | 'estimated' | 'kmReached' | 'dueToday' | 'daysLeft' | 'kmLeft' | 'currentKm'
  | 'forecastConfidence' | 'reasons'
>;

function withEvaluation(base: RowBase, ev: Evaluation, unit: DistanceUnit): DeadlineRow {
  const tone = toneOf(ev);
  const t = describeEvaluation(ev, unit);
  return {
    ...base,
    state: ev.state,
    group: ev.state,
    tone,
    icon: ICON_OF_TONE[tone],
    label: t.label,
    text: t.text,
    secondaryText: t.secondaryText,
    summary: t.summary,
    dueOn: ev.dueOn,
    dueKm: ev.dueKm,
    forecastOn: ev.forecastOn,
    effectiveDueOn: ev.effectiveDueOn,
    trigger: ev.trigger,
    estimated: ev.estimated,
    kmReached: ev.kmReached,
    dueToday: ev.dueToday,
    daysLeft: ev.daysLeft,
    kmLeft: ev.kmLeft,
    currentKm: ev.currentKm,
    forecastConfidence: ev.forecastConfidence,
    reasons: t.reasons,
  };
}

/** Ordine di lista: per urgenza (scadute, in arrivo, in regola per data, da configurare), poi titolo e id (deterministico). */
export function compareRows(a: DeadlineRow, b: DeadlineRow): number {
  return compareByUrgency(a, b) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Tutte le scadenze delle auto date, ordinate per urgenza: i promemoria aperti (dalla cache) e le voci attive
 * senza occorrenza aperta (valutate dalla regola: tipicamente `unknown` con il motivo).
 */
export async function loadDeadlineRows(
  db: SqlDatabase,
  clock: Clock,
  vehicles: readonly VehicleInfo[],
): Promise<DeadlineRow[]> {
  if (vehicles.length === 0) return [];
  const today = clock.todayLocal();
  const nowLocal = clock.nowLocal();
  const rateParams = await loadRateParams(db); // le stesse impostazioni forecast.* della riconciliazione e delle notifiche
  const ids = vehicles.map((v) => v.id);
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const out: DeadlineRow[] = [];

  const reminders = await db.all<ReminderDbRow>(
    `SELECT r.id, r.vehicle_id, r.origin, r.item_id, r.policy_id, r.payment_id, r.title, r.category, r.due_on, r.due_time,
            r.due_km, r.soon_days, r.soon_km, r.snoozed_until, r.snooze_until_km, r.repeat_every, r.repeat_unit,
            i.template_id AS item_template_id, i.is_active AS item_active, i.deleted_at AS item_deleted_at,
            p.kind AS policy_kind
       FROM reminders r
       LEFT JOIN maintenance_items i ON i.id = r.item_id
       LEFT JOIN insurance_policies p ON p.id = r.policy_id
      WHERE r.status = 'open' AND r.deleted_at IS NULL AND r.vehicle_id IN (${placeholders(ids.length)})`,
    ids,
  );
  for (const r of reminders) {
    const v = byId.get(r.vehicle_id);
    if (!v) continue;
    if (r.item_id && (r.item_active === 0 || r.item_deleted_at != null)) continue; // regola spenta o nel cestino
    const ev = evaluateThresholds({
      today,
      dueOn: r.due_on,
      dueKm: r.due_km,
      soonDays: r.soon_days,
      soonKm: r.soon_km,
      odometer: v.odometer,
      vehicle: v.profile,
      rateParams,
    });
    const snoozed = isSnoozed(
      { snoozedUntilLocal: r.snoozed_until ? isoToLocal(r.snoozed_until, clock) : null, snoozeUntilKm: r.snooze_until_km },
      nowLocal,
      v.currentKm,
    );
    out.push(
      withEvaluation(
        {
          id: r.id,
          kind: 'reminder',
          reminderId: r.id,
          itemId: r.item_id,
          policyId: r.policy_id,
          paymentId: r.payment_id,
          templateId: r.item_template_id,
          vehicleId: r.vehicle_id,
          vehicleLabel: v.label,
          title: r.title,
          category: r.category,
          categoryLabel: CATEGORY_LABELS[r.category],
          origin: originOf(r),
          snoozed,
          snoozedUntil: snoozed ? r.snoozed_until : null,
          dueTime: r.due_time,
          repeat: r.repeat_every && r.repeat_unit ? { every: r.repeat_every, unit: r.repeat_unit } : null,
          legal: legalInfoFor({ category: r.category, templateId: r.item_template_id, policyKind: r.policy_kind }),
        },
        ev,
        v.distanceUnit,
      ),
    );
  }

  // voci attive senza occorrenza aperta: stato dalla regola (mancano gli ingredienti oppure la cache non e' ancora allineata)
  const items = await db.all<ItemDbRow>(
    `SELECT i.id, i.vehicle_id, i.template_id, i.name, i.category, i.schedule_type, i.interval_km, i.interval_months,
            i.period_end, i.fixed_due_on, i.baseline_on, i.baseline_km, i.soon_days, i.soon_km
       FROM maintenance_items i
      WHERE i.deleted_at IS NULL AND i.is_active = 1 AND i.vehicle_id IN (${placeholders(ids.length)})
        AND NOT EXISTS (SELECT 1 FROM reminders r WHERE r.item_id = i.id AND r.status = 'open' AND r.deleted_at IS NULL)`,
    ids,
  );
  if (items.length > 0) {
    const completions = await db.all<{ item_id: string; done_on: string; done_km: number | null }>(
      `SELECT item_id, done_on, done_km FROM maintenance_completions
        WHERE deleted_at IS NULL AND item_id IN (${placeholders(items.length)})`,
      items.map((i) => i.id),
    );
    const doneBy = new Map<string, { doneOn: string; doneKm: number | null }[]>();
    for (const c of completions) {
      const list = doneBy.get(c.item_id) ?? [];
      list.push({ doneOn: c.done_on, doneKm: c.done_km });
      doneBy.set(c.item_id, list);
    }
    // cicli SALTATI: la voce rivalutata dalla regola che coincide con un promemoria saltato non e' scaduta ne' in arrivo
    const skippedRows = await db.all<{ item_id: string; due_on: string | null; due_km: number | null }>(
      `SELECT item_id, due_on, due_km FROM reminders
        WHERE status = 'skipped' AND origin = 'generated' AND deleted_at IS NULL AND item_id IN (${placeholders(items.length)})`,
      items.map((i) => i.id),
    );
    const skippedKeys = new Set(skippedRows.map((s) => cycleKey(s.item_id, s.due_on, s.due_km)));
    for (const i of items) {
      const v = byId.get(i.vehicle_id);
      if (!v) continue;
      const lastDone = resolveLastDone(doneBy.get(i.id) ?? [], { baselineOn: i.baseline_on, baselineKm: i.baseline_km });
      const ev = evaluateRule({
        today,
        rule: {
          scheduleType: i.schedule_type,
          intervalKm: i.interval_km,
          intervalMonths: i.interval_months,
          periodEnd: i.period_end,
          fixedDueOn: i.fixed_due_on,
          soonDays: i.soon_days,
          soonKm: i.soon_km,
        },
        lastDone,
        odometer: v.odometer,
        vehicle: v.profile,
        rateParams,
      });
      const skipped = skippedKeys.has(cycleKey(i.id, ev.dueOn, ev.dueKm));
      const row = withEvaluation(
        {
          id: i.id,
          kind: 'item',
          reminderId: null,
          itemId: i.id,
          policyId: null,
          paymentId: null,
          templateId: i.template_id,
          vehicleId: i.vehicle_id,
          vehicleLabel: v.label,
          title: i.name,
          category: i.category,
          categoryLabel: CATEGORY_LABELS[i.category],
          origin: 'rule',
          snoozed: false,
          snoozedUntil: null,
          dueTime: null,
          repeat: null,
          legal: legalInfoFor({ category: i.category, templateId: i.template_id, policyKind: null }),
        },
        skipped ? skippedEvaluation(ev) : ev,
        v.distanceUnit,
      );
      out.push(skipped ? { ...row, label: 'Saltata', summary: `Saltata · ${row.text}` } : row);
    }
  }
  return out.sort(compareRows);
}
