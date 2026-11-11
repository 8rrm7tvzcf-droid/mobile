// Regole di manutenzione modificabili dall'utente (SPEC 3.2 F-19/F-20, S-31 "modifica"): `updateDeadlineRule` per le voci
// esistenti (anche nate dal catalogo: i valori dei template sono indicativi e vanno sempre poter essere cambiati) e
// `addCustomRule` per una voce senza template. Dopo la scrittura si riconcilia nella stessa transazione.
import { isValidDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/dates';
import type { ItemCategory, ReasonCode, ReminderState, ScheduleType } from '@/domain/maintenance';
import { isValidKm } from '@/domain/units';
import type { Deps, UsecaseResult } from '../context';
import { abortNotFound, abortValidation, guard, parseOffsets } from './internal';
import { previewItem, reconcileInTx } from './load';

export interface DeadlineRulePatch {
  name?: string;
  intervalKm?: number | null;
  intervalMonths?: number | null;
  periodEnd?: 'exact' | 'end_of_month';
  /** Prossima data (serie di calendario e date fisse). */
  fixedDueOn?: LocalDate | null;
  /** Ultimo "fatto" noto (la base di calcolo finche' non c'e' un completamento): serve a configurare una voce "Da configurare". */
  baselineOn?: LocalDate | null;
  baselineKm?: number | null;
  soonDays?: number;
  soonKm?: number;
  /** Giorni di preavviso (0 = il giorno stesso). */
  notifyOffsetsDays?: number[];
  notifyEnabled?: boolean;
  /** Falso = voce disattivata: nessun promemoria, nessuna notifica (i dati restano). */
  isActive?: boolean;
  notes?: string | null;
}

export interface DeadlineRuleResult {
  itemId: string;
  state: ReminderState;
  effectiveDueOn: LocalDate | null;
  reasons: ReasonCode[];
}

interface RuleFields {
  name: string;
  schedule_type: ScheduleType;
  interval_km: number | null;
  interval_months: number | null;
  period_end: 'exact' | 'end_of_month';
  fixed_due_on: string | null;
  baseline_on: string | null;
  baseline_km: number | null;
  soon_days: number;
  soon_km: number;
  notify_offsets: number[];
  notify_enabled: boolean;
  is_active: boolean;
  notes: string | null;
}

/** Controlli equivalenti ai CHECK dello schema, con messaggi in italiano. */
function validateRule(r: RuleFields, today: LocalDate): void {
  const name = r.name.trim();
  if (name.length < 1 || name.length > 80) abortValidation('name', 'Il nome deve avere da 1 a 80 caratteri.');
  if (r.interval_km !== null && (!Number.isInteger(r.interval_km) || r.interval_km < 100 || r.interval_km > 1_000_000)) {
    abortValidation('intervalKm', "L'intervallo in km deve essere un numero intero tra 100 e 1.000.000.");
  }
  if (r.interval_months !== null && (!Number.isInteger(r.interval_months) || r.interval_months < 1 || r.interval_months > 240)) {
    abortValidation('intervalMonths', "L'intervallo in mesi deve essere un numero intero tra 1 e 240.");
  }
  if (r.schedule_type === 'interval_last_done' && r.interval_km === null && r.interval_months === null) {
    abortValidation('intervalKm', 'Serve almeno un intervallo: in km o in mesi.');
  }
  if (r.schedule_type === 'interval_calendar' && r.interval_months === null) {
    abortValidation('intervalMonths', 'Serve la ripetizione in mesi.');
  }
  if (r.schedule_type === 'fixed_date' && (r.interval_km !== null || r.interval_months !== null)) {
    abortValidation('intervalKm', 'Una scadenza a data fissa non ha intervalli.');
  }
  if (r.fixed_due_on !== null && !isValidDate(r.fixed_due_on)) abortValidation('fixedDueOn', 'La data non è valida.');
  if (r.baseline_on !== null) {
    if (!isValidDate(r.baseline_on)) abortValidation('baselineOn', 'La data non è valida.');
    else if (r.baseline_on > today) abortValidation('baselineOn', "La data dell'ultima volta non può essere nel futuro.");
  }
  if (r.baseline_km !== null) {
    if (!isValidKm(r.baseline_km)) abortValidation('baselineKm', 'I km devono essere un numero intero tra 0 e 2.000.000.');
    if (r.baseline_on === null) abortValidation('baselineKm', 'Per indicare i km serve anche la data dell\'ultima volta.');
  }
  if (!Number.isInteger(r.soon_days) || r.soon_days < 0 || r.soon_days > 365) {
    abortValidation('soonDays', 'I giorni di preavviso "in arrivo" devono essere da 0 a 365.');
  }
  if (!Number.isInteger(r.soon_km) || r.soon_km < 0 || r.soon_km > 100_000) {
    abortValidation('soonKm', 'I km "in arrivo" devono essere da 0 a 100.000.');
  }
  if (r.notify_offsets.length > 10 || r.notify_offsets.some((n) => !Number.isInteger(n) || n < 0 || n > 365)) {
    abortValidation('notifyOffsetsDays', 'I preavvisi devono essere giorni interi da 0 a 365 (al massimo 10).');
  }
}

const normOffsets = (v: number[]): number[] => [...new Set(v)].sort((a, b) => b - a);

export async function updateDeadlineRule(d: Deps, itemId: string, patch: DeadlineRulePatch): Promise<UsecaseResult<DeadlineRuleResult>> {
  const today = d.clock.todayLocal();
  let vehicleId = '';
  const res = await guard(() =>
    d.db.transaction(async (tx): Promise<DeadlineRuleResult> => {
      const row = await tx.get<{
        vehicle_id: string;
        name: string;
        schedule_type: ScheduleType;
        interval_km: number | null;
        interval_months: number | null;
        period_end: 'exact' | 'end_of_month';
        fixed_due_on: string | null;
        baseline_on: string | null;
        baseline_km: number | null;
        soon_days: number;
        soon_km: number;
        notify_offsets_days: string;
        notify_enabled: number;
        is_active: number;
        notes: string | null;
      }>(
        `SELECT vehicle_id, name, schedule_type, interval_km, interval_months, period_end, fixed_due_on, baseline_on, baseline_km,
                soon_days, soon_km, notify_offsets_days, notify_enabled, is_active, notes
         FROM maintenance_items WHERE id = ? AND deleted_at IS NULL`,
        [itemId],
      );
      if (!row) return abortNotFound();
      vehicleId = row.vehicle_id;
      const merged: RuleFields = {
        name: patch.name ?? row.name,
        schedule_type: row.schedule_type,
        interval_km: patch.intervalKm !== undefined ? patch.intervalKm : row.interval_km,
        interval_months: patch.intervalMonths !== undefined ? patch.intervalMonths : row.interval_months,
        period_end: patch.periodEnd ?? row.period_end,
        fixed_due_on: patch.fixedDueOn !== undefined ? patch.fixedDueOn : row.fixed_due_on,
        baseline_on: patch.baselineOn !== undefined ? patch.baselineOn : row.baseline_on,
        baseline_km: patch.baselineKm !== undefined ? patch.baselineKm : row.baseline_km,
        soon_days: patch.soonDays ?? row.soon_days,
        soon_km: patch.soonKm ?? row.soon_km,
        notify_offsets: normOffsets(patch.notifyOffsetsDays ?? parseOffsets(row.notify_offsets_days)),
        notify_enabled: patch.notifyEnabled ?? row.notify_enabled === 1,
        is_active: patch.isActive ?? row.is_active === 1,
        notes: patch.notes !== undefined ? (patch.notes?.trim() ? patch.notes.trim() : null) : row.notes,
      };
      // la data di base gia' salvata non si ricontrolla se l'utente non la tocca (potrebbe essere una data derivata)
      validateRule(patch.baselineOn === undefined && patch.baselineKm === undefined ? { ...merged, baseline_on: null, baseline_km: null } : merged, today);
      await tx.run(
        `UPDATE maintenance_items SET name = ?, interval_km = ?, interval_months = ?, period_end = ?, fixed_due_on = ?,
           baseline_on = ?, baseline_km = ?, soon_days = ?, soon_km = ?, notify_offsets_days = ?, notify_enabled = ?, is_active = ?,
           notes = ?, updated_at = ? WHERE id = ?`,
        [
          merged.name.trim(),
          merged.interval_km,
          merged.interval_months,
          merged.period_end,
          merged.fixed_due_on,
          merged.baseline_on,
          merged.baseline_km,
          merged.soon_days,
          merged.soon_km,
          JSON.stringify(merged.notify_offsets),
          merged.notify_enabled ? 1 : 0,
          merged.is_active ? 1 : 0,
          merged.notes,
          d.clock.nowIso(),
          itemId,
        ],
      );
      const outcome = await reconcileInTx(tx, d, row.vehicle_id);
      const ev = outcome.input ? previewItem(outcome.input, itemId)?.evaluation : undefined;
      return { itemId, state: ev?.state ?? 'unknown', effectiveDueOn: ev?.effectiveDueOn ?? null, reasons: ev?.reasons ?? [] };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId });
  return res;
}

export interface CustomRuleInput {
  vehicleId: string;
  name: string;
  category?: ItemCategory;
  scheduleType: ScheduleType;
  intervalKm?: number | null;
  intervalMonths?: number | null;
  periodEnd?: 'exact' | 'end_of_month';
  fixedDueOn?: LocalDate | null;
  baselineOn?: LocalDate | null;
  baselineKm?: number | null;
  soonDays?: number;
  soonKm?: number;
  notifyOffsetsDays?: number[];
  notes?: string | null;
}

/** Voce di manutenzione senza template ("Rabbocco liquido X ogni 6 mesi"): stesse regole e stessa riconciliazione delle altre. */
export async function addCustomRule(d: Deps, input: CustomRuleInput): Promise<UsecaseResult<DeadlineRuleResult>> {
  const today = d.clock.todayLocal();
  const res = await guard(() =>
    d.db.transaction(async (tx): Promise<DeadlineRuleResult> => {
      const v = await tx.get<{ id: string }>('SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [input.vehicleId]);
      if (!v) return abortNotFound();
      const rule: RuleFields = {
        name: input.name,
        schedule_type: input.scheduleType,
        interval_km: input.intervalKm ?? null,
        interval_months: input.intervalMonths ?? null,
        period_end: input.periodEnd ?? 'exact',
        fixed_due_on: input.fixedDueOn ?? null,
        baseline_on: input.baselineOn ?? null,
        baseline_km: input.baselineKm ?? null,
        soon_days: input.soonDays ?? 30,
        soon_km: input.soonKm ?? 1500,
        notify_offsets: normOffsets(input.notifyOffsetsDays ?? [30, 7, 0]),
        notify_enabled: true,
        is_active: true,
        notes: input.notes?.trim() ? input.notes.trim() : null,
      };
      validateRule(rule, today);
      const id = d.ids.ulid();
      const now = d.clock.nowIso();
      await tx.run(
        `INSERT INTO maintenance_items (id, vehicle_id, name, category, schedule_type, interval_km, interval_months, period_end,
           fixed_due_on, baseline_on, baseline_km, soon_days, soon_km, notify_offsets_days, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.vehicleId,
          rule.name.trim(),
          input.category ?? 'other',
          rule.schedule_type,
          rule.interval_km,
          rule.interval_months,
          rule.period_end,
          rule.fixed_due_on,
          rule.baseline_on,
          rule.baseline_km,
          rule.soon_days,
          rule.soon_km,
          JSON.stringify(rule.notify_offsets),
          rule.notes,
          now,
          now,
        ],
      );
      const outcome = await reconcileInTx(tx, d, input.vehicleId);
      const ev = outcome.input ? previewItem(outcome.input, id)?.evaluation : undefined;
      return { itemId: id, state: ev?.state ?? 'unknown', effectiveDueOn: ev?.effectiveDueOn ?? null, reasons: ev?.reasons ?? [] };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId: input.vehicleId });
  return res;
}
