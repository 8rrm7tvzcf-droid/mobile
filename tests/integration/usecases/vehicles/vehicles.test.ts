// Casi d'uso dei veicoli su node:sqlite (AC-01): aggiunta, modifica, archivio, cestino, ripristino, elenco.
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '@/domain/dates';
import {
  addVehicle,
  archiveVehicle,
  deleteVehicle,
  getVehicle,
  listVehicles,
  reactivateVehicle,
  restoreVehicle,
  updateVehicle,
} from '@/usecases/vehicles';
import { addOdometerReading } from '@/usecases/odometer';
import { setSetting } from '@/usecases/settings';
import { count, errorCode, makeHarness, PANDA, unwrap, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await makeHarness(); // oggi = 2026-10-08
});

describe('addVehicle', () => {
  it('si salva un auto con solo marca, modello e alimentazione primaria', async () => {
    const v = unwrap(await addVehicle(h.deps, PANDA));
    expect(v).toMatchObject({
      make: 'Fiat',
      model: 'Panda',
      fuelPrimary: 'petrol',
      fuelSecondary: null,
      powertrain: 'ice',
      status: 'active',
      plate: null,
      vin: null,
      plateCountry: 'IT',
      distanceUnit: 'km',
      isDemo: false,
      deletedAt: null,
      currentKm: null,
      displayName: 'Fiat Panda',
    });
    expect(v.id).toHaveLength(26);
    expect(v.createdAt).toBe('2026-10-08T07:30:00.000Z');
  });

  it('il soprannome diventa il nome mostrato; senza targa e valido', async () => {
    const v = unwrap(await addVehicle(h.deps, { ...PANDA, nickname: 'Panda di Marco' }));
    expect(v.displayName).toBe('Panda di Marco');
    expect(v.plate).toBeNull();
  });

  it('salva tutti i campi, bifuel benzina/GPL incluso', async () => {
    const v = unwrap(
      await addVehicle(h.deps, {
        nickname: 'Panda di Marco',
        plate: 'fa 123 bc',
        vin: 'zfa31200003456789',
        make: 'Fiat',
        model: 'Panda',
        trim: '1.2 Easy',
        modelYear: 2016,
        firstRegistrationOn: '2016-05-10',
        fuelPrimary: 'petrol',
        fuelSecondary: 'lpg',
        engineCc: 1242,
        powerKw: 51,
        euroClass: 'Euro 6',
        color: 'Bianco',
        transmission: 'manual',
        tankCapacityMl: 37000,
        annualKmEstimate: 12000,
        purchaseOn: '2016-06-01',
        purchaseKm: 0,
        purchasePriceCents: 1099000,
        notes: 'prima auto',
      }),
    );
    expect(v).toMatchObject({
      plate: 'FA123BC',
      vin: 'ZFA31200003456789',
      fuelSecondary: 'lpg',
      powertrain: 'ice',
      engineCc: 1242,
      powerKw: 51,
      firstRegistrationOn: '2016-05-10',
      purchasePriceCents: 1099000,
      notes: 'prima auto',
    });
  });

  it('usa l unita di distanza delle impostazioni se l input non la indica', async () => {
    unwrap(await setSetting(h.deps, 'units.distance', 'mi'));
    expect(unwrap(await addVehicle(h.deps, PANDA)).distanceUnit).toBe('mi');
    expect(unwrap(await addVehicle(h.deps, { ...PANDA, distanceUnit: 'km' })).distanceUnit).toBe('km');
  });

  it('elettrica, ibrida plug-in e idrogeno ricevono il tipo di motorizzazione giusto', async () => {
    expect(unwrap(await addVehicle(h.deps, { make: 'Tesla', model: 'Model 3', fuelPrimary: 'electric' })).powertrain).toBe('bev');
    expect(unwrap(await addVehicle(h.deps, { make: 'Toyota', model: 'Prius', fuelPrimary: 'petrol', fuelSecondary: 'electric' })).powertrain).toBe('phev');
    expect(unwrap(await addVehicle(h.deps, { make: 'Toyota', model: 'Mirai', fuelPrimary: 'hydrogen' })).powertrain).toBe('fcev');
  });

  it('errori di validazione con campo e messaggio in italiano', async () => {
    const r = await addVehicle(h.deps, { ...PANDA, vin: 'CORTO' });
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'vin' } });
    const m = await addVehicle(h.deps, { make: '', model: 'Panda', fuelPrimary: 'petrol' });
    expect(m).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'make', message: 'Indica la marca.' } });
    expect(await count(h.db, 'vehicles')).toBe(0);
  });

  it('targa normalizzata e unica fra le auto non eliminate: DUPLICATE_PLATE', async () => {
    unwrap(await addVehicle(h.deps, { ...PANDA, plate: 'AB123CD' }));
    expect(errorCode(await addVehicle(h.deps, { ...PANDA, plate: 'ab 123 cd' }))).toBe('DUPLICATE_PLATE');
    expect(await count(h.db, 'vehicles')).toBe(1);
  });

  it('un VIN gia presente e un errore di validazione sul campo vin', async () => {
    unwrap(await addVehicle(h.deps, { ...PANDA, vin: 'ZFA31200003456789' }));
    const r = await addVehicle(h.deps, { ...PANDA, vin: 'zfa 31200 003 456 789' });
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'vin', message: 'Questo VIN è già nel tuo garage.' } });
  });

  it('i km iniziali creano la prima lettura dell odometro (oggi, inserita a mano)', async () => {
    const v = unwrap(await addVehicle(h.deps, { ...PANDA, initialKm: 84500 }));
    expect(v.currentKm).toEqual({ km: 84500, readOn: '2026-10-08', source: 'manual', sourceLabel: 'Inserito a mano' });
    const rows = await h.db.all('SELECT vehicle_id, read_on, km, source, status FROM odometer_readings');
    expect(rows).toEqual([{ vehicle_id: v.id, read_on: '2026-10-08', km: 84500, source: 'manual', status: 'valid' }]);
  });

  it('la lettura iniziale puo avere una data passata; km non validi o data futura sono rifiutati senza salvare nulla', async () => {
    const past = unwrap(await addVehicle(h.deps, { ...PANDA, initialKm: 1000, initialKmOn: '2026-09-01' }));
    expect(past.currentKm?.readOn).toBe('2026-09-01');
    expect(await addVehicle(h.deps, { ...PANDA, initialKm: 1.5 })).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'initialKm' } });
    expect(await addVehicle(h.deps, { ...PANDA, initialKm: 2_000_001 })).toMatchObject({ ok: false, error: { field: 'initialKm' } });
    expect(errorCode(await addVehicle(h.deps, { ...PANDA, initialKm: 10, initialKmOn: '2026-10-09' }))).toBe('FUTURE_DATE');
    expect(await count(h.db, 'vehicles')).toBe(1);
  });

  it('se l inserimento fallisce a meta (targa duplicata) non resta nulla: ne auto ne lettura', async () => {
    unwrap(await addVehicle(h.deps, { ...PANDA, plate: 'AB123CD', initialKm: 100 }));
    await addVehicle(h.deps, { ...PANDA, plate: 'AB123CD', initialKm: 200 });
    expect(await count(h.db, 'vehicles')).toBe(1);
    expect(await count(h.db, 'odometer_readings')).toBe(1);
  });

  it('emette gli eventi di dominio solo dopo il commit, con l id dell auto', async () => {
    const v = unwrap(await addVehicle(h.deps, { ...PANDA, initialKm: 100 }));
    expect(h.events).toEqual([
      { type: 'data-changed', scope: 'vehicles', vehicleId: v.id },
      { type: 'data-changed', scope: 'odometer', vehicleId: v.id },
    ]);
    h.clearEvents();
    await addVehicle(h.deps, { ...PANDA, vin: 'CORTO' });
    expect(h.events).toEqual([]);
  });

  it('nessun limite al numero di auto: 50 auto', async () => {
    for (let i = 0; i < 50; i++) unwrap(await addVehicle(h.deps, { ...PANDA, nickname: `Auto ${i}` }));
    const list = await listVehicles(h.deps);
    expect(list).toHaveLength(50);
    expect(list.map((v) => v.sortOrder)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });
});

