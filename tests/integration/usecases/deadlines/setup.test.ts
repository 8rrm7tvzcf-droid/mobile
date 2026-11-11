// Wizard "Imposta le scadenze" (SPEC 6.3.3, F-20..F-22): catalogo filtrato per alimentazione, risposte dell'utente,
// revisione e bollo calcolati dal dominio italiano con override manuale, nessun dato inventato (I3).
import { describe, expect, it } from 'vitest';
import { listSetupCatalog, setupDeadlines, vehicleTags } from '@/usecases/deadlines';
import type { SetupItemInput, SetupItemResult } from '@/usecases/deadlines';
import { addVehicle, errorOf, makeEnv, openReminders, rows, unwrap } from './helpers';
import type { Env } from './helpers';

async function setup(env: Env, vehicleId: string, items: SetupItemInput[]): Promise<SetupItemResult[]> {
  return unwrap(await setupDeadlines(env.deps, { vehicleId, items })).items;
}
const only = (r: SetupItemResult[]): SetupItemResult => r[0]!;
const itemRow = async (env: Env, id: string) => (await rows(env.db, 'SELECT * FROM maintenance_items WHERE id = ?', [id]))[0]!;

describe('tag veicolo e catalogo proposto', () => {
  it('i tag derivano da powertrain e alimentazioni', () => {
    expect(vehicleTags({ powertrain: 'ice', fuelPrimary: 'petrol' })).toEqual(['combustion', 'petrol']);
    expect(vehicleTags({ powertrain: 'ice', fuelPrimary: 'diesel' })).toEqual(['combustion', 'diesel']);
    expect(vehicleTags({ powertrain: 'ice', fuelPrimary: 'petrol', fuelSecondary: 'lpg' })).toEqual(['combustion', 'petrol', 'gas']);
    expect(vehicleTags({ powertrain: 'bev', fuelPrimary: 'electric' })).toEqual(['bev']);
    expect(vehicleTags({ powertrain: 'phev', fuelPrimary: 'petrol', fuelSecondary: 'electric' })).toEqual(['combustion', 'petrol']);
  });

  it('benzina: 27 voci, compatibili con l alimentazione, preselezionate solo quelle attive di default', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env, { fuel_primary: 'petrol' });
    const cat = unwrap(await listSetupCatalog(env.deps, v));
    expect(cat.proposals).toHaveLength(27);
    expect(cat.vehicleTags).toEqual(['combustion', 'petrol']);
    const by = Object.fromEntries(cat.proposals.map((p) => [p.templateId, p]));
    expect(by['tpl_oil_change']).toMatchObject({ applies: true, preselected: true, question: 'last_done', isIndicative: true });
    expect(by['tpl_spark_plugs']).toMatchObject({ applies: true, preselected: true });
    expect(by['tpl_fuel_filter']).toMatchObject({ applies: false, preselected: false }); // solo diesel
    expect(by['tpl_gas_cylinder']).toMatchObject({ applies: false, preselected: false });
    expect(by['tpl_ev_service']).toMatchObject({ applies: false, preselected: false });
    expect(by['tpl_timing_belt']).toMatchObject({ applies: true, preselected: false }); // spenta di default
    expect(by['tpl_inspection']).toMatchObject({ applies: true, preselected: true, question: 'inspection' });
    expect(by['tpl_road_tax']).toMatchObject({ applies: true, preselected: true, question: 'road_tax' });
    expect(by['tpl_tyres_winter']).toMatchObject({ preselected: false, question: 'next_due', suggestedDueOn: '2026-11-15' });
    expect(by['tpl_tyres_summer']).toMatchObject({ suggestedDueOn: '2027-04-15' });
  });

  it('diesel, GPL ed elettrica: ognuna vede le sue voci', async () => {
    const env = await makeEnv();
    const diesel = unwrap(await listSetupCatalog(env.deps, await addVehicle(env, { fuel_primary: 'diesel' })));
    const dBy = Object.fromEntries(diesel.proposals.map((p) => [p.templateId, p]));
    expect(dBy['tpl_fuel_filter']!.applies).toBe(true);
    expect(dBy['tpl_spark_plugs']!.applies).toBe(false);
    expect(dBy['tpl_check_adblue']).toMatchObject({ applies: true, preselected: false });

    const lpg = unwrap(await listSetupCatalog(env.deps, await addVehicle(env, { fuel_primary: 'petrol', fuel_secondary: 'lpg' })));
    const gBy = Object.fromEntries(lpg.proposals.map((p) => [p.templateId, p]));
    expect(gBy['tpl_gas_cylinder']).toMatchObject({ applies: true, preselected: true, question: 'next_due' });
    expect(gBy['tpl_gas_system_check']!.applies).toBe(true);

    const bev = unwrap(await listSetupCatalog(env.deps, await addVehicle(env, { fuel_primary: 'electric', powertrain: 'bev' })));
    const eBy = Object.fromEntries(bev.proposals.map((p) => [p.templateId, p]));
    expect(eBy['tpl_ev_service']).toMatchObject({ applies: true, preselected: true });
    expect(eBy['tpl_oil_change']).toMatchObject({ applies: false, preselected: false });
    expect(eBy['tpl_cabin_filter']!.applies).toBe(true); // vale per tutti
  });

  it('segnala le voci gia presenti e per un veicolo inesistente da ITEM_NOT_FOUND', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env);
    const [oil] = await setup(env, v, [{ templateId: 'tpl_oil_change' }]);
    const cat = unwrap(await listSetupCatalog(env.deps, v));
    expect(cat.proposals.find((p) => p.templateId === 'tpl_oil_change')!.existingItemId).toBe(oil!.itemId);
    expect(errorOf(await listSetupCatalog(env.deps, '01TESTID99999999999999999X')).code).toBe('ITEM_NOT_FOUND');
  });
});

