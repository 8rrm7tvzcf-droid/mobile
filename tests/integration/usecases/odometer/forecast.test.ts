// Media km/giorno e confidenza (AC-02 punto 5), con i parametri dalle impostazioni.
import { describe, expect, it } from 'vitest';
import { addDays } from '@/domain/dates';
import { addOdometerReading, getKmForecast } from '@/usecases/odometer';
import { setSetting } from '@/usecases/settings';
import { addVehicle, updateVehicle } from '@/usecases/vehicles';
import { makeHarness, PANDA, unwrap } from '../vehicles/harness';

describe('getKmForecast', () => {
  it('AC-02.5: 20 giorni di dati (30.000 il 17/9, 30.400 il 7/10) con stima utente 12.000 km/anno: 30,015 km/g, confidenza low', async () => {
    const h = await makeHarness('2026-10-07T08:00:00.000Z');
    const v = unwrap(await addVehicle(h.deps, { ...PANDA, annualKmEstimate: 12000 }));
    unwrap(await addOdometerReading(h.deps, { vehicleId: v.id, km: 30000, readOn: '2026-09-17' }));
    unwrap(await addOdometerReading(h.deps, { vehicleId: v.id, km: 30400, readOn: '2026-10-07' }));
    const f = (await getKmForecast(h.deps, v.id))!;
    expect(f.kmPerDay).toBeCloseTo(30.015, 2);
    expect(f.confidence).toBe('low');
    expect(f.source).toBe('blended');
    expect(f.priorSource).toBe('user_estimate');
    expect(f.points).toBe(2);
    expect(f.isInitialEstimate).toBe(false);
    expect(f.currentKm).toMatchObject({ km: 30400, readOn: '2026-10-07' });
    expect(f.projectedKm).toBeNull(); // la lettura e di oggi
    expect(f.kmPerYear).toBe(Math.round(f.kmPerDay * 365));
  });

  it('AC-02.5: 5.000 km invariati in 180 giorni: nessuna previsione (confidenza none)', async () => {
    const h = await makeHarness('2026-10-08T08:00:00.000Z');
    const v = unwrap(await addVehicle(h.deps, PANDA));
    unwrap(await addOdometerReading(h.deps, { vehicleId: v.id, km: 5000, readOn: addDays('2026-10-08', -180) }));
    unwrap(await addOdometerReading(h.deps, { vehicleId: v.id, km: 5000, readOn: '2026-10-08' }));
    const f = (await getKmForecast(h.deps, v.id))!;
    expect(f.confidence).toBe('none');
    expect(f.projectedKm).toBeNull();
  });

  it('senza letture la media e la stima iniziale: dell utente, altrimenti il valore predefinito delle impostazioni', async () => {
    const h = await makeHarness();
    const v = unwrap(await addVehicle(h.deps, PANDA));
    const def = (await getKmForecast(h.deps, v.id))!;
    expect(def).toMatchObject({ source: 'prior', priorSource: 'default', isInitialEstimate: true, kmPerYear: 12000, currentKm: null, projectedKm: null, points: 0 });

    unwrap(await setSetting(h.deps, 'forecast.defaultAnnualKm', 20000));
    expect((await getKmForecast(h.deps, v.id))?.kmPerYear).toBe(20000);

    unwrap(await updateVehicle(h.deps, v.id, { annualKmEstimate: 8000 }));
    expect(await getKmForecast(h.deps, v.id)).toMatchObject({ kmPerYear: 8000, priorSource: 'user_estimate', isInitialEstimate: true });
  });

  it('con l ultima lettura vecchia i km stimati oggi avanzano della media (e la confidenza scende)', async () => {
    const h = await makeHarness('2026-10-08T08:00:00.000Z');
    const v = unwrap(await addVehicle(h.deps, PANDA));
    for (const [km, on] of [
      [10000, '2026-04-01'],
      [11000, '2026-05-01'],
      [12000, '2026-06-01'],
      [13000, '2026-07-01'],
      [14000, '2026-07-29'],
    ] as const) {
      unwrap(await addOdometerReading(h.deps, { vehicleId: v.id, km, readOn: on }));
    }
    const f = (await getKmForecast(h.deps, v.id))!;
    expect(f.staleDays).toBe(71);
    expect(f.confidence).not.toBe('high'); // ultima lettura di oltre 60 giorni
    expect(f.projectedKm).toBe(14000 + Math.round(f.kmPerDay * 71));
    expect(f.projectedKm!).toBeGreaterThan(14000);
  });

  it('le letture ignorate non contano', async () => {
    const h = await makeHarness('2026-10-08T08:00:00.000Z');
    const v = unwrap(await addVehicle(h.deps, PANDA));
    await h.db.run(
      `INSERT INTO odometer_readings (id, vehicle_id, read_on, km, source, status) VALUES ('01TESTID000000000000007777', ?, '2026-10-01', 99999, 'manual', 'ignored')`,
      [v.id],
    );
    const f = (await getKmForecast(h.deps, v.id))!;
    expect(f.points).toBe(0);
    expect(f.currentKm).toBeNull();
  });

  it('auto inesistente: null', async () => {
    const h = await makeHarness();
    expect(await getKmForecast(h.deps, 'non-esiste')).toBeNull();
  });
});
