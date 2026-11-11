// Scadenze di un'auto (S-30) e dettaglio di una scadenza (S-31): letture, nessuna scrittura.
import { estimateKmPerDay, reasonMessage, resolveLastDone } from '@/domain/maintenance';
import type { RateConfidence, RateParams } from '@/domain/maintenance';
import { formatDateIt, formatDistance } from '@/domain/units';
import type { DistanceUnit } from '@/domain/units';
import type { Deps, UsecaseResult } from '../context';
import { fail, ok } from '../context';
import { loadRateParams } from '../deadlines/rateParams';
import { countRows, groupRows, vehicleSummary } from './aggregate';
import { loadDeadlineRows, loadVehicleInfos } from './load';
import type { VehicleInfo } from './load';
import type { CompletionEntry, DeadlineDetail, DeadlineRow, RuleDescription, VehicleDeadlines } from './types';

/** Scadenze dell'auto per stato (scadute, in arrivo, in regola, da configurare). `null` se l'auto non esiste (o e' nel cestino). */
export async function getVehicleDeadlines(d: Deps, vehicleId: string): Promise<VehicleDeadlines | null> {
  const today = d.clock.todayLocal();
  const [vehicle] = await loadVehicleInfos(d.db, today, { vehicleId });
  if (!vehicle) return null;
  // auto venduta, rottamata o archiviata: i promemoria si fermano (SPEC 6.3.13)
  const rows = vehicle.status === 'active' ? await loadDeadlineRows(d.db, d.clock, [vehicle]) : [];
  return { vehicle: vehicleSummary(vehicle, rows), rows, groups: groupRows(rows), counts: countRows(rows) };
}

// ---------------------------------------------------------------- dettaglio

interface ItemDetailRow {
  schedule_type: 'interval_last_done' | 'interval_calendar' | 'fixed_date';
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
  notes: string | null;
}

const DEFAULT_OFFSETS = [30, 7, 0];

/** Preavvisi da JSON ('[30,7,0]'): valori non validi -> predefinito. */
export function parseOffsets(json: string | null | undefined): number[] {
  if (!json) return [...DEFAULT_OFFSETS];
  try {
    const v: unknown = JSON.parse(json);
    if (Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 365)) return v as number[];
  } catch {
    // JSON non valido
  }
  return [...DEFAULT_OFFSETS];
}

function describeRule(item: ItemDetailRow, unit: DistanceUnit): RuleDescription {
  const months = item.interval_months ? `${item.interval_months} mesi` : null;
  const km = item.interval_km ? formatDistance(item.interval_km, unit) : null;
  const end = item.period_end === 'end_of_month' ? ', entro fine mese' : '';
  let text: string;
  if (item.schedule_type === 'interval_last_done') {
    text =
      km && months ? `Ogni ${km} o ${months} (il primo dei due)${end}` : km ? `Ogni ${km}` : months ? `Ogni ${months}${end}` : 'Intervallo da impostare';
  } else if (item.schedule_type === 'interval_calendar') {
    text = `Ogni ${months ?? 'periodo da impostare'}${item.fixed_due_on ? `, con scadenza fissa al ${formatDateIt(item.fixed_due_on)}` : ''}`;
  } else {
    text = item.fixed_due_on ? `Scadenza fissa al ${formatDateIt(item.fixed_due_on)}` : 'Scadenza fissa: inserisci la data';
  }
  return {
    scheduleType: item.schedule_type,
    intervalKm: item.interval_km,
    intervalMonths: item.interval_months,
    periodEnd: item.period_end,
    fixedDueOn: item.fixed_due_on,
    soonDays: item.soon_days,
    soonKm: item.soon_km,
    notifyOffsetsDays: parseOffsets(item.notify_offsets_days),
    notifyEnabled: item.notify_enabled === 1,
    text,
  };
}

const CONFIDENCE_IT: Record<RateConfidence, string> = { none: 'nessuna', low: 'bassa', medium: 'media', high: 'alta' };

function forecastOf(v: VehicleInfo, today: string, rateParams: Partial<RateParams>): DeadlineDetail['forecast'] {
  const est = estimateKmPerDay(v.odometer, today, v.profile, rateParams);
  if (est.confidence === 'none') {
    return { kmPerDay: est.kmPerDay, confidence: 'none', text: reasonMessage('RATE_TOO_LOW') };
  }
  const perDay = formatDistance(Math.max(1, Math.round(est.kmPerDay)), v.distanceUnit);
  const initial = est.source === 'prior' ? ' (stima iniziale)' : '';
  return {
    kmPerDay: est.kmPerDay,
    confidence: est.confidence,
    text: `Circa ${perDay} al giorno${initial}: affidabilità ${CONFIDENCE_IT[est.confidence]}.`,
  };
}

function kmText(km: number | null, unit: DistanceUnit): string {
  return km != null ? ` a ${formatDistance(km, unit)}` : '';
}

