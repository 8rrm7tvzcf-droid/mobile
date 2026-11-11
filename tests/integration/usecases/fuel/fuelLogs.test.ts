// Rifornimenti (F-39, AC-07): aritmetica intera degli importi, coerenza dei km, consumo immediato, bifuel,
// modifica ricalcolando il terzo valore, cestino e ripristino.
import { beforeEach, describe, expect, it } from 'vitest';
import { addOdometerReading, isOdometerConflict, listOdometerReadings, markReadingIgnored } from '@/usecases/odometer';
import {
  addFuelLog,
  deleteFuelLog,
  getFuelLog,
  listFuelLogs,
  restoreFuelLog,
  updateFuelLog,
} from '@/usecases/fuel';
import { count, errorCode, fill, makeFuelWorld, unwrap, type FuelWorld } from './helpers';

let w: FuelWorld;
beforeEach(async () => {
  w = await makeFuelWorld(); // oggi = 2026-10-08, Panda a benzina
});

const add = (input: Record<string, unknown>) => addFuelLog(w.h.deps, { vehicleId: w.vehicleId, filledOn: '2026-09-01', ...input });

describe('addFuelLog: aritmetica intera dei tre importi (AC-07.1, AC-07.2)', () => {
  it('quantita\' e prezzo calcolano il totale: 40,000 L x 1,859 = 74,36 EUR; 35,500 x 1,789 = 6351', async () => {
    const a = unwrap(await add({ quantityMilli: 40000, unitPriceMilli: 1859 }));
    expect(a.fuelLog.totalCents).toBe(7436);
    expect(a.computed).toBe('total');
    const b = unwrap(await add({ quantityMilli: 35500, unitPriceMilli: 1789 }));
    expect(b.fuelLog.totalCents).toBe(6351); // 63,5095 -> 63,51
    expect(b.warnings).toEqual([]);
  });

  it('quantita\' e totale calcolano il prezzo (si salva anche il prezzo calcolato)', async () => {
    const r = unwrap(await add({ quantityMilli: 40000, totalCents: 7436 }));
    expect(r.computed).toBe('unitPrice');
    expect(r.fuelLog.unitPriceMilli).toBe(1859);
  });

  it('prezzo e totale calcolano la quantita\'', async () => {
    const r = unwrap(await add({ unitPriceMilli: 1859, totalCents: 7436 }));
    expect(r.computed).toBe('quantity');
    expect(r.fuelLog.quantityMilli).toBe(40000);
    expect(r.fuelLog.quantityUnit).toBe('L');
  });

  it('con meno di due valori e\' un errore di validazione sul campo, e non si scrive nulla', async () => {
    const r = await add({ quantityMilli: 40000 });
    expect(errorCode(r)).toBe('VALIDATION');
    if (!r.ok && r.error.code === 'VALIDATION') expect(r.error.message).toContain('almeno due valori');
    expect(await count(w.h.db, 'fuel_logs')).toBe(0);
  });

  it('tre valori restano quelli immessi: scarto fino a 2 centesimi senza avviso, oltre un avviso NON bloccante', async () => {
    const near = unwrap(await add({ quantityMilli: 40000, unitPriceMilli: 1859, totalCents: 7437 }));
    expect(near.fuelLog.totalCents).toBe(7437);
    expect(near.warnings).toEqual([]);
    const far = unwrap(await add({ quantityMilli: 40000, unitPriceMilli: 1859, totalCents: 7500 }));
    expect(far.fuelLog.totalCents).toBe(7500); // salvato cosi' com'e'
    expect(far.warnings.join(' ')).toContain('Il totale non torna');
    expect(far.expectedTotalCents).toBe(7436);
  });

  it('un prezzo insolito (virgola sbagliata) e\' solo un avviso', async () => {
    const r = unwrap(await add({ quantityMilli: 40000, unitPriceMilli: 18590 }));
    expect(r.warnings.join(' ')).toContain('insolito');
  });

  it('quantita\' zero, totale negativo, data futura, unita\' incoerente, auto inesistente', async () => {
    expect(errorCode(await add({ quantityMilli: 0, totalCents: 100 }))).toBe('VALIDATION');
    expect(errorCode(await add({ quantityMilli: 1000, totalCents: -5 }))).toBe('VALIDATION');
    expect(errorCode(await add({ filledOn: '2026-10-09', quantityMilli: 1000, totalCents: 100 }))).toBe('FUTURE_DATE');
    expect(errorCode(await add({ filledOn: '2026-02-30', quantityMilli: 1000, totalCents: 100 }))).toBe('VALIDATION');
    expect(errorCode(await add({ quantityMilli: 1000, totalCents: 100, quantityUnit: 'kg' }))).toBe('VALIDATION');
    expect(errorCode(await addFuelLog(w.h.deps, { vehicleId: 'nessuna', quantityMilli: 1000, totalCents: 100 }))).toBe('ITEM_NOT_FOUND');
    expect(await count(w.h.db, 'fuel_logs')).toBe(0);
  });

  it('campi accessori: tipo, ottani, stazione, note, pieno e rifornimento saltato', async () => {
    const r = unwrap(
      await add({ quantityMilli: 30000, totalCents: 5700, grade: ' 100 ottani ', station: ' Eni  ', notes: '', isFull: false, missedBefore: true }),
    );
    expect(r.fuelLog).toMatchObject({
      fuelType: 'petrol',
      grade: '100 ottani',
      station: 'Eni',
      notes: null,
      isFull: false,
      missedBefore: true,
      tank: 'petrol',
    });
  });

  it('il carburante di default e\' il primario, poi l\'ultimo usato; uno fuori dall\'auto da\' un avviso', async () => {
    const bi = await makeFuelWorld({ fuelPrimary: 'petrol', fuelSecondary: 'lpg' });
    const a = unwrap(await addFuelLog(bi.h.deps, { vehicleId: bi.vehicleId, filledOn: '2026-09-01', quantityMilli: 30000, totalCents: 5000 }));
    expect(a.fuelLog.fuelType).toBe('petrol');
    unwrap(await addFuelLog(bi.h.deps, { vehicleId: bi.vehicleId, filledOn: '2026-09-02', fuelType: 'lpg', quantityMilli: 20000, totalCents: 1500 }));
    const c = unwrap(await addFuelLog(bi.h.deps, { vehicleId: bi.vehicleId, filledOn: '2026-09-03', quantityMilli: 20000, totalCents: 1500 }));
    expect(c.fuelLog.fuelType).toBe('lpg'); // l'ultimo usato
    const wrong = unwrap(await add({ fuelType: 'diesel', quantityMilli: 30000, totalCents: 5000 }));
    expect(wrong.warnings.join(' ')).toContain('non è tra i carburanti');
  });

  it('HVO ha unita\' litri; l\'elettrico kWh; il metano kg (il CHECK del DB resta coerente)', async () => {
    const ev = await makeFuelWorld({ fuelPrimary: 'electric' });
    const kwh = unwrap(await addFuelLog(ev.h.deps, { vehicleId: ev.vehicleId, filledOn: '2026-09-01', quantityMilli: 40000, unitPriceMilli: 350 }));
    expect(kwh.fuelLog).toMatchObject({ fuelType: 'electric', quantityUnit: 'kWh', totalCents: 1400 });
    const hvo = await makeFuelWorld({ fuelPrimary: 'diesel' });
    const h = unwrap(await addFuelLog(hvo.h.deps, { vehicleId: hvo.vehicleId, filledOn: '2026-09-01', fuelType: 'hvo', quantityMilli: 40000, unitPriceMilli: 1900 }));
    expect(h.fuelLog).toMatchObject({ fuelType: 'hvo', quantityUnit: 'L', tank: 'diesel' });
    expect(h.warnings).toEqual([]);
  });

  it('emette data-changed fuel con l\'auto (e odometer solo se ci sono km)', async () => {
    unwrap(await add({ quantityMilli: 30000, totalCents: 5000 }));
    expect(w.h.events).toEqual([{ type: 'data-changed', scope: 'fuel', vehicleId: w.vehicleId }]);
    w.h.clearEvents();
    unwrap(await add({ quantityMilli: 30000, totalCents: 5000, km: 1000 }));
    expect(w.h.events.map((e) => (e.type === 'data-changed' ? e.scope : e.type))).toEqual(['fuel', 'odometer']);
  });
});

