import { describe, expect, it } from 'vitest';
import { addDays, addMonths, diffDays, endOfMonth } from '@/domain/dates';
import {
  compareByUrgency,
  evaluateRule,
  evaluateThresholds,
  reasonMessage,
  sortByUrgency,
  stateLabel,
} from '@/domain/maintenance';
import type { MaintenanceRule, OdometerPoint } from '@/domain/maintenance';

const TODAY = '2026-10-07';

const oil: MaintenanceRule = {
  scheduleType: 'interval_last_done',
  intervalKm: 15000,
  intervalMonths: 12,
  periodEnd: 'exact',
  soonDays: 30,
  soonKm: 1500,
};
const revision: MaintenanceRule = {
  scheduleType: 'interval_last_done',
  intervalMonths: 24,
  periodEnd: 'end_of_month',
  soonDays: 30,
  soonKm: 0,
};

/** Letture del vettore V3: 40 km/g costanti (40.000 il 01/03, 44.880 il 01/07, 48.560 il 01/10). */
const v3: OdometerPoint[] = [
  { on: '2026-03-01', km: 40000 },
  { on: '2026-07-01', km: 44880 },
  { on: '2026-10-01', km: 48560 },
];
const lastOil = { on: '2026-03-01', km: 40000 };

describe('vettori V1: date', () => {
  it('V1a addMonths con clamp a fine mese', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-01-15', -13)).toBe('2024-12-15');
  });
  it('V1b endOfMonth', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
  });
  it('V1c giorni attraverso il cambio ora (nessuna deriva)', () => {
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2);
    expect(addDays('2027-03-27', 2)).toBe('2027-03-29');
  });
});

describe('vettori V2: regole a tempo', () => {
  it('V2a revisione (24 mesi, fine mese), ultima 2024-06-10: scaduta, 99 giorni', () => {
    const ev = evaluateRule({ today: TODAY, rule: revision, lastDone: { on: '2024-06-10' } });
    expect(ev.dueOn).toBe('2026-06-30');
    expect(ev.state).toBe('overdue');
    expect(ev.daysLeft).toBe(-99);
    expect(ev.trigger).toBe('time');
    expect(ev.estimated).toBe(false);
    expect(stateLabel(ev)).toBe('Scaduto');
  });

  it('V2b auto immatricolata 2023-03-15, baseline = +24 mesi: scade 2027-03-31, in regola', () => {
    const baselineOn = addMonths('2023-03-15', 24);
    const ev = evaluateRule({ today: TODAY, rule: revision, lastDone: { on: baselineOn } });
    expect(ev.dueOn).toBe('2027-03-31');
    expect(ev.state).toBe('ok');
    expect(ev.daysLeft).toBe(175);
    expect(stateLabel(ev)).toBe('In regola');
  });

  it('V2c revisione senza ultimo fatto: unknown con NO_LAST_DONE, nessuna data inventata', () => {
    const ev = evaluateRule({ today: TODAY, rule: revision, lastDone: null });
    expect(ev.state).toBe('unknown');
    expect(ev.reasons).toEqual(['NO_LAST_DONE']);
    expect(ev.dueOn).toBeNull();
    expect(ev.effectiveDueOn).toBeNull();
    expect(ev.daysLeft).toBeNull();
    expect(stateLabel(ev)).toBe('Da configurare');
    expect(reasonMessage('NO_LAST_DONE')).toContain("l'ultima volta");
  });
});