describe('updateVehicle', () => {
  it('modifica solo i campi indicati e null svuota un campo facoltativo', async () => {
    const v = unwrap(await addVehicle(h.deps, { ...PANDA, nickname: 'Vecchio', plate: 'AB123CD', color: 'Rosso' }));
    h.clock.set('2026-10-09T10:00:00.000Z');
    h.clearEvents();
    const u = unwrap(await updateVehicle(h.deps, v.id, { nickname: 'Nuovo', color: null, powerKw: 51 }));
    expect(u).toMatchObject({ nickname: 'Nuovo', color: null, powerKw: 51, plate: 'AB123CD', make: 'Fiat', updatedAt: '2026-10-09T10:00:00.000Z' });
    expect(h.events).toEqual([{ type: 'data-changed', scope: 'vehicles', vehicleId: v.id }]);
  });

  it('tenere la stessa targa non e un duplicato; prendere quella di un altra si', async () => {
    const a = unwrap(await addVehicle(h.deps, { ...PANDA, plate: 'AB123CD' }));
    const b = unwrap(await addVehicle(h.deps, { ...PANDA, plate: 'EF456GH' }));
    expect(unwrap(await updateVehicle(h.deps, a.id, { plate: 'ab 123 cd', nickname: 'x' })).plate).toBe('AB123CD');
    expect(errorCode(await updateVehicle(h.deps, b.id, { plate: 'AB123CD' }))).toBe('DUPLICATE_PLATE');
    expect((await getVehicle(h.deps, b.id))?.plate).toBe('EF456GH');
    expect(unwrap(await updateVehicle(h.deps, b.id, { plate: null })).plate).toBeNull();
  });

  it('un errore di validazione non cambia nulla; auto inesistente o nel cestino: ITEM_NOT_FOUND', async () => {
    const v = unwrap(await addVehicle(h.deps, { ...PANDA, nickname: 'A' }));
    expect(await updateVehicle(h.deps, v.id, { vin: 'x', nickname: 'B' })).toMatchObject({ ok: false, error: { field: 'vin' } });
    expect((await getVehicle(h.deps, v.id))?.nickname).toBe('A');
    expect(errorCode(await updateVehicle(h.deps, 'non-esiste', { nickname: 'B' }))).toBe('ITEM_NOT_FOUND');
    unwrap(await deleteVehicle(h.deps, v.id));
    expect(errorCode(await updateVehicle(h.deps, v.id, { nickname: 'B' }))).toBe('ITEM_NOT_FOUND');
  });

  it('cambiando alimentazione il tipo di motorizzazione si ricava di nuovo; la combinazione assurda e rifiutata', async () => {
    const v = unwrap(await addVehicle(h.deps, { ...PANDA, fuelSecondary: 'lpg' }));
    const bad = await updateVehicle(h.deps, v.id, { fuelPrimary: 'electric' }); // il GPL resta: incoerente
    expect(bad).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'fuelSecondary' } });
    const ev = unwrap(await updateVehicle(h.deps, v.id, { fuelPrimary: 'electric', fuelSecondary: null }));
    expect(ev).toMatchObject({ fuelPrimary: 'electric', fuelSecondary: null, powertrain: 'bev' });
    const back = unwrap(await updateVehicle(h.deps, v.id, { fuelPrimary: 'diesel' }));
    expect(back.powertrain).toBe('ice');
  });

  it('la data d acquisto non puo seguire quella di vendita', async () => {
    const v = unwrap(await addVehicle(h.deps, { ...PANDA, purchaseOn: '2020-01-01' }));
    unwrap(await archiveVehicle(h.deps, v.id, { status: 'sold', soldOn: '2024-01-01' }));
    const r = await updateVehicle(h.deps, v.id, { purchaseOn: '2025-01-01' });
    expect(r).toMatchObject({ ok: false, error: { field: 'purchaseOn' } });
  });
});