describe('addFuelLog: km collegati e coerenza del registro (AC-02, AC-07.4)', () => {
  it('crea la lettura km con source fuel collegata al rifornimento, visibile nel registro', async () => {
    const r = unwrap(await add({ quantityMilli: 30000, totalCents: 5000, km: 10000 }));
    expect(r.fuelLog.km).toBe(10000);
    const list = await listOdometerReadings(w.h.deps, w.vehicleId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ km: 10000, readOn: '2026-09-01', source: 'fuel', linkedId: r.fuelLog.id, canDelete: false });
    expect(r.odometerReadingId).toBe(list[0]!.id);
  });

  it('senza km non crea nessuna lettura', async () => {
    unwrap(await add({ quantityMilli: 30000, totalCents: 5000 }));
    expect(await count(w.h.db, 'odometer_readings')).toBe(0);
  });

  async function seed(): Promise<void> {
    unwrap(await addOdometerReading(w.h.deps, { vehicleId: w.vehicleId, km: 10000, readOn: '2026-01-01' }));
    unwrap(await addOdometerReading(w.h.deps, { vehicleId: w.vehicleId, km: 15000, readOn: '2026-06-01' }));
  }

  it('km incoerenti: ODO_NON_MONOTONIC IDENTICO a quello di addOdometerReading, rollback completo', async () => {
    await seed();
    const viaFuel = await add({ filledOn: '2026-03-02', quantityMilli: 30000, totalCents: 5000, km: 16000 });
    const viaOdo = await addOdometerReading(w.h.deps, { vehicleId: w.vehicleId, km: 16000, readOn: '2026-03-02' });
    expect(errorCode(viaFuel)).toBe('ODO_NON_MONOTONIC');
    if (viaFuel.ok || viaOdo.ok) throw new Error('attesi due errori');
    expect(isOdometerConflict(viaFuel.error)).toBe(true);
    expect(viaFuel.error).toEqual(viaOdo.error);
    expect(await count(w.h.db, 'fuel_logs')).toBe(0); // niente rifornimento senza i suoi km
    expect(await count(w.h.db, 'odometer_readings')).toBe(2);
  });

  it('km oltre il limite o non interi: errore di validazione sul campo km', async () => {
    const a = await add({ quantityMilli: 30000, totalCents: 5000, km: 2_000_001 });
    expect(errorCode(a)).toBe('VALIDATION');
    if (!a.ok && a.error.code === 'VALIDATION') expect(a.error.field).toBe('km');
    expect(errorCode(await add({ quantityMilli: 30000, totalCents: 5000, km: 1000.5 }))).toBe('VALIDATION');
    // stesso errore del registro km per lo stesso valore
    const viaOdo = await addOdometerReading(w.h.deps, { vehicleId: w.vehicleId, km: 2_000_001 });
    expect(a.ok || viaOdo.ok ? null : a.error).toEqual(viaOdo.ok ? null : viaOdo.error);
  });

  it('«Salva senza aggiornare i km»: il rifornimento si salva, i km restano fuori', async () => {
    await seed();
    const r = unwrap(await add({ filledOn: '2026-03-02', quantityMilli: 30000, totalCents: 5000, km: 16000, onOdometerConflict: 'skip_km' }));
    expect(r.kmIgnored).toBe(true);
    expect(r.fuelLog.km).toBeNull();
    expect(r.odometerReadingId).toBeNull();
    expect(await count(w.h.db, 'odometer_readings')).toBe(2);
  });

  it('«È un errore della lettura precedente»: le letture in conflitto vanno da parte e il rifornimento si salva', async () => {
    await seed();
    const r = unwrap(
      await add({ filledOn: '2026-03-02', quantityMilli: 30000, totalCents: 5000, km: 16000, resolveConflicts: 'ignore-conflicting' }),
    );
    expect(r.ignoredReadingIds).toHaveLength(1);
    expect(r.fuelLog.km).toBe(16000);
    expect(await count(w.h.db, 'odometer_readings', "status = 'ignored'")).toBe(1);
    expect(w.h.events.map((e) => (e.type === 'data-changed' ? e.scope : e.type))).toContain('odometer');
  });

  it('un salto implausibile di km e\' un avviso, non un blocco', async () => {
    await seed();
    const r = unwrap(await add({ filledOn: '2026-06-02', quantityMilli: 30000, totalCents: 5000, km: 19000 }));
    expect(r.warnings.join(' ')).toContain('controlla');
    expect(r.fuelLog.km).toBe(19000);
  });

  it('due rifornimenti nello stesso giorno non hanno vincoli tra loro', async () => {
    unwrap(await add({ quantityMilli: 30000, totalCents: 5000, km: 10000 }));
    unwrap(await add({ quantityMilli: 5000, totalCents: 900, km: 9990 }));
    expect(await count(w.h.db, 'odometer_readings')).toBe(2);
  });
});

