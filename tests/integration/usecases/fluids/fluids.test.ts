// Controllo livelli (AC-08, F-44): validazione, lettura km collegata, completamento delle voci di controllo,
// annullamento esatto, stato per fluido ed elenco.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addFluidCheck,
  deleteFluidCheck,
  FLUID_CHECK_TEMPLATES,
  getFluidCheck,
  getFluidStatus,
  getToppedUpSummary,
  listFluidChecks,
} from '@/usecases/fluids';
import type { AddFluidCheckInput } from '@/usecases/fluids';
import { completeDeadline, reconcileVehicle } from '@/usecases/deadlines';
import { isOdometerConflict, listOdometerReadings, markReadingIgnored } from '@/usecases/odometer';
import { count, errorOf, expectAtMostOneOpen, makeEnv, makeVehicle, openReminders, rows, setupItems, unwrap } from './harness';
import type { Env } from './harness';

const OIL = 'tpl_check_oil_level';
const TYRES = 'tpl_check_tyre_pressure';
const COOLANT = 'tpl_check_coolant_washer';

let env: Env;
let vid: string;
let items: Record<string, string>;

beforeEach(async () => {
  env = await makeEnv(); // oggi = 2026-10-08
  vid = await makeVehicle(env);
  items = await setupItems(env, vid, [
    { templateId: OIL, lastDone: { kind: 'done', on: '2026-09-20', km: 15200 } },
    { templateId: TYRES, lastDone: { kind: 'done', on: '2026-09-25' } },
    { templateId: COOLANT, lastDone: { kind: 'done', on: '2026-09-01' } },
  ]);
});

const check = (o: Partial<AddFluidCheckInput> = {}) =>
  addFluidCheck(env.deps, { vehicleId: vid, fluid: 'engine_oil', level: 'ok', ...o });

/** Stato "visibile" (senza istanti di scrittura): serve a confrontare prima e dopo un controllo + eliminazione. */
async function visible() {
  return {
    items: await rows(env.db, 'SELECT id, name, fixed_due_on, baseline_on, baseline_km, interval_km, interval_months, is_active FROM maintenance_items WHERE deleted_at IS NULL ORDER BY id'),
    completions: await rows(env.db, 'SELECT id, item_id, done_on, done_km, prev_fixed_due_on, source, fluid_check_id FROM maintenance_completions WHERE deleted_at IS NULL ORDER BY id'),
    odometer: await rows(env.db, 'SELECT id, vehicle_id, read_on, km, source, status FROM odometer_readings WHERE deleted_at IS NULL ORDER BY read_on, km'),
    reminders: await rows(
      env.db,
      `SELECT id, item_id, origin, title, status, due_on, due_km, effective_due_on, due_trigger, forecast_on, completed_on, completion_id, snoozed_until
       FROM reminders WHERE deleted_at IS NULL ORDER BY id`,
    ),
    checks: await rows(env.db, 'SELECT id FROM fluid_checks WHERE deleted_at IS NULL ORDER BY id'),
  };
}

