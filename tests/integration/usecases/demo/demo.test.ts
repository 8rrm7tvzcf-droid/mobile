// Auto demo (F-17): storico di due anni credibile, idempotenza, eliminazione a cascata, nessun conflitto con l auto vera.
import { describe, expect, it } from 'vitest';
import { addDays, diffDays } from '@/domain/dates';
import {
  DEMO_SPAN_DAYS,
  buildDemoPlan,
  createDemoVehicle,
  getDemoVehicleId,
  hasDemoVehicle,
  removeDemoVehicle,
} from '@/usecases/demo';
import { getFuelSummary } from '@/usecases/fuel';
import { suggestLastDoneFromHistory } from '@/usecases/services';
import { addOdometerReading, getKmForecast, listOdometerReadings } from '@/usecases/odometer';
import { addVehicle, getVehicle, listVehicles } from '@/usecases/vehicles';
import { count, errorCode, makeHarness, PANDA, unwrap } from '../vehicles/harness';

describe('buildDemoPlan (storico puro)', () => {
  it.each(['2026-10-08', '2028-02-29', '2027-03-31', '2026-01-01', '2030-12-31'])(
    'per %s: due anni di letture coerenti, mai nel futuro, ultima lettura due giorni fa',
    (today) => {
      const p = buildDemoPlan(today);
      const all = [
        ...p.manual.map((m) => ({ on: m.on, km: m.km })),
        ...p.fuel.map((f) => ({ on: f.on, km: f.km })),
        ...p.services.map((s) => ({ on: s.on, km: s.km })),
      ].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : a.km - b.km));
      expect(diffDays(all[0]!.on, all[all.length - 1]!.on)).toBeGreaterThanOrEqual(DEMO_SPAN_DAYS - 31 - 2);
      for (let i = 1; i < all.length; i++) expect(all[i]!.km, `${all[i]!.on}`).toBeGreaterThanOrEqual(all[i - 1]!.km);
      expect(all.every((r) => r.on <= today)).toBe(true);
      expect(p.finalOn).toBe(addDays(today, -2));
      expect(p.manual[p.manual.length - 1]).toEqual({ on: p.finalOn, km: p.finalKm });
      expect(p.firstRegistrationOn < today).toBe(true);
    },
  );

  it('e deterministico: stessa data, stesso piano', () => {
    expect(buildDemoPlan('2026-10-08')).toEqual(buildDemoPlan('2026-10-08'));
  });

  it('rifornimenti a sola benzina con totali coerenti con quantita x prezzo, due tagliandi e una revisione con righe che sommano al totale', () => {
    const p = buildDemoPlan('2026-10-08');
    expect(p.fuel.length).toBeGreaterThan(40);
    expect(new Set(p.fuel.map((f) => f.fuelType))).toEqual(new Set(['petrol']));
    for (const f of p.fuel) {
      expect(Math.abs(f.totalCents - (f.quantityMilli * f.unitPriceMilli) / 10_000)).toBeLessThanOrEqual(0.5);
      expect(f.unitPriceMilli).toBeGreaterThan(1500);
    }
    expect(p.services.map((s) => s.kind)).toEqual(['scheduled', 'inspection', 'scheduled']);
    expect(p.services.every((s, i) => i === 0 || s.on > p.services[i - 1]!.on)).toBe(true);
    for (const s of p.services) expect(s.lines.reduce((a, l) => a + l.amountCents, 0)).toBe(s.totalCents);
  });

  it.each(['2026-10-08', '2028-02-29', '2030-12-31'])('per %s: il consumo di ogni pieno e credibile per una Panda 1.2 benzina (5,5-7,5 L/100 km)', (today) => {
    const p = buildDemoPlan(today);
    for (let i = 1; i < p.fuel.length; i++) {
      const distance = p.fuel[i]!.km - p.fuel[i - 1]!.km;
      expect(distance).toBeGreaterThan(150);
      const per100 = p.fuel[i]!.quantityMilli / distance / 10;
      expect(per100).toBeGreaterThan(5.5);
      expect(per100).toBeLessThan(7.5);
    }
  });
});

