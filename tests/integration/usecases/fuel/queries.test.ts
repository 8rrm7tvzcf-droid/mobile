// Letture dei rifornimenti: elenco per periodo, riepilogo consumi/costi per serbatoio (bifuel) e valori predefiniti del modulo.
import { beforeEach, describe, expect, it } from 'vitest';
import { sourceLabelIt } from '@/domain/odometer';
import { addOdometerReading } from '@/usecases/odometer';
import { getFuelFormDefaults, getFuelSummary, listFuelLogs } from '@/usecases/fuel';
import { fill, makeFuelWorld, unwrap, type FuelWorld } from './helpers';

/** Il vettore V11 (data.md): consumi 6,43 / 6,00 / (catena spezzata) / 6,40. */
async function seedV11(w: FuelWorld): Promise<void> {
  await fill(w, '2026-01-10', 10000, 40);
  await fill(w, '2026-01-20', 10300, 15, { isFull: false });
  await fill(w, '2026-02-01', 10700, 30, { station: 'Eni' });
  await fill(w, '2026-02-15', 11300, 36);
  await fill(w, '2026-03-01', 11900, 33, { missedBefore: true });
  await fill(w, '2026-03-15', 12500, 38.4, { station: 'Q8' });
}

describe('listFuelLogs', () => {
  let w: FuelWorld;
  beforeEach(async () => {
    w = await makeFuelWorld();
    await seedV11(w);
  });

  it('dal piu\' recente, ogni pieno col suo consumo (anche con la catena iniziata prima del periodo)', async () => {
    const all = await listFuelLogs(w.h.deps, w.vehicleId);
    expect(all.map((l) => l.filledOn)).toEqual(['2026-03-15', '2026-03-01', '2026-02-15', '2026-02-01', '2026-01-20', '2026-01-10']);
    expect(all[0]!.consumption).toMatchObject({ computed: true, per100Centi: 640 });
    expect(all[1]!.consumption).toMatchObject({ computed: false, reason: 'CHAIN_BROKEN' });
    expect(all[4]!.consumption).toBeNull(); // parziale

    const feb = await listFuelLogs(w.h.deps, w.vehicleId, { from: '2026-02-01', to: '2026-02-28' });
    expect(feb.map((l) => l.filledOn)).toEqual(['2026-02-15', '2026-02-01']);
    expect(feb[1]!.consumption).toMatchObject({ computed: true, per100Centi: 643 }); // l'ancora e' di gennaio
  });

  it('estremi inclusivi, ordine crescente, limite e filtro per carburante', async () => {
    const edge = await listFuelLogs(w.h.deps, w.vehicleId, { from: '2026-02-15', to: '2026-03-01' }, { order: 'asc' });
    expect(edge.map((l) => l.filledOn)).toEqual(['2026-02-15', '2026-03-01']);
    expect(await listFuelLogs(w.h.deps, w.vehicleId, null, { limit: 2 })).toHaveLength(2);
    expect(await listFuelLogs(w.h.deps, w.vehicleId, null, { fuelType: 'lpg' })).toEqual([]);
    expect(await listFuelLogs(w.h.deps, 'nessuna')).toEqual([]);
  });

  it('un periodo con data non valida e\' ignorato, uno rovesciato da\' elenco vuoto', async () => {
    expect(await listFuelLogs(w.h.deps, w.vehicleId, { from: 'boh' })).toHaveLength(6);
    expect(await listFuelLogs(w.h.deps, w.vehicleId, { from: '2026-04-01', to: '2026-01-01' })).toEqual([]);
  });
});

