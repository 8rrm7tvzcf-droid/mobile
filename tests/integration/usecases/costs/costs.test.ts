// Costi e costo al km (F-42, AC-07.6): totali senza doppioni tra interventi, rifornimenti, spese e rate pagate
// (vista v_costs), per fonte, categoria, mese e anno; costo al km con NO_KM_DATA; serie mensile; esclusione di categorie.
import { beforeEach, describe, expect, it } from 'vitest';
import { addExpense, createExpenseCategory, deleteExpense } from '@/usecases/expenses';
import { addFuelLog, deleteFuelLog } from '@/usecases/fuel';
import { getCostSeries, getCostSummary, periodOfLastMonths, periodOfMonth, periodOfYear } from '@/usecases/costs';
import { insertRow, serviceRow } from '../../../support/db';
import { populateSampleData, SAMPLE_EXPECTED, SAMPLE_IDS } from '../../../support/sampleData';
import { makeHarness, unwrap, type Harness } from '../vehicles/harness';

let h: Harness;
const V1 = SAMPLE_IDS.vehicle1;
beforeEach(async () => {
  h = await makeHarness(); // oggi = 2026-10-08
  await populateSampleData(h.db);
  h.clearEvents();
});

const summary = async (period?: Parameters<typeof getCostSummary>[2], opts?: Parameters<typeof getCostSummary>[3]) =>
  (await getCostSummary(h.deps, V1, period, opts))!;

