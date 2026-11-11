// Totali per mese, anno e categoria, senza doppioni (F-42, SPEC §6.3.8 S-60). Interi in centesimi, funzioni pure.
import { addMonths, compareDates, isValidDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/ports';
import type { CostEntry, CostSource } from './types';

/** Tiene la prima occorrenza di ogni (source, sourceId): una JOIN che moltiplica le righe non gonfia i totali. */
export function dedupeCostEntries(entries: readonly CostEntry[]): { entries: CostEntry[]; removed: number } {
  const seen = new Set<string>();
  const out: CostEntry[] = [];
  for (const e of entries) {
    const k = `${e.source}:${e.sourceId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return { entries: out, removed: entries.length - out.length };
}

/** Righe con data in [from, to] (estremi inclusi). `from` e `to` opzionali. */
export function filterCostPeriod(entries: readonly CostEntry[], from?: LocalDate | null, to?: LocalDate | null): CostEntry[] {
  return entries.filter(
    (e) => (!from || compareDates(e.onDate, from) >= 0) && (!to || compareDates(e.onDate, to) <= 0),
  );
}

export function filterCostSources(entries: readonly CostEntry[], sources: readonly CostSource[]): CostEntry[] {
  return entries.filter((e) => sources.includes(e.source));
}

/** Totale in centesimi, SENZA doppioni. */
export function totalCostCents(entries: readonly CostEntry[]): number {
  let t = 0;
  for (const e of dedupeCostEntries(entries).entries) t += e.cents;
  return t;
}

/** La "categoria di costo": interventi, carburante e assicurazione sono categorie a se', le spese hanno la loro. */
export function costCategoryKey(e: Pick<CostEntry, 'source' | 'categoryId'>): string {
  return e.source === 'expense' ? `expense:${e.categoryId ?? 'none'}` : e.source;
}

export type CostGrouping = 'month' | 'year' | 'source' | 'category';

export interface CostGroup {
  /** 'YYYY-MM' o 'YYYY' per i periodi; 'service' | 'fuel' | 'expense' | 'insurance' per fonte; `costCategoryKey` per categoria. */
  key: string;
  cents: number;
  count: number;
  /** Quota sul totale in punti base (10000 = 100%); le quote arrotondate possono non sommare esattamente 10000. */
  shareBp: number;
}

function groupKey(e: CostEntry, by: CostGrouping): string {
  switch (by) {
    case 'month':
      return e.onDate.slice(0, 7);
    case 'year':
      return e.onDate.slice(0, 4);
    case 'source':
      return e.source;
    case 'category':
      return costCategoryKey(e);
  }
}

/**
 * Raggruppa i costi. I periodi sono in ordine cronologico crescente; fonti e categorie dal piu' costoso al meno
 * (a parita' per chiave). Le righe duplicate (stessa fonte e stesso id) contano una volta sola.
 */
export function groupCosts(entries: readonly CostEntry[], by: CostGrouping): CostGroup[] {
  const { entries: unique } = dedupeCostEntries(entries);
  const map = new Map<string, { cents: number; count: number }>();
  let total = 0;
  for (const e of unique) {
    const k = groupKey(e, by);
    const g = map.get(k) ?? { cents: 0, count: 0 };
    g.cents += e.cents;
    g.count += 1;
    map.set(k, g);
    total += e.cents;
  }
  const groups: CostGroup[] = [...map.entries()].map(([key, g]) => ({
    key,
    cents: g.cents,
    count: g.count,
    shareBp: total > 0 ? Math.round((g.cents * 10000) / total) : 0,
  }));
  const chronological = by === 'month' || by === 'year';
  groups.sort(chronological ? (a, b) => (a.key < b.key ? -1 : 1) : (a, b) => b.cents - a.cents || (a.key < b.key ? -1 : 1));
  return groups;
}

/** Serie mensile con i mesi senza spese a zero (grafici e tabella): da `fromMonth` a `toMonth` inclusi ('YYYY-MM'). */
export function monthlyCostSeries(entries: readonly CostEntry[], fromMonth: string, toMonth: string): CostGroup[] {
  const byMonth = new Map(groupCosts(entries, 'month').map((g) => [g.key, g]));
  const out: CostGroup[] = [];
  if (!isValidDate(`${fromMonth}-01`) || !isValidDate(`${toMonth}-01`) || fromMonth > toMonth) return out;
  let d: LocalDate = `${fromMonth}-01`;
  for (let guard = 0; guard < 1200; guard++) {
    const key = d.slice(0, 7);
    if (key > toMonth) break;
    out.push(byMonth.get(key) ?? { key, cents: 0, count: 0, shareBp: 0 });
    d = addMonths(d, 1);
  }
  return out;
}

export interface PossibleDuplicate {
  onDate: LocalDate;
  cents: number;
  entries: CostEntry[];
}

/**
 * Indizi di doppioni LOGICI: lo stesso importo, nello stesso giorno, per lo stesso veicolo, registrato in fonti diverse
 * (es. un tagliando da 210 EUR inserito anche come spesa). Non cambia i totali: serve a chiedere conferma all'utente.
 */
export function findPossibleDuplicates(entries: readonly CostEntry[]): PossibleDuplicate[] {
  const { entries: unique } = dedupeCostEntries(entries);
  const map = new Map<string, CostEntry[]>();
  for (const e of unique) {
    if (e.cents <= 0) continue;
    const k = `${e.vehicleId ?? ''}|${e.onDate}|${e.cents}`;
    const list = map.get(k);
    if (list) list.push(e);
    else map.set(k, [e]);
  }
  const out: PossibleDuplicate[] = [];
  for (const list of map.values()) {
    if (new Set(list.map((e) => e.source)).size > 1) out.push({ onDate: list[0]!.onDate, cents: list[0]!.cents, entries: list });
  }
  return out.sort((a, b) => compareDates(a.onDate, b.onDate) || a.cents - b.cents);
}