describe('archiveVehicle e reactivateVehicle', () => {
  it('venduta: data (default oggi), km e prezzo; l auto non e piu attiva', async () => {
    const v = unwrap(await addVehicle(h.deps, PANDA));
    h.clearEvents();
    const s = unwrap(await archiveVehicle(h.deps, v.id, { status: 'sold', soldKm: 120000, soldPriceCents: 450000 }));
    expect(s).toMatchObject({ status: 'sold', soldOn: '2026-10-08', soldKm: 120000, soldPriceCents: 450000 });
    expect(h.events).toEqual([{ type: 'data-changed', scope: 'vehicles', vehicleId: v.id }]);
    const [row] = await listVehicles(h.deps);
    expect(row).toMatchObject({ status: 'sold', isActive: false });
  });

  it('archiviata ignora i dati di vendita; rottamata li accetta', async () => {
    const a = unwrap(await addVehicle(h.deps, PANDA));
    const archived = unwrap(await archiveVehicle(h.deps, a.id, { status: 'archived', soldOn: '2026-01-01', soldKm: 5 }));
    expect(archived).toMatchObject({ status: 'archived', soldOn: null, soldKm: null });
    const scrapped = unwrap(await archiveVehicle(h.deps, a.id, { status: 'scrapped', soldOn: '2026-09-30' }));
    expect(scrapped).toMatchObject({ status: 'scrapped', soldOn: '2026-09-30' });
  });

  it('rifiuta stato, data, km e prezzo non validi; vendita prima dell acquisto', async () => {
    const v = unwrap(await addVehicle(h.deps, { ...PANDA, purchaseOn: '2022-05-01' }));
    expect(await archiveVehicle(h.deps, v.id, { status: 'boh' as never })).toMatchObject({ ok: false, error: { field: 'status' } });
    expect(errorCode(await archiveVehicle(h.deps, v.id, { status: 'sold', soldOn: '2026-10-09' }))).toBe('FUTURE_DATE');
    expect(await archiveVehicle(h.deps, v.id, { status: 'sold', soldOn: '2026-02-30' })).toMatchObject({ ok: false, error: { field: 'soldOn' } });
    expect(await archiveVehicle(h.deps, v.id, { status: 'sold', soldKm: -4 })).toMatchObject({ ok: false, error: { field: 'soldKm' } });
    expect(await archiveVehicle(h.deps, v.id, { status: 'sold', soldPriceCents: 1.5 })).toMatchObject({ ok: false, error: { field: 'soldPriceCents' } });
    expect(await archiveVehicle(h.deps, v.id, { status: 'sold', soldOn: '2022-04-30' })).toMatchObject({ ok: false, error: { field: 'soldOn' } });
    expect(errorCode(await archiveVehicle(h.deps, 'non-esiste', { status: 'sold' }))).toBe('ITEM_NOT_FOUND');
    expect((await getVehicle(h.deps, v.id))?.status).toBe('active');
  });

  it('reactivateVehicle rimette l auto in garage e cancella i dati di vendita', async () => {
    const v = unwrap(await addVehicle(h.deps, PANDA));
    unwrap(await archiveVehicle(h.deps, v.id, { status: 'sold', soldKm: 10, soldPriceCents: 100 }));
    expect(unwrap(await reactivateVehicle(h.deps, v.id))).toMatchObject({ status: 'active', soldOn: null, soldKm: null, soldPriceCents: null });
    expect(errorCode(await reactivateVehicle(h.deps, 'non-esiste'))).toBe('ITEM_NOT_FOUND');
  });
});

