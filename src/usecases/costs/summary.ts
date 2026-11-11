// Costi (F-42; SPEC 6.3.8 S-60): totali per fonte, categoria, mese e anno, costo al km e indizi di doppioni, sulla vista
// `v_costs` (interventi, rifornimenti, spese e rate pagate: ogni costo vive in UNA sola tabella, quindi nessun doppione).
// Sola lettura. Le somme si fanno nel dominio (`groupCosts`, `costPerKmForPeriod`), in interi.
import {
  costPerKmForPeriod,
  costSourceLabelIt,
  dedupeCostEntries,
  findPossibleDuplicates,
  groupCosts,
  type CostEntry,
  type CostSource,
} from '@/domain/costs';
import { formatMonthYearIt } from '@/domain/units';
import type { Deps } from '../context';
import { loadReadings } from '../odometer/store';
import { resolvePeriod, type DatePeriod } from './period';
import { loadCategoryLabels, loadCostEntries, vehicleExists } from './store';
import type {
  CostCategoryTotal,
  CostMonthTotal,
  CostSourceTotal,
  CostSummary,
  CostsOptions,
  CostYearTotal,
} from './types';

/** Un record con tutte le fonti a zero. */
export const emptyBySource = (): Record<CostSource, number> => ({ service: 0, fuel: 0, expense: 0, insurance: 0 });

/** Ripartisce per fonte le righe di ogni mese ('YYYY-MM'). */
export function bySourcePerMonth(entries: readonly CostEntry[]): Map<string, Record<CostSource, number>> {
  const out = new Map<string, Record<CostSource, number>>();
  for (const e of dedupeCostEntries(entries).entries) {
    const m = e.onDate.slice(0, 7);
    const rec = out.get(m) ?? emptyBySource();
    rec[e.source] += e.cents;
    out.set(m, rec);
  }
  return out;
}

/**
 * Riepilogo dei costi di un veicolo nel periodo (default: sempre): totale, per fonte, per categoria (le spese con la loro
 * categoria), per mese e per anno, il costo al km con la spiegazione del calcolo e gli indizi di costi registrati due volte.
 * `null` se il veicolo non esiste. Con meno di due letture km nel periodo il costo al km e' `NO_KM_DATA` (non si inventa).
 */
export async function getCostSummary(
  d: Pick<Deps, 'db'>,
  vehicleId: string,
  period?: DatePeriod | null,
  opts: CostsOptions = {},
): Promise<CostSummary | null> {
  if (!(await vehicleExists(d.db, vehicleId))) return null;
  const p = resolvePeriod(period);
  const { entries } = dedupeCostEntries(await loadCostEntries(d.db, vehicleId, p, opts.excludeCategoryIds));
  const labels = await loadCategoryLabels(d.db);
  const readings = await loadReadings(d.db, vehicleId);

  const bySource: CostSourceTotal[] = groupCosts(entries, 'source').map((g) => ({
    source: g.key as CostSource,
    label: costSourceLabelIt(g.key as CostSource),
    cents: g.cents,
    count: g.count,
    shareBp: g.shareBp,
  }));

  const byCategory: CostCategoryTotal[] = groupCosts(entries, 'category').map((g) => {
    if (g.key.startsWith('expense:')) {
      const raw = g.key.slice('expense:'.length);
      const categoryId = raw === 'none' ? null : raw;
      const cat = categoryId !== null ? labels.get(categoryId) : undefined;
      return {
        key: g.key,
        source: 'expense' as const,
        categoryId,
        label: cat?.name ?? 'Senza categoria',
        icon: cat?.icon ?? null,
        cents: g.cents,
        count: g.count,
        shareBp: g.shareBp,
      };
    }
    return {
      key: g.key,
      source: g.key as CostSource,
      categoryId: null,
      label: costSourceLabelIt(g.key as CostSource),
      icon: null,
      cents: g.cents,
      count: g.count,
      shareBp: g.shareBp,
    };
  });

  const perMonth = bySourcePerMonth(entries);
  const byMonth: CostMonthTotal[] = groupCosts(entries, 'month').map((g) => ({
    month: g.key,
    label: formatMonthYearIt(g.key),
    cents: g.cents,
    count: g.count,
    bySource: perMonth.get(g.key) ?? emptyBySource(),
  }));
  const byYear: CostYearTotal[] = groupCosts(entries, 'year').map((g) => ({ year: Number(g.key), cents: g.cents, count: g.count }));

  return {
    vehicleId,
    period: p,
    totalCents: entries.reduce((s, e) => s + e.cents, 0),
    count: entries.length,
    bySource,
    byCategory,
    byMonth,
    byYear,
    costPerKm: costPerKmForPeriod(entries, readings, p.from ?? '0001-01-01', p.to ?? '9999-12-31'),
    possibleDuplicates: findPossibleDuplicates(entries),
  };
}