describe('setupDeadlines: voci a intervallo (data e km / non lo so / mai fatto)', () => {
  it('"data e km": baseline, regole e preavvisi copiati dal template, nessuna lettura km creata', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env, { fuel_primary: 'petrol' });
    const res = unwrap(
      await setupDeadlines(env.deps, {
        vehicleId: v,
        items: [{ templateId: 'tpl_oil_change', lastDone: { kind: 'done', on: '2026-03-01', km: 12000 } }],
      }),
    );
    const r = res.items[0]!;
    expect(r).toMatchObject({ status: 'created', state: 'ok', effectiveDueOn: '2027-03-01', basis: 'last_done', name: 'Cambio olio motore e filtro' });
    expect(r.reasons).toEqual(['NO_ODOMETER']); // i km a scadenza non si possono prevedere senza letture: motivo, nessun dato inventato
    expect(res).toMatchObject({ createdCount: 1, existingCount: 0, toConfigureCount: 0 });
    const row = await itemRow(env, r.itemId);
    expect(row).toMatchObject({
      vehicle_id: v,
      template_id: 'tpl_oil_change',
      template_version: 1,
      category: 'maintenance',
      schedule_type: 'interval_last_done',
      interval_km: 15000,
      interval_months: 12,
      period_end: 'exact',
      baseline_on: '2026-03-01',
      baseline_km: 12000,
      soon_days: 30,
      soon_km: 1500,
      notify_offsets_days: '[14,3,0]',
      notify_enabled: 1,
      is_active: 1,
    });
    expect(await rows(env.db, 'SELECT id FROM odometer_readings')).toEqual([]);
    const open = await openReminders(env.db, v);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ item_id: r.itemId, due_on: '2027-03-01', due_km: 27000 });
  });

  it('"non lo so": la voce resta Da configurare, nessun promemoria, con il motivo (I3)', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env);
    const res = unwrap(await setupDeadlines(env.deps, { vehicleId: v, items: [{ templateId: 'tpl_cabin_filter' }, { templateId: 'tpl_brake_fluid', lastDone: { kind: 'unknown' } }] }));
    for (const r of res.items) {
      expect(r.state).toBe('unknown');
      expect(r.reasons).toContain('NO_LAST_DONE');
      expect(r.effectiveDueOn).toBeNull();
    }
    expect(res.toConfigureCount).toBe(2);
    expect(await openReminders(env.db, v)).toEqual([]);
    const row = await itemRow(env, res.items[0]!.itemId);
    expect(row).toMatchObject({ baseline_on: null, baseline_km: null });
  });

  it('"mai fatto": parte dalla prima immatricolazione con 0 km; senza immatricolazione dall acquisto; senza nulla resta da configurare', async () => {
    const env = await makeEnv();
    const withReg = await addVehicle(env, { first_registration_on: '2020-03-15' });
    const r1 = only(await setup(env, withReg, [{ templateId: 'tpl_brake_fluid', lastDone: { kind: 'never' } }]));
    expect(r1).toMatchObject({ basis: 'never_done_since_registration', state: 'overdue', effectiveDueOn: '2022-03-15' });
    expect(await itemRow(env, r1.itemId)).toMatchObject({ baseline_on: '2020-03-15', baseline_km: 0 });
    expect(await openReminders(env.db, withReg)).toHaveLength(1);

    const bought = await addVehicle(env, { purchase_on: '2024-05-10', purchase_km: 41000 });
    const r2 = only(await setup(env, bought, [{ templateId: 'tpl_air_filter', lastDone: { kind: 'never' } }]));
    expect(r2.basis).toBe('never_done_since_purchase');
    expect(await itemRow(env, r2.itemId)).toMatchObject({ baseline_on: '2024-05-10', baseline_km: 41000 });

    const bare = await addVehicle(env);
    const r3 = only(await setup(env, bare, [{ templateId: 'tpl_air_filter', lastDone: { kind: 'never' } }]));
    expect(r3).toMatchObject({ state: 'unknown', basis: null });
    expect(r3.reasons).toContain('NO_LAST_DONE');
  });

  it('personalizzazioni: nome e intervalli diversi dal catalogo; valori fuori range rifiutati', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env);
    const r = only(
      await setup(env, v, [
        { templateId: 'tpl_oil_change', lastDone: { kind: 'done', on: '2026-06-01', km: 20000 }, overrides: { name: 'Olio (libretto)', intervalKm: 10000, intervalMonths: null, notifyEnabled: false } },
      ]),
    );
    expect(r.name).toBe('Olio (libretto)');
    expect(await itemRow(env, r.itemId)).toMatchObject({ interval_km: 10000, interval_months: null, notify_enabled: 0, template_id: 'tpl_oil_change' });
    const bad = errorOf(await setupDeadlines(env.deps, { vehicleId: await addVehicle(env), items: [{ templateId: 'tpl_oil_change', overrides: { intervalKm: 50 } }] }));
    expect(bad).toMatchObject({ code: 'VALIDATION', field: 'items[0].overrides.intervalKm' });
    const none = errorOf(await setupDeadlines(env.deps, { vehicleId: await addVehicle(env), items: [{ templateId: 'tpl_oil_change', overrides: { intervalKm: null, intervalMonths: null } }] }));
    expect(none.code).toBe('VALIDATION');
  });
});

