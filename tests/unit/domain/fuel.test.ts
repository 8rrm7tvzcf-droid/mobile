import { describe, expect, it } from 'vitest';
import {
  BIFUEL_CAVEAT_IT,
  FUEL_TYPES,
  PLAUSIBLE_PRICE_MILLI,
  SKIP_REASON_TEXT_IT,
  averageUnitPriceMilli,
  completeFuelAmounts,
  computedPoints,
  consumptionByTank,
  defaultFuelType,
  fuelLabelIt,
  fuelTypesForVehicle,
  fullToFull,
  isBifuel,
  isUnitConsistentWithFuel,
  sortConsumptionLogs,
  summarizeConsumption,
  tankOf,
  unitForFuel,
  validateFuelLog,
  type ConsumptionLog,
  type FuelConsumptionLog,
  type FuelLogInput,
} from '@/domain/fuel';
import { formatConsumption } from '@/domain/units';

const L = (
  id: string,
  on: string,
  km: number | null,
  liters: number,
  isFull = true,
  missedBefore = false,
): ConsumptionLog => ({ id, on, km, quantityMilli: Math.round(liters * 1000), isFull, missedBefore });

describe('fuel: unita e serbatoi', () => {
  it('unita obbligata per carburante (come il CHECK di fuel_logs)', () => {
    for (const f of ['petrol', 'diesel', 'lpg', 'adblue', 'hvo'] as const) expect(unitForFuel(f)).toBe('L');
    for (const f of ['cng', 'hydrogen'] as const) expect(unitForFuel(f)).toBe('kg');
    expect(unitForFuel('electric')).toBe('kWh');
    expect(isUnitConsistentWithFuel('cng', 'kg')).toBe(true);
    expect(isUnitConsistentWithFuel('cng', 'L')).toBe(false);
    expect(isUnitConsistentWithFuel('electric', 'L')).toBe(false);
    expect(FUEL_TYPES).toHaveLength(8);
  });

  it('gasolio e HVO sono lo stesso serbatoio, AdBlue non ha serbatoio di carburante', () => {
    expect(tankOf('hvo')).toBe('diesel');
    expect(tankOf('diesel')).toBe('diesel');
    expect(tankOf('adblue')).toBeNull();
    expect(tankOf('lpg')).toBe('lpg');
  });

  it('carburanti tra cui scegliere per veicolo', () => {
    expect(fuelTypesForVehicle({ fuelPrimary: 'petrol' })).toEqual(['petrol']);
    expect(fuelTypesForVehicle({ fuelPrimary: 'petrol', fuelSecondary: 'lpg' })).toEqual(['petrol', 'lpg']);
    expect(fuelTypesForVehicle({ fuelPrimary: 'diesel' })).toEqual(['diesel', 'hvo', 'adblue']);
    expect(fuelTypesForVehicle({ fuelPrimary: 'electric' })).toEqual(['electric']);
    expect(isBifuel({ fuelPrimary: 'petrol', fuelSecondary: 'cng' })).toBe(true);
    expect(isBifuel({ fuelPrimary: 'petrol', fuelSecondary: null })).toBe(false);
    expect(defaultFuelType({ fuelPrimary: 'petrol', fuelSecondary: 'lpg' }, 'lpg')).toBe('lpg');
    expect(defaultFuelType({ fuelPrimary: 'petrol', fuelSecondary: 'lpg' }, 'diesel')).toBe('petrol');
    expect(defaultFuelType({ fuelPrimary: 'petrol' }, null)).toBe('petrol');
    expect(fuelLabelIt('lpg')).toBe('GPL');
    expect(fuelLabelIt('cng')).toBe('Metano');
  });
});