describe('cestino: deleteVehicle e restoreVehicle', () => {
  it('l auto eliminata esce da elenco e scheda ma i dati restano; si puo ripristinare', async () => {
    const v = unwrap(await addVehicle(h.deps, { ...PANDA, plate: 'AB123CD', initialKm: 5000 }));
    h.clearEvents();
    const del = unwrap(await deleteVehicle(h.deps, v.id));
    expect(del.purgeOn).toBe(addDays('2026-10-08', 30));
    expect(h.events).toEqual([{ type: 'data-changed', scope: 'vehicles', vehicleId: v.id }]);
    expect(await listVehicles(h.deps)).toEqual([]);
    expect(await getVehicle(h.deps, v.id)).toBeNull();
    expect((await getVehicle(h.deps, v.id, { includeDeleted: true }))?.deletedAt).toBe('2026-10-08T07:30:00.000Z');
    expect(await count(h.db, 'odometer_readings')).toBe(1); // i dati restano nel cestino

    const back = unwrap(await restoreVehicle(h.deps, v.id));
    expect(back).toMatchObject({ id: v.id, deletedAt: null, plate: 'AB123CD' });
    expect(back.currentKm?.km).toBe(5000);
    expect(await listVehicles(h.deps)).toHaveLength(1);
  });

  it('i giorni di permanenza vengono dalle impostazioni', async () => {
    unwrap(await setSetting(h.deps, 'trash.retentionDays', 7));
    const v = unwrap(await addVehicle(h.deps, PANDA));
    expect(unwrap(await deleteVehicle(h.deps, v.id)).purgeOn).toBe('2026-10-15');
  });

  it('dopo l eliminazione la targa e riusabile; ripristinare con la targa occupata da DUPLICATE_PLATE', async () => {
    const old = unwrap(await addVehicle(h.deps, { ...PANDA, plate: 'AB123CD', vin: 'ZFA31200003456789' }));
    unwrap(await deleteVehicle(h.deps, old.id));
    const fresh = unwrap(await addVehicle(h.deps, { ...PANDA, plate: 'AB123CD', vin: 'ZFA31200003456789' }));
    expect(fresh.id).not.toBe(old.id);
    expect(errorCode(await restoreVehicle(h.deps, old.id))).toBe('DUPLICATE_PLATE');
    // libero la targa ma non il VIN
    unwrap(await updateVehicle(h.deps, fresh.id, { plate: 'EF456GH' }));
    expect(await restoreVehicle(h.deps, old.id)).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'vin' } });
    unwrap(await updateVehicle(h.deps, fresh.id, { vin: null }));
    expect(unwrap(await restoreVehicle(h.deps, old.id)).plate).toBe('AB123CD');
  });

  it('eliminare due volte, ripristinare un auto non eliminata o inesistente: ITEM_NOT_FOUND', async () => {
    const v = unwrap(await addVehicle(h.deps, PANDA));
    expect(errorCode(await restoreVehicle(h.deps, v.id))).toBe('ITEM_NOT_FOUND');
    unwrap(await deleteVehicle(h.deps, v.id));
    expect(errorCode(await deleteVehicle(h.deps, v.id))).toBe('ITEM_NOT_FOUND');
    expect(errorCode(await deleteVehicle(h.deps, 'non-esiste'))).toBe('ITEM_NOT_FOUND');
    expect(errorCode(await restoreVehicle(h.deps, 'non-esiste'))).toBe('ITEM_NOT_FOUND');
  });
});