describe('addFluidCheck: validazione (AC-08.2, AC-08.3)', () => {
  it('la pressione deve stare tra 500 e 6000 millibar; i bordi sono validi', async () => {
    for (const bad of [499, 6001, 0, 2.5]) {
      const r = await check({ fluid: 'tyre_pressure', valueMillibar: bad });
      expect(errorOf(r)).toMatchObject({ code: 'VALIDATION', field: 'valueMillibar' });
    }
    for (const good of [500, 2200, 6000]) unwrap(await check({ fluid: 'tyre_pressure', valueMillibar: good }));
    expect(await count(env.db, 'fluid_checks')).toBe(3);
  });

  it('la pressione si indica solo per i pneumatici e la quantita solo con "rabboccato"', async () => {
    expect(errorOf(await check({ fluid: 'engine_oil', valueMillibar: 2200 }))).toMatchObject({ field: 'valueMillibar' });
    expect(errorOf(await check({ level: 'ok', addedMl: 500 }))).toMatchObject({ code: 'VALIDATION', field: 'addedMl' });
    expect(errorOf(await check({ level: 'topped_up', addedMl: 0 }))).toMatchObject({ field: 'addedMl' });
    expect(errorOf(await check({ level: 'topped_up', addedMl: 100_001 }))).toMatchObject({ field: 'addedMl' });
    expect(errorOf(await check({ fluid: 'tyre_pressure', level: 'topped_up', addedMl: 100 }))).toMatchObject({ field: 'addedMl' });
    unwrap(await check({ level: 'topped_up', addedMl: 100_000 }));
  });

  it('il prodotto solo con "rabboccato", al massimo 80 caratteri', async () => {
    expect(errorOf(await check({ level: 'ok', product: '5W-30' }))).toMatchObject({ field: 'product' });
    expect(errorOf(await check({ level: 'topped_up', product: 'x'.repeat(81) }))).toMatchObject({ field: 'product' });
    const r = unwrap(await check({ level: 'topped_up', addedMl: 500, product: '  5W-30 ACEA C3 ' }));
    expect(r.check).toMatchObject({ addedMl: 500, product: '5W-30 ACEA C3', levelLabelIt: 'Rabboccato' });
  });

  it('data non valida, nel futuro, fluido ed esito sconosciuti, km non validi, auto inesistente: nulla viene scritto', async () => {
    expect(errorOf(await check({ checkedOn: '2026-02-30' }))).toMatchObject({ field: 'checkedOn' });
    expect(errorOf(await check({ checkedOn: '2026-10-09' })).code).toBe('FUTURE_DATE');
    expect(errorOf(await check({ fluid: 'olio' as never }))).toMatchObject({ field: 'fluid' });
    expect(errorOf(await check({ level: 'meh' as never }))).toMatchObject({ field: 'level' });
    expect(errorOf(await check({ km: -1 }))).toMatchObject({ field: 'km' });
    expect(errorOf(await check({ km: 2_000_001 }))).toMatchObject({ field: 'km' });
    expect(errorOf(await addFluidCheck(env.deps, { vehicleId: 'nope', fluid: 'engine_oil', level: 'ok' })).code).toBe('ITEM_NOT_FOUND');
    expect(await count(env.db, 'fluid_checks')).toBe(0);
    expect(await count(env.db, 'maintenance_completions')).toBe(0);
    expect(env.events).toEqual([]);
  });
});