describe('setupDeadlines: revisione (SPEC 7.2)', () => {
  it('auto con meno di 4 anni: base = immatricolazione + 24 mesi, prima scadenza a 4 anni a fine mese (vettore V2b)', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env, { first_registration_on: '2023-03-15' });
    const r = only(await setup(env, v, [{ templateId: 'tpl_inspection' }]));
    expect(r).toMatchObject({ state: 'ok', effectiveDueOn: '2027-03-31', basis: 'first_registration' });
    expect(r.warning).toContain('Portale dell');
    expect(await itemRow(env, r.itemId)).toMatchObject({ baseline_on: '2025-03-15', period_end: 'end_of_month', interval_months: 24 });
  });

  it('auto con piu di 4 anni senza data dell ultima revisione: non si inventa (da configurare)', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env, { first_registration_on: '2019-03-15' });
    const r = only(await setup(env, v, [{ templateId: 'tpl_inspection' }]));
    expect(r).toMatchObject({ state: 'unknown', effectiveDueOn: null });
    expect(r.reasons).toContain('NO_LAST_DONE');
    expect(await openReminders(env.db, v)).toEqual([]);
    const noReg = only(await setup(env, await addVehicle(env), [{ templateId: 'tpl_inspection' }]));
    expect(noReg.state).toBe('unknown');
  });

  it('con la data dell ultima revisione: +2 anni a fine mese', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env, { first_registration_on: '2019-03-15' });
    const r = only(await setup(env, v, [{ templateId: 'tpl_inspection', inspection: { lastInspectionOn: '2025-05-20' } }]));
    expect(r).toMatchObject({ state: 'ok', effectiveDueOn: '2027-05-31', basis: 'last_inspection' });
    expect(await itemRow(env, r.itemId)).toMatchObject({ baseline_on: '2025-05-20' });
  });

  it('esito "da ripetere": entro un mese dalla revisione; "sospesa": nessuna scadenza calcolabile', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env, { first_registration_on: '2019-03-15' });
    const rep = only(await setup(env, v, [{ templateId: 'tpl_inspection', inspection: { lastInspectionOn: '2026-09-20', outcome: 'to_repeat' } }]));
    expect(rep).toMatchObject({ state: 'soon', effectiveDueOn: '2026-10-20', basis: 'repeat' });
    expect(await itemRow(env, rep.itemId)).toMatchObject({ period_end: 'exact' });

    const v2 = await addVehicle(env, { first_registration_on: '2019-03-15' });
    const sus = only(await setup(env, v2, [{ templateId: 'tpl_inspection', inspection: { lastInspectionOn: '2026-09-20', outcome: 'suspended' } }]));
    expect(sus.state).toBe('unknown');
    expect(sus.reasons).toContain('INSPECTION_SUSPENDED');
    expect(await openReminders(env.db, v2)).toEqual([]);
  });

  it('la data letta sul documento vince sul calcolo: a fine mese resta a fine mese, un altro giorno resta quel giorno', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env, { first_registration_on: '2023-03-15' });
    const eom = only(await setup(env, v, [{ templateId: 'tpl_inspection', nextDueOn: '2027-04-30' }]));
    expect(eom).toMatchObject({ effectiveDueOn: '2027-04-30', basis: 'manual' });
    expect(await itemRow(env, eom.itemId)).toMatchObject({ period_end: 'end_of_month' });

    const v2 = await addVehicle(env, { first_registration_on: '2023-03-15' });
    const day = only(await setup(env, v2, [{ templateId: 'tpl_inspection', nextDueOn: '2027-04-12' }]));
    expect(day.effectiveDueOn).toBe('2027-04-12');
    expect(await itemRow(env, day.itemId)).toMatchObject({ period_end: 'exact' });

    const leap = only(await setup(env, await addVehicle(env), [{ templateId: 'tpl_inspection', nextDueOn: '2028-02-29' }]));
    expect(leap.effectiveDueOn).toBe('2028-02-29');
  });
});