describe('listVehicles e getVehicle', () => {
  it('riepilogo con ultimo km e provenienza, le attive per prime', async () => {
    const a = unwrap(await addVehicle(h.deps, { ...PANDA, nickname: 'A' }));
    const b = unwrap(await addVehicle(h.deps, { ...PANDA, nickname: 'B', initialKm: 9000, initialKmOn: '2026-08-01' }));
    const c = unwrap(await addVehicle(h.deps, { ...PANDA, nickname: 'C' }));
    unwrap(await archiveVehicle(h.deps, a.id, { status: 'sold' }));
    unwrap(await addOdometerReading(h.deps, { vehicleId: b.id, km: 9800, readOn: '2026-09-15' }));
    unwrap(await addOdometerReading(h.deps, { vehicleId: b.id, km: 9500, readOn: '2026-09-01' })); // piu vecchia: non e l ultima

    const list = await listVehicles(h.deps);
    expect(list.map((v) => v.displayName)).toEqual(['B', 'C', 'A']); // attive per prime, poi la venduta
    expect(list[0]).toMatchObject({
      id: b.id,
      status: 'active',
      isActive: true,
      currentKm: { km: 9800, readOn: '2026-09-15', source: 'manual', sourceLabel: 'Inserito a mano' },
    });
    expect(list[1]).toMatchObject({ id: c.id, currentKm: null });
    expect(list[2]).toMatchObject({ id: a.id, status: 'sold', isActive: false });
  });

  it('una lettura ignorata non conta per l ultimo km', async () => {
    const v = unwrap(await addVehicle(h.deps, { ...PANDA, initialKm: 1000, initialKmOn: '2026-01-01' }));
    await h.db.run(
      `INSERT INTO odometer_readings (id, vehicle_id, read_on, km, source, status) VALUES ('01TESTID000000000000009999', ?, '2026-05-01', 99999, 'manual', 'ignored')`,
      [v.id],
    );
    expect((await listVehicles(h.deps))[0]?.currentKm?.km).toBe(1000);
    expect((await getVehicle(h.deps, v.id))?.currentKm?.km).toBe(1000);
  });

  it('filtra per stato e per auto demo', async () => {
    const a = unwrap(await addVehicle(h.deps, { ...PANDA, nickname: 'A' }));
    unwrap(await addVehicle(h.deps, { ...PANDA, nickname: 'B' }));
    unwrap(await archiveVehicle(h.deps, a.id, { status: 'archived' }));
    expect((await listVehicles(h.deps, { statuses: ['active'] })).map((v) => v.displayName)).toEqual(['B']);
    expect((await listVehicles(h.deps, { statuses: ['sold', 'archived'] })).map((v) => v.displayName)).toEqual(['A']);
    await h.db.run(`UPDATE vehicles SET is_demo = 1 WHERE nickname = 'B'`);
    expect((await listVehicles(h.deps, { includeDemo: false })).map((v) => v.displayName)).toEqual(['A']);
    expect((await listVehicles(h.deps))[0]).toMatchObject({ displayName: 'B', isDemo: true });
  });

  it('getVehicle: null per un id inesistente', async () => {
    expect(await getVehicle(h.deps, 'non-esiste')).toBeNull();
  });
});
