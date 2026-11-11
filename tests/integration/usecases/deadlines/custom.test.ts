// Scadenze personalizzate (F-23) e modifica delle regole (S-31): validazione in italiano, ricorrenza ancorata all'origine,
// riconciliazione nella stessa transazione, soft delete.
import { describe, expect, it } from 'vitest';
import {
  addCustomDeadline,
  addCustomRule,
  completeDeadline,
  deleteDeadline,
  reconcileVehicle,
  setupDeadlines,
  updateCustomDeadline,
  updateDeadlineRule,
} from '@/usecases/deadlines';
import { insertRow, reminderRow } from '../../../support/db';
import { addItem, addOdo, addVehicle, errorOf, makeEnv, openReminders, rows, unwrap } from './helpers';

async function base() {
  const env = await makeEnv();
  const v = await addVehicle(env, { first_registration_on: '2020-03-15' });
  await addOdo(env, v, '2026-01-01', 10000);
  await addOdo(env, v, '2026-06-01', 15000);
  return { env, v };
}

describe('addCustomDeadline', () => {
  it('scadenza con data e ricorrenza annuale: promemoria manuale ancorato all origine, cache riempita, evento emesso', async () => {
    const { env, v } = await base();
    const r = unwrap(
      await addCustomDeadline(env.deps, {
        vehicleId: v,
        title: '  Pagare il box  ',
        dueOn: '2026-11-30',
        repeat: { every: 1, unit: 'year' },
        category: 'legal',
        notes: ' contratto 2024 ',
        notifyOffsetsDays: [0, 7, 30, 7],
      }),
    );
    expect(r).toMatchObject({ state: 'ok', effectiveDueOn: '2026-11-30', reasons: [] });
    const [row] = await rows(env.db, 'SELECT * FROM reminders WHERE id = ?', [r.reminderId]);
    expect(row).toMatchObject({
      origin: 'manual',
      vehicle_id: v,
      title: 'Pagare il box',
      notes: 'contratto 2024',
      category: 'legal',
      due_on: '2026-11-30',
      due_km: null,
      due_time: null,
      status: 'open',
      repeat_every: 1,
      repeat_unit: 'year',
      repeat_origin_on: '2026-11-30',
      notify_offsets_days: '[30,7,0]',
      effective_due_on: '2026-11-30',
      due_trigger: 'time',
      item_id: null,
      policy_id: null,
      payment_id: null,
    });
    expect(env.events).toEqual([{ type: 'data-changed', scope: 'reminders', vehicleId: v }]);
  });

  it('con km e ora: la previsione parte dalle letture; senza letture dice perche (NO_ODOMETER) e non inventa', async () => {
    const { env, v } = await base();
    const withKm = unwrap(await addCustomDeadline(env.deps, { vehicleId: v, title: 'Rabbocco', dueOn: '2027-06-01', dueKm: 16000, dueTime: '18:30' }));
    const [row] = await rows(env.db, 'SELECT due_km, due_time, forecast_on, effective_due_on, due_trigger FROM reminders WHERE id = ?', [withKm.reminderId]);
    expect(row).toMatchObject({ due_km: 16000, due_time: '18:30' });
    expect(row!['forecast_on']).not.toBeNull();
    expect(row!['effective_due_on']).toBe(withKm.effectiveDueOn);

    const bare = await addVehicle(env);
    const noKm = unwrap(await addCustomDeadline(env.deps, { vehicleId: bare, title: 'Solo km', dueKm: 50000 }));
    expect(noKm).toMatchObject({ state: 'unknown', effectiveDueOn: null });
    expect(noKm.reasons).toContain('NO_ODOMETER');
  });

  it('una data gia passata e ammessa e risulta scaduta', async () => {
    const { env, v } = await base();
    const r = unwrap(await addCustomDeadline(env.deps, { vehicleId: v, title: 'Assicurazione moto', dueOn: '2026-10-01' }));
    expect(r.state).toBe('overdue');
  });

  it('validazione con messaggi in italiano e transazione annullata', async () => {
    const { env, v } = await base();
    const bad = async (input: Record<string, unknown>) => errorOf(await addCustomDeadline(env.deps, { vehicleId: v, title: 'X', dueOn: '2026-12-01', ...input } as never));
    expect(await bad({ title: '   ' })).toMatchObject({ code: 'VALIDATION', field: 'title', message: 'Inserisci un titolo.' });
    expect((await bad({ title: 'x'.repeat(121) })).field).toBe('title');
    expect(await bad({ dueOn: null })).toMatchObject({ field: 'dueOn', message: 'Indica una data o un chilometraggio.' });
    expect((await bad({ dueOn: '2026-02-30' })).field).toBe('dueOn');
    expect((await bad({ dueKm: 3_000_000 })).field).toBe('dueKm');
    expect((await bad({ dueTime: '25:00' })).field).toBe('dueTime');
    expect((await bad({ dueTime: '9:00' })).field).toBe('dueTime');
    expect((await bad({ dueOn: null, dueKm: 20000, dueTime: '09:00' })).field).toBe('dueTime');
    expect((await bad({ dueOn: null, dueKm: 20000, repeat: { every: 1, unit: 'month' } })).field).toBe('repeat');
    expect((await bad({ repeat: { every: 0, unit: 'month' } })).field).toBe('repeat');
    expect((await bad({ repeat: { every: 1001, unit: 'month' } })).field).toBe('repeat');
    expect((await bad({ repeat: { every: 2, unit: 'decade' } })).field).toBe('repeat');
    expect((await bad({ category: 'insurance' })).field).toBe('category');
    expect((await bad({ notifyOffsetsDays: [-1] })).field).toBe('notifyOffsetsDays');
    expect((await bad({ soonDays: 400 })).field).toBe('soonDays');
    expect(errorOf(await addCustomDeadline(env.deps, { vehicleId: '01TESTID99999999999999999X', title: 'X', dueOn: '2026-12-01' })).code).toBe('ITEM_NOT_FOUND');
    expect(await rows(env.db, 'SELECT id FROM reminders')).toEqual([]);
    expect(env.events).toEqual([]);
  });

  it('il Fatto di una scadenza personalizzata ricorrente porta alla prossima occorrenza (ciclo completo)', async () => {
    const { env, v } = await base();
    const r = unwrap(await addCustomDeadline(env.deps, { vehicleId: v, title: 'Lavaggio', dueOn: '2026-10-08', repeat: { every: 2, unit: 'week' } }));
    const done = unwrap(await completeDeadline(env.deps, { reminderId: r.reminderId, doneOn: '2026-10-08' }));
    expect((await rows(env.db, 'SELECT due_on FROM reminders WHERE id = ?', [done.nextReminderId as string]))[0]).toEqual({ due_on: '2026-10-22' });
  });
});

