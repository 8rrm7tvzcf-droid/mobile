import { describe, expect, it } from 'vitest';
import type { CostPerKm } from '@/domain/costs';
import type { CostSeries } from '@/usecases/costs';
import type { TimelineEntry } from '@/usecases/queries';
import { it as italian } from '@/ui/i18n/it';
import { chartBars, chartSummary, perKmView } from '@/ui/logic/costsView';
import {
  buildAddExpenseInput,
  buildUpdateExpenseInput,
  cleanCategoryName,
  expenseErrorField,
  expenseRowSubtitle,
  expenseRowTitle,
  formFromExpense,
  initialExpenseForm,
  parseCentsText,
} from '@/ui/logic/expenseForm';
import { COST_PERIODS, LIST_PERIODS, periodRange } from '@/ui/logic/period';
import { KIND_FILTER_KINDS, entryA11yLabel, entryAmountText, entryRoute, entrySubtitle, groupTimeline, kindFilterOptions } from '@/ui/logic/registry';

const entry = (over: Partial<TimelineEntry>): TimelineEntry => ({
  id: 'e1',
  kind: 'fuel',
  date: '2026-10-05',
  title: 'Rifornimento · Benzina',
  text: '35,500 L · pieno',
  tone: 'neutral',
  icon: 'fuel',
  upcoming: false,
  ignored: false,
  amountCents: 6600,
  km: 16600,
  kmText: '16.600 km',
  ...over,
});