describe('getFuelSummary', () => {
  it('consumo medio (km totali), ultimo, migliore, peggiore, costo per 100 km e serie per il grafico', async () => {
    const w = await makeFuelWorld();
    await seedV11(w);
    const s = (await getFuelSummary(w.h.deps, w.vehicleId))!;
    expect(s.bifuel).toBe(false);
    expect(s.caveat).toBeNull();
    expect(s.logCount).toBe(6);
    expect(s.tanks).toHaveLength(1);
    const t = s.tanks[0]!;
    expect(t).toMatchObject({
      tank: 'petrol',
      unit: 'L',
      logCount: 6,
      count: 3,
      totalDistanceKm: 1900,
      totalQuantityMilli: 119400,
      avgPer100Centi: 628, // 119,4 L su 1.900 km = 6,28 (media sui km totali, non dei rapporti)
      lastPer100Centi: 640,
      bestPer100Centi: 600,
      worstPer100Centi: 643,
      avgText: '6,28 L/100 km',
      bestText: '6,00 L/100 km',
      totalCostCents: 21492,
      costPer100KmCents: 1131,
    });
    expect(t.series.map((p) => [p.on, p.per100Centi])).toEqual([
      ['2026-02-01', 643],
      ['2026-02-15', 600],
      ['2026-03-15', 640],
    ]);
    expect(s.combinedCostPer100KmCents).toBe(1131);
    expect(s.combinedComplete).toBe(true);
    // spesa e prezzo medio ponderato (1,800 EUR/L)
    expect(s.byFuel).toHaveLength(1);
    expect(s.byFuel[0]).toMatchObject({ fuelType: 'petrol', logCount: 6, avgUnitPriceMilli: 1800 });
    expect(s.totalCostCents).toBe(s.byFuel[0]!.totalCents);
  });

  it('il periodo filtra i risultati ma l\'ancora del primo pieno puo\' stare prima del periodo', async () => {
    const w = await makeFuelWorld();
    await seedV11(w);
    const s = (await getFuelSummary(w.h.deps, w.vehicleId, { from: '2026-02-10', to: '2026-03-31' }))!;
    const t = s.tanks[0]!;
    expect(t).toMatchObject({ logCount: 3, count: 2, totalDistanceKm: 1200, totalQuantityMilli: 74400, avgPer100Centi: 620 });
    expect(t.series.map((p) => p.per100Centi)).toEqual([600, 640]);
    const none = (await getFuelSummary(w.h.deps, w.vehicleId, { from: '2027-01-01' }))!;
    expect(none).toMatchObject({ logCount: 0, totalCostCents: 0, tanks: [], byFuel: [], combinedCostPer100KmCents: null, combinedComplete: false });
  });

  it('un solo pieno: nessun consumo ma la spesa c\'e\'', async () => {
    const w = await makeFuelWorld();
    await fill(w, '2026-01-10', 10000, 40);
    const t = (await getFuelSummary(w.h.deps, w.vehicleId))!.tanks[0]!;
    expect(t).toMatchObject({ count: 0, avgPer100Centi: null, lastPer100Centi: null, costPer100KmCents: null, series: [] });
  });

  it('auto bifuel: consumi PER carburante, avvertenza e costo per 100 km complessivo (somma dei serbatoi)', async () => {
    const w = await makeFuelWorld({ fuelPrimary: 'petrol', fuelSecondary: 'lpg' });
    const f = (on: string, km: number, liters: number, fuelType: 'petrol' | 'lpg') =>
      fill(w, on, km, liters, { fuelType, unitPriceMilli: fuelType === 'lpg' ? 800 : 1800 });
    await f('2026-01-10', 10000, 40, 'petrol');
    await f('2026-01-12', 10100, 20, 'lpg');
    await f('2026-02-01', 10600, 30, 'petrol');
    await f('2026-02-05', 10800, 14, 'lpg');
    const s = (await getFuelSummary(w.h.deps, w.vehicleId))!;
    expect(s.bifuel).toBe(true);
    expect(s.caveat).toContain('indicativi');
    expect(s.tanks.map((t) => t.tank)).toEqual(['petrol', 'lpg']); // ordine fisso
    const [petrol, lpg] = s.tanks;
    expect(petrol).toMatchObject({ avgPer100Centi: 500, costPer100KmCents: 900 }); // 30 L x 1,800 = 54 EUR su 600 km
    expect(lpg).toMatchObject({ avgPer100Centi: 200, costPer100KmCents: 160 }); // 14 L x 0,800 = 11,20 EUR su 700 km
    expect(s.combinedCostPer100KmCents).toBe(1060);
    expect(s.combinedComplete).toBe(true);
    expect(s.byFuel.map((b) => b.fuelType)).toEqual(['petrol', 'lpg']);
  });

  it('il costo combinato e\' parziale se un serbatoio non ha ancora un consumo', async () => {
    const w = await makeFuelWorld({ fuelPrimary: 'petrol', fuelSecondary: 'lpg' });
    await fill(w, '2026-01-10', 10000, 40, { fuelType: 'petrol' });
    await fill(w, '2026-02-01', 10600, 30, { fuelType: 'petrol' });
    await fill(w, '2026-02-02', 10610, 20, { fuelType: 'lpg' });
    const s = (await getFuelSummary(w.h.deps, w.vehicleId))!;
    expect(s.combinedComplete).toBe(false);
    expect(s.combinedCostPer100KmCents).toBe(900);
  });

  it('serie dei prezzi unitari e AdBlue conteggiato nella spesa ma senza consumi', async () => {
    const w = await makeFuelWorld({ fuelPrimary: 'diesel' });
    await fill(w, '2026-01-10', 10000, 40, { fuelType: 'diesel', unitPriceMilli: 1700 });
    await fill(w, '2026-02-10', 10800, 40, { fuelType: 'diesel', unitPriceMilli: 1750 });
    await fill(w, '2026-02-11', null, 10, { fuelType: 'adblue', unitPriceMilli: 1200 });
    const s = (await getFuelSummary(w.h.deps, w.vehicleId))!;
    expect(s.tanks.map((t) => t.tank)).toEqual(['diesel']);
    expect(s.byFuel.find((b) => b.fuelType === 'diesel')!.prices.map((p) => p.unitPriceMilli)).toEqual([1700, 1750]);
    expect(s.byFuel.find((b) => b.fuelType === 'adblue')).toMatchObject({ unit: 'L', totalCents: 1200 });
    expect(s.logCount).toBe(3);
  });

  it('veicolo inesistente: null', async () => {
    const w = await makeFuelWorld();
    expect(await getFuelSummary(w.h.deps, 'nessuno')).toBeNull();
  });
});