describe('getCostSummary: nessun doppione tra interventi, rifornimenti, spese e rate pagate', () => {
  it('somma le quattro fonti UNA volta (le righe dell\'intervento e le rate non pagate non contano)', async () => {
    const e = SAMPLE_EXPECTED.costsByVehicle1;
    const s = await summary();
    expect(s.totalCents).toBe(e.service + e.fuel + e.expense + e.insurance); // 21000 + 11500 + 1200 + 20000
    expect(s.count).toBe(1 + 2 + 1 + 1);
    expect(Object.fromEntries(s.bySource.map((b) => [b.source, b.cents]))).toEqual({
      service: e.service,
      fuel: e.fuel,
      expense: e.expense,
      insurance: e.insurance,
    });
    // le righe dell'intervento (9000 di olio...) e il premio annuo (40000) non si sommano ai totali
    const lines = await h.db.get<{ t: number }>('SELECT SUM(amount_cents) AS t FROM service_lines');
    expect(lines!.t).toBeGreaterThan(0);
    expect(s.totalCents).toBe(53700);
  });

  it('per fonte: dal piu\' costoso, con le etichette italiane e le quote in punti base', async () => {
    const s = await summary();
    expect(s.bySource.map((b) => [b.source, b.label])).toEqual([
      ['service', 'Interventi'],
      ['insurance', 'Assicurazione'],
      ['fuel', 'Carburante'],
      ['expense', 'Spese'],
    ]);
    expect(s.bySource[0]!.shareBp).toBe(Math.round((21000 * 10000) / 53700));
  });

  it('per categoria: interventi, carburante e assicurazione a se\', le spese con la loro categoria', async () => {
    const custom = unwrap(await createExpenseCategory(h.deps, { name: 'Radio', icon: 'music' }));
    unwrap(await addExpense(h.deps, { vehicleId: V1, spentOn: '2026-04-20', categoryId: 'sys_tolls', amountCents: 800 }));
    unwrap(await addExpense(h.deps, { vehicleId: V1, spentOn: '2026-04-25', categoryId: custom.id, amountCents: 3000 }));
    const s = await summary();
    const byKey = Object.fromEntries(s.byCategory.map((c) => [c.key, c]));
    expect(byKey['service']).toMatchObject({ source: 'service', cents: 21000, label: 'Interventi', categoryId: null });
    expect(byKey['fuel']).toMatchObject({ cents: 11500, count: 2 });
    expect(byKey['insurance']).toMatchObject({ cents: 20000 });
    expect(byKey['expense:sys_parking']).toMatchObject({ source: 'expense', categoryId: 'sys_parking', label: 'Parcheggio e sosta', cents: 1200 });
    expect(byKey['expense:sys_tolls']).toMatchObject({ label: 'Pedaggi', cents: 800 });
    expect(byKey[`expense:${custom.id}`]).toMatchObject({ label: 'Radio', icon: 'music', cents: 3000 });
    expect(s.byCategory.reduce((t, c) => t + c.cents, 0)).toBe(s.totalCents);
    expect(s.byCategory.map((c) => c.cents)).toEqual([...s.byCategory.map((c) => c.cents)].sort((a, b) => b - a)); // dal piu' costoso
    expect(s.totalCents).toBe(53700 + 800 + 3000);
  });

  it('per mese (cronologico, solo mesi con costi) e per anno', async () => {
    const s = await summary();
    expect(s.byMonth.map((m) => [m.month, m.cents])).toEqual([
      ['2025-12', 6000],
      ['2026-01', 20000],
      ['2026-03', 21000],
      ['2026-04', 1200],
      ['2026-05', 5500],
    ]);
    expect(s.byMonth[0]).toMatchObject({ label: 'dicembre 2025', bySource: { fuel: 6000, service: 0, expense: 0, insurance: 0 } });
    expect(s.byYear).toEqual([
      { year: 2025, cents: 6000, count: 1 },
      { year: 2026, cents: 47700, count: 4 },
    ]);
  });

  it('il periodo (mese, anno, intervallo) filtra con estremi inclusi', async () => {
    expect((await summary(periodOfYear(2026))).totalCents).toBe(47700);
    expect((await summary(periodOfMonth('2026-04'))).totalCents).toBe(1200);
    expect((await summary({ from: '2026-03-01', to: '2026-04-10' })).totalCents).toBe(22200); // intervento il 1/3 e spesa il 10/4
    expect((await summary({ from: '2026-10-01' })).totalCents).toBe(0);
    expect((await summary({ from: '2026-04-01', to: '2026-01-01' })).totalCents).toBe(0); // periodo rovesciato: vuoto
    expect((await summary(periodOfMonth('boh'))).totalCents).toBe(53700); // periodo non valido: nessun limite
  });

  it('una rata assicurativa conta solo quando e\' pagata, con la data del pagamento', async () => {
    expect((await summary({ from: '2026-07-01', to: '2026-07-31' })).totalCents).toBe(0); // la rata scade il 1/7 ma non e' pagata
    await h.db.run("UPDATE insurance_payments SET paid_on = '2026-07-03' WHERE id = ?", [`01TESTID${String(33).padStart(18, '0')}`]);
    const jul = await summary({ from: '2026-07-01', to: '2026-07-31' });
    expect(jul.totalCents).toBe(20000);
    expect(jul.bySource[0]).toMatchObject({ source: 'insurance', cents: 20000 });
  });

  it('le righe nel cestino e le auto diverse non contano; auto inesistente: null', async () => {
    const fuel = unwrap(await addFuelLog(h.deps, { vehicleId: V1, filledOn: '2026-09-01', quantityMilli: 30000, totalCents: 5000 }));
    const exp = unwrap(await addExpense(h.deps, { vehicleId: V1, spentOn: '2026-09-02', categoryId: 'sys_tolls', amountCents: 700 }));
    unwrap(await addExpense(h.deps, { vehicleId: SAMPLE_IDS.demo, spentOn: '2026-09-02', categoryId: 'sys_tolls', amountCents: 9999 }));
    expect((await summary()).totalCents).toBe(53700 + 5000 + 700);
    unwrap(await deleteFuelLog(h.deps, fuel.fuelLog.id));
    unwrap(await deleteExpense(h.deps, exp.expense.id));
    await h.db.run('UPDATE service_records SET deleted_at = ? WHERE id = ?', ['2026-10-01T00:00:00.000Z', SAMPLE_IDS.service1]);
    expect((await summary()).totalCents).toBe(53700 - 21000);
    expect(await getCostSummary(h.deps, 'nessuna')).toBeNull();
    expect(await getCostSeries(h.deps, 'nessuna')).toBeNull();
  });

  it('indizi di doppioni LOGICI (stesso giorno e importo, fonti diverse): segnalati ma i totali NON cambiano', async () => {
    const before = (await summary()).totalCents;
    const r = unwrap(await addExpense(h.deps, { vehicleId: V1, spentOn: '2026-03-01', categoryId: 'sys_other', amountCents: 21000 }));
    expect(r.warnings[0]).toContain('un intervento');
    const s = await summary();
    expect(s.totalCents).toBe(before + 21000); // l'utente decide: il totale non si corregge da solo
    expect(s.possibleDuplicates).toHaveLength(1);
    expect(s.possibleDuplicates[0]).toMatchObject({ onDate: '2026-03-01', cents: 21000 });
    expect(s.possibleDuplicates[0]!.entries.map((x) => x.source).sort()).toEqual(['expense', 'service']);
  });

  it('esclude le categorie indicate da totali e costo al km (es. acquisto del veicolo)', async () => {
    unwrap(await addExpense(h.deps, { vehicleId: V1, spentOn: '2026-02-01', categoryId: 'sys_purchase', amountCents: 1_000_000 }));
    const all = await summary(periodOfYear(2026));
    const run = await summary(periodOfYear(2026), { excludeCategoryIds: ['sys_purchase'] });
    expect(all.totalCents).toBe(47700 + 1_000_000);
    expect(run.totalCents).toBe(47700);
    expect(run.byCategory.some((c) => c.categoryId === 'sys_purchase')).toBe(false);
    if (!all.costPerKm.ok || !run.costPerKm.ok) throw new Error('km disponibili');
    expect(run.costPerKm.totalCents).toBe(47700);
    expect(all.costPerKm.totalCents).toBe(47700 + 1_000_000);
  });
});

