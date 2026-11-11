// "Rimanda", "Salta" e riapertura (SPEC 3.2 F-25, data.md 3.6): preset di rimando, scadenza di sicurezza a 30 giorni,
// serie di calendario che avanza al salto e torna indietro alla riapertura.
import { describe, expect, it } from 'vitest';
import { clearSnooze, completeDeadline, reconcileVehicle, reopenReminder, skipDeadline, snoozeDeadline, utcIsoToLocal, localToUtcIso } from '@/usecases/deadlines';
import type { Clock } from '@/domain/ports';
import { insertRow, reminderRow } from '../../../support/db';
import { addItem, addOdo, addPolicy, addVehicle, errorOf, expectOneOpenPerItem, makeEnv, openReminders, rows, unwrap } from './helpers';

const OIL = { name: 'Cambio olio', baseline_on: '2026-03-01', baseline_km: 12000, interval_km: 15000, interval_months: 12 };
const BOLLO = { name: 'Bollo auto', category: 'legal', schedule_type: 'interval_calendar', interval_km: null, interval_months: 12, fixed_due_on: '2026-08-31', baseline_on: null, baseline_km: null, soon_km: 0 };
const BOMBOLA = { name: 'Riqualifica bombola', category: 'legal', schedule_type: 'fixed_date', interval_km: null, interval_months: null, fixed_due_on: '2026-10-20', baseline_on: null, baseline_km: null, soon_km: 0 };

async function garage(items: Record<string, unknown>[] = [OIL], withKm = true) {
  const env = await makeEnv();
  const v = await addVehicle(env, { first_registration_on: '2020-03-15' });
  if (withKm) {
    await addOdo(env, v, '2026-01-01', 10000);
    await addOdo(env, v, '2026-06-01', 15000);
  }
  const ids: string[] = [];
  for (const o of items) ids.push(await addItem(env, v, o as never));
  await reconcileVehicle(env.deps, v);
  env.events.length = 0;
  const [first] = await openReminders(env.db, v);
  return { env, v, ids, reminder: first?.['id'] as string };
}

const snoozeRow = async (env: Awaited<ReturnType<typeof makeEnv>>, id: string) =>
  (await rows(env.db, 'SELECT snoozed_until, snooze_until_km, due_on, due_km, status FROM reminders WHERE id = ?', [id]))[0]!;