describe('consumo restituito subito dopo il salvataggio (S-22 punto 5)', () => {
  it('vettore V11: pieno-pieno con parziale, rifornimento mancato e catena che riparte', async () => {
    const a = await fill(w, '2026-01-10', 10000, 40);
    expect(a.consumption).toMatchObject({ computed: false, reason: 'FIRST_FULL' });
    const b = await fill(w, '2026-01-20', 10300, 15, { isFull: false });
    expect(b.consumption).toBeNull(); // un parziale non ha consumo
    const c = await fill(w, '2026-02-01', 10700, 30);
    expect(c.consumption).toMatchObject({ computed: true, per100Centi: 643, distanceKm: 700, quantityMilli: 45000, text: '6,43 L/100 km' });
    const dd = await fill(w, '2026-02-15', 11300, 36);
    expect(dd.consumption).toMatchObject({ computed: true, per100Centi: 600, text: '6,00 L/100 km' });
    const e = await fill(w, '2026-03-01', 11900, 33, { missedBefore: true });
    expect(e.consumption).toMatchObject({ computed: false, reason: 'CHAIN_BROKEN' });
    const f = await fill(w, '2026-03-15', 12500, 38.4);
    expect(f.consumption).toMatchObject({ computed: true, per100Centi: 640, distanceKm: 600 });
  });

  it('il costo del tratto somma pieno e parziali (aritmetica intera)', async () => {
    await fill(w, '2026-01-10', 10000, 40);
    await fill(w, '2026-01-20', 10300, 15, { isFull: false }); // 15 L x 1,800 = 2700
    const c = await fill(w, '2026-02-01', 10700, 30); // 30 L x 1,800 = 5400
    expect(c.consumption).toMatchObject({ computed: true, costCents: 8100 });
  });

  it('senza km il pieno non ha consumo e lo dice; con km non crescenti avvisa invece di inventare', async () => {
    await fill(w, '2026-01-10', 10000, 40);
    const noKm = await fill(w, '2026-01-20', null, 30);
    expect(noKm.consumption).toMatchObject({ computed: false, reason: 'NO_KM' });
    await fill(w, '2026-02-01', 10500, 30);
    const same = await fill(w, '2026-02-10', 10500, 30); // stesso km: lettura accettata (stesso valore), consumo non calcolabile
    expect(same.consumption).toMatchObject({ computed: false, reason: 'KM_NOT_INCREASING' });
  });

  it('auto bifuel: ogni carburante ha la sua catena pieno-a-pieno', async () => {
    const bi = await makeFuelWorld({ fuelPrimary: 'petrol', fuelSecondary: 'lpg' });
    const f = (on: string, km: number, liters: number, fuelType: 'petrol' | 'lpg') =>
      fill(bi, on, km, liters, { fuelType, unitPriceMilli: fuelType === 'lpg' ? 800 : 1800 });
    await f('2026-01-10', 10000, 40, 'petrol');
    await f('2026-01-12', 10100, 20, 'lpg');
    const p2 = await f('2026-02-01', 10600, 30, 'petrol'); // benzina: 30 L su 600 km = 5,00
    expect(p2.consumption).toMatchObject({ computed: true, tank: 'petrol', per100Centi: 500, distanceKm: 600 });
    const g2 = await f('2026-02-05', 10800, 14, 'lpg'); // GPL: 14 L su 700 km (dal pieno GPL del 12/1) = 2,00
    expect(g2.consumption).toMatchObject({ computed: true, tank: 'lpg', per100Centi: 200, distanceKm: 700, text: '2,00 L/100 km' });
  });

  it('gasolio e HVO sono lo stesso serbatoio', async () => {
    const dz = await makeFuelWorld({ fuelPrimary: 'diesel' });
    await fill(dz, '2026-01-10', 10000, 40, { fuelType: 'diesel' });
    const h = await fill(dz, '2026-02-01', 10800, 40, { fuelType: 'hvo' });
    expect(h.consumption).toMatchObject({ computed: true, tank: 'diesel', per100Centi: 500 });
  });

  it('l\'AdBlue non ha consumi', async () => {
    const dz = await makeFuelWorld({ fuelPrimary: 'diesel' });
    const a = await fill(dz, '2026-01-10', null, 10, { fuelType: 'adblue' });
    expect(a.consumption).toBeNull();
    expect(a.fuelLog.tank).toBeNull();
  });

  it('una lettura km messa da parte non conta per i consumi', async () => {
    await fill(w, '2026-01-10', 10000, 40);
    const mid = await fill(w, '2026-02-01', 10600, 30);
    const reading = (await listOdometerReadings(w.h.deps, w.vehicleId)).find((r) => r.linkedId === mid.fuelLog.id)!;
    unwrap(await markReadingIgnored(w.h.deps, reading.id));
    const after = (await getFuelLog(w.h.deps, mid.fuelLog.id))!;
    expect(after.consumption).toMatchObject({ computed: false, reason: 'NO_KM' });
    expect(after.kmIgnored).toBe(true);
  });
});