describe('setupDeadlines: bollo, bombola, gomme (SPEC 7.3, 7.5)', () => {
  it('bollo dal mese di pagamento: ultimo giorno del mese, prossima occorrenza; nessun importo', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env, { first_registration_on: '2020-03-15' });
    const nov = only(await setup(env, v, [{ templateId: 'tpl_road_tax', paymentMonth: 11 }]));
    expect(nov).toMatchObject({ state: 'ok', effectiveDueOn: '2026-11-30', basis: 'renewal_payment_month' });
    expect(nov.warning).toContain('ACI');
    expect(await itemRow(env, nov.itemId)).toMatchObject({ schedule_type: 'interval_calendar', interval_months: 12, fixed_due_on: '2026-11-30' });

    const sep = only(await setup(env, await addVehicle(env), [{ templateId: 'tpl_road_tax', paymentMonth: 9 }]));
    expect(sep.effectiveDueOn).toBe('2027-09-30'); // settembre 2026 e gia passato
  });

  it('bollo senza mese: dal mese di immatricolazione; senza nessun dato resta da configurare; mese non valido rifiutato', async () => {
    const env = await makeEnv();
    const withReg = only(await setup(env, await addVehicle(env, { first_registration_on: '2020-03-15' }), [{ templateId: 'tpl_road_tax' }]));
    expect(withReg).toMatchObject({ effectiveDueOn: '2027-03-31', basis: 'renewal_registration_month' });
    const none = only(await setup(env, await addVehicle(env), [{ templateId: 'tpl_road_tax' }]));
    expect(none).toMatchObject({ state: 'unknown', basis: null });
    expect(none.reasons).toContain('NO_FIXED_DATE');
    const bad = errorOf(await setupDeadlines(env.deps, { vehicleId: await addVehicle(env), items: [{ templateId: 'tpl_road_tax', paymentMonth: 13 }] }));
    expect(bad).toMatchObject({ code: 'VALIDATION', field: 'items[0].paymentMonth' });
  });

  it('bollo: la data inserita vince; bombola dal cartellino; senza data da configurare', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env, { fuel_primary: 'petrol', fuel_secondary: 'lpg', first_registration_on: '2020-03-15' });
    const res = await setup(env, v, [
      { templateId: 'tpl_road_tax', paymentMonth: 11, nextDueOn: '2026-12-15' },
      { templateId: 'tpl_gas_cylinder', nextDueOn: '2030-05-01' },
    ]);
    expect(res[0]).toMatchObject({ effectiveDueOn: '2026-12-15', basis: 'manual' });
    expect(res[1]).toMatchObject({ state: 'ok', effectiveDueOn: '2030-05-01' });
    const noDate = only(await setup(env, await addVehicle(env, { fuel_primary: 'petrol', fuel_secondary: 'lpg' }), [{ templateId: 'tpl_gas_cylinder' }]));
    expect(noDate.state).toBe('unknown');
    expect(noDate.reasons).toContain('NO_FIXED_DATE');
  });

  it('gomme stagionali: prossima occorrenza del 15/11 e del 15/4, oppure la data inserita', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env);
    const res = await setup(env, v, [{ templateId: 'tpl_tyres_winter' }, { templateId: 'tpl_tyres_summer' }]);
    expect(res[0]).toMatchObject({ effectiveDueOn: '2026-11-15', state: 'ok', basis: 'template_anchor' });
    expect(res[1]).toMatchObject({ effectiveDueOn: '2027-04-15' });
    expect(await itemRow(env, res[0]!.itemId)).toMatchObject({ fixed_due_on: '2026-11-15', soon_days: 21, notify_offsets_days: '[14,3,0]' });
  });
});