describe('getFuelFormDefaults', () => {
  it('auto nuova: carburante primario, nessun prezzo, nessun km', async () => {
    const w = await makeFuelWorld({ fuelPrimary: 'diesel', tankCapacityMl: 50000 });
    const d = (await getFuelFormDefaults(w.h.deps, w.vehicleId))!;
    expect(d).toMatchObject({
      today: '2026-10-08',
      fuelType: 'diesel',
      fuelTypes: ['diesel', 'hvo', 'adblue'],
      quantityUnit: 'L',
      lastUnitPriceMilli: {},
      lastStation: null,
      recentStations: [],
      suggestedKm: null,
      isFull: true,
      tankCapacityMl: 50000,
    });
  });

  it('ultimo carburante, ultimo prezzo per carburante, ultima stazione e ottani', async () => {
    const w = await makeFuelWorld({ fuelPrimary: 'petrol', fuelSecondary: 'lpg' });
    await fill(w, '2026-02-01', null, 30, { fuelType: 'petrol', unitPriceMilli: 1850, station: 'Eni', grade: '98 ottani' });
    await fill(w, '2026-02-10', null, 20, { fuelType: 'lpg', unitPriceMilli: 790, station: 'Q8' });
    await fill(w, '2026-02-20', null, 20, { fuelType: 'lpg', unitPriceMilli: 800, station: 'Q8' });
    const d = (await getFuelFormDefaults(w.h.deps, w.vehicleId))!;
    expect(d.fuelType).toBe('lpg'); // l'ultimo usato
    expect(d.lastUnitPriceMilli).toEqual({ petrol: 1850, lpg: 800 });
    expect(d.lastGrade).toEqual({ petrol: '98 ottani' });
    expect(d.lastStation).toBe('Q8');
    expect(d.recentStations).toEqual(['Q8', 'Eni']);
  });

  it('km suggeriti: letti oggi (provenienza), oppure stimati (etichetta «stimato») o ultima lettura', async () => {
    const w = await makeFuelWorld();
    expect((await getFuelFormDefaults(w.h.deps, w.vehicleId))!.suggestedKm).toBeNull();
    unwrap(await addOdometerReading(w.h.deps, { vehicleId: w.vehicleId, km: 10000, readOn: '2026-09-01' }));
    unwrap(await addOdometerReading(w.h.deps, { vehicleId: w.vehicleId, km: 11000, readOn: '2026-09-30' }));
    const stale = (await getFuelFormDefaults(w.h.deps, w.vehicleId))!.suggestedKm!;
    expect(stale.asOf).toBe('2026-09-30');
    expect(stale.km).toBeGreaterThanOrEqual(11000);
    if (stale.estimated) {
      expect(stale).toMatchObject({ basis: 'projected', label: 'stimato' });
      expect(stale.km).toBeGreaterThan(11000);
    } else {
      expect(stale).toMatchObject({ basis: 'last', label: 'ultima lettura', km: 11000 });
    }
    unwrap(await addOdometerReading(w.h.deps, { vehicleId: w.vehicleId, km: 11400, readOn: '2026-10-08' }));
    const today = (await getFuelFormDefaults(w.h.deps, w.vehicleId))!.suggestedKm!;
    expect(today).toMatchObject({ km: 11400, estimated: false, basis: 'today', label: sourceLabelIt('manual') });
  });

  it('veicolo inesistente: null', async () => {
    const w = await makeFuelWorld();
    expect(await getFuelFormDefaults(w.h.deps, 'nessuno')).toBeNull();
  });
});