describe('updateFuelLog', () => {
  it('cambiando la quantita\' il totale si ricalcola, il prezzo resta', async () => {
    const a = unwrap(await add({ quantityMilli: 40000, unitPriceMilli: 1859 }));
    const u = unwrap(await updateFuelLog(w.h.deps, a.fuelLog.id, { quantityMilli: 30000 }));
    expect(u.fuelLog).toMatchObject({ quantityMilli: 30000, unitPriceMilli: 1859, totalCents: 5577 });
    expect(u.computed).toBe('total');
  });

  it('cambiando il prezzo il totale segue; cambiando il totale il prezzo segue', async () => {
    const a = unwrap(await add({ quantityMilli: 40000, unitPriceMilli: 1859 }));
    const p = unwrap(await updateFuelLog(w.h.deps, a.fuelLog.id, { unitPriceMilli: 1900 }));
    expect(p.fuelLog).toMatchObject({ unitPriceMilli: 1900, totalCents: 7600 });
    const t = unwrap(await updateFuelLog(w.h.deps, a.fuelLog.id, { totalCents: 7436 }));
    expect(t.fuelLog).toMatchObject({ quantityMilli: 40000, totalCents: 7436, unitPriceMilli: 1859 });
  });

  it('prezzo e totale insieme ricalcolano la quantita\'; quantita\' e totale ricalcolano il prezzo', async () => {
    const a = unwrap(await add({ quantityMilli: 40000, unitPriceMilli: 1859 }));
    const u = unwrap(await updateFuelLog(w.h.deps, a.fuelLog.id, { unitPriceMilli: 2000, totalCents: 6000 }));
    expect(u.fuelLog.quantityMilli).toBe(30000);
    const v = unwrap(await updateFuelLog(w.h.deps, a.fuelLog.id, { quantityMilli: 25000, totalCents: 5000 }));
    expect(v.fuelLog.unitPriceMilli).toBe(2000);
  });

  it('modificare solo le note non tocca importi ne\' prezzo (un prezzo mancante resta mancante)', async () => {
    const a = unwrap(await add({ quantityMilli: 30000, totalCents: 5000 }));
    // il prezzo e' stato calcolato all'inserimento; lo togliamo a mano per simulare un dato storico
    await w.h.db.run('UPDATE fuel_logs SET unit_price_milli = NULL WHERE id = ?', [a.fuelLog.id]);
    const u = unwrap(await updateFuelLog(w.h.deps, a.fuelLog.id, { notes: 'ok' }));
    expect(u.fuelLog).toMatchObject({ notes: 'ok', quantityMilli: 30000, totalCents: 5000, unitPriceMilli: null });
  });

  it('aggiunge, cambia e toglie i km; la data sposta la lettura collegata', async () => {
    const a = unwrap(await add({ quantityMilli: 30000, totalCents: 5000 }));
    const withKm = unwrap(await updateFuelLog(w.h.deps, a.fuelLog.id, { km: 10000 }));
    expect(withKm.fuelLog.km).toBe(10000);
    const moved = unwrap(await updateFuelLog(w.h.deps, a.fuelLog.id, { filledOn: '2026-08-20', km: 10050 }));
    expect(moved.fuelLog).toMatchObject({ filledOn: '2026-08-20', km: 10050 });
    const reading = (await listOdometerReadings(w.h.deps, w.vehicleId))[0]!;
    expect(reading).toMatchObject({ readOn: '2026-08-20', km: 10050 });
    expect(await count(w.h.db, 'odometer_readings')).toBe(1); // aggiornata, non duplicata
    const dateOnly = unwrap(await updateFuelLog(w.h.deps, a.fuelLog.id, { filledOn: '2026-08-21' }));
    expect(dateOnly.fuelLog.km).toBe(10050);
    expect((await listOdometerReadings(w.h.deps, w.vehicleId))[0]!.readOn).toBe('2026-08-21');
    const removed = unwrap(await updateFuelLog(w.h.deps, a.fuelLog.id, { km: null }));
    expect(removed.fuelLog.km).toBeNull();
    expect(await listOdometerReadings(w.h.deps, w.vehicleId)).toEqual([]);
    // i km si possono rimettere: la lettura nel cestino viene riesumata (indice unico per rifornimento)
    const back = unwrap(await updateFuelLog(w.h.deps, a.fuelLog.id, { km: 10060 }));
    expect(back.fuelLog.km).toBe(10060);
    expect(await count(w.h.db, 'odometer_readings')).toBe(1);
  });

  it('km incoerenti in modifica: ODO_NON_MONOTONIC e nessuna modifica parziale', async () => {
    unwrap(await addOdometerReading(w.h.deps, { vehicleId: w.vehicleId, km: 15000, readOn: '2026-06-01' }));
    const a = unwrap(await add({ filledOn: '2026-07-01', quantityMilli: 30000, totalCents: 5000, km: 16000 }));
    const r = await updateFuelLog(w.h.deps, a.fuelLog.id, { totalCents: 9999, km: 14000 });
    expect(errorCode(r)).toBe('ODO_NON_MONOTONIC');
    const after = (await getFuelLog(w.h.deps, a.fuelLog.id))!;
    expect(after).toMatchObject({ totalCents: 5000, km: 16000 });
  });

  it('rifiuta valori non validi e id sconosciuti', async () => {
    const a = unwrap(await add({ quantityMilli: 30000, totalCents: 5000 }));
    expect(errorCode(await updateFuelLog(w.h.deps, a.fuelLog.id, { quantityMilli: 0 }))).toBe('VALIDATION');
    expect(errorCode(await updateFuelLog(w.h.deps, a.fuelLog.id, { filledOn: '2026-12-01' }))).toBe('FUTURE_DATE');
    expect(errorCode(await updateFuelLog(w.h.deps, 'nessuno', { notes: 'x' }))).toBe('ITEM_NOT_FOUND');
  });

  it('cambiare pieno/parziale cambia i consumi dei pieni successivi', async () => {
    await fill(w, '2026-01-10', 10000, 40);
    const mid = await fill(w, '2026-02-01', 10500, 20);
    const last = await fill(w, '2026-03-01', 11000, 30);
    expect(last.consumption).toMatchObject({ computed: true, per100Centi: 600 }); // 30 L su 500 km
    unwrap(await updateFuelLog(w.h.deps, mid.fuelLog.id, { isFull: false }));
    const after = (await getFuelLog(w.h.deps, last.fuelLog.id))!;
    expect(after.consumption).toMatchObject({ computed: true, per100Centi: 500, distanceKm: 1000, quantityMilli: 50000 });
  });
});