describe('updateCustomDeadline e deleteDeadline', () => {
  it('modifica titolo e data: la ricorrenza si riancora alla nuova data; solo i manuali aperti', async () => {
    const { env, v } = await base();
    const r = unwrap(await addCustomDeadline(env.deps, { vehicleId: v, title: 'Vecchio', dueOn: '2026-11-30', repeat: { every: 1, unit: 'month' } }));
    const u = unwrap(await updateCustomDeadline(env.deps, r.reminderId, { title: 'Nuovo', dueOn: '2026-12-15' }));
    expect(u.effectiveDueOn).toBe('2026-12-15');
    expect((await rows(env.db, 'SELECT title, due_on, repeat_origin_on, repeat_every FROM reminders WHERE id = ?', [r.reminderId]))[0]).toEqual({
      title: 'Nuovo',
      due_on: '2026-12-15',
      repeat_origin_on: '2026-12-15',
      repeat_every: 1,
    });
    unwrap(await updateCustomDeadline(env.deps, r.reminderId, { repeat: null }));
    expect((await rows(env.db, 'SELECT repeat_every, repeat_unit, repeat_origin_on FROM reminders WHERE id = ?', [r.reminderId]))[0]).toEqual({
      repeat_every: null,
      repeat_unit: null,
      repeat_origin_on: null,
    });
    expect(errorOf(await updateCustomDeadline(env.deps, r.reminderId, { dueOn: null })).field).toBe('dueOn');

    const item = await addItem(env, v, { name: 'Olio', baseline_on: '2026-03-01', baseline_km: 12000 });
    await reconcileVehicle(env.deps, v);
    const generated = (await rows(env.db, 'SELECT id FROM reminders WHERE item_id = ?', [item]))[0]!['id'] as string;
    expect(errorOf(await updateCustomDeadline(env.deps, generated, { title: 'X' })).field).toBe('reminderId');
    await env.db.run(`UPDATE reminders SET status = 'skipped' WHERE id = ?`, [r.reminderId]);
    expect(errorOf(await updateCustomDeadline(env.deps, r.reminderId, { title: 'X' })).field).toBe('reminderId');
    expect(errorOf(await updateCustomDeadline(env.deps, '01TESTID99999999999999999X', {})).code).toBe('ITEM_NOT_FOUND');
  });

  it('elimina un promemoria manuale (soft delete) o una voce con i suoi promemoria generati', async () => {
    const { env, v } = await base();
    const m = await insertRow(env.db, 'reminders', reminderRow(v, { title: 'Manuale', due_on: '2026-12-01' }));
    const item = await addItem(env, v, { name: 'Olio', baseline_on: '2026-03-01', baseline_km: 12000 });
    await reconcileVehicle(env.deps, v);
    const generated = (await rows(env.db, 'SELECT id FROM reminders WHERE item_id = ?', [item]))[0]!['id'] as string;

    expect(errorOf(await deleteDeadline(env.deps, { reminderId: generated })).field).toBe('reminderId'); // si elimina la regola
    expect(unwrap(await deleteDeadline(env.deps, { reminderId: m }))).toEqual({ vehicleId: v });
    expect((await rows(env.db, 'SELECT deleted_at FROM reminders WHERE id = ?', [m]))[0]!['deleted_at']).not.toBeNull();
    expect(await openReminders(env.db, v)).toHaveLength(1);

    unwrap(await deleteDeadline(env.deps, { itemId: item }));
    expect(await openReminders(env.db, v)).toEqual([]);
    expect((await rows(env.db, 'SELECT deleted_at FROM maintenance_items WHERE id = ?', [item]))[0]!['deleted_at']).not.toBeNull();
    expect(errorOf(await deleteDeadline(env.deps, { itemId: item })).code).toBe('ITEM_NOT_FOUND');
    expect(errorOf(await deleteDeadline(env.deps, { reminderId: m })).code).toBe('ITEM_NOT_FOUND');
  });
});

