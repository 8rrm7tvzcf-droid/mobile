// Costi (S-60, F-42): presentazione di costo al km, ripartizioni e grafico mensile con la sua alternativa testuale. Pura.
import { MONTHS_IT, formatEuro, formatMonthYearIt, formatPercentBp } from '@/domain/units';
import type { CostPerKm } from '@/domain/costs';
import type { CostSeries, CostSummary } from '@/usecases/costs';
import { it } from '../i18n/it';

export interface PerKmView {
  ok: boolean;
  /** "0,35 €/km" oppure, se non si puo' calcolare, la frase che lo spiega. */
  headline: string;
  /** Come e' stato calcolato, o cosa manca. */
  detail: string;
  /** Se manca qualcosa che l'utente puo' fare subito (aggiornare i km). */
  needsKm: boolean;
}

export function perKmView(c: CostPerKm): PerKmView {
  if (c.ok) {
    return { ok: true, headline: c.text, detail: `${c.explanationIt} ${it.costs.perKmEven(formatEuro(c.per100KmCents))}`, needsKm: false };
  }
  const detail = c.reason === 'NO_KM_DATA' ? it.costs.perKmNoData : it.costs.perKmZero;
  return { ok: false, headline: detail, detail: c.explanationIt, needsKm: true };
}

export interface ShareRow {
  key: string;
  label: string;
  amount: string;
  share: string;
  count: string;
}

export function sourceRows(s: CostSummary): ShareRow[] {
  return s.bySource.map((r) => ({
    key: r.source,
    label: r.label,
    amount: formatEuro(r.cents),
    share: formatPercentBp(r.shareBp),
    count: it.costs.entriesCount(r.count),
  }));
}

export function categoryRows(s: CostSummary): ShareRow[] {
  return s.byCategory.map((r) => ({
    key: r.key,
    label: r.label,
    amount: formatEuro(r.cents),
    share: formatPercentBp(r.shareBp),
    count: it.costs.entriesCount(r.count),
  }));
}

export const shareRowA11y = (r: ShareRow): string => `${r.label}: ${r.amount}, ${r.share}, ${r.count}`;

export interface ChartBar {
  month: string;
  /** "ott" (con l'anno a gennaio e sulla prima barra: "gen 26"). */
  shortLabel: string;
  /** "ottobre 2026". */
  longLabel: string;
  cents: number;
  /** 0..1 rispetto al mese piu' alto. */
  ratio: number;
  amountText: string;
}

const short = (month: string): string => (MONTHS_IT[Number(month.slice(5, 7)) - 1] ?? '').slice(0, 3);

export function chartBars(series: CostSeries): ChartBar[] {
  return series.points.map((p, i) => ({
    month: p.month,
    shortLabel: p.month.endsWith('-01') || i === 0 ? `${short(p.month)} ${p.month.slice(2, 4)}` : short(p.month),
    longLabel: formatMonthYearIt(p.month),
    cents: p.cents,
    ratio: series.maxCents > 0 ? p.cents / series.maxCents : 0,
    amountText: formatEuro(p.cents),
  }));
}

/** Riassunto a parole del grafico per chi usa un lettore di schermo (e per tutti: sta sopra la tabella). */
export function chartSummary(series: CostSeries): string {
  if (series.totalCents <= 0) return it.costs.chartEmpty;
  const top = series.points.reduce((best, p) => (p.cents > best.cents ? p : best), series.points[0] as CostSeries['points'][number]);
  return it.costs.chartSummary(
    series.points.length,
    formatEuro(series.totalCents),
    formatEuro(series.averagePerMonthCents),
    `${formatMonthYearIt(top.month)} (${formatEuro(top.cents)})`,
  );
}