describe('getCostSummary: costo al km', () => {
  it('costi del periodo diviso i km tra la prima e l\'ultima lettura del periodo, con la spiegazione', async () => {
    // 2026: letture valide 10.000 (1/1), 12.000 (1/3), 15.000 (1/6); quella da 99.999 e' ignorata
    const s = await summary(periodOfYear(2026));
    expect(s.costPerKm.ok).toBe(true);
    if (!s.costPerKm.ok) return;
    expect(s.costPerKm).toMatchObject({ totalCents: 47700, km: 5000, perKmMilli: 95, per100KmCents: 954 });
    expect(s.costPerKm.text).toBe('0,10 €/km'); // il testo e' arrotondato al centesimo dal dominio
    expect(s.costPerKm.explanationIt).toContain('Costi del periodo divisi per i km percorsi');
    expect(s.costPerKm.explanationIt).toContain('477,00 €');
    const all = await summary();
    if (!all.costPerKm.ok) throw new Error('km disponibili');
    expect(all.costPerKm).toMatchObject({ totalCents: 53700, km: 5000, perKmMilli: 107 });
  });

  it('NO_KM_DATA con meno di due letture nel periodo (le ignorate non contano): non si inventa nulla', async () => {
    for (const period of [periodOfMonth('2026-04'), { from: '2026-07-01', to: '2026-12-31' }, { from: '2026-06-01', to: '2026-06-30' }]) {
      const s = await summary(period);
      expect(s.costPerKm).toMatchObject({ ok: false, reason: 'NO_KM_DATA' });
      expect(s.costPerKm.explanationIt).toContain('almeno due letture');
    }
  });

  it('i rifornimenti con km alimentano il registro e rendono calcolabile il costo al km di un mese', async () => {
    unwrap(await addFuelLog(h.deps, { vehicleId: V1, filledOn: '2026-08-01', km: 16000, quantityMilli: 40000, totalCents: 7000 }));
    unwrap(await addFuelLog(h.deps, { vehicleId: V1, filledOn: '2026-08-20', km: 16500, quantityMilli: 30000, totalCents: 5000 }));
    const s = await summary(periodOfMonth('2026-08'));
    expect(s.totalCents).toBe(12000);
    expect(s.costPerKm).toMatchObject({ ok: true, km: 500, totalCents: 12000, perKmMilli: 240, per100KmCents: 2400 });
  });

  it('stessi km nel periodo: ZERO_DISTANCE', async () => {
    await insertRow(h.db, 'odometer_readings', {
      id: '01TESTID000000000000000201', vehicle_id: V1, read_on: '2026-09-01', km: 20000, source: 'manual',
      created_at: '2026-09-01T08:00:00.000Z', updated_at: '2026-09-01T08:00:00.000Z',
    });
    await insertRow(h.db, 'odometer_readings', {
      id: '01TESTID000000000000000202', vehicle_id: V1, read_on: '2026-09-15', km: 20000, source: 'manual',
      created_at: '2026-09-01T08:00:00.000Z', updated_at: '2026-09-01T08:00:00.000Z',
    });
    unwrap(await addExpense(h.deps, { vehicleId: V1, spentOn: '2026-09-10', categoryId: 'sys_tolls', amountCents: 500 }));
    expect((await summary({ from: '2026-09-01', to: '2026-09-30' })).costPerKm).toMatchObject({ ok: false, reason: 'ZERO_DISTANCE' });
  });
});