describe('vettori V3-V5: tempo e chilometri, il primo dei due', () => {
  it('V3 olio 15.000 km / 12 mesi: la scadenza a tempo vince sulla previsione km', () => {
    const ev = evaluateRule({ today: TODAY, rule: oil, lastDone: lastOil, odometer: v3 });
    expect(ev.dueKm).toBe(55000);
    expect(ev.forecastOn).toBe('2027-03-11'); // 6.440 km a 40 km/g = 161 giorni da 2026-10-01
    expect(ev.dueOn).toBe('2027-03-01');
    expect(ev.effectiveDueOn).toBe('2027-03-01');
    expect(ev.trigger).toBe('time');
    expect(ev.state).toBe('ok');
    expect(ev.daysLeft).toBe(145);
    expect(ev.kmLeft).toBe(6440);
    expect(ev.currentKm).toBe(48560);
    expect(ev.forecastConfidence).toBe('medium');
    expect(ev.estimated).toBe(false);
    expect(ev.kmReached).toBe(false);
    expect(ev.rate).toBeCloseTo(40, 1);
  });

  it('V3 il ceil usa un epsilon: 6440 / 40,000000000000007 = 161 giorni, non 162', () => {
    // piu' di un giorno non deve mai comparire per un errore di virgola mobile
    const ev = evaluateRule({ today: TODAY, rule: { ...oil, intervalMonths: null }, lastDone: lastOil, odometer: v3 });
    expect(ev.forecastOn).toBe('2027-03-11');
    expect(ev.trigger).toBe('km');
    expect(ev.estimated).toBe(true);
  });

  it('V4 a 60 km/g: la previsione km (2026-11-06) batte la data, in arrivo e stimata', () => {
    const odo: OdometerPoint[] = [
      { on: '2026-03-01', km: 40000 },
      { on: '2026-07-01', km: 47320 },
      { on: '2026-10-01', km: 52840 },
    ];
    const ev = evaluateRule({ today: TODAY, rule: oil, lastDone: lastOil, odometer: odo });
    expect(ev.forecastOn).toBe('2026-11-06');
    expect(ev.effectiveDueOn).toBe('2026-11-06');
    expect(ev.trigger).toBe('km');
    expect(ev.estimated).toBe(true);
    expect(ev.state).toBe('soon');
    expect(ev.daysLeft).toBe(30);
    expect(ev.kmLeft).toBe(2160);
  });

  it('V5 con 55.200 km il 01/10: km raggiunti, scaduto e non stimato', () => {
    const odo: OdometerPoint[] = [
      { on: '2026-03-01', km: 40000 },
      { on: '2026-07-01', km: 44880 },
      { on: '2026-10-01', km: 55200 },
    ];
    const ev = evaluateRule({ today: TODAY, rule: oil, lastDone: lastOil, odometer: odo });
    expect(ev.state).toBe('overdue');
    expect(ev.kmReached).toBe(true);
    expect(ev.effectiveDueOn).toBe('2026-10-01');
    expect(ev.daysLeft).toBe(-6);
    expect(ev.estimated).toBe(false);
    expect(ev.trigger).toBe('km');
  });

  it('V5b stessa regola: il giorno della scadenza e "Scade oggi" (soon), il giorno dopo scaduto', () => {
    const d0 = evaluateRule({ today: '2027-03-01', rule: oil, lastDone: lastOil, odometer: v3 });
    expect(d0.state).toBe('soon');
    expect(d0.dueToday).toBe(true);
    expect(d0.daysLeft).toBe(0);
    expect(stateLabel(d0)).toBe('Scade oggi');
    const d1 = evaluateRule({ today: '2027-03-02', rule: oil, lastDone: lastOil, odometer: v3 });
    expect(d1.state).toBe('overdue');
    expect(d1.dueToday).toBe(false);
    expect(d1.daysLeft).toBe(-1);
  });

  it('V5c ultimo fatto senza km: i km si interpolano dalle letture (dueKm 55.000)', () => {
    const ev = evaluateRule({ today: TODAY, rule: oil, lastDone: { on: '2026-03-01' }, odometer: v3 });
    expect(ev.dueKm).toBe(55000);
    expect(ev.reasons).toEqual([]);
    // a meta' fra due letture: interpolazione lineare
    const mid = evaluateRule({ today: TODAY, rule: oil, lastDone: { on: '2026-05-01' }, odometer: v3 });
    expect(mid.dueKm).toBe(Math.round(40000 + (4880 * 61) / 122) + 15000);
  });

  it('V5c senza letture che coprano la data: nessuna estrapolazione, NO_LAST_KM', () => {
    const before = evaluateRule({ today: TODAY, rule: oil, lastDone: { on: '2026-01-01' }, odometer: v3 });
    expect(before.dueKm).toBeNull();
    expect(before.reasons).toContain('NO_LAST_KM');
    expect(before.dueOn).toBe('2027-01-01'); // resta la scadenza a tempo
    expect(before.state).toBe('ok');
    const onlyKm = evaluateRule({
      today: TODAY,
      rule: { ...oil, intervalMonths: null },
      lastDone: { on: '2026-01-01' },
      odometer: v3,
    });
    expect(onlyKm.state).toBe('unknown');
    expect(onlyKm.reasons).toEqual(['NO_LAST_KM']);
    expect(reasonMessage('NO_LAST_KM')).toContain('contachilometri');
  });

  it('V5d nessuna lettura: scade per tempo (2027-03-01) con motivo NO_ODOMETER', () => {
    const ev = evaluateRule({ today: TODAY, rule: oil, lastDone: lastOil, odometer: [] });
    expect(ev.effectiveDueOn).toBe('2027-03-01');
    expect(ev.trigger).toBe('time');
    expect(ev.reasons).toContain('NO_ODOMETER');
    expect(ev.forecastConfidence).toBe('none');
    expect(ev.state).toBe('ok');
  });

  it('soglia a km: in arrivo se mancano meno di soonKm, anche con la data lontana', () => {
    const odo: OdometerPoint[] = [
      { on: '2026-03-01', km: 40000 },
      { on: '2026-07-01', km: 44880 },
      { on: '2026-10-05', km: 53600 }, // mancano 1.400 km (< 1.500)
    ];
    const ev = evaluateRule({ today: TODAY, rule: { ...oil, soonDays: 5 }, lastDone: lastOil, odometer: odo });
    expect(ev.kmLeft).toBe(1400);
    expect(ev.state).toBe('soon');
    // con soonKm = 0 la soglia a km e' disattivata
    const off = evaluateRule({ today: TODAY, rule: { ...oil, soonDays: 5, soonKm: 0 }, lastDone: lastOil, odometer: odo });
    expect(off.state).toBe('ok');
  });

  it('un giorno dopo la scadenza a tempo e scaduto; 30 giorni prima e in arrivo, 31 in regola', () => {
    const rule: MaintenanceRule = { scheduleType: 'fixed_date', fixedDueOn: '2026-11-06', soonDays: 30 };
    expect(evaluateRule({ today: '2026-10-07', rule, lastDone: null }).state).toBe('soon'); // 30 giorni
    expect(evaluateRule({ today: '2026-10-06', rule, lastDone: null }).state).toBe('ok'); // 31 giorni
    expect(evaluateRule({ today: '2026-11-07', rule, lastDone: null }).state).toBe('overdue');
  });
});