describe('snoozeDeadline', () => {
  it('domani alle 09:00, fra 3 giorni, fra 1 settimana: istante UTC salvato e scadenza invariata', async () => {
    const { env, v, reminder } = await garage();
    const dueBefore = (await snoozeRow(env, reminder))['due_on'];
    const t = unwrap(await snoozeDeadline(env.deps, { reminderId: reminder, choice: { type: 'tomorrow' } }));
    expect(t).toMatchObject({ snoozedUntil: '2026-10-09T09:00:00.000Z', untilLocal: { date: '2026-10-09', time: '09:00' }, untilKm: null });
    expect(await snoozeRow(env, reminder)).toMatchObject({ snoozed_until: '2026-10-09T09:00:00.000Z', snooze_until_km: null, due_on: dueBefore });
    expect(env.events).toEqual([{ type: 'data-changed', scope: 'reminders', vehicleId: v }]);

    expect(unwrap(await snoozeDeadline(env.deps, { reminderId: reminder, choice: { type: 'days', days: 3 } })).snoozedUntil).toBe('2026-10-11T09:00:00.000Z');
    expect(unwrap(await snoozeDeadline(env.deps, { reminderId: reminder, choice: { type: 'days', days: 7 } })).snoozedUntil).toBe('2026-10-15T09:00:00.000Z');
    await expectOneOpenPerItem(env.db, v); // si puo rimandare piu volte; il promemoria e sempre lo stesso
  });

  it('dopo N km: km attuali + N e scadenza di sicurezza a +30 giorni (default 500 km)', async () => {
    const { env, reminder } = await garage();
    const r = unwrap(await snoozeDeadline(env.deps, { reminderId: reminder, choice: { type: 'after_km' } }));
    expect(r).toMatchObject({ untilKm: 15500, snoozedUntil: '2026-11-07T09:00:00.000Z' });
    const custom = unwrap(await snoozeDeadline(env.deps, { reminderId: reminder, choice: { type: 'after_km', km: 1200 } }));
    expect(custom.untilKm).toBe(16200);
    expect(await snoozeRow(env, reminder)).toMatchObject({ snooze_until_km: 16200, snoozed_until: '2026-11-07T09:00:00.000Z' });
  });

  it('dopo N km senza nessuna lettura: errore sul campo currentKm, nulla scritto', async () => {
    const { env, reminder } = await garage([OIL], false);
    const e = errorOf(await snoozeDeadline(env.deps, { reminderId: reminder, choice: { type: 'after_km' } }));
    expect(e).toMatchObject({ code: 'VALIDATION', field: 'currentKm' });
    expect(e.message).toContain('km');
    expect(await snoozeRow(env, reminder)).toMatchObject({ snoozed_until: null, snooze_until_km: null });
    expect(env.events).toEqual([]);
  });

  it('rimando non valido, promemoria inesistente o gia chiuso', async () => {
    const { env, ids, reminder } = await garage();
    expect(errorOf(await snoozeDeadline(env.deps, { reminderId: reminder, choice: { type: 'days', days: 0 } }))).toMatchObject({ code: 'VALIDATION', field: 'choice' });
    expect(errorOf(await snoozeDeadline(env.deps, { reminderId: reminder, choice: { type: 'after_km', km: 0 } })).field).toBe('choice');
    expect(errorOf(await snoozeDeadline(env.deps, { reminderId: '01TESTID99999999999999999X', choice: { type: 'tomorrow' } })).code).toBe('ITEM_NOT_FOUND');
    unwrap(await completeDeadline(env.deps, { itemId: ids[0]!, doneOn: '2026-10-05' }));
    expect(errorOf(await snoozeDeadline(env.deps, { reminderId: reminder, choice: { type: 'tomorrow' } })).field).toBe('reminderId');
  });

  it('usa l ora delle notifiche dalle impostazioni (notify.time) e i promemoria manuali si rimandano come gli altri', async () => {
    const { env, v } = await garage([]);
    await env.db.run(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('notify.time', '"18:30"')`);
    const m = await insertRow(env.db, 'reminders', reminderRow(v, { title: 'Manuale', due_on: '2026-10-15' }));
    expect(unwrap(await snoozeDeadline(env.deps, { reminderId: m, choice: { type: 'tomorrow' } })).snoozedUntil).toBe('2026-10-09T18:30:00.000Z');
    await env.db.run(`UPDATE app_settings SET value = '"25:99"' WHERE key = 'notify.time'`);
    expect(unwrap(await snoozeDeadline(env.deps, { reminderId: m, choice: { type: 'tomorrow' } })).untilLocal.time).toBe('09:00'); // valore non valido: predefinito
  });

  it('con un fuso diverso da UTC (Roma, CEST +2) 09:00 locali sono le 07:00 UTC; l inverso restituisce l ora locale', async () => {
    const { env, reminder } = await garage();
    const rome: Clock = {
      nowIso: () => '2026-10-08T07:30:00.000Z',
      todayLocal: () => '2026-10-08',
      nowLocal: () => ({ date: '2026-10-08', time: '09:30' }),
      timeZone: () => 'Europe/Rome',
    };
    const deps = { ...env.deps, clock: rome };
    const r = unwrap(await snoozeDeadline(deps, { reminderId: reminder, choice: { type: 'tomorrow' } }));
    expect(r.snoozedUntil).toBe('2026-10-09T07:00:00.000Z');
    expect(r.untilLocal).toEqual({ date: '2026-10-09', time: '09:00' });
    expect(utcIsoToLocal(r.snoozedUntil, rome)).toEqual({ date: '2026-10-09', time: '09:00' });
    // lo scarto e' quello del giorno di DESTINAZIONE (31/12: CET +1, non il +2 estivo di adesso): 23:30 a Roma sono le 22:30Z.
    // (Prima del fix DL-6 il test attendeva 21:30Z, cioe' lo scarto estivo applicato a una data invernale: era il bug.)
    expect(localToUtcIso({ date: '2026-12-31', time: '23:30' }, rome)).toBe('2026-12-31T22:30:00.000Z');
    expect(localToUtcIso({ date: '2026-10-09', time: '00:15' }, rome)).toBe('2026-10-08T22:15:00.000Z'); // attraversa la mezzanotte UTC
  });

  it('clearSnooze toglie il rimando; il Fatto lo lascia chiudere insieme al promemoria', async () => {
    const { env, reminder } = await garage();
    unwrap(await snoozeDeadline(env.deps, { reminderId: reminder, choice: { type: 'after_km' } }));
    unwrap(await clearSnooze(env.deps, reminder));
    expect(await snoozeRow(env, reminder)).toMatchObject({ snoozed_until: null, snooze_until_km: null });
    expect(errorOf(await clearSnooze(env.deps, '01TESTID99999999999999999X')).code).toBe('ITEM_NOT_FOUND');
  });
});

describe('skipDeadline e reopenReminder', () => {
  it('voce "dall ultimo fatto": il promemoria passa a skipped, non rinasce, la regola non cambia; si riapre lo stesso promemoria', async () => {
    const { env, v, ids, reminder } = await garage();
    const itemBefore = await rows(env.db, 'SELECT * FROM maintenance_items WHERE id = ?', [ids[0]!]);
    const r = unwrap(await skipDeadline(env.deps, reminder));
    expect(r).toEqual({ reminderId: reminder, nextReminderId: null });
    expect((await rows(env.db, 'SELECT status, completed_on FROM reminders WHERE id = ?', [reminder]))[0]).toEqual({ status: 'skipped', completed_on: '2026-10-08' });
    expect(await openReminders(env.db, v)).toEqual([]);
    await reconcileVehicle(env.deps, v); // il ciclo saltato non resuscita
    expect(await openReminders(env.db, v)).toEqual([]);
    expect(await rows(env.db, 'SELECT * FROM maintenance_items WHERE id = ?', [ids[0]!])).toEqual(itemBefore);
    expect(await rows(env.db, 'SELECT id FROM maintenance_completions')).toEqual([]); // saltare non e un "fatto"

    unwrap(await reopenReminder(env.deps, reminder));
    expect((await openReminders(env.db, v)).map((x) => x['id'])).toEqual([reminder]);
    expect((await rows(env.db, 'SELECT completed_on FROM reminders WHERE id = ?', [reminder]))[0]).toEqual({ completed_on: null });
    await expectOneOpenPerItem(env.db, v);
  });

  it('serie di calendario (bollo): il salto porta la serie al 2027 e crea il prossimo; la riapertura rimette la data di prima', async () => {
    const { env, v, ids, reminder } = await garage([BOLLO]);
    const r = unwrap(await skipDeadline(env.deps, reminder));
    expect((await rows(env.db, 'SELECT fixed_due_on FROM maintenance_items WHERE id = ?', [ids[0]!]))[0]).toEqual({ fixed_due_on: '2027-08-31' });
    expect((await openReminders(env.db, v))[0]).toMatchObject({ id: r.nextReminderId, due_on: '2027-08-31' });
    expect(r.nextReminderId).not.toBeNull();

    unwrap(await reopenReminder(env.deps, reminder));
    expect((await rows(env.db, 'SELECT fixed_due_on FROM maintenance_items WHERE id = ?', [ids[0]!]))[0]).toEqual({ fixed_due_on: '2026-08-31' });
    const open = await openReminders(env.db, v);
    expect(open.map((x) => [x['id'], x['due_on']])).toEqual([[reminder, '2026-08-31']]);
    await expectOneOpenPerItem(env.db, v);
  });

  it('data fissa (bombola): il salto la azzera (Da configurare), la riapertura la ripristina', async () => {
    const { env, v, ids, reminder } = await garage([BOMBOLA]);
    unwrap(await skipDeadline(env.deps, reminder));
    expect((await rows(env.db, 'SELECT fixed_due_on FROM maintenance_items WHERE id = ?', [ids[0]!]))[0]).toEqual({ fixed_due_on: null });
    expect(await openReminders(env.db, v)).toEqual([]);
    unwrap(await reopenReminder(env.deps, reminder));
    expect((await rows(env.db, 'SELECT fixed_due_on FROM maintenance_items WHERE id = ?', [ids[0]!]))[0]).toEqual({ fixed_due_on: '2026-10-20' });
    expect((await openReminders(env.db, v)).map((x) => x['id'])).toEqual([reminder]);
  });

  it('la riapertura non sovrascrive una data modificata dall utente dopo il salto', async () => {
    const { env, ids, reminder } = await garage([BOLLO]);
    unwrap(await skipDeadline(env.deps, reminder));
    await env.db.run(`UPDATE maintenance_items SET fixed_due_on = '2027-09-30' WHERE id = ?`, [ids[0]!]);
    unwrap(await reopenReminder(env.deps, reminder));
    expect((await rows(env.db, 'SELECT fixed_due_on FROM maintenance_items WHERE id = ?', [ids[0]!]))[0]).toEqual({ fixed_due_on: '2027-09-30' });
  });

  it('promemoria manuale: non ricorrente si chiude; ricorrente genera la prossima occorrenza e la riapertura la toglie', async () => {
    const { env, v } = await garage([]);
    const once = await insertRow(env.db, 'reminders', reminderRow(v, { title: 'Una tantum', due_on: '2026-10-20' }));
    expect(unwrap(await skipDeadline(env.deps, once)).nextReminderId).toBeNull();

    const rep = await insertRow(
      env.db,
      'reminders',
      reminderRow(v, { title: 'Ogni mese', due_on: '2026-10-20', repeat_every: 1, repeat_unit: 'month', repeat_origin_on: '2026-01-20' }),
    );
    const r = unwrap(await skipDeadline(env.deps, rep));
    expect((await rows(env.db, 'SELECT due_on FROM reminders WHERE id = ?', [r.nextReminderId as string]))[0]).toEqual({ due_on: '2026-11-20' });
    unwrap(await reopenReminder(env.deps, rep));
    const open = (await openReminders(env.db, v)).filter((x) => x['title'] === 'Ogni mese');
    expect(open.map((x) => x['id'])).toEqual([rep]);
  });

  it('riaprire un Fatto di una voce equivale all annulla; un Fatto manuale si riapre togliendo la prossima occorrenza', async () => {
    const { env, v, ids, reminder } = await garage();
    unwrap(await completeDeadline(env.deps, { itemId: ids[0]!, doneOn: '2026-10-05', doneKm: 17000 }));
    unwrap(await reopenReminder(env.deps, reminder));
    expect((await openReminders(env.db, v)).map((x) => x['id'])).toEqual([reminder]);
    expect(await rows(env.db, 'SELECT id FROM maintenance_completions WHERE deleted_at IS NULL')).toEqual([]);

    const rep = await insertRow(
      env.db,
      'reminders',
      reminderRow(v, { title: 'Annuale', due_on: '2026-10-20', repeat_every: 1, repeat_unit: 'year', repeat_origin_on: '2025-10-20' }),
    );
    unwrap(await completeDeadline(env.deps, { reminderId: rep, doneOn: '2026-10-08' }));
    expect((await openReminders(env.db, v)).filter((x) => x['title'] === 'Annuale')).toHaveLength(1);
    unwrap(await reopenReminder(env.deps, rep));
    expect((await openReminders(env.db, v)).filter((x) => x['title'] === 'Annuale').map((x) => x['id'])).toEqual([rep]);
  });

  it('errori: promemoria inesistente, gia chiuso o gia aperto; i promemoria che si chiudono da soli non si riaprono', async () => {
    const { env, v, reminder } = await garage();
    expect(errorOf(await skipDeadline(env.deps, '01TESTID99999999999999999X')).code).toBe('ITEM_NOT_FOUND');
    expect(errorOf(await reopenReminder(env.deps, '01TESTID99999999999999999X')).code).toBe('ITEM_NOT_FOUND');
    expect(errorOf(await reopenReminder(env.deps, reminder))).toMatchObject({ code: 'VALIDATION', field: 'reminderId' }); // gia aperto
    unwrap(await skipDeadline(env.deps, reminder));
    expect(errorOf(await skipDeadline(env.deps, reminder)).field).toBe('reminderId'); // gia chiuso

    const p = await addPolicy(env, v, { company: 'Acme', end_on: '2027-01-01' });
    await insertRow(env.db, 'insurance_payments', { id: '01TESTPAY00000000000000001', policy_id: p, installment_no: 1, due_on: '2026-10-01', amount_cents: 1000, paid_on: null });
    await reconcileVehicle(env.deps, v);
    await env.db.run(`UPDATE insurance_payments SET paid_on = '2026-10-07'`);
    await reconcileVehicle(env.deps, v);
    const paid = (await rows(env.db, `SELECT id FROM reminders WHERE payment_id IS NOT NULL AND status = 'done'`))[0]!;
    expect(errorOf(await reopenReminder(env.deps, paid['id'] as string)).field).toBe('reminderId');
  });

  it('saltare il promemoria di una polizza: non rinasce finche la scadenza resta la stessa', async () => {
    const { env, v } = await garage([]);
    await addPolicy(env, v, { company: 'Acme', end_on: '2027-01-01' });
    await reconcileVehicle(env.deps, v);
    const [rem] = await openReminders(env.db, v);
    unwrap(await skipDeadline(env.deps, rem!['id'] as string));
    await reconcileVehicle(env.deps, v);
    expect(await openReminders(env.db, v)).toEqual([]);
  });
});