describe('deleteFuelLog e restoreFuelLog (Annulla)', () => {
  it('elimina nel cestino rifornimento e lettura km, e li ripristina insieme', async () => {
    const a = unwrap(await add({ quantityMilli: 30000, totalCents: 5000, km: 10000 }));
    w.h.clearEvents();
    unwrap(await deleteFuelLog(w.h.deps, a.fuelLog.id));
    expect(await getFuelLog(w.h.deps, a.fuelLog.id)).toBeNull();
    expect(await listFuelLogs(w.h.deps, w.vehicleId)).toEqual([]);
    expect(await listOdometerReadings(w.h.deps, w.vehicleId)).toEqual([]);
    expect(await count(w.h.db, 'fuel_logs')).toBe(1); // soft delete
    expect(w.h.events.map((e) => (e.type === 'data-changed' ? e.scope : e.type))).toEqual(['fuel', 'odometer']);
    const r = unwrap(await restoreFuelLog(w.h.deps, a.fuelLog.id));
    expect(r.kmRestored).toBe(true);
    expect(r.fuelLog.km).toBe(10000);
    expect((await listOdometerReadings(w.h.deps, w.vehicleId))[0]).toMatchObject({ km: 10000, source: 'fuel' });
  });

  it('eliminare due volte o ripristinare un non eliminato: ITEM_NOT_FOUND', async () => {
    const a = unwrap(await add({ quantityMilli: 30000, totalCents: 5000 }));
    expect(errorCode(await restoreFuelLog(w.h.deps, a.fuelLog.id))).toBe('ITEM_NOT_FOUND');
    unwrap(await deleteFuelLog(w.h.deps, a.fuelLog.id));
    expect(errorCode(await deleteFuelLog(w.h.deps, a.fuelLog.id))).toBe('ITEM_NOT_FOUND');
    expect(errorCode(await deleteFuelLog(w.h.deps, 'nessuno'))).toBe('ITEM_NOT_FOUND');
  });

  it('ripristino con km non piu\' coerenti: il rifornimento torna senza km e lo dice', async () => {
    const a = unwrap(await add({ filledOn: '2026-03-01', quantityMilli: 30000, totalCents: 5000, km: 12000 }));
    unwrap(await deleteFuelLog(w.h.deps, a.fuelLog.id));
    unwrap(await addOdometerReading(w.h.deps, { vehicleId: w.vehicleId, km: 13000, readOn: '2026-02-01' })); // 12000 dopo 13000: incoerente
    const r = unwrap(await restoreFuelLog(w.h.deps, a.fuelLog.id));
    expect(r.kmRestored).toBe(false);
    expect(r.warnings.join(' ')).toContain('12.000');
    expect(r.fuelLog.km).toBeNull();
    // si possono reimmettere: la lettura nel cestino e' riesumata, non duplicata
    const fixed = unwrap(await updateFuelLog(w.h.deps, a.fuelLog.id, { km: 13500 }));
    expect(fixed.fuelLog.km).toBe(13500);
  });

  it('un rifornimento eliminato esce dai consumi e dai costi (vista v_costs)', async () => {
    await fill(w, '2026-01-10', 10000, 40);
    const mid = await fill(w, '2026-02-01', 10500, 20);
    const last = await fill(w, '2026-03-01', 11000, 30);
    unwrap(await deleteFuelLog(w.h.deps, mid.fuelLog.id));
    const after = (await getFuelLog(w.h.deps, last.fuelLog.id))!;
    expect(after.consumption).toMatchObject({ computed: true, distanceKm: 1000 });
    const row = await w.h.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM v_costs WHERE source = 'fuel'");
    expect(row!.n).toBe(2);
  });
});