describe('vettori V7 e V10b: previsione stimata e promemoria manuali', () => {
  it('V7 solo km, ultima lettura vecchia di 128 giorni: scaduto stimato, confidenza low', () => {
    const rule: MaintenanceRule = { scheduleType: 'interval_last_done', intervalKm: 7000, soonDays: 30, soonKm: 1500 };
    const odo: OdometerPoint[] = [
      { on: '2026-01-10', km: 45000 },
      { on: '2026-06-01', km: 50000 },
    ];
    const ev = evaluateRule({
      today: TODAY,
      rule,
      lastDone: { on: '2026-01-10', km: 45000 },
      odometer: odo,
    });
    expect(ev.dueKm).toBe(52000);
    expect(ev.forecastOn).toBe('2026-07-28');
    expect(ev.state).toBe('overdue');
    expect(ev.estimated).toBe(true);
    expect(ev.daysLeft).toBe(-71);
    expect(ev.forecastConfidence).toBe('low');
    expect(stateLabel(ev)).toBe('Probabilmente scaduto');
  });

  it('V10b promemoria manuale a 60.000 km: previsione 2027-03-04 (148 giorni), in regola', () => {
    const ev = evaluateThresholds({
      today: TODAY,
      dueOn: null,
      dueKm: 60000,
      odometer: [
        { on: '2026-04-10', km: 50000 },
        { on: '2026-10-07', km: 55490 },
      ],
    });
    expect(ev.rate).toBeCloseTo(30.5, 2);
    expect(ev.forecastOn).toBe('2027-03-04');
    expect(diffDays(TODAY, '2027-03-04')).toBe(148);
    expect(ev.state).toBe('ok');
    expect(ev.trigger).toBe('km');
  });
});