describe('fuel: consumi pieno-a-pieno (vettore V11 di data.md)', () => {
  const v11 = [
    L('A', '2026-01-01', 10000, 40),
    L('B', '2026-01-10', 10300, 15, false),
    L('C', '2026-01-20', 10700, 30),
    L('D', '2026-02-01', 11300, 36),
    L('E', '2026-02-15', 11900, 33, true, true),
    L('F', '2026-03-01', 12500, 38.4),
  ];

  it('C = 6,43 L/100 km (700 km, 45 L), D = 6,00, E nessun valore, F = 6,40', () => {
    const e = fullToFull(v11);
    expect(e.map((x) => x.id)).toEqual(['A', 'C', 'D', 'E', 'F']); // B e parziale: nessuna voce
    const by = Object.fromEntries(e.map((x) => [x.id, x]));
    expect(by.A).toMatchObject({ computed: false, reason: 'FIRST_FULL' });
    expect(by.C).toMatchObject({ computed: true, distanceKm: 700, quantityMilli: 45000, per100Centi: 643 });
    expect(by.D).toMatchObject({ computed: true, distanceKm: 600, quantityMilli: 36000, per100Centi: 600 });
    expect(by.E).toMatchObject({ computed: false, reason: 'CHAIN_BROKEN' });
    expect(by.F).toMatchObject({ computed: true, distanceKm: 600, quantityMilli: 38400, per100Centi: 640 });
  });

  it('il testo del consumo calcolato', () => {
    const c = computedPoints(fullToFull(v11));
    expect(c.map((p) => formatConsumption(p.per100Centi, 'L'))).toEqual(['6,43 L/100 km', '6,00 L/100 km', '6,40 L/100 km']);
    expect(formatConsumption(c[0]!.per100Centi, 'L', 'mpgUS')).toBe('36,6 mpg (US)');
    expect(formatConsumption(c[0]!.per100Centi, 'L', 'kmPerUnit')).toBe('15,55 km/L');
  });

  it('piu rifornimenti parziali tra due pieni si sommano', () => {
    const e = fullToFull([
      L('1', '2026-01-01', 1000, 40),
      L('2', '2026-01-05', 1200, 10, false),
      L('3', '2026-01-09', 1400, 10, false),
      L('4', '2026-01-12', 1600, 20),
    ]);
    expect(e[1]).toMatchObject({ computed: true, distanceKm: 600, quantityMilli: 40000, per100Centi: 667 }); // 6,67 L/100
  });

  it('pieno senza km: spezza la catena', () => {
    const e = fullToFull([
      L('1', '2026-01-01', 1000, 40),
      L('2', '2026-01-10', null, 30),
      L('3', '2026-01-20', 1700, 35),
      L('4', '2026-02-01', 2300, 36),
    ]);
    expect(e.map((x) => (x.computed ? x.per100Centi : x.reason))).toEqual(['FIRST_FULL', 'NO_KM', 'FIRST_FULL', 600]);
  });

  it('km non crescenti: nessun valore, ma si riparte da quel pieno', () => {
    const e = fullToFull([
      L('1', '2026-01-01', 1000, 40),
      L('2', '2026-01-10', 1000, 30),
      L('3', '2026-01-20', 1500, 30),
    ]);
    expect(e.map((x) => (x.computed ? x.per100Centi : x.reason))).toEqual(['FIRST_FULL', 'KM_NOT_INCREASING', 600]);
  });

  it('un rifornimento mancato sul primo pieno non e una catena interrotta ma un primo pieno', () => {
    const e = fullToFull([L('1', '2026-01-01', 1000, 40, true, true)]);
    expect(e[0]).toMatchObject({ computed: false, reason: 'FIRST_FULL' });
  });

  it('un parziale con il flag mancato riparte da zero: il suo carburante non conta per il pieno precedente', () => {
    const e = fullToFull([
      L('1', '2026-01-01', 1000, 40),
      L('2', '2026-01-05', 1200, 10, false, true), // mancato prima: catena azzerata
      L('3', '2026-01-10', 1600, 30),
      L('4', '2026-01-20', 2200, 36),
    ]);
    expect(e.map((x) => (x.computed ? x.per100Centi : x.reason))).toEqual(['FIRST_FULL', 'FIRST_FULL', 600]);
  });

  it('solo parziali: nessuna voce; vuoto: nessuna voce', () => {
    expect(fullToFull([L('1', '2026-01-01', 1000, 10, false), L('2', '2026-01-02', 1100, 10, false)])).toEqual([]);
    expect(fullToFull([])).toEqual([]);
  });

  it('i rifornimenti sono ordinati per data, creazione e id come la query', () => {
    const shuffled: ConsumptionLog[] = [
      { ...L('c', '2026-01-20', 1700, 35), createdAt: '2026-01-20T10:00:00.000Z' },
      { ...L('a', '2026-01-01', 1000, 40), createdAt: '2026-01-01T10:00:00.000Z' },
      { ...L('b', '2026-01-10', 1300, 30), createdAt: '2026-01-10T10:00:00.000Z' },
    ];
    expect(sortConsumptionLogs(shuffled).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(fullToFull(shuffled).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    // stessa data: conta createdAt, poi l'id
    const sameDay = sortConsumptionLogs([
      { ...L('z', '2026-01-01', 1, 1), createdAt: '2026-01-01T09:00:00.000Z' },
      { ...L('y', '2026-01-01', 1, 1), createdAt: '2026-01-01T08:00:00.000Z' },
      L('x1', '2026-01-01', 1, 1),
      L('x0', '2026-01-01', 1, 1),
    ]);
    expect(sameDay.map((x) => x.id)).toEqual(['x0', 'x1', 'y', 'z']);
  });

  it('non modifica l array ricevuto', () => {
    const input = [...v11].reverse();
    const snapshot = JSON.stringify(input);
    fullToFull(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('i testi delle ragioni sono in italiano per tutte le ragioni', () => {
    for (const r of ['NO_KM', 'KM_NOT_INCREASING', 'FIRST_FULL', 'CHAIN_BROKEN'] as const) {
      expect(SKIP_REASON_TEXT_IT[r].length).toBeGreaterThan(20);
    }
  });
});

describe('fuel: riepilogo dei consumi', () => {
  it('media pesata sui km, ultimo, migliore e peggiore', () => {
    const pts = computedPoints(
      fullToFull([
        L('1', '2026-01-01', 1000, 40),
        L('2', '2026-02-01', 1500, 25), // 500 km, 25 L -> 5,00
        L('3', '2026-03-01', 2500, 80), // 1000 km, 80 L -> 8,00
        L('4', '2026-04-01', 2600, 6), // 100 km, 6 L -> 6,00
      ]),
    );
    const s = summarizeConsumption(pts);
    expect(s.count).toBe(3);
    expect(s.totalDistanceKm).toBe(1600);
    expect(s.totalQuantityMilli).toBe(111000);
    expect(s.avgPer100Centi).toBe(694); // 111 L / 1600 km = 6,94 (non la media dei rapporti 6,33)
    expect(s.lastPer100Centi).toBe(600);
    expect(s.bestPer100Centi).toBe(500);
    expect(s.worstPer100Centi).toBe(800);
    expect(s.totalCostCents).toBeNull(); // nessun totale fornito
    expect(s.costPer100KmCents).toBeNull();
  });

  it('senza voci calcolate tutto e null', () => {
    const s = summarizeConsumption([]);
    expect(s).toMatchObject({ count: 0, avgPer100Centi: null, lastPer100Centi: null, bestPer100Centi: null, costPer100KmCents: null });
  });

  it('costo del carburante per 100 km quando i totali sono noti', () => {
    const c = (id: string, on: string, km: number, l: number, cents: number, full = true): ConsumptionLog => ({
      ...L(id, on, km, l, full),
      totalCents: cents,
    });
    const pts = computedPoints(
      fullToFull([
        c('1', '2026-01-01', 1000, 40, 7200),
        c('2', '2026-01-10', 1300, 15, 2700, false), // parziale del tratto
        c('3', '2026-01-20', 1700, 30, 5400), // tratto 1: 700 km, costo 2700 + 5400
        c('4', '2026-02-01', 2300, 36, 6480), // tratto 2: 600 km, costo 6480
      ]),
    );
    expect(pts.map((p) => p.costCents)).toEqual([8100, 6480]);
    const s = summarizeConsumption(pts);
    expect(s.totalCostCents).toBe(14580);
    expect(s.costPer100KmCents).toBe(1122); // 145,80 EUR su 1300 km = 11,22 EUR/100 km
  });

  it('se un solo rifornimento del tratto non ha il totale il costo e null (non si inventa)', () => {
    const pts = computedPoints(
      fullToFull([
        { ...L('1', '2026-01-01', 1000, 40), totalCents: 7200 },
        L('2', '2026-01-10', 1500, 30), // senza totale
      ]),
    );
    expect(pts[0]!.costCents).toBeNull();
    expect(summarizeConsumption(pts).costPer100KmCents).toBeNull();
  });

  it('prezzo medio ponderato', () => {
    expect(
      averageUnitPriceMilli([
        { quantityMilli: 40000, totalCents: 7436 },
        { quantityMilli: 10000, totalCents: 2000 },
      ]),
    ).toBe(1887); // 94,36 EUR / 50 L = 1,8872
    expect(averageUnitPriceMilli([])).toBeNull();
  });
});

describe('fuel: serbatoi multipli (bifuel benzina + GPL), kg per metano, kWh per elettrico', () => {
  const F = (
    id: string,
    fuelType: FuelConsumptionLog['fuelType'],
    on: string,
    km: number,
    qty: number,
    cents: number,
  ): FuelConsumptionLog => ({ ...L(id, on, km, qty), fuelType, totalCents: cents });

  it('un auto benzina + GPL ha due catene separate e un costo combinato', () => {
    const r = consumptionByTank([
      F('p1', 'petrol', '2026-01-01', 10000, 40, 7200),
      F('g1', 'lpg', '2026-01-01', 10000, 30, 2000),
      F('p2', 'petrol', '2026-02-01', 10600, 20, 3600),
      F('g2', 'lpg', '2026-02-01', 10600, 55, 3300),
    ]);
    expect(r.bifuel).toBe(true);
    expect(r.caveat).toBe(BIFUEL_CAVEAT_IT);
    expect(r.tanks.map((t) => t.tank)).toEqual(['petrol', 'lpg']);
    const [petrol, lpg] = r.tanks;
    expect(petrol).toMatchObject({ unit: 'L', logs: 2 });
    expect(petrol!.points).toHaveLength(1);
    expect(petrol!.points[0]).toMatchObject({ distanceKm: 600, quantityMilli: 20000, per100Centi: 333 });
    expect(lpg!.points[0]).toMatchObject({ distanceKm: 600, quantityMilli: 55000, per100Centi: 917 });
    // costo per 100 km: benzina 36,00/6 = 6,00 EUR + GPL 33,00/6 = 5,50 EUR
    expect(petrol!.summary.costPer100KmCents).toBe(600);
    expect(lpg!.summary.costPer100KmCents).toBe(550);
    expect(r.combinedCostPer100KmCents).toBe(1150);
    expect(r.combinedComplete).toBe(true);
  });

  it('un solo serbatoio: nessuna avvertenza', () => {
    const r = consumptionByTank([F('p1', 'petrol', '2026-01-01', 10000, 40, 7200), F('p2', 'petrol', '2026-02-01', 10600, 36, 6480)]);
    expect(r.bifuel).toBe(false);
    expect(r.caveat).toBeNull();
    expect(r.tanks).toHaveLength(1);
    expect(r.combinedCostPer100KmCents).toBe(r.tanks[0]!.summary.costPer100KmCents);
  });

  it('un serbatoio senza ancora un consumo rende il costo combinato incompleto', () => {
    const r = consumptionByTank([
      F('p1', 'petrol', '2026-01-01', 10000, 40, 7200),
      F('p2', 'petrol', '2026-02-01', 10600, 36, 6480),
      F('g1', 'lpg', '2026-01-01', 10000, 30, 2000), // un solo pieno GPL: nessun consumo
    ]);
    expect(r.tanks.map((t) => t.tank)).toEqual(['petrol', 'lpg']);
    expect(r.combinedComplete).toBe(false);
    expect(r.combinedCostPer100KmCents).toBe(1080); // solo la benzina: 64,80 / 6 km*100
  });

  it('gasolio e HVO nella stessa catena; AdBlue escluso', () => {
    const r = consumptionByTank([
      F('d1', 'diesel', '2026-01-01', 10000, 50, 9000),
      F('h1', 'hvo', '2026-01-15', 10200, 12, 2400),
      F('a1', 'adblue', '2026-01-20', 10250, 10, 1500),
      F('d2', 'diesel', '2026-02-01', 10500, 25, 4500),
    ]);
    expect(r.tanks).toHaveLength(1);
    expect(r.tanks[0]!.tank).toBe('diesel');
    expect(r.tanks[0]!.logs).toBe(3);
    // h1 e un pieno a 10.200 km (12 L su 200 km = 6,00), d2 un pieno a 10.500 km (25 L su 300 km = 8,33)
    expect(r.tanks[0]!.points.map((p) => p.per100Centi)).toEqual([600, 833]);
  });

  it('metano in kg: kg/100 km', () => {
    const r = consumptionByTank([F('c1', 'cng', '2026-01-01', 10000, 12, 2000), F('c2', 'cng', '2026-01-20', 10300, 10.5, 1800)]);
    expect(r.tanks[0]).toMatchObject({ tank: 'cng', unit: 'kg' });
    expect(r.tanks[0]!.points[0]!.per100Centi).toBe(350);
    expect(formatConsumption(350, r.tanks[0]!.unit)).toBe('3,50 kg/100 km');
  });

  it('elettrico in kWh: kWh/100 km', () => {
    const r = consumptionByTank([F('e1', 'electric', '2026-01-01', 10000, 30, 900), F('e2', 'electric', '2026-01-10', 10200, 36, 1080)]);
    expect(r.tanks[0]).toMatchObject({ tank: 'electric', unit: 'kWh' });
    expect(r.tanks[0]!.points[0]!.per100Centi).toBe(1800);
    expect(formatConsumption(1800, 'kWh')).toBe('18,00 kWh/100 km');
  });

  it('nessun rifornimento: report vuoto', () => {
    expect(consumptionByTank([])).toMatchObject({ tanks: [], bifuel: false, caveat: null, combinedCostPer100KmCents: null, combinedComplete: false });
  });
});

describe('fuel: due campi calcolano il terzo', () => {
  it('quantita x prezzo -> totale', () => {
    expect(completeFuelAmounts({ quantityMilli: 40000, unitPriceMilli: 1859 })).toEqual({
      quantityMilli: 40000,
      unitPriceMilli: 1859,
      totalCents: 7436,
      computed: 'total',
    });
    expect(completeFuelAmounts({ quantityMilli: 35500, unitPriceMilli: 1789 }).totalCents).toBe(6351);
  });

  it('totale / prezzo -> quantita, totale / quantita -> prezzo', () => {
    expect(completeFuelAmounts({ totalCents: 7436, unitPriceMilli: 1859 })).toMatchObject({ quantityMilli: 40000, computed: 'quantity' });
    expect(completeFuelAmounts({ totalCents: 7436, quantityMilli: 40000 })).toMatchObject({ unitPriceMilli: 1859, computed: 'unitPrice' });
  });

  it('non tocca i campi gia inseriti: con tre campi non calcola nulla', () => {
    const r = completeFuelAmounts({ quantityMilli: 40000, unitPriceMilli: 1859, totalCents: 7500 });
    expect(r).toEqual({ quantityMilli: 40000, unitPriceMilli: 1859, totalCents: 7500, computed: null });
  });

  it('con meno di due campi o con divisione per zero non calcola', () => {
    expect(completeFuelAmounts({})).toMatchObject({ computed: null, totalCents: null });
    expect(completeFuelAmounts({ quantityMilli: 40000 })).toMatchObject({ computed: null });
    expect(completeFuelAmounts({ totalCents: 5000, unitPriceMilli: 0 })).toMatchObject({ computed: null, quantityMilli: null });
    expect(completeFuelAmounts({ totalCents: 5000, quantityMilli: 0 })).toMatchObject({ computed: null, unitPriceMilli: null });
    expect(completeFuelAmounts({ quantityMilli: null, unitPriceMilli: 1859, totalCents: null })).toMatchObject({ computed: null });
  });
});

describe('fuel: validazione non bloccante', () => {
  const TODAY = '2026-10-07';
  const ok: FuelLogInput = {
    filledOn: '2026-10-07',
    fuelType: 'petrol',
    quantityMilli: 40000,
    unitPriceMilli: 1859,
    totalCents: 7436,
    km: 12345,
  };

  it('un rifornimento coerente non da ne errori ne avvisi', () => {
    const v = validateFuelLog(ok, { today: TODAY });
    expect(v).toMatchObject({ ok: true, errors: [], warnings: [], expectedTotalCents: 7436 });
  });

  it('il totale che non torna e solo un avviso (oltre 2 centesimi)', () => {
    const near = validateFuelLog({ ...ok, totalCents: 7438 }, { today: TODAY });
    expect(near.warnings).toEqual([]);
    const far = validateFuelLog({ ...ok, totalCents: 7500 }, { today: TODAY });
    expect(far.ok).toBe(true);
    expect(far.warnings.map((w) => w.code)).toEqual(['TOTAL_MISMATCH']);
    expect(far.warnings[0]!.message).toContain('Il totale non torna: ricontrolla');
    expect(far.warnings[0]!.message).toContain('74,36 €');
  });

  it('senza prezzo non si puo verificare il totale', () => {
    const v = validateFuelLog({ ...ok, unitPriceMilli: null, totalCents: 9999 }, { today: TODAY });
    expect(v.warnings).toEqual([]);
    expect(v.expectedTotalCents).toBeNull();
  });

  it('errori bloccanti: quelli che violerebbero un CHECK del DB', () => {
    const codes = (i: Partial<FuelLogInput>) => validateFuelLog({ ...ok, ...i }, { today: TODAY }).errors.map((e) => e.code);
    expect(codes({ quantityMilli: 0 })).toEqual(['INVALID_QUANTITY']);
    expect(codes({ quantityMilli: 1.5 })).toEqual(['INVALID_QUANTITY']);
    expect(codes({ unitPriceMilli: -1 })).toEqual(['INVALID_PRICE']);
    expect(codes({ unitPriceMilli: 100_000_001 })).toEqual(['INVALID_PRICE']);
    expect(codes({ totalCents: -1 })).toEqual(['INVALID_TOTAL']);
    expect(codes({ totalCents: 100_000_000_001 })).toEqual(['INVALID_TOTAL']);
    expect(codes({ filledOn: '2026-02-30' })).toEqual(['INVALID_DATE']);
    expect(codes({ filledOn: '2026-10-08' })).toEqual(['FUTURE_DATE']);
    expect(codes({ km: -5 })).toEqual(['INVALID_KM']);
    expect(codes({ km: 2_000_001 })).toEqual(['INVALID_KM']);
    expect(codes({ fuelType: 'cng', quantityUnit: 'L' })).toEqual(['INVALID_UNIT']);
    expect(codes({ fuelType: 'electric', quantityUnit: 'kg' })).toEqual(['INVALID_UNIT']);
  });

  it('unita implicita: quella del carburante', () => {
    const v = validateFuelLog({ ...ok, fuelType: 'electric', quantityMilli: 30000, unitPriceMilli: 350, totalCents: 1050 }, { today: TODAY });
    expect(v.ok).toBe(true);
  });

  it('prezzo insolito: avviso, non errore (virgola sbagliata)', () => {
    const v = validateFuelLog({ ...ok, unitPriceMilli: 18590, totalCents: expectedFor(40000, 18590) }, { today: TODAY });
    expect(v.ok).toBe(true);
    expect(v.warnings.map((w) => w.code)).toEqual(['PRICE_OUT_OF_RANGE']);
    // prezzo zero (ricarica gratuita): nessun avviso
    expect(validateFuelLog({ ...ok, fuelType: 'electric', unitPriceMilli: 0, totalCents: 0 }, { today: TODAY }).warnings).toEqual([]);
    for (const f of FUEL_TYPES) expect(PLAUSIBLE_PRICE_MILLI[f][0]).toBeLessThan(PLAUSIBLE_PRICE_MILLI[f][1]);
  });

  it('quantita oltre la capacita: avviso', () => {
    const v = validateFuelLog({ ...ok, quantityMilli: 60000, totalCents: expectedFor(60000, 1859) }, { today: TODAY, maxQuantityMilli: 55000 });
    expect(v.ok).toBe(true);
    expect(v.warnings.map((w) => w.code)).toEqual(['QUANTITY_ABOVE_MAX']);
    expect(v.warnings[0]!.message).toContain('60,000 L');
  });
});

function expectedFor(q: number, p: number): number {
  return Number((BigInt(q) * BigInt(p) + 5000n) / 10000n);
}