/**
 * Dettaglio di una scadenza (S-31): regola, base di calcolo, previsione km e storico dei completamenti.
 * `id` e' l'id di un promemoria aperto oppure di una voce di manutenzione. Non trovato -> ITEM_NOT_FOUND.
 */
export async function getDeadlineDetail(d: Deps, id: string): Promise<UsecaseResult<DeadlineDetail>> {
  const today = d.clock.todayLocal();
  const owner =
    (await d.db.get<{ vehicle_id: string }>('SELECT vehicle_id FROM reminders WHERE id = ? AND deleted_at IS NULL', [id])) ??
    (await d.db.get<{ vehicle_id: string }>('SELECT vehicle_id FROM maintenance_items WHERE id = ? AND deleted_at IS NULL', [id]));
  if (!owner) return fail({ code: 'ITEM_NOT_FOUND' });
  const [vehicle] = await loadVehicleInfos(d.db, today, { vehicleId: owner.vehicle_id, activeOnly: true });
  if (!vehicle) return fail({ code: 'ITEM_NOT_FOUND' });
  const rows = await loadDeadlineRows(d.db, d.clock, [vehicle]);
  const row: DeadlineRow | undefined = rows.find((r) => r.id === id) ?? rows.find((r) => r.itemId === id);
  if (!row) return fail({ code: 'ITEM_NOT_FOUND' });

  const unit = vehicle.distanceUnit;
  let notes: string | null = null;
  let offsets = DEFAULT_OFFSETS;
  let rule: RuleDescription | null = null;
  let history: CompletionEntry[] = [];
  let basis: DeadlineDetail['basis'] = { source: 'none', lastDoneOn: null, lastDoneKm: null, text: '' };

  if (row.reminderId) {
    const r = await d.db.get<{ notes: string | null; notify_offsets_days: string }>(
      'SELECT notes, notify_offsets_days FROM reminders WHERE id = ?',
      [row.reminderId],
    );
    notes = r?.notes ?? null;
    offsets = parseOffsets(r?.notify_offsets_days);
  }

  if (row.itemId) {
    const item = await d.db.get<ItemDetailRow>(
      `SELECT schedule_type, interval_km, interval_months, period_end, fixed_due_on, baseline_on, baseline_km, soon_days, soon_km,
              notify_offsets_days, notify_enabled, notes FROM maintenance_items WHERE id = ?`,
      [row.itemId],
    );
    if (item) {
      rule = describeRule(item, unit);
      notes = notes ?? item.notes;
      if (!row.reminderId) offsets = rule.notifyOffsetsDays;
      const done = await d.db.all<{ id: string; done_on: string; done_km: number | null; source: CompletionEntry['source']; notes: string | null }>(
        `SELECT id, done_on, done_km, source, notes FROM maintenance_completions
          WHERE item_id = ? AND deleted_at IS NULL ORDER BY done_on DESC, created_at DESC, id DESC LIMIT 20`,
        [row.itemId],
      );
      history = done.map((c) => ({ id: c.id, doneOn: c.done_on, doneKm: c.done_km, source: c.source, notes: c.notes }));
      if (item.schedule_type === 'interval_last_done') {
        const last = resolveLastDone(
          history.map((h) => ({ doneOn: h.doneOn, doneKm: h.doneKm })),
          { baselineOn: item.baseline_on, baselineKm: item.baseline_km },
        );
        if (last) {
          const fromCompletion = history.length > 0;
          basis = {
            source: fromCompletion ? 'completion' : 'baseline',
            lastDoneOn: last.on,
            lastDoneKm: last.km ?? null,
            text: `${fromCompletion ? 'Ultimo intervento' : 'Base di calcolo'}: ${formatDateIt(last.on)}${kmText(last.km ?? null, unit)}`,
          };
        } else {
          basis = { source: 'none', lastDoneOn: null, lastDoneKm: null, text: reasonMessage('NO_LAST_DONE') };
        }
      } else if (item.fixed_due_on) {
        basis = { source: 'fixed', lastDoneOn: null, lastDoneKm: null, text: `Scadenza fissa al ${formatDateIt(item.fixed_due_on)}` };
      } else {
        basis = { source: 'none', lastDoneOn: null, lastDoneKm: null, text: reasonMessage('NO_FIXED_DATE') };
      }
    }
  } else if (row.origin === 'manual') {
    basis = {
      source: 'manual',
      lastDoneOn: null,
      lastDoneKm: null,
      text: row.dueOn ? `Scadenza inserita da te: ${formatDateIt(row.dueOn)}` : `Scadenza inserita da te: ${formatDistance(row.dueKm ?? 0, unit)}`,
    };
  } else {
    basis = {
      source: 'policy',
      lastDoneOn: null,
      lastDoneKm: null,
      text: row.origin === 'installment' ? 'Calcolata dalle rate della polizza.' : 'Calcolata dalla scadenza della polizza.',
    };
  }

  return ok({
    row,
    rule,
    basis,
    forecast: row.dueKm != null ? forecastOf(vehicle, today, await loadRateParams(d.db)) : null,
    history,
    notes,
    notifyOffsetsDays: offsets,
  });
}