describe('createDemoVehicle', () => {
  it('crea una Panda di esempio con is_demo = 1, senza targa ne VIN, con storico di due anni', async () => {
    const h = await makeHarness();
    const r = unwrap(await createDemoVehicle(h.deps));
    expect(r.created).toBe(true);
    const v = (await getVehicle(h.deps, r.vehicleId))!;
    expect(v).toMatchObject({
      isDemo: true,
      nickname: 'Panda di esempio',
      displayName: 'Panda di esempio',
      make: 'Fiat',
      model: 'Panda',
      fuelPrimary: 'petrol',
      fuelSecondary: null,
      powertrain: 'ice',
      plate: null,
      vin: null,
      status: 'active',
    });
    expect(v.firstRegistrationOn).toBe('2021-10-08');
    expect(v.currentKm?.readOn).toBe('2026-10-06');

    const readings = await listOdometerReadings(h.deps, r.vehicleId);
    const days = diffDays(readings[readings.length - 1]!.readOn, readings[0]!.readOn);
    expect(days).toBeGreaterThanOrEqual(700);
    expect(new Set(readings.map((x) => x.source))).toEqual(new Set(['manual', 'fuel', 'service']));
    expect(readings.every((x) => x.status === 'valid')).toBe(true);
    // ogni rifornimento e ogni tagliando porta la sua lettura collegata
    expect(await count(h.db, 'odometer_readings', "source = 'fuel'")).toBe(await count(h.db, 'fuel_logs'));
    expect(await count(h.db, 'fuel_logs')).toBeGreaterThan(40);
    expect(await count(h.db, 'service_records')).toBe(3);
    expect(await count(h.db, 'service_lines', 'amount_cents > 0')).toBe(15); // 9 righe + 1 riga (revisione) + 5 righe
    const totals = await h.db.all<{ total_cents: number; sum: number }>(
      `SELECT r.total_cents, (SELECT SUM(amount_cents) FROM service_lines l WHERE l.service_record_id = r.id) AS sum FROM service_records r`,
    );
    for (const t of totals) expect(t.sum).toBe(t.total_cents);
  });

  it('un solo serbatoio (benzina) con consumo medio realistico, non 1,5 L/100 km', async () => {
    const h = await makeHarness();
    const { vehicleId } = unwrap(await createDemoVehicle(h.deps));
    const summary = (await getFuelSummary(h.deps, vehicleId))!;
    expect(summary.bifuel).toBe(false);
    expect(summary.tanks).toHaveLength(1);
    expect(summary.tanks[0]!.avgText).toMatch(/^6,\d+ L\/100 km/);
  });

  it('lo storico dice quando sono state fatte le voci principali (precompila "Imposta le scadenze")', async () => {
    const h = await makeHarness();
    const { vehicleId } = unwrap(await createDemoVehicle(h.deps));
    const last = await suggestLastDoneFromHistory(h.deps, vehicleId);
    for (const id of ['tpl_service_main', 'tpl_oil_change', 'tpl_air_filter', 'tpl_cabin_filter', 'tpl_inspection', 'tpl_brake_fluid', 'tpl_spark_plugs', 'tpl_coolant', 'tpl_battery_check', 'tpl_wipers']) {
      expect(last[id], id).toBeDefined();
      expect(last[id]!.doneKm).not.toBeNull();
    }
    expect(last.tpl_inspection!.serviceTitle).toBe('Revisione');
    expect(last.tpl_oil_change!.doneOn > last.tpl_brake_fluid!.doneOn).toBe(true);
  });

  it('la previsione dei km sull auto di esempio e credibile: alta confidenza, circa 10.000-11.000 km all anno', async () => {
    const h = await makeHarness();
    const { vehicleId } = unwrap(await createDemoVehicle(h.deps));
    const f = (await getKmForecast(h.deps, vehicleId))!;
    expect(f.confidence).toBe('high');
    expect(f.isInitialEstimate).toBe(false);
    expect(f.kmPerYear).toBeGreaterThan(9000);
    expect(f.kmPerYear).toBeLessThan(13000);
  });

  it('e idempotente: una seconda chiamata restituisce la stessa auto senza crearne un altra', async () => {
    const h = await makeHarness();
    const a = unwrap(await createDemoVehicle(h.deps));
    const readingsBefore = await count(h.db, 'odometer_readings');
    h.clearEvents();
    const b = unwrap(await createDemoVehicle(h.deps));
    expect(b).toEqual({ vehicleId: a.vehicleId, created: false });
    expect(await count(h.db, 'vehicles')).toBe(1);
    expect(await count(h.db, 'odometer_readings')).toBe(readingsBefore);
    expect(h.events).toEqual([]);
    expect(await getDemoVehicleId(h.deps)).toBe(a.vehicleId);
    expect(await hasDemoVehicle(h.deps)).toBe(true);
  });

  it('emette gli eventi dopo il commit per km, rifornimenti e interventi', async () => {
    const h = await makeHarness();
    const { vehicleId } = unwrap(await createDemoVehicle(h.deps));
    expect(h.events).toEqual(
      (['vehicles', 'odometer', 'fuel', 'service'] as const).map((scope) => ({ type: 'data-changed', scope, vehicleId })),
    );
  });

  it('non confligge con l auto vera dell utente: compare nel garage dopo di lei e non occupa targhe', async () => {
    const h = await makeHarness();
    const real = unwrap(await addVehicle(h.deps, { ...PANDA, plate: 'AB123CD', initialKm: 500 }));
    const demo = unwrap(await createDemoVehicle(h.deps));
    const list = await listVehicles(h.deps);
    expect(list.map((v) => [v.id, v.isDemo])).toEqual([
      [real.id, false],
      [demo.vehicleId, true],
    ]);
    expect(await listVehicles(h.deps, { includeDemo: false })).toHaveLength(1);
    unwrap(await addVehicle(h.deps, { ...PANDA, plate: 'EF456GH' })); // nessuna targa bloccata dalla demo
  });

  it('con un altro "oggi" (anno bisestile) crea comunque uno storico valido', async () => {
    const h = await makeHarness('2028-02-29T09:00:00.000Z');
    const { vehicleId } = unwrap(await createDemoVehicle(h.deps));
    expect((await getVehicle(h.deps, vehicleId))?.firstRegistrationOn).toBe('2023-02-28');
  });
});