describe('updateDeadlineRule', () => {
  const OIL = { name: 'Cambio olio', baseline_on: '2026-03-01', baseline_km: 12000, interval_km: 15000, interval_months: 12 };

  it('cambiare l intervallo aggiorna lo STESSO promemoria in place (nessun duplicato) e restituisce la nuova scadenza', async () => {
    const { env, v } = await base();
    const item = await addItem(env, v, OIL);
    await reconcileVehicle(env.deps, v);
    const [before] = await openReminders(env.db, v);
    env.events.length = 0;
    const r = unwrap(await updateDeadlineRule(env.deps, item, { intervalMonths: 6, intervalKm: 10000 }));
    expect(r).toMatchObject({ itemId: item, state: 'overdue', effectiveDueOn: '2026-09-01' }); // 2026-03-01 + 6 mesi e gia passato
    const open = await openReminders(env.db, v);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ id: before!['id'], due_on: '2026-09-01', due_km: 22000 });
    expect(env.events).toEqual([{ type: 'data-changed', scope: 'reminders', vehicleId: v }]);
  });

  it('configurare una voce "Da configurare" con la baseline fa nascere il promemoria; disattivarla lo toglie', async () => {
    const { env, v } = await base();
    const item = await addItem(env, v, { name: 'Filtro', baseline_on: null, baseline_km: null, interval_months: 12, interval_km: null });
    expect(unwrap(await updateDeadlineRule(env.deps, item, {})).state).toBe('unknown');
    expect(await openReminders(env.db, v)).toEqual([]);
    const set = unwrap(await updateDeadlineRule(env.deps, item, { baselineOn: '2026-05-10', baselineKm: 14000 }));
    expect(set).toMatchObject({ state: 'ok', effectiveDueOn: '2027-05-10' });
    expect(await openReminders(env.db, v)).toHaveLength(1);
    unwrap(await updateDeadlineRule(env.deps, item, { isActive: false }));
    expect(await openReminders(env.db, v)).toEqual([]);
    unwrap(await updateDeadlineRule(env.deps, item, { isActive: true, name: ' Filtro abitacolo ', soonDays: 10, notifyOffsetsDays: [3, 14, 0], notifyEnabled: false, notes: 'ok' }));
    expect((await rows(env.db, 'SELECT name, soon_days, notify_offsets_days, notify_enabled, notes, is_active FROM maintenance_items WHERE id = ?', [item]))[0]).toEqual({
      name: 'Filtro abitacolo',
      soon_days: 10,
      notify_offsets_days: '[14,3,0]',
      notify_enabled: 0,
      notes: 'ok',
      is_active: 1,
    });
    expect((await openReminders(env.db, v))[0]).toMatchObject({ soon_days: 10, notify_offsets_days: '[14,3,0]' });
  });

  it('una voce nata dal wizard resta modificabile e conserva template_id', async () => {
    const { env, v } = await base();
    const res = unwrap(await setupDeadlines(env.deps, { vehicleId: v, items: [{ templateId: 'tpl_road_tax' }] }));
    const id = res.items[0]!.itemId;
    const r = unwrap(await updateDeadlineRule(env.deps, id, { fixedDueOn: '2026-12-31' }));
    expect(r.effectiveDueOn).toBe('2026-12-31');
    expect((await rows(env.db, 'SELECT template_id, fixed_due_on FROM maintenance_items WHERE id = ?', [id]))[0]).toEqual({ template_id: 'tpl_road_tax', fixed_due_on: '2026-12-31' });
  });

  it('validazione: intervalli, date, km senza data, coerenza con il tipo di regola', async () => {
    const { env, v } = await base();
    const item = await addItem(env, v, OIL);
    const cal = await addItem(env, v, { name: 'Bollo', schedule_type: 'interval_calendar', interval_km: null, interval_months: 12, fixed_due_on: '2026-12-31', baseline_on: null, baseline_km: null });
    const fixed = await addItem(env, v, { name: 'Bombola', schedule_type: 'fixed_date', interval_km: null, interval_months: null, fixed_due_on: '2030-01-01', baseline_on: null, baseline_km: null });
    const bad = async (id: string, patch: Record<string, unknown>) => errorOf(await updateDeadlineRule(env.deps, id, patch as never));
    expect(await bad(item, { name: '' })).toMatchObject({ code: 'VALIDATION', field: 'name' });
    expect((await bad(item, { name: 'x'.repeat(81) })).field).toBe('name');
    expect((await bad(item, { intervalKm: 50 })).field).toBe('intervalKm');
    expect((await bad(item, { intervalMonths: 0 })).field).toBe('intervalMonths');
    expect((await bad(item, { intervalKm: null, intervalMonths: null })).field).toBe('intervalKm');
    expect((await bad(item, { baselineOn: '2026-10-09' })).field).toBe('baselineOn');
    expect((await bad(item, { baselineOn: null })).field).toBe('baselineKm'); // i km di base senza data
    expect((await bad(item, { fixedDueOn: '2026-13-01' })).field).toBe('fixedDueOn');
    expect((await bad(item, { soonKm: 200000 })).field).toBe('soonKm');
    expect((await bad(cal, { intervalMonths: null })).field).toBe('intervalMonths');
    expect((await bad(fixed, { intervalMonths: 12 })).field).toBe('intervalKm');
    expect((await bad('01TESTID99999999999999999X', {})).code).toBe('ITEM_NOT_FOUND');
    expect((await rows(env.db, 'SELECT interval_km, interval_months, baseline_on FROM maintenance_items WHERE id = ?', [item]))[0]).toEqual({ interval_km: 15000, interval_months: 12, baseline_on: '2026-03-01' });
  });
});

