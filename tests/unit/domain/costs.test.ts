import { describe, expect, it } from 'vitest';
import {
  COST_SOURCES,
  costCategoryKey,
  costPerKm,
  costPerKmForPeriod,
  costSourceLabelIt,
  dedupeCostEntries,
  filterCostPeriod,
  filterCostSources,
  findPossibleDuplicates,
  groupCosts,
  monthlyCostSeries,
  totalCostCents,
  type CostEntry,
} from '@/domain/costs';
import type { OdometerReading } from '@/domain/odometer';

const C = (
  source: CostEntry['source'],
  sourceId: string,
  onDate: string,
  cents: number,
  categoryId?: string,
  vehicleId = 'v1',
): CostEntry => ({ vehicleId, onDate, source, sourceId, cents, categoryId: categoryId ?? null });

const entries: CostEntry[] = [
  C('service', 's1', '2026-01-15', 21000), // tagliando 210,00
  C('fuel', 'f1', '2026-01-20', 7436),
  C('fuel', 'f2', '2026-02-03', 6351),
  C('expense', 'e1', '2026-02-10', 1500, 'sys_parking'),
  C('expense', 'e2', '2026-02-11', 800, 'sys_toll'),
  C('expense', 'e3', '2026-03-05', 2200, 'sys_toll'),
  C('insurance', 'i1', '2026-03-10', 24000), // rata pagata
  C('fuel', 'f3', '2025-12-28', 5000),
];

describe('costs: totali senza doppioni', () => {
  it('somma intera in centesimi', () => {
    expect(totalCostCents(entries)).toBe(21000 + 7436 + 6351 + 1500 + 800 + 2200 + 24000 + 5000);
    expect(totalCostCents([])).toBe(0);
  });

  it('una riga che compare due volte (JOIN che moltiplica) conta una sola volta', () => {
    const dup = [...entries, entries[0]!, entries[1]!];
    expect(totalCostCents(dup)).toBe(totalCostCents(entries));
    const d = dedupeCostEntries(dup);
    expect(d.removed).toBe(2);
    expect(d.entries).toHaveLength(entries.length);
    expect(dedupeCostEntries(entries).removed).toBe(0);
  });

  it('lo stesso id in fonti diverse NON e un doppione (sono tabelle diverse)', () => {
    const x = [C('service', 'same', '2026-01-01', 100), C('expense', 'same', '2026-01-01', 100)];
    expect(totalCostCents(x)).toBe(200);
    expect(dedupeCostEntries(x).removed).toBe(0);
  });

  it('periodo con estremi inclusi e filtro per fonte', () => {
    expect(filterCostPeriod(entries, '2026-01-15', '2026-02-03').map((e) => e.sourceId)).toEqual(['s1', 'f1', 'f2']);
    expect(filterCostPeriod(entries, '2026-03-01').map((e) => e.sourceId)).toEqual(['e3', 'i1']);
    expect(filterCostPeriod(entries, null, '2025-12-31').map((e) => e.sourceId)).toEqual(['f3']);
    expect(filterCostSources(entries, ['fuel']).map((e) => e.sourceId)).toEqual(['f1', 'f2', 'f3']);
  });
});