describe('removeDemoVehicle', () => {
  it('elimina l auto di esempio e tutto il suo storico, ma non i dati veri', async () => {
    const h = await makeHarness();
    const real = unwrap(await addVehicle(h.deps, { ...PANDA, plate: 'AB123CD', initialKm: 500 }));
    unwrap(await addOdometerReading(h.deps, { vehicleId: real.id, km: 600, readOn: '2026-10-08' })); // stesso giorno: nessun vincolo
    unwrap(await createDemoVehicle(h.deps));
    h.clearEvents();

    expect(unwrap(await removeDemoVehicle(h.fileDeps))).toEqual({ removed: 1 });
    expect(await count(h.db, 'vehicles')).toBe(1);
    expect(await count(h.db, 'vehicles', 'is_demo = 1')).toBe(0);
    expect(await count(h.db, 'fuel_logs')).toBe(0);
    expect(await count(h.db, 'service_records')).toBe(0);
    expect(await count(h.db, 'service_lines')).toBe(0);
    expect(await count(h.db, 'odometer_readings')).toBe(2); // solo quelle dell auto vera
    expect((await getVehicle(h.deps, real.id))?.currentKm?.km).toBe(600);
    expect(await hasDemoVehicle(h.deps)).toBe(false);
    expect(h.events.map((e) => (e.type === 'data-changed' ? e.scope : e.type))).toEqual([
      'vehicles',
      'odometer',
      'fuel',
      'service',
      'insurance',
      'reminders',
    ]);
  });

  it('elimina anche i dati collegati creati dopo (sessioni OBD simulate, promemoria) e la sua riga nel cestino', async () => {
    const h = await makeHarness();
    const { vehicleId } = unwrap(await createDemoVehicle(h.deps));
    await h.db.run(
      `INSERT INTO obd_adapters (id, name, transport, address) VALUES ('01TESTID000000000000000500', 'Simulatore', 'simulator', 'simulator')`,
    );
    await h.db.run(
      `INSERT INTO obd_sessions (id, seq, vehicle_id, adapter_id, kind, started_at) VALUES ('01TESTID000000000000000501', 1, ?, '01TESTID000000000000000500', 'live', '2026-10-01T10:00:00.000Z')`,
      [vehicleId],
    );
    await h.db.run('INSERT INTO telemetry_samples (session_seq, pid, t_ms, value) VALUES (1, 268, 0, 850)');
    await h.db.run(
      `INSERT INTO reminders (id, vehicle_id, origin, title, due_on) VALUES ('01TESTID000000000000000502', ?, 'manual', 'Prova', '2026-12-01')`,
      [vehicleId],
    );
    unwrap(await removeDemoVehicle(h.fileDeps));
    expect(await count(h.db, 'obd_sessions')).toBe(0);
    expect(await count(h.db, 'telemetry_samples')).toBe(0);
    expect(await count(h.db, 'reminders')).toBe(0);
  });

  it('senza auto di esempio: ITEM_NOT_FOUND e nessun evento; dopo la rimozione se ne puo creare un altra', async () => {
    const h = await makeHarness();
    expect(errorCode(await removeDemoVehicle(h.fileDeps))).toBe('ITEM_NOT_FOUND');
    expect(h.events).toEqual([]);
    const a = unwrap(await createDemoVehicle(h.deps));
    unwrap(await removeDemoVehicle(h.fileDeps));
    const b = unwrap(await createDemoVehicle(h.deps));
    expect(b.created).toBe(true);
    expect(b.vehicleId).not.toBe(a.vehicleId);
  });
});
