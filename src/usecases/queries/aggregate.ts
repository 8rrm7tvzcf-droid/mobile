// Raggruppamenti e semafori (SPEC 6.3.4): conteggi per stato, stato della categoria = il peggiore fra le sue voci.
import type { ReminderCategory } from '@/domain/reminders';
import { CATEGORY_LABELS, CATEGORY_ORDER, ICON_OF_TONE, worstTone } from './describe';
import type { VehicleInfo } from './load';
import type { CategorySummary, DeadlineGroups, DeadlineRow, StateCounts, VehicleSummary } from './types';

export function groupRows(rows: readonly DeadlineRow[]): DeadlineGroups {
  const g: DeadlineGroups = { overdue: [], soon: [], ok: [], unknown: [] };
  for (const r of rows) g[r.group].push(r);
  return g;
}

export function countRows(rows: readonly DeadlineRow[]): StateCounts {
  const c: StateCounts = { overdue: 0, soon: 0, ok: 0, unknown: 0, total: rows.length };
  for (const r of rows) c[r.state]++;
  return c;
}

/** Un semaforo per ogni categoria che ha almeno una voce, nell'ordine di SPEC 6.3.4. */
export function categorySummaries(rows: readonly DeadlineRow[]): CategorySummary[] {
  const out: CategorySummary[] = [];
  for (const category of CATEGORY_ORDER) {
    const mine = rows.filter((r) => r.category === category);
    if (mine.length === 0) continue;
    const tone = worstTone(mine.map((r) => r.tone));
    out.push({ category: category as ReminderCategory, label: CATEGORY_LABELS[category], tone, icon: ICON_OF_TONE[tone], counts: countRows(mine) });
  }
  return out;
}

/** La voce piu' urgente fra quelle con una scadenza calcolata (le "da configurare" non fanno da prossima scadenza). */
export function nextDeadline(rows: readonly DeadlineRow[]): DeadlineRow | null {
  return rows.find((r) => r.state !== 'unknown') ?? null;
}

export function vehicleSummary(v: VehicleInfo, vehicleRows: readonly DeadlineRow[]): VehicleSummary {
  const tone = worstTone(vehicleRows.map((r) => r.tone));
  return {
    id: v.id,
    label: v.label,
    plate: v.plate,
    make: v.make,
    model: v.model,
    status: v.status,
    isDemo: v.isDemo,
    distanceUnit: v.distanceUnit,
    currentKm: v.currentKm,
    currentKmText: v.currentKmText,
    lastReadingOn: v.lastReadingOn,
    tone,
    icon: ICON_OF_TONE[tone],
    counts: countRows(vehicleRows),
    next: nextDeadline(vehicleRows),
  };
}