describe('getCostSeries: serie mensile per il grafico (con i mesi vuoti a zero)', () => {
  it('senza periodo: gli ultimi 12 mesi fino al mese di oggi, con i mesi senza costi a zero', async () => {
    const s = (await getCostSeries(h.deps, V1))!;
    expect(s).toMatchObject({ vehicleId: V1, fromMonth: '2025-11', toMonth: '2026-10' });
    expect(s.points).toHaveLength(12);
    expect(s.points.map((p) => p.month)[0]).toBe('2025-11');
    const byMonth = Object.fromEntries(s.points.map((p) => [p.month, p.cents]));
    expect(byMonth).toEqual({
      '2025-11': 0, '2025-12': 6000, '2026-01': 20000, '2026-02': 0, '2026-03': 21000, '2026-04': 1200,
      '2026-05': 5500, '2026-06': 0, '2026-07': 0, '2026-08': 0, '2026-09': 0, '2026-10': 0,
    });
    expect(s.totalCents).toBe(53700);
    expect(s.maxCents).toBe(21000);
    expect(s.averagePerMonthCents).toBe(4475); // 53700 / 12
    expect(s.points[2]).toMatchObject({ label: 'gennaio 2026', bySource: { insurance: 20000, service: 0, fuel: 0, expense: 0 } });
  });

  it('un anno intero: 12 mesi anche se il futuro e\' vuoto; periodo aperto: dal primo mese con costi a oggi', async () => {
    const y = (await getCostSeries(h.deps, V1, periodOfYear(2026)))!;
    expect([y.fromMonth, y.toMonth, y.points.length]).toEqual(['2026-01', '2026-12', 12]);
    expect(y.totalCents).toBe(47700);
    const open = (await getCostSeries(h.deps, V1, {}))!;
    expect([open.fromMonth, open.toMonth, open.points.length]).toEqual(['2025-12', '2026-10', 11]);
    expect(open.totalCents).toBe(53700);
    const last6 = periodOfLastMonths('2026-10-08', 6);
    expect(last6).toEqual({ from: '2026-05-01', to: '2026-10-08' });
    expect((await getCostSeries(h.deps, V1, last6))!.points).toHaveLength(6);
  });

  it('senza nessun costo: una serie a zero (non un errore)', async () => {
    const empty = (await getCostSeries(h.deps, SAMPLE_IDS.demo))!;
    expect(empty.points).toHaveLength(12);
    expect(empty).toMatchObject({ totalCents: 0, maxCents: 0, averagePerMonthCents: 0 });
    const emptyOpen = (await getCostSeries(h.deps, SAMPLE_IDS.demo, {}))!;
    expect(emptyOpen.points).toHaveLength(1); // solo il mese di oggi
  });

  it('la somma della serie coincide col riepilogo dello stesso periodo', async () => {
    unwrap(await addExpense(h.deps, { vehicleId: V1, spentOn: '2026-09-09', categoryId: 'sys_tolls', amountCents: 450 }));
    const p = { from: '2026-01-01', to: '2026-10-31' };
    const series = (await getCostSeries(h.deps, V1, p))!;
    const sum = await summary(p);
    expect(series.totalCents).toBe(sum.totalCents);
    expect(series.points.reduce((t, x) => t + x.count, 0)).toBe(sum.count);
    for (const m of sum.byMonth) expect(series.points.find((x) => x.month === m.month)!.bySource).toEqual(m.bySource);
  });

  it('esclude le categorie indicate anche dalla serie', async () => {
    unwrap(await addExpense(h.deps, { vehicleId: V1, spentOn: '2026-09-09', categoryId: 'sys_purchase', amountCents: 100000 }));
    const s = (await getCostSeries(h.deps, V1, undefined, { excludeCategoryIds: ['sys_purchase'] }))!;
    expect(s.totalCents).toBe(53700);
  });
});