describe('motivi di "unknown" e casi limite (invariante I3)', () => {
  it('calendario e data fissa senza scadenza: NO_FIXED_DATE', () => {
    for (const scheduleType of ['interval_calendar', 'fixed_date'] as const) {
      const ev = evaluateRule({ today: TODAY, rule: { scheduleType, intervalMonths: scheduleType === 'interval_calendar' ? 12 : null }, lastDone: null });
      expect(ev.state).toBe('unknown');
      expect(ev.reasons).toEqual(['NO_FIXED_DATE']);
    }
    expect(reasonMessage('NO_FIXED_DATE')).toBeTruthy();
  });

  it('calendario con scadenza: la scadenza e quella fissa, i km non contano', () => {
    const ev = evaluateRule({
      today: TODAY,
      rule: { scheduleType: 'interval_calendar', intervalMonths: 12, fixedDueOn: '2026-11-30' },
      lastDone: null,
      odometer: v3,
    });
    expect(ev.dueOn).toBe('2026-11-30');
    expect(ev.dueKm).toBeNull();
    expect(ev.forecastConfidence).toBeNull();
    expect(ev.state).toBe('ok'); // 54 giorni
  });

  it('auto ferma: RATE_TOO_LOW e nessuna data prevista (resta la scadenza a tempo)', () => {
    const odo: OdometerPoint[] = [
      { on: '2026-04-10', km: 5000 },
      { on: '2026-07-01', km: 5000 },
      { on: '2026-10-01', km: 5000 },
    ];
    const ev = evaluateRule({
      today: TODAY,
      rule: oil,
      lastDone: { on: '2026-03-01', km: 4000 },
      odometer: odo,
      vehicle: { annualKmEstimate: 12000 },
    });
    expect(ev.reasons).toContain('RATE_TOO_LOW');
    expect(ev.forecastOn).toBeNull();
    expect(ev.effectiveDueOn).toBe('2027-03-01');
    expect(ev.forecastConfidence).toBe('none');
  });

  it('previsione oltre 10 anni: FORECAST_BEYOND_10Y e nessuna data', () => {
    const rule: MaintenanceRule = { scheduleType: 'interval_last_done', intervalKm: 100000, soonDays: 30, soonKm: 1500 };
    const odo: OdometerPoint[] = [
      { on: '2026-09-01', km: 10000 },
      { on: '2026-10-07', km: 10040 }, // ~1 km/g
    ];
    const ev = evaluateRule({
      today: TODAY,
      rule,
      lastDone: { on: '2026-09-01', km: 10000 },
      odometer: odo,
      rateParams: { fullTrustDays: 10, minKmPerDay: 0.5 },
    });
    expect(ev.reasons).toContain('FORECAST_BEYOND_10Y');
    expect(ev.forecastOn).toBeNull();
    expect(ev.state).toBe('unknown');
  });

  it('le letture future non contano (oggi e un parametro)', () => {
    const ev = evaluateRule({
      today: TODAY,
      rule: oil,
      lastDone: lastOil,
      odometer: [...v3, { on: '2026-12-01', km: 60000 }],
    });
    expect(ev.kmReached).toBe(false);
    expect(ev.currentKm).toBe(48560);
  });

  it('stesso input, stesso output (funzione pura, I4)', () => {
    const a = evaluateRule({ today: TODAY, rule: oil, lastDone: lastOil, odometer: v3 });
    const b = evaluateRule({ today: TODAY, rule: oil, lastDone: lastOil, odometer: [...v3].reverse() });
    expect(b).toEqual(a);
  });

  it('il tempo e i km "both": previsione esattamente nel giorno della scadenza a tempo', () => {
    const ev = evaluateThresholds({
      today: TODAY,
      dueOn: '2027-03-11',
      dueKm: 55000,
      odometer: v3,
    });
    expect(ev.forecastOn).toBe('2027-03-11');
    expect(ev.trigger).toBe('both');
  });
});

describe('ordinamento e etichette', () => {
  it('scaduti (piu in ritardo prima), in arrivo, in regola per data, da configurare in fondo', () => {
    const rows = [
      { id: 'ok-late', state: 'ok', effectiveDueOn: '2027-06-01' },
      { id: 'unknown', state: 'unknown', effectiveDueOn: null },
      { id: 'soon', state: 'soon', effectiveDueOn: '2026-10-20' },
      { id: 'over-recent', state: 'overdue', effectiveDueOn: '2026-10-01' },
      { id: 'ok-early', state: 'ok', effectiveDueOn: '2027-01-01' },
      { id: 'over-old', state: 'overdue', effectiveDueOn: '2026-06-30' },
    ] as const;
    expect(sortByUrgency(rows).map((r) => r.id)).toEqual([
      'over-old',
      'over-recent',
      'soon',
      'ok-early',
      'ok-late',
      'unknown',
    ]);
    expect(compareByUrgency(rows[1], rows[1])).toBe(0);
  });

  it('etichette italiane', () => {
    expect(stateLabel({ state: 'soon', effectiveDueOn: '2026-10-20', dueToday: false })).toBe('In arrivo');
    expect(stateLabel({ state: 'overdue', effectiveDueOn: '2026-10-01', estimated: false })).toBe('Scaduto');
    expect(reasonMessage('RATE_TOO_LOW')).toContain('ferma');
    expect(reasonMessage('FORECAST_BEYOND_10Y')).toContain('10 anni');
    expect(reasonMessage('NO_ODOMETER')).toContain('km attuali');
  });
});