describe('setupDeadlines: ripetibilita, validazione e transazione', () => {
  it('ripetere il wizard non duplica ne modifica le voci esistenti', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env);
    const input: SetupItemInput[] = [
      { templateId: 'tpl_oil_change', lastDone: { kind: 'done', on: '2026-03-01', km: 12000 } },
      { templateId: 'tpl_cabin_filter' },
    ];
    const first = unwrap(await setupDeadlines(env.deps, { vehicleId: v, items: input }));
    const itemsBefore = await rows(env.db, 'SELECT * FROM maintenance_items ORDER BY id');
    const remindersBefore = await rows(env.db, 'SELECT * FROM reminders ORDER BY id');
    const again = unwrap(
      await setupDeadlines(env.deps, {
        vehicleId: v,
        items: [{ templateId: 'tpl_oil_change', lastDone: { kind: 'done', on: '2026-09-01', km: 99999 } }, { templateId: 'tpl_cabin_filter' }],
      }),
    );
    expect(again).toMatchObject({ createdCount: 0, existingCount: 2 });
    expect(again.items.map((i) => i.itemId)).toEqual(first.items.map((i) => i.itemId));
    expect(again.items.every((i) => i.status === 'already_exists')).toBe(true);
    expect(await rows(env.db, 'SELECT * FROM maintenance_items ORDER BY id')).toEqual(itemsBefore);
    expect(await rows(env.db, 'SELECT * FROM reminders ORDER BY id')).toEqual(remindersBefore);
  });

  it('lo stesso template ripetuto nell input si crea una volta sola; una voce nel cestino non conta come esistente', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env);
    const res = unwrap(await setupDeadlines(env.deps, { vehicleId: v, items: [{ templateId: 'tpl_wipers' }, { templateId: 'tpl_wipers' }] }));
    expect(res.createdCount).toBe(1);
    expect(res.existingCount).toBe(1);
    await env.db.run(`UPDATE maintenance_items SET deleted_at = '2026-10-01T00:00:00.000Z'`);
    const after = unwrap(await setupDeadlines(env.deps, { vehicleId: v, items: [{ templateId: 'tpl_wipers' }] }));
    expect(after.createdCount).toBe(1);
  });

  it('un errore di validazione annulla tutto: nessuna voce, nessun evento', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env);
    const e1 = errorOf(await setupDeadlines(env.deps, { vehicleId: v, items: [{ templateId: 'tpl_oil_change' }, { templateId: 'tpl_non_esiste' }] }));
    expect(e1).toMatchObject({ code: 'VALIDATION', field: 'items[1].templateId' });
    const e2 = errorOf(await setupDeadlines(env.deps, { vehicleId: v, items: [{ templateId: 'tpl_oil_change', lastDone: { kind: 'done', on: '2026-10-09' } }] }));
    expect(e2).toMatchObject({ code: 'VALIDATION', field: 'items[0].lastDone.on' });
    const e3 = errorOf(await setupDeadlines(env.deps, { vehicleId: v, items: [{ templateId: 'tpl_oil_change', lastDone: { kind: 'done', on: '2026-01-01', km: -5 } }] }));
    expect(e3).toMatchObject({ code: 'VALIDATION', field: 'items[0].lastDone.km' });
    const e4 = errorOf(await setupDeadlines(env.deps, { vehicleId: v, items: [{ templateId: 'tpl_oil_change', lastDone: { kind: 'done', on: '2026-02-30' } }] }));
    expect(e4.code).toBe('VALIDATION');
    expect(await rows(env.db, 'SELECT id FROM maintenance_items')).toEqual([]);
    expect(env.events).toEqual([]);
    expect(errorOf(await setupDeadlines(env.deps, { vehicleId: '01TESTID99999999999999999X', items: [] })).code).toBe('ITEM_NOT_FOUND');
  });

  it('emette un evento data-changed (reminders) dopo il commit, solo se qualcosa e cambiato', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env);
    unwrap(await setupDeadlines(env.deps, { vehicleId: v, items: [{ templateId: 'tpl_cabin_filter' }] }));
    expect(env.events).toEqual([{ type: 'data-changed', scope: 'reminders', vehicleId: v }]);
    unwrap(await setupDeadlines(env.deps, { vehicleId: v, items: [{ templateId: 'tpl_cabin_filter' }] }));
    expect(env.events).toHaveLength(1);
  });

  it('un wizard completo: le voci preselezionate di un auto a benzina, riepilogo con semaforo', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env, { fuel_primary: 'petrol', first_registration_on: '2023-03-15' });
    const cat = unwrap(await listSetupCatalog(env.deps, v));
    const chosen = cat.proposals.filter((p) => p.preselected).map((p) => ({ templateId: p.templateId }) as SetupItemInput);
    const res = unwrap(await setupDeadlines(env.deps, { vehicleId: v, items: chosen }));
    expect(res.createdCount).toBe(chosen.length);
    const byTpl = Object.fromEntries(res.items.map((i) => [i.templateId, i]));
    expect(byTpl['tpl_inspection']!.state).toBe('ok'); // dalla immatricolazione
    expect(byTpl['tpl_oil_change']!.state).toBe('unknown'); // non lo so
    expect(res.toConfigureCount).toBeGreaterThan(10);
    // hanno una scadenza solo le voci con dati noti: revisione e bollo (dalla prima immatricolazione, regole italiane)
    expect((await openReminders(env.db, v)).map((r) => r['title']).sort()).toEqual(['Bollo auto', 'Revisione periodica']);
    expect(byTpl['tpl_road_tax']).toMatchObject({ state: 'ok', basis: 'renewal_registration_month' });
  });
});