describe('costs: raggruppamenti', () => {
  it('per mese: ordine cronologico', () => {
    const g = groupCosts(entries, 'month');
    expect(g.map((x) => x.key)).toEqual(['2025-12', '2026-01', '2026-02', '2026-03']);
    expect(g.map((x) => x.cents)).toEqual([5000, 28436, 8651, 26200]);
    expect(g.map((x) => x.count)).toEqual([1, 2, 3, 2]);
  });

  it('per anno', () => {
    const g = groupCosts(entries, 'year');
    expect(g).toEqual([
      expect.objectContaining({ key: '2025', cents: 5000, count: 1 }),
      expect.objectContaining({ key: '2026', cents: 21000 + 7436 + 6351 + 1500 + 800 + 2200 + 24000, count: 7 }),
    ]);
  });

  it('per fonte: dal piu costoso, con quote in punti base', () => {
    const g = groupCosts(entries, 'source');
    expect(g.map((x) => x.key)).toEqual(['insurance', 'service', 'fuel', 'expense']);
    const total = totalCostCents(entries);
    expect(g.find((x) => x.key === 'fuel')!.cents).toBe(7436 + 6351 + 5000);
    expect(g.reduce((s, x) => s + x.cents, 0)).toBe(total);
    // le quote sommano 10000 punti base entro l'arrotondamento
    expect(Math.abs(g.reduce((s, x) => s + x.shareBp, 0) - 10000)).toBeLessThanOrEqual(2);
    expect(g[0]!.shareBp).toBe(Math.round((24000 * 10000) / total));
  });

  it('per categoria: le spese hanno la loro categoria, il resto e una categoria a se', () => {
    const g = groupCosts(entries, 'category');
    expect(g.map((x) => x.key)).toEqual(['insurance', 'service', 'fuel', 'expense:sys_toll', 'expense:sys_parking']);
    expect(g.find((x) => x.key === 'expense:sys_toll')).toMatchObject({ cents: 3000, count: 2 });
    expect(costCategoryKey(C('expense', 'x', '2026-01-01', 1))).toBe('expense:none');
    expect(costCategoryKey(C('fuel', 'x', '2026-01-01', 1, 'ignorata'))).toBe('fuel');
  });

  it('un gruppo vuoto non divide per zero', () => {
    expect(groupCosts([], 'month')).toEqual([]);
    expect(groupCosts([C('fuel', 'x', '2026-01-01', 0)], 'source')).toEqual([{ key: 'fuel', cents: 0, count: 1, shareBp: 0 }]);
  });

  it('serie mensile con i mesi vuoti a zero', () => {
    const s = monthlyCostSeries(entries, '2025-11', '2026-04');
    expect(s.map((x) => x.key)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04']);
    expect(s.map((x) => x.cents)).toEqual([0, 5000, 28436, 8651, 26200, 0]);
    expect(monthlyCostSeries(entries, '2026-03', '2026-01')).toEqual([]);
    expect(monthlyCostSeries(entries, 'boh', '2026-01')).toEqual([]);
    expect(monthlyCostSeries([], '2026-12', '2027-01').map((x) => x.key)).toEqual(['2026-12', '2027-01']);
  });
});

describe('costs: possibili doppioni logici', () => {
  it('stesso importo, stesso giorno, fonti diverse -> indizio (non cambia i totali)', () => {
    const e = [
      C('service', 's', '2026-05-01', 21000),
      C('expense', 'x', '2026-05-01', 21000, 'sys_other'),
      C('fuel', 'f', '2026-05-01', 21000, undefined, 'v2'), // altro veicolo: non e un indizio
      C('expense', 'y', '2026-05-02', 21000),
    ];
    const d = findPossibleDuplicates(e);
    expect(d).toHaveLength(1);
    expect(d[0]!.entries.map((x) => x.sourceId).sort()).toEqual(['s', 'x']);
    expect(totalCostCents(e)).toBe(4 * 21000);
  });

  it('due spese uguali nella stessa fonte (due caffe) non sono un indizio; importo zero ignorato', () => {
    expect(findPossibleDuplicates([C('expense', 'a', '2026-05-01', 500), C('expense', 'b', '2026-05-01', 500)])).toEqual([]);
    expect(findPossibleDuplicates([C('service', 'a', '2026-05-01', 0), C('expense', 'b', '2026-05-01', 0)])).toEqual([]);
  });
});

describe('costs: costo al km', () => {
  const R = (id: string, readOn: string, km: number, status: OdometerReading['status'] = 'valid'): OdometerReading => ({
    id,
    readOn,
    km,
    source: 'manual',
    status,
  });
  const readings = [R('a', '2026-01-01', 10000), R('b', '2026-03-31', 12500), R('c', '2026-12-01', 19999, 'ignored')];

  it('totale del periodo diviso i km tra la prima e l ultima lettura del periodo', () => {
    const r = costPerKmForPeriod(entries, readings, '2026-01-01', '2026-03-31');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('atteso ok');
    expect(r.km).toBe(2500);
    expect(r.totalCents).toBe(21000 + 7436 + 6351 + 1500 + 800 + 2200 + 24000);
    expect(r.perKmMilli).toBe(Math.round((63287 * 10) / 2500)); // 0,253 EUR/km
    expect(r.text).toBe('0,25 €/km');
    expect(r.per100KmCents).toBe(Math.round((63287 * 100) / 2500));
    expect(r.explanationIt).toContain('prima e l\'ultima lettura del periodo');
    expect(r.explanationIt).toContain('632,87 €');
    expect(r.explanationIt).toContain('2.500 km');
  });

  it('le righe fuori periodo non contano (carburante di dicembre 2025 escluso)', () => {
    const r = costPerKmForPeriod(entries, readings, '2026-01-01', '2026-03-31');
    if (!r.ok) throw new Error('atteso ok');
    expect(r.totalCents).not.toBe(totalCostCents(entries));
  });

  it('solo alcune fonti (es. senza carburante)', () => {
    const r = costPerKmForPeriod(entries, readings, '2026-01-01', '2026-03-31', { sources: ['service', 'expense', 'insurance'] });
    if (!r.ok) throw new Error('atteso ok');
    expect(r.totalCents).toBe(21000 + 1500 + 800 + 2200 + 24000);
  });

  it('con meno di due letture nel periodo non e calcolabile e lo dice', () => {
    const r = costPerKmForPeriod(entries, readings, '2026-02-01', '2026-02-28');
    expect(r).toMatchObject({ ok: false, reason: 'NO_KM_DATA' });
    expect(r.explanationIt).toContain('almeno due letture');
  });

  it('stessi km nelle due letture: nessuna divisione per zero', () => {
    expect(costPerKm(1000, 0)).toMatchObject({ ok: false, reason: 'ZERO_DISTANCE' });
    expect(costPerKm(1000, null)).toMatchObject({ ok: false, reason: 'NO_KM_DATA' });
    const same = costPerKmForPeriod(entries, [R('a', '2026-01-01', 500), R('b', '2026-02-01', 500)], '2026-01-01', '2026-02-28');
    expect(same).toMatchObject({ ok: false, reason: 'ZERO_DISTANCE' });
  });

  it('nessun costo ma km percorsi: 0,00 EUR al km', () => {
    const r = costPerKm(0, 1000);
    expect(r).toMatchObject({ ok: true, perKmMilli: 0, text: '0,00 €/km' });
  });
});

describe('costs: fonti ed etichette', () => {
  it('le quattro fonti di v_costs', () => {
    expect([...COST_SOURCES]).toEqual(['service', 'fuel', 'expense', 'insurance']);
    expect(COST_SOURCES.map(costSourceLabelIt)).toEqual(['Interventi', 'Carburante', 'Spese', 'Assicurazione']);
  });
});