describe('Registro: raggruppamento e righe', () => {
  it('mette le scadenze aperte in cima e poi un gruppo per mese, dal piu\' recente', () => {
    const groups = groupTimeline([
      entry({ id: 'a', date: '2026-10-05' }),
      entry({ id: 'b', date: '2026-10-01', kind: 'expense', amountCents: 1250 }),
      entry({ id: 'c', date: '2026-09-20', kind: 'service', amountCents: 21000 }),
      entry({ id: 'd', date: '2026-12-15', kind: 'deadline', upcoming: true, amountCents: null }),
      entry({ id: 'e', date: '2026-11-02', kind: 'deadline', upcoming: true, amountCents: null }),
      entry({ id: 'f', date: '2026-08-01', kind: 'odometer', amountCents: null }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['upcoming', '2026-10', '2026-09', '2026-08']);
    expect(groups[0]).toMatchObject({ title: 'Prossime scadenze', totalText: null });
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(['e', 'd']); // la piu' vicina per prima
    expect(groups[1]).toMatchObject({ title: 'Ottobre 2026', totalText: 'Spesi 78,50 €' });
    expect(groups[2]!.totalText).toBe('Spesi 210,00 €');
    expect(groups[3]!.totalText).toBeNull();
  });

  it('nessuna voce, nessun gruppo', () => {
    expect(groupTimeline([])).toEqual([]);
  });

  it('sottotitolo con data, dettagli e km (i km non si ripetono dove sono gia\' nel testo)', () => {
    expect(entrySubtitle(entry({}))).toBe('05/10/2026 · 35,500 L · pieno · 16.600 km');
    expect(entrySubtitle(entry({ kind: 'odometer', text: '16.600 km · inserita a mano' }))).toBe('05/10/2026 · 16.600 km · inserita a mano');
    expect(entrySubtitle(entry({ kind: 'expense', text: '', km: null, kmText: null }))).toBe('05/10/2026');
  });

  it('frase per i lettori di schermo con importo', () => {
    expect(entryA11yLabel(entry({}))).toBe('Rifornimento · Benzina. 05/10/2026 · 35,500 L · pieno · 16.600 km. 66,00 €');
    expect(entryAmountText(entry({ amountCents: null }))).toBeNull();
    expect(entryA11yLabel(entry({ kind: 'odometer', ignored: true, amountCents: null }))).toContain('messa da parte');
  });

  it('il tocco apre rifornimenti, spese, interventi, controlli livelli, polizze, rate e scadenze; km e completamenti restano senza navigazione', () => {
    expect(entryRoute(entry({ kind: 'fuel', id: 'f9' }), 'v1')).toBe('/auto/v1/rifornimento/f9');
    expect(entryRoute(entry({ kind: 'expense', id: 'x9' }), 'v1')).toBe('/auto/v1/spesa/x9');
    expect(entryRoute(entry({ kind: 'deadline', id: 'r9' }), 'v1')).toBe('/scadenza/r9');
    expect(entryRoute(entry({ kind: 'service', id: 's9' }), 'v1')).toBe('/auto/v1/intervento/s9');
    expect(entryRoute(entry({ kind: 'fluid', id: 'c9' }), 'v1')).toBe('/auto/v1/livelli/c9');
    expect(entryRoute(entry({ kind: 'policy', id: 'p9' }), 'v1')).toBe('/auto/v1/polizza/p9');
    expect(entryRoute(entry({ kind: 'installment', id: 'i9' }), 'v1')).toBe('/auto/v1/assicurazioni');
    for (const kind of ['odometer', 'completion'] as const) {
      expect(entryRoute(entry({ kind }), 'v1')).toBeNull();
    }
  });

  it('i filtri per tipo coprono tutti i tipi di voce e "Tutto" non restringe', () => {
    expect(KIND_FILTER_KINDS.all).toBeUndefined();
    expect(kindFilterOptions.map((o) => o.label)).toEqual(['Tutto', 'Rifornimenti', 'Spese', 'Interventi', 'Livelli', 'Assicurazione', 'Km', 'Scadenze']);
    const covered = new Set(Object.values(KIND_FILTER_KINDS).flatMap((k) => k ?? []));
    expect([...covered].sort()).toEqual(['completion', 'deadline', 'expense', 'fluid', 'fuel', 'installment', 'odometer', 'policy', 'service']);
  });
});

describe('Periodi', () => {
  it('mese, ultimi 3 mesi, anno e sempre', () => {
    expect(periodRange('month', '2026-10-13')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('quarter', '2026-10-13')).toEqual({ from: '2026-08-01', to: '2026-10-13' });
    expect(periodRange('year', '2026-10-13')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodRange('all', '2026-10-13')).toEqual({ from: null, to: null });
    expect(LIST_PERIODS).toHaveLength(4);
    expect(COST_PERIODS).toEqual(['month', 'year', 'all']);
  });
});

describe('Spese: modulo', () => {
  it('costruisce una nuova spesa e traduce gli errori', () => {
    const base = { ...initialExpenseForm('2026-10-08', 'sys_tolls'), amount: '12,50', description: ' Autostrada ' };
    const ok = buildAddExpenseInput('v1', base, '2026-10-08');
    expect(ok).toMatchObject({ ok: true, input: { vehicleId: 'v1', spentOn: '2026-10-08', categoryId: 'sys_tolls', amountCents: 1250, description: 'Autostrada', vendor: null, notes: null } });
    expect(buildAddExpenseInput('v1', { ...base, amount: '' }, '2026-10-08')).toMatchObject({ ok: false, errors: { amount: italian.expense.invalidAmount } });
    expect(buildAddExpenseInput('v1', { ...base, amount: '0' }, '2026-10-08')).toMatchObject({ ok: false });
    expect(buildAddExpenseInput('v1', { ...base, date: '09/10/2026' }, '2026-10-08')).toMatchObject({ ok: false, errors: { date: italian.common.futureDate } });
    expect(buildAddExpenseInput('v1', { ...base, date: 'ieri' }, '2026-10-08')).toMatchObject({ ok: false, errors: { date: italian.common.dateExample } });
    expect(buildUpdateExpenseInput({ ...base, amount: '1.234,50' }, '2026-10-08')).toMatchObject({ ok: true, input: { amountCents: 123450 } });
  });

  it('riporta i valori salvati nel modulo e nelle righe', () => {
    const e = {
      id: 'x1', vehicleId: 'v1', spentOn: '2026-09-12', categoryId: 'sys_tolls', categoryName: 'Pedaggi', categoryIcon: null, isSystemCategory: true,
      amountCents: 1205, description: 'Autostrada', vendor: null, notes: null, createdAt: '', updatedAt: '',
    };
    expect(formFromExpense(e)).toMatchObject({ amount: '12,05', date: '12/09/2026', description: 'Autostrada', categoryId: 'sys_tolls' });
    expect(expenseRowTitle(e)).toBe('12,05 € · Pedaggi');
    expect(expenseRowSubtitle(e)).toBe('12/09/2026 · Autostrada');
    expect(parseCentsText(100000)).toBe('1000,00');
    expect(parseCentsText(5)).toBe('0,05');
  });

  it('campi dei casi d\'uso e nomi di categoria', () => {
    expect(expenseErrorField('amountCents')).toBe('amount');
    expect(expenseErrorField('spentOn')).toBe('date');
    expect(expenseErrorField('categoryId')).toBe('category');
    expect(expenseErrorField('altro')).toBe('form');
    expect(cleanCategoryName('  Accessori   bici ')).toBe('Accessori bici');
    expect(cleanCategoryName('   ')).toBeNull();
  });
});

describe('Costi: presentazione', () => {
  it('costo al km calcolabile e non calcolabile, sempre con spiegazione in italiano', () => {
    const ok: CostPerKm = { ok: true, totalCents: 120000, km: 3000, perKmMilli: 400, per100KmCents: 4000, text: '0,40 €/km', explanationIt: 'Costi del periodo divisi per i km.' };
    expect(perKmView(ok)).toMatchObject({ ok: true, headline: '0,40 €/km', needsKm: false });
    expect(perKmView(ok).detail).toContain('40,00 € ogni 100 km');
    const none = perKmView({ ok: false, reason: 'NO_KM_DATA', explanationIt: 'spiegazione' });
    expect(none).toMatchObject({ ok: false, headline: italian.costs.perKmNoData, needsKm: true });
    expect(perKmView({ ok: false, reason: 'ZERO_DISTANCE', explanationIt: 'x' }).headline).toBe(italian.costs.perKmZero);
  });

  const series: CostSeries = {
    vehicleId: 'v1',
    fromMonth: '2026-08',
    toMonth: '2026-10',
    points: [
      { month: '2026-08', label: 'agosto 2026', cents: 21000, count: 1, bySource: { service: 21000, fuel: 0, expense: 0, insurance: 0 } },
      { month: '2026-09', label: 'settembre 2026', cents: 0, count: 0, bySource: { service: 0, fuel: 0, expense: 0, insurance: 0 } },
      { month: '2026-10', label: 'ottobre 2026', cents: 10500, count: 2, bySource: { service: 0, fuel: 9250, expense: 1250, insurance: 0 } },
    ],
    totalCents: 31500,
    maxCents: 21000,
    averagePerMonthCents: 10500,
  };

  it('barre del grafico proporzionali al mese piu\' alto', () => {
    const bars = chartBars(series);
    expect(bars.map((b) => b.ratio)).toEqual([1, 0, 0.5]);
    expect(bars.map((b) => b.shortLabel)).toEqual(['ago 26', 'set', 'ott']);
    expect(bars[2]).toMatchObject({ longLabel: 'ottobre 2026', amountText: '105,00 €' });
  });

  it('riassunto scritto equivalente al grafico', () => {
    expect(chartSummary(series)).toBe(
      'Costi per mese su 3 mesi: totale 315,00 €, media 105,00 € al mese. Il mese più alto è agosto 2026 (210,00 €).',
    );
    expect(chartSummary({ ...series, totalCents: 0, maxCents: 0 })).toBe(italian.costs.chartEmpty);
  });
});