describe('addFluidCheck: registrazione, km collegati ed eventi', () => {
  it('3 tocchi: fluido ed esito bastano; la data e oggi e i testi sono in italiano', async () => {
    const r = unwrap(await check({ fluid: 'coolant', level: 'low' }));
    expect(r.check).toMatchObject({
      vehicleId: vid,
      checkedOn: '2026-10-08',
      fluid: 'coolant',
      level: 'low',
      fluidLabelIt: 'Refrigerante',
      levelLabelIt: 'Basso',
      addedMl: null,
      valueMillibar: null,
      km: null,
      odometerReadingId: null,
    });
    expect(r.odometerReadingId).toBeNull();
    expect(r.status).toMatchObject({ fluid: 'coolant', kind: 'attention', labelIt: 'Basso' });
    expect(r.status.suggestionIt).toEqual(expect.any(String));
    expect(await count(env.db, 'odometer_readings', "source = 'fluid_check'")).toBe(0);
  });

  it('con i km crea la lettura collegata (source fluid_check) e la usa come km del completamento', async () => {
    const r = unwrap(await check({ km: 15400, checkedOn: '2026-10-07', level: 'topped_up', addedMl: 300 }));
    expect(r.odometerReadingId).toHaveLength(26);
    const [reading] = await rows(env.db, "SELECT * FROM odometer_readings WHERE source = 'fluid_check'");
    expect(reading).toMatchObject({ id: r.odometerReadingId, vehicle_id: vid, read_on: '2026-10-07', km: 15400, status: 'valid', fluid_check_id: r.check.id });
    expect(r.check.km).toBe(15400);
    const [comp] = await rows(env.db, 'SELECT * FROM maintenance_completions WHERE deleted_at IS NULL AND fluid_check_id IS NOT NULL');
    expect(comp).toMatchObject({ item_id: items[OIL], done_on: '2026-10-07', done_km: 15400, source: 'check', fluid_check_id: r.check.id });
    const log = await listOdometerReadings(env.deps, vid);
    expect(log[0]).toMatchObject({ km: 15400, source: 'fluid_check', linkedId: r.check.id, canDelete: false });
  });

  it('emette gli eventi dopo il commit: service, reminders e odometer (solo se serve)', async () => {
    unwrap(await check({ fluid: 'brake_fluid' })); // nessuna voce collegata, nessun km
    expect(env.events).toEqual([{ type: 'data-changed', scope: 'service', vehicleId: vid }]);
    env.clearEvents();
    unwrap(await check({ km: 15500 }));
    expect(env.events).toEqual([
      { type: 'data-changed', scope: 'service', vehicleId: vid },
      { type: 'data-changed', scope: 'reminders', vehicleId: vid },
      { type: 'data-changed', scope: 'odometer', vehicleId: vid },
    ]);
  });

  it('km incoerenti: ODO_NON_MONOTONIC con i dettagli per le tre scelte e nessuna scrittura', async () => {
    const r = await check({ km: 9000, checkedOn: '2026-08-01' }); // dopo il 2026-06-01 (15.000) non si puo scendere
    const e = errorOf(r);
    expect(e.code).toBe('ODO_NON_MONOTONIC');
    if (r.ok || !isOdometerConflict(r.error)) throw new Error('doveva essere un conflitto');
    expect(r.error.conflicts.map((c) => c.km)).toEqual([10000, 15000]); // 9.000 e piu basso di entrambe le letture precedenti
    expect(r.error.allowedRange).toEqual({ min: 15000, max: 2_000_000 });
    expect(await count(env.db, 'fluid_checks')).toBe(0);
    expect(await count(env.db, 'maintenance_completions')).toBe(0);
    expect(env.events).toEqual([]);
  });

  it('"Salva senza aggiornare i km": il controllo si registra, senza lettura e con km null nel completamento', async () => {
    const r = unwrap(await check({ km: 9000, checkedOn: '2026-08-01', onOdometerConflict: 'skip_km' }));
    expect(r.kmIgnored).toBe(true);
    expect(r.odometerReadingId).toBeNull();
    expect(r.check.km).toBeNull();
    expect(r.completions).toHaveLength(1);
    expect(await count(env.db, 'odometer_readings', "source = 'fluid_check'")).toBe(0);
    const [c] = await rows(env.db, "SELECT done_km FROM maintenance_completions WHERE source = 'check'");
    expect(c!['done_km']).toBeNull();
  });

  it('"E un errore della lettura precedente": le letture in conflitto vengono messe da parte e si salva', async () => {
    const r = unwrap(await check({ km: 9000, checkedOn: '2026-08-01', onOdometerConflict: 'ignore-conflicting' }));
    expect(r.ignoredReadingIds).toHaveLength(2);
    expect(r.odometerReadingId).toHaveLength(26);
    const log = await listOdometerReadings(env.deps, vid);
    expect(log.filter((x) => x.status === 'ignored').map((x) => x.km).sort()).toEqual([10000, 15000]);
    expect(log.find((x) => x.km === 9000)).toMatchObject({ status: 'valid', source: 'fluid_check' });
  });

  it('salto implausibile di km: avviso non bloccante nel risultato', async () => {
    const r = unwrap(await check({ km: 90000, checkedOn: '2026-06-02' }));
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('addFluidCheck: completamento delle voci di controllo (AC-08.4)', () => {
  it('olio: chiude il promemoria aperto e il prossimo parte dal controllo REALE (data e km)', async () => {
    const [old] = await openReminders(env.db, vid).then((r) => r.filter((x) => x['item_id'] === items[OIL]));
    expect(old).toMatchObject({ due_on: '2026-10-20', due_km: 16200 }); // 20/9 + 1 mese, 15.200 + 1.000
    const r = unwrap(await check({ km: 15900, checkedOn: '2026-10-07' }));
    expect(r.completions).toEqual([
      { completionId: expect.any(String), itemId: items[OIL], itemName: 'Controlla livello olio motore', closedReminderId: old!['id'] },
    ]);
    const [closed] = await rows(env.db, 'SELECT status, completed_on, completion_id FROM reminders WHERE id = ?', [old!['id'] as string]);
    expect(closed).toMatchObject({ status: 'done', completed_on: '2026-10-07', completion_id: r.completions[0]!.completionId });
    const next = (await openReminders(env.db, vid)).find((x) => x['item_id'] === items[OIL]);
    expect(next).toMatchObject({ due_on: '2026-11-07', due_km: 16900 });
    await expectAtMostOneOpen(env.db, vid);
  });

  it('refrigerante e lavavetri condividono la voce: ognuno dei due la completa; il liquido freni non ha voce', async () => {
    const a = unwrap(await check({ fluid: 'coolant' }));
    const b = unwrap(await check({ fluid: 'washer' }));
    expect(a.completions.map((c) => c.itemId)).toEqual([items[COOLANT]]);
    expect(b.completions.map((c) => c.itemId)).toEqual([items[COOLANT]]);
    expect(await count(env.db, 'maintenance_completions', 'item_id = ? AND deleted_at IS NULL', [items[COOLANT]!])).toBe(2);
    const c = unwrap(await check({ fluid: 'brake_fluid' }));
    expect(c.completions).toEqual([]);
    expect(FLUID_CHECK_TEMPLATES.brake_fluid).toBeUndefined();
  });

  it('pressione dei pneumatici: registra i millibar e completa la voce di pressione', async () => {
    const r = unwrap(await check({ fluid: 'tyre_pressure', valueMillibar: 2200 }));
    expect(r.check).toMatchObject({ valueMillibar: 2200, levelLabelIt: 'OK' });
    expect(r.completions.map((c) => c.itemId)).toEqual([items[TYRES]]);
    expect(r.status.detailIt).toContain('2,2 bar');
  });

  it('senza voci create (il wizard non e stato fatto) il controllo si registra e basta', async () => {
    const env2 = await makeEnv();
    const v2 = await makeVehicle(env2);
    const r = unwrap(await addFluidCheck(env2.deps, { vehicleId: v2, fluid: 'engine_oil', level: 'ok' }));
    expect(r.completions).toEqual([]);
    expect(await count(env2.db, 'fluid_checks')).toBe(1);
  });

  it('un controllo retrodatato si registra ma non cambia la base ne chiude il promemoria', async () => {
    unwrap(await check({ checkedOn: '2026-10-05' }));
    const before = await openReminders(env.db, vid);
    const r = unwrap(await check({ checkedOn: '2026-09-01' })); // piu vecchio dell ultimo fatto (2026-10-05)
    expect(r.completions[0]).toMatchObject({ itemId: items[OIL], closedReminderId: null });
    expect(await openReminders(env.db, vid)).toEqual(before);
    expect(await count(env.db, 'maintenance_completions', 'item_id = ? AND deleted_at IS NULL', [items[OIL]!])).toBe(2);
  });

  it('equivalenza con completeDeadline: stesso stato di voci e promemoria (cambia solo la provenienza)', async () => {
    const envB = await makeEnv();
    const vB = await makeVehicle(envB);
    const itemsB = await setupItems(envB, vB, [
      { templateId: OIL, lastDone: { kind: 'done', on: '2026-09-20', km: 15200 } },
      { templateId: TYRES, lastDone: { kind: 'done', on: '2026-09-25' } },
      { templateId: COOLANT, lastDone: { kind: 'done', on: '2026-09-01' } },
    ]);
    unwrap(await check({ km: 15900, checkedOn: '2026-10-07' }));
    unwrap(await completeDeadline(envB.deps, { itemId: itemsB[OIL]!, doneOn: '2026-10-07', doneKm: 15900 }));

    const snap = async (e: Env) => ({
      items: await rows(e.db, 'SELECT name, fixed_due_on, baseline_on, baseline_km, is_active FROM maintenance_items ORDER BY name'),
      completions: await rows(e.db, 'SELECT done_on, done_km, prev_fixed_due_on FROM maintenance_completions WHERE deleted_at IS NULL ORDER BY done_on'),
      reminders: await rows(
        e.db,
        `SELECT title, status, due_on, due_km, effective_due_on, due_trigger, forecast_on, completed_on
         FROM reminders WHERE deleted_at IS NULL ORDER BY title, status, due_on`,
      ),
      odometer: await rows(e.db, 'SELECT read_on, km FROM odometer_readings WHERE deleted_at IS NULL ORDER BY read_on, km'),
    });
    expect(await snap(env)).toEqual(await snap(envB));
  });
});

describe('deleteFluidCheck: annullamento esatto', () => {
  it('controllo con km e completamento: dopo l eliminazione lo stato visibile e identico a quello di prima', async () => {
    const before = await visible();
    const r = unwrap(await check({ km: 15900, checkedOn: '2026-10-07', level: 'topped_up', addedMl: 250 }));
    expect(await visible()).not.toEqual(before);
    env.clearEvents();

    const del = unwrap(await deleteFluidCheck(env.deps, r.check.id));
    expect(del).toMatchObject({
      checkId: r.check.id,
      vehicleId: vid,
      undoneCompletionIds: [r.completions[0]!.completionId],
      reopenedReminderIds: [r.completions[0]!.closedReminderId],
      removedReadingId: r.odometerReadingId,
    });
    expect(await visible()).toEqual(before);
    expect(await getFluidCheck(env.deps, r.check.id)).toBeNull();
    expect(await listFluidChecks(env.deps, vid)).toEqual([]);
    expect(env.events.map((e) => (e.type === 'data-changed' ? e.scope : e.type))).toEqual(['service', 'reminders', 'odometer']);
    await expectAtMostOneOpen(env.db, vid);
    // idempotenza (I5): una nuova riconciliazione non cambia nulla
    await reconcileVehicle(env.deps, vid);
    expect(await visible()).toEqual(before);
  });

  it('refrigerante e lavavetri nello stesso giorno: eliminarli uno alla volta riporta allo stato iniziale', async () => {
    const before = await visible();
    const a = unwrap(await check({ fluid: 'coolant', checkedOn: '2026-10-07' }));
    const b = unwrap(await check({ fluid: 'washer', checkedOn: '2026-10-07' }));
    unwrap(await deleteFluidCheck(env.deps, b.check.id));
    unwrap(await deleteFluidCheck(env.deps, a.check.id));
    expect(await visible()).toEqual(before);
  });

  it('se dopo il controllo c e un altro Fatto della stessa voce si annulla solo il completamento del controllo', async () => {
    const r = unwrap(await check({ km: 15900, checkedOn: '2026-10-06' }));
    unwrap(await completeDeadline(env.deps, { itemId: items[OIL]!, doneOn: '2026-10-07', doneKm: 15950 }));
    const manualReminder = (await openReminders(env.db, vid)).find((x) => x['item_id'] === items[OIL]);
    const del = unwrap(await deleteFluidCheck(env.deps, r.check.id));
    expect(del.reopenedReminderIds).toEqual([]);
    expect(del.undoneCompletionIds).toEqual([r.completions[0]!.completionId]);
    const after = (await openReminders(env.db, vid)).find((x) => x['item_id'] === items[OIL]);
    expect(after).toMatchObject({ id: manualReminder!['id'], due_on: '2026-11-07' }); // resta la base del Fatto piu recente
  });

  it('un controllo gia eliminato o inesistente da ITEM_NOT_FOUND e non emette eventi', async () => {
    const r = unwrap(await check());
    unwrap(await deleteFluidCheck(env.deps, r.check.id));
    env.clearEvents();
    expect(errorOf(await deleteFluidCheck(env.deps, r.check.id)).code).toBe('ITEM_NOT_FOUND');
    expect(errorOf(await deleteFluidCheck(env.deps, 'nope')).code).toBe('ITEM_NOT_FOUND');
    expect(env.events).toEqual([]);
  });

  it('una lettura collegata messa da parte non conta come km del controllo', async () => {
    const r = unwrap(await check({ km: 15400, checkedOn: '2026-10-07' }));
    unwrap(await markReadingIgnored(env.deps, r.odometerReadingId!));
    expect((await getFluidCheck(env.deps, r.check.id))?.km).toBeNull();
  });
});

describe('getFluidStatus (S-24)', () => {
  it('benzina: sette fluidi senza AdBlue; mai controllato dice "Mai controllato" senza inventare nulla', async () => {
    const list = await getFluidStatus(env.deps, vid);
    expect(list.map((s) => s.fluid)).toEqual(['engine_oil', 'coolant', 'brake_fluid', 'washer', 'power_steering', 'gearbox_oil', 'tyre_pressure']);
    expect(list.every((s) => s.kind === 'never' && s.last === null && s.nextCheckOn === null && s.readableViaObd === false)).toBe(true);
    const oil = list[0]!;
    expect(oil).toMatchObject({ fluidLabelIt: 'Olio motore', labelIt: 'Mai controllato', detailIt: 'Mai controllato' });
    expect(oil.hintIt).toContain('astina');
    expect(oil.obdNoteIt).toContain('non legge');
  });

  it('diesel con AdBlue; elettrica senza olio motore ne AdBlue; auto inesistente: elenco vuoto', async () => {
    const diesel = await makeVehicle(env, { fuelPrimary: 'diesel', km: false });
    expect((await getFluidStatus(env.deps, diesel)).map((s) => s.fluid)).toContain('adblue');
    const ev = await makeVehicle(env, { fuelPrimary: 'electric', km: false });
    const evFluids = (await getFluidStatus(env.deps, ev)).map((s) => s.fluid);
    expect(evFluids).not.toContain('engine_oil');
    expect(evFluids).not.toContain('adblue');
    expect(evFluids).toContain('tyre_pressure');
    expect(await getFluidStatus(env.deps, 'nope')).toEqual([]);
  });

  it('dopo un controllo: ultimo esito, giorni trascorsi, prossimo controllo e suggerimento se basso', async () => {
    unwrap(await check({ fluid: 'engine_oil', level: 'low', km: 15400, checkedOn: '2026-10-01' }));
    unwrap(await check({ fluid: 'tyre_pressure', valueMillibar: 2200, checkedOn: '2026-10-08' }));
    const list = await getFluidStatus(env.deps, vid, { pressureUnit: 'bar' });
    const oil = list.find((s) => s.fluid === 'engine_oil')!;
    expect(oil).toMatchObject({ kind: 'attention', labelIt: 'Basso', daysSince: 7, nextCheckOn: '2026-10-31', nextCheckKm: 16400, kmSince: 0 });
    expect(oil.detailIt).toBe('Ultima verifica: 7 giorni fa');
    expect(oil.suggestionIt).toEqual(expect.any(String));
    const tyres = list.find((s) => s.fluid === 'tyre_pressure')!;
    expect(tyres).toMatchObject({ kind: 'ok', labelIt: 'OK', daysSince: 0 });
    expect(tyres.detailIt).toBe('Ultima verifica: oggi · 2,2 bar');
    expect((await getFluidStatus(env.deps, vid, { pressureUnit: 'psi' })).find((s) => s.fluid === 'tyre_pressure')!.detailIt).toContain('psi');
  });

  it('il ricontrollo e dovuto dopo i giorni indicati (lo stato si calcola con "oggi", non e salvato)', async () => {
    unwrap(await check({ fluid: 'washer', checkedOn: '2026-10-01' }));
    expect((await getFluidStatus(env.deps, vid)).find((s) => s.fluid === 'washer')).toMatchObject({ kind: 'ok', recheckDue: false });
    env.clock.set('2026-11-05T08:00:00.000Z');
    expect((await getFluidStatus(env.deps, vid)).find((s) => s.fluid === 'washer')).toMatchObject({ kind: 'overdue', recheckDue: true, labelIt: 'Da ricontrollare' });
  });

  it('una lettura km collegata messa da parte o un controllo eliminato escono dallo stato', async () => {
    const r = unwrap(await check({ fluid: 'engine_oil', level: 'low', checkedOn: '2026-10-07' }));
    unwrap(await deleteFluidCheck(env.deps, r.check.id));
    expect((await getFluidStatus(env.deps, vid))[0]).toMatchObject({ fluid: 'engine_oil', kind: 'never' });
  });
});

describe('listFluidChecks e rabbocchi', () => {
  it('elenco dal piu recente, con filtro per fluido e periodo, limite e offset', async () => {
    const a = unwrap(await check({ fluid: 'engine_oil', checkedOn: '2026-09-01' }));
    const b = unwrap(await check({ fluid: 'coolant', checkedOn: '2026-10-01' }));
    const c = unwrap(await check({ fluid: 'engine_oil', checkedOn: '2026-10-01', level: 'topped_up', addedMl: 200 }));
    const all = await listFluidChecks(env.deps, vid);
    expect(all.map((x) => x.id)).toEqual([c.check.id, b.check.id, a.check.id]); // stessa data: l ultimo creato prima
    expect((await listFluidChecks(env.deps, vid, { fluid: 'engine_oil' })).map((x) => x.id)).toEqual([c.check.id, a.check.id]);
    expect((await listFluidChecks(env.deps, vid, { from: '2026-09-15' })).map((x) => x.id)).toEqual([c.check.id, b.check.id]);
    expect((await listFluidChecks(env.deps, vid, { to: '2026-09-30' })).map((x) => x.id)).toEqual([a.check.id]);
    expect((await listFluidChecks(env.deps, vid, { limit: 1, offset: 1 })).map((x) => x.id)).toEqual([b.check.id]);
    expect(await listFluidChecks(env.deps, 'nope')).toEqual([]);
  });

  it('i rabbocchi dell olio nell anno si sommano (base di F-45); quelli senza quantita contano ma non sommano', async () => {
    unwrap(await check({ level: 'topped_up', addedMl: 300, checkedOn: '2026-03-01' }));
    unwrap(await check({ level: 'topped_up', addedMl: 700, checkedOn: '2026-07-01' }));
    unwrap(await check({ level: 'topped_up', checkedOn: '2026-08-01' }));
    unwrap(await check({ level: 'ok', checkedOn: '2026-09-01' }));
    unwrap(await check({ level: 'topped_up', addedMl: 500, checkedOn: '2025-12-31' }));
    expect(await getToppedUpSummary(env.deps, vid, 'engine_oil', '2026-01-01', '2026-12-31')).toEqual({ count: 3, totalMl: 1000, withoutAmount: 1 });
  });
});
