// Serie mensile dei costi per il grafico a barre (S-60) e per la sua alternativa tabellare: i mesi senza costi valgono zero.
import { monthlyCostSeries } from '@/domain/costs';
import { formatMonthYearIt } from '@/domain/units';
import type { Deps } from '../context';
import { periodOfLastMonths, resolvePeriod, type DatePeriod } from './period';
import { loadCostEntries, vehicleExists } from './store';
import { bySourcePerMonth, emptyBySource } from './summary';
import type { CostSeries, CostsOptions } from './types';

/** Quanti mesi mostra la serie quando non si indica un periodo. */
export const DEFAULT_SERIES_MONTHS = 12;

/**
 * Serie mensile dei costi di un veicolo. Senza `period` (omesso o `undefined`) sono gli ultimi 12 mesi fino a quello di oggi.
 * Con un periodo: `to` mancante = oggi, `from` mancante = il primo mese con costi (o il mese di `to` se non ce ne sono);
 * un periodo e' inclusivo e i mesi vuoti restano nella serie con zero. `null` se il veicolo non esiste.
 */
export async function getCostSeries(
  d: Pick<Deps, 'db' | 'clock'>,
  vehicleId: string,
  period?: DatePeriod | null,
  opts: CostsOptions = {},
): Promise<CostSeries | null> {
  if (!(await vehicleExists(d.db, vehicleId))) return null;
  const today = d.clock.todayLocal();
  const bounds = period == null ? periodOfLastMonths(today, DEFAULT_SERIES_MONTHS) : resolvePeriod(period);
  const to = bounds.to ?? today;
  const entries = await loadCostEntries(d.db, vehicleId, { from: bounds.from, to }, opts.excludeCategoryIds);
  const from = bounds.from ?? entries[0]?.onDate ?? to;
  const fromMonth = from.slice(0, 7);
  const toMonth = to.slice(0, 7);
  const perMonth = bySourcePerMonth(entries);
  const points = monthlyCostSeries(entries, fromMonth, toMonth).map((g) => ({
    month: g.key,
    label: formatMonthYearIt(g.key),
    cents: g.cents,
    count: g.count,
    bySource: perMonth.get(g.key) ?? emptyBySource(),
  }));
  const totalCents = points.reduce((s, p) => s + p.cents, 0);
  return {
    vehicleId,
    fromMonth,
    toMonth,
    points,
    totalCents,
    maxCents: points.reduce((m, p) => Math.max(m, p.cents), 0),
    averagePerMonthCents: points.length > 0 ? Math.round(totalCents / points.length) : 0,
  };
}