describe('addCustomRule', () => {
  it('voce senza template: promemoria subito se ci sono gli ingredienti, altrimenti Da configurare', async () => {
    const { env, v } = await base();
    const ok = unwrap(
      await addCustomRule(env.deps, { vehicleId: v, name: 'Ingrassaggio catena', category: 'maintenance', scheduleType: 'interval_last_done', intervalKm: 5000, baselineOn: '2026-09-01', baselineKm: 15500 }),
    );
    expect(ok.state).toBe('ok');
    expect((await rows(env.db, 'SELECT template_id, template_version, notify_offsets_days, category FROM maintenance_items WHERE id = ?', [ok.itemId]))[0]).toEqual({
      template_id: null,
      template_version: null,
      notify_offsets_days: '[30,7,0]',
      category: 'maintenance',
    });
    expect((await openReminders(env.db, v))[0]).toMatchObject({ item_id: ok.itemId, due_km: 20500, title: 'Ingrassaggio catena' });

    const tbd = unwrap(await addCustomRule(env.deps, { vehicleId: v, name: 'Tagliando extra', scheduleType: 'interval_last_done', intervalMonths: 6 }));
    expect(tbd).toMatchObject({ state: 'unknown' });
    expect(tbd.reasons).toContain('NO_LAST_DONE');
    expect(await openReminders(env.db, v)).toHaveLength(1);
  });

  it('serie di calendario e data fissa; validazione; veicolo inesistente', async () => {
    const { env, v } = await base();
    const cal = unwrap(await addCustomRule(env.deps, { vehicleId: v, name: 'Assicurazione box', scheduleType: 'interval_calendar', intervalMonths: 12, fixedDueOn: '2026-12-01' }));
    expect(cal.effectiveDueOn).toBe('2026-12-01');
    expect(errorOf(await addCustomRule(env.deps, { vehicleId: v, name: 'X', scheduleType: 'interval_last_done' })).field).toBe('intervalKm');
    expect(errorOf(await addCustomRule(env.deps, { vehicleId: v, name: 'X', scheduleType: 'interval_calendar' })).field).toBe('intervalMonths');
    expect(errorOf(await addCustomRule(env.deps, { vehicleId: v, name: 'X', scheduleType: 'fixed_date', intervalKm: 1000 })).code).toBe('VALIDATION');
    expect(errorOf(await addCustomRule(env.deps, { vehicleId: '01TESTID99999999999999999X', name: 'X', scheduleType: 'fixed_date' })).code).toBe('ITEM_NOT_FOUND');
    expect(await rows(env.db, 'SELECT id FROM maintenance_items')).toHaveLength(1);
  });
});
