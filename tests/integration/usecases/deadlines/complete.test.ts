// "Fatto" e "Annulla" (SPEC 3.2 F-25, data.md 3.7): transazione unica, valori REALI come nuova base, serie di calendario,
// conflitto sui km, completamenti retrodatati, annullamento esatto.
import { describe, expect, it } from 'vitest';
import { completeDeadline, reconcileVehicle, undoCompletion } from '@/usecases/deadlines';
import type { CompleteDeadlineInput } from '@/usecases/deadlines';
import { insertRow, reminderRow } from '../../../support/db';
import { addItem, addOdo, addPolicy, addVehicle, errorOf, expectOneOpenPerItem, makeEnv, openReminders, rows, unwrap } from './helpers';
import type { Env } from './helpers';

const OIL = { name: 'Cambio olio', baseline_on: '2026-03-01', baseline_km: 12000, interval_km: 15000, interval_months: 12 };
const BOLLO = { name: 'Bollo auto', category: 'legal', schedule_type: 'interval_calendar', interval_km: null, interval_months: 12, fixed_due_on: '2026-08-31', baseline_on: null, baseline_km: null, soon_km: 0 };
const BOMBOLA = { name: 'Riqualifica bombola', category: 'legal', schedule_type: 'fixed_date', interval_km: null, interval_months: null, fixed_due_on: '2026-10-20', baseline_on: null, baseline_km: null, soon_km: 0 };

async function garage(extra: Record<string, unknown>[] = [OIL]) {
  const env = await makeEnv();
  const v = await addVehicle(env, { nickname: 'Panda', first_registration_on: '2020-03-15' });
  await addOdo(env, v, '2026-01-01', 10000);
  await addOdo(env, v, '2026-06-01', 15000);
  const items: string[] = [];
  for (const o of extra) items.push(await addItem(env, v, o as never));
  await reconcileVehicle(env.deps, v);
  env.events.length = 0;
  return { env, v, items, item: items[0]! };
}

/** Stato "visibile" (senza istanti di scrittura): serve a confrontare prima e dopo un Fatto + Annulla. */
async function visible(env: Env) {
  return {
    items: await rows(env.db, 'SELECT id, name, fixed_due_on, baseline_on, baseline_km, interval_km, interval_months, is_active FROM maintenance_items WHERE deleted_at IS NULL ORDER BY id'),
    completions: await rows(env.db, 'SELECT id, item_id, done_on, done_km, prev_fixed_due_on FROM maintenance_completions WHERE deleted_at IS NULL ORDER BY id'),
    odometer: await rows(env.db, 'SELECT vehicle_id, read_on, km, source, status FROM odometer_readings WHERE deleted_at IS NULL ORDER BY read_on, km'),
    reminders: await rows(
      env.db,
      `SELECT id, item_id, origin, title, status, due_on, due_km, effective_due_on, due_trigger, forecast_on, completed_on, completion_id, snoozed_until
       FROM reminders WHERE deleted_at IS NULL ORDER BY id`,
    ),
  };
}

const done = (d: CompleteDeadlineInput) => d;

describe('completeDeadline: voce a intervallo (data.md 3.7)', () => {
  it('Fatto con data e km: completamento, lettura km, promemoria chiuso e il prossimo parte dai valori REALI', async () => {
    const { env, v, item } = await garage();
    const [old] = await openReminders(env.db, v);
    const r = unwrap(await completeDeadline(env.deps, done({ itemId: item, doneOn: '2026-10-05', doneKm: 26000 }))); // fatto a 26.000, non ai 27.000 teorici
    expect(r).toMatchObject({ kind: 'item', itemId: item, closedReminderId: old!['id'], kmIgnored: false, warnings: [] });
    expect(r.completionId).toHaveLength(26);

    const [c] = await rows(env.db, 'SELECT * FROM maintenance_completions');
    expect(c).toMatchObject({ item_id: item, done_on: '2026-10-05', done_km: 26000, prev_fixed_due_on: null, source: 'manual', deleted_at: null });
    const [odo] = await rows(env.db, `SELECT * FROM odometer_readings WHERE read_on = '2026-10-05'`);
    expect(odo).toMatchObject({ km: 26000, source: 'manual', status: 'valid', note: 'Fatto: Cambio olio', id: r.odometerReadingId });
    const closed = (await rows(env.db, 'SELECT * FROM reminders WHERE id = ?', [old!['id'] as string]))[0]!;
    expect(closed).toMatchObject({ status: 'done', completed_on: '2026-10-05', completion_id: r.completionId });
    const open = await openReminders(env.db, v);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ id: r.nextReminderId, item_id: item, due_on: '2027-10-05', due_km: 41000 }); // 26.000 + 15.000
    expect(r.next).toMatchObject({ state: 'ok', effectiveDueOn: expect.any(String) });
    await expectOneOpenPerItem(env.db, v);
    expect(env.events).toEqual([
      { type: 'data-changed', scope: 'reminders', vehicleId: v },
      { type: 'data-changed', scope: 'odometer', vehicleId: v },
    ]);
  });

  it('fatto in anticipo a 13.000 km su un intervallo teorico a 27.000: il prossimo e a 13.000 + intervallo', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env);
    await addOdo(env, v, '2026-09-01', 12900);
    const item = await addItem(env, v, { ...OIL, baseline_on: '2025-10-01', baseline_km: 0 });
    await reconcileVehicle(env.deps, v);
    unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-01', doneKm: 13000 }));
    expect((await openReminders(env.db, v))[0]).toMatchObject({ due_km: 28000, due_on: '2027-10-01' });
  });

  it('senza km: nessuna lettura creata, nessun km inventato (NO_LAST_KM), resta la scadenza a tempo', async () => {
    const { env, v, item } = await garage();
    const r = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-05' }));
    expect(r.odometerReadingId).toBeNull();
    expect(r.next!.reasons).toContain('NO_LAST_KM');
    expect(await rows(env.db, 'SELECT id FROM odometer_readings')).toHaveLength(2);
    expect((await openReminders(env.db, v))[0]).toMatchObject({ due_on: '2027-10-05', due_km: null });
    expect(env.events).toEqual([{ type: 'data-changed', scope: 'reminders', vehicleId: v }]);
  });

  it('per reminderId equivale a per itemId; una voce senza promemoria ("Da configurare") si puo completare dal dettaglio', async () => {
    const { env, v, item } = await garage([OIL, { name: 'Filtro', baseline_on: null, baseline_km: null }]);
    const [oilReminder] = await openReminders(env.db, v);
    const viaReminder = unwrap(await completeDeadline(env.deps, { reminderId: oilReminder!['id'] as string, doneOn: '2026-10-05' }));
    expect(viaReminder.itemId).toBe(item);
    expect(viaReminder.closedReminderId).toBe(oilReminder!['id']);

    const unknownItem = (await rows(env.db, `SELECT id FROM maintenance_items WHERE name = 'Filtro'`))[0]!['id'] as string;
    expect(await openReminders(env.db, v)).toHaveLength(1);
    const r = unwrap(await completeDeadline(env.deps, { itemId: unknownItem, doneOn: '2026-10-07', doneKm: 16500 }));
    expect(r.closedReminderId).toBeNull();
    expect(r.nextReminderId).not.toBeNull();
    expect(r.next!.state).toBe('ok');
    expect(await openReminders(env.db, v)).toHaveLength(2);
  });

  it('validazione: data futura, data o km non validi, bersaglio mancante o doppio, voce o promemoria inesistenti', async () => {
    const { env, v, item } = await garage();
    expect(errorOf(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-09' })).code).toBe('FUTURE_DATE');
    expect(errorOf(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-02-30' }))).toMatchObject({ code: 'VALIDATION', field: 'doneOn' });
    expect(errorOf(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-05', doneKm: -1 }))).toMatchObject({ code: 'VALIDATION', field: 'doneKm' });
    expect(errorOf(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-05', doneKm: 12.5 })).code).toBe('VALIDATION');
    expect(errorOf(await completeDeadline(env.deps, { doneOn: '2026-10-05' }))).toMatchObject({ code: 'VALIDATION', field: 'target' });
    expect(errorOf(await completeDeadline(env.deps, { itemId: item, reminderId: 'x', doneOn: '2026-10-05' })).field).toBe('target');
    expect(errorOf(await completeDeadline(env.deps, { itemId: '01TESTID99999999999999999X', doneOn: '2026-10-05' })).code).toBe('ITEM_NOT_FOUND');
    expect(errorOf(await completeDeadline(env.deps, { reminderId: '01TESTID99999999999999999X', doneOn: '2026-10-05' })).code).toBe('ITEM_NOT_FOUND');
    expect(await rows(env.db, 'SELECT id FROM maintenance_completions')).toEqual([]);
    expect(await openReminders(env.db, v)).toHaveLength(1);
    expect(env.events).toEqual([]); // nessun evento se non e cambiato nulla
  });

  it('un promemoria gia chiuso non si completa di nuovo; i promemoria di polizze e rate non si chiudono con "Fatto"', async () => {
    const { env, v, item } = await garage();
    const [rem] = await openReminders(env.db, v);
    unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-05' }));
    expect(errorOf(await completeDeadline(env.deps, { reminderId: rem!['id'] as string, doneOn: '2026-10-05' }))).toMatchObject({ code: 'VALIDATION', field: 'reminderId' });

    await addPolicy(env, v, { company: 'Acme', end_on: '2027-01-01' });
    await reconcileVehicle(env.deps, v);
    const policyReminder = (await rows(env.db, `SELECT id FROM reminders WHERE policy_id IS NOT NULL AND status = 'open'`))[0]!;
    const e = errorOf(await completeDeadline(env.deps, { reminderId: policyReminder['id'] as string, doneOn: '2026-10-05' }));
    expect(e).toMatchObject({ code: 'VALIDATION', field: 'reminderId' });
    expect(e.message).toContain('assicurazione');
  });
});

describe('completeDeadline: km in conflitto (ODO_NON_MONOTONIC)', () => {
  it('di default errore tipizzato e nessuna scrittura; con skip_km si completa senza km', async () => {
    const { env, v, item } = await garage();
    const before = await visible(env);
    const e = errorOf(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-05', doneKm: 9000 }));
    expect(e.code).toBe('ODO_NON_MONOTONIC');
    expect(e.message).toContain('km');
    expect(await visible(env)).toEqual(before); // transazione annullata
    expect(env.events).toEqual([]);

    const r = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-05', doneKm: 9000, onOdometerConflict: 'skip_km' }));
    expect(r).toMatchObject({ kmIgnored: true, odometerReadingId: null });
    expect((await rows(env.db, 'SELECT done_km FROM maintenance_completions'))[0]).toEqual({ done_km: null });
    expect(await rows(env.db, 'SELECT id FROM odometer_readings')).toHaveLength(2);
    expect((await openReminders(env.db, v))[0]!['due_km']).toBeNull();
  });

  it('se la stessa lettura (giorno e km) esiste gia non ne crea un altra; un salto implausibile e solo un avviso', async () => {
    const { env, item } = await garage();
    const same = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-06-01', doneKm: 15000 }));
    expect(same.odometerReadingId).toBeNull();
    expect(await rows(env.db, 'SELECT id FROM odometer_readings')).toHaveLength(2);
    expect((await rows(env.db, 'SELECT done_km FROM maintenance_completions'))[0]).toEqual({ done_km: 15000 });

    const jump = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-06-02', doneKm: 90000 }));
    expect(jump.odometerReadingId).not.toBeNull();
    expect(jump.warnings).toHaveLength(1);
    expect(jump.warnings[0]).toContain('km');
  });
});

describe('completeDeadline: completamenti retrodatati e doppi', () => {
  it('un completamento piu vecchio dell ultimo si registra ma non cambia la base ne il promemoria', async () => {
    const { env, v, item } = await garage();
    unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-05', doneKm: 17000 }));
    const [reminder] = await openReminders(env.db, v);
    const before = await visible(env);
    const old = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-09-01' }));
    expect(old.closedReminderId).toBeNull();
    expect(old.nextReminderId).toBe(reminder!['id']);
    const after = await visible(env);
    expect(after.reminders).toEqual(before.reminders);
    expect(after.completions).toHaveLength(2);
    expect(await openReminders(env.db, v)).toHaveLength(1);
  });

  it('lo stesso Fatto registrato due volte non lascia la voce senza promemoria', async () => {
    const { env, v, item } = await garage();
    unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-05', doneKm: 17000 }));
    unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-05', doneKm: 17000 }));
    const open = await openReminders(env.db, v);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ due_on: '2027-10-05', due_km: 32000 });
    await expectOneOpenPerItem(env.db, v);
  });
});

describe('completeDeadline: serie di calendario e data fissa', () => {
  it('bollo: la serie avanza dalla scadenza e non scivola col ritardo (V10: 10/08 e 02/10 -> 2027-08-31)', async () => {
    for (const doneOn of ['2026-08-10', '2026-10-02']) {
      const { env, v, item } = await garage([BOLLO]);
      const r = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn }));
      const row = (await rows(env.db, 'SELECT fixed_due_on FROM maintenance_items WHERE id = ?', [item]))[0]!;
      expect(row['fixed_due_on']).toBe('2027-08-31');
      expect((await rows(env.db, 'SELECT prev_fixed_due_on FROM maintenance_completions'))[0]).toEqual({ prev_fixed_due_on: '2026-08-31' });
      expect((await openReminders(env.db, v))[0]).toMatchObject({ due_on: '2027-08-31', id: r.nextReminderId });
      expect(r.closedReminderId).not.toBeNull();
    }
  });

  it('bollo pagato con oltre 16 mesi di ritardo (2028-01-10): la prossima e 2028-08-31', async () => {
    const env = await makeEnv('2028-01-10T08:00:00.000Z');
    const v = await addVehicle(env);
    const item = await addItem(env, v, BOLLO);
    await reconcileVehicle(env.deps, v);
    unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2028-01-10' }));
    expect((await rows(env.db, 'SELECT fixed_due_on FROM maintenance_items'))[0]).toEqual({ fixed_due_on: '2028-08-31' });
  });

  it('data fissa (bombola): dopo il Fatto la data si azzera e la voce torna Da configurare, senza promemoria', async () => {
    const { env, v, item } = await garage([BOMBOLA]);
    expect(await openReminders(env.db, v)).toHaveLength(1);
    const r = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-07' }));
    expect(r.nextReminderId).toBeNull();
    expect(r.next).toMatchObject({ state: 'unknown', effectiveDueOn: null });
    expect(r.next!.reasons).toContain('NO_FIXED_DATE');
    expect((await rows(env.db, 'SELECT fixed_due_on FROM maintenance_items'))[0]).toEqual({ fixed_due_on: null });
    expect((await rows(env.db, 'SELECT prev_fixed_due_on FROM maintenance_completions'))[0]).toEqual({ prev_fixed_due_on: '2026-10-20' });
    expect(await openReminders(env.db, v)).toEqual([]);
  });
});

describe('completeDeadline: promemoria manuali', () => {
  it('senza ricorrenza: passa a done', async () => {
    const { env, v } = await garage([]);
    const m = await insertRow(env.db, 'reminders', reminderRow(v, { title: 'Portare l auto a lavare', due_on: '2026-10-10' }));
    const r = unwrap(await completeDeadline(env.deps, { reminderId: m, doneOn: '2026-10-08' }));
    expect(r).toMatchObject({ kind: 'manual', completionId: null, closedReminderId: m, nextReminderId: null, next: null });
    expect((await rows(env.db, 'SELECT status, completed_on FROM reminders WHERE id = ?', [m]))[0]).toEqual({ status: 'done', completed_on: '2026-10-08' });
  });

  it('ricorrente mensile ancorata all origine (31 gen): in ritardo di tre mesi salta le occorrenze perse, senza deriva a 28', async () => {
    const { env, v } = await garage([]);
    const m = await insertRow(
      env.db,
      'reminders',
      reminderRow(v, { title: 'Pulizia filtro', due_on: '2026-07-31', repeat_every: 1, repeat_unit: 'month', repeat_origin_on: '2026-01-31', due_km: 20000, due_time: '18:00' }),
    );
    const r = unwrap(await completeDeadline(env.deps, { reminderId: m, doneOn: '2026-10-08' }));
    const next = (await rows(env.db, 'SELECT * FROM reminders WHERE id = ?', [r.nextReminderId as string]))[0]!;
    expect(next).toMatchObject({
      origin: 'manual',
      title: 'Pulizia filtro',
      due_on: '2026-10-31',
      due_time: '18:00',
      due_km: null, // la ricorrenza e a data: i km valgono solo per la prima occorrenza
      repeat_every: 1,
      repeat_unit: 'month',
      repeat_origin_on: '2026-01-31',
      status: 'open',
    });
    expect((await rows(env.db, 'SELECT status FROM reminders WHERE id = ?', [m]))[0]).toEqual({ status: 'done' });
  });
});

describe('undoCompletion: annulla ESATTAMENTE', () => {
  it('Fatto con km e Annulla: stesso stato visibile di prima (voce, completamenti, km, promemoria riaperto)', async () => {
    const { env, v, item } = await garage();
    const before = await visible(env);
    const r = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-05', doneKm: 17000 }));
    expect(await visible(env)).not.toEqual(before);
    env.events.length = 0;

    const u = unwrap(await undoCompletion(env.deps, r.completionId as string));
    expect(u).toMatchObject({ itemId: item, reopenedReminderId: r.closedReminderId, removedReadingId: r.odometerReadingId });
    expect(await visible(env)).toEqual(before);
    expect((await openReminders(env.db, v)).map((x) => x['id'])).toEqual([r.closedReminderId]);
    expect(env.events).toEqual([
      { type: 'data-changed', scope: 'reminders', vehicleId: v },
      { type: 'data-changed', scope: 'odometer', vehicleId: v },
    ]);
    await expectOneOpenPerItem(env.db, v);
    // soft delete, non cancellazione: il completamento e la lettura restano nel cestino
    expect(await rows(env.db, 'SELECT id FROM maintenance_completions WHERE deleted_at IS NOT NULL')).toHaveLength(1);
    expect(await rows(env.db, 'SELECT id FROM odometer_readings WHERE deleted_at IS NOT NULL')).toHaveLength(1);
  });

  it('serie di calendario: ripristina esattamente fixed_due_on (prev_fixed_due_on) e riapre il promemoria', async () => {
    const { env, v, item } = await garage([BOLLO]);
    const before = await visible(env);
    const r = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-02' }));
    unwrap(await undoCompletion(env.deps, r.completionId as string));
    expect(await visible(env)).toEqual(before);
    expect((await openReminders(env.db, v))[0]).toMatchObject({ due_on: '2026-08-31', id: r.closedReminderId });
  });

  it('data fissa: ripristina la data azzerata dal Fatto', async () => {
    const { env, v, item } = await garage([BOMBOLA]);
    const before = await visible(env);
    const r = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-07' }));
    unwrap(await undoCompletion(env.deps, r.completionId as string));
    expect(await visible(env)).toEqual(before);
    expect(await openReminders(env.db, v)).toHaveLength(1);
  });

  it('se l utente ha impostato una nuova data dopo il Fatto, l Annulla non la sovrascrive', async () => {
    const { env, item } = await garage([BOMBOLA]);
    const r = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-07' }));
    await env.db.run(`UPDATE maintenance_items SET fixed_due_on = '2031-06-30' WHERE id = ?`, [item]);
    unwrap(await undoCompletion(env.deps, r.completionId as string));
    expect((await rows(env.db, 'SELECT fixed_due_on FROM maintenance_items'))[0]).toEqual({ fixed_due_on: '2031-06-30' });
  });

  it('non rimuove una lettura km che esisteva gia, e non si annulla due volte', async () => {
    const { env, item } = await garage();
    const r = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-06-01', doneKm: 15000 }));
    const u = unwrap(await undoCompletion(env.deps, r.completionId as string));
    expect(u.removedReadingId).toBeNull();
    expect(await rows(env.db, 'SELECT id FROM odometer_readings WHERE deleted_at IS NULL')).toHaveLength(2);
    expect(errorOf(await undoCompletion(env.deps, r.completionId as string)).code).toBe('ITEM_NOT_FOUND');
    expect(errorOf(await undoCompletion(env.deps, '01TESTID99999999999999999X')).code).toBe('ITEM_NOT_FOUND');
  });

  it('con un Fatto successivo si annulla solo il completamento indicato (storico), senza riaprire i promemoria', async () => {
    const { env, v, item } = await garage();
    const first = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-01', doneKm: 16500 }));
    env.clock.set('2026-10-08T09:00:00.000Z');
    const second = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-07', doneKm: 17000 }));
    const u = unwrap(await undoCompletion(env.deps, first.completionId as string));
    expect(u.reopenedReminderId).toBeNull();
    const open = await openReminders(env.db, v);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ id: second.nextReminderId, due_km: 32000 }); // la base resta il secondo Fatto
    expect(await rows(env.db, 'SELECT id FROM maintenance_completions WHERE deleted_at IS NULL')).toHaveLength(1);
    // annullare anche il secondo: si torna alla base iniziale
    unwrap(await undoCompletion(env.deps, second.completionId as string));
    expect((await openReminders(env.db, v))[0]).toMatchObject({ due_on: '2027-03-01', due_km: 27000 });
    await expectOneOpenPerItem(env.db, v);
  });

  it('una voce senza promemoria prima del Fatto: l Annulla toglie il promemoria nato dal Fatto', async () => {
    const { env, v, item } = await garage([{ name: 'Filtro', baseline_on: null, baseline_km: null, interval_months: 12, interval_km: null }]);
    expect(await openReminders(env.db, v)).toEqual([]);
    const r = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-05' }));
    expect(await openReminders(env.db, v)).toHaveLength(1);
    const u = unwrap(await undoCompletion(env.deps, r.completionId as string));
    expect(u.reopenedReminderId).toBeNull();
    expect(await openReminders(env.db, v)).toEqual([]);
  });
});

describe('invarianti I1-I5 lungo una sequenza di operazioni', () => {
  it('Fatto, Annulla, Fatto retrodatato, Salta: sempre al massimo un promemoria aperto per voce e riconciliazione idempotente', async () => {
    const { env, v, items } = await garage([OIL, BOLLO, BOMBOLA]);
    const check = async () => {
      await expectOneOpenPerItem(env.db, v);
      const snap = await rows(env.db, 'SELECT * FROM reminders ORDER BY id');
      await reconcileVehicle(env.deps, v);
      expect(await rows(env.db, 'SELECT * FROM reminders ORDER BY id')).toEqual(snap); // I5: gia a regime
    };
    await check();
    const a = unwrap(await completeDeadline(env.deps, { itemId: items[0]!, doneOn: '2026-10-05', doneKm: 17000 }));
    await check();
    unwrap(await undoCompletion(env.deps, a.completionId as string));
    await check();
    unwrap(await completeDeadline(env.deps, { itemId: items[1]!, doneOn: '2026-10-02' }));
    await check();
    unwrap(await completeDeadline(env.deps, { itemId: items[2]!, doneOn: '2026-10-07' }));
    await check();
    unwrap(await completeDeadline(env.deps, { itemId: items[0]!, doneOn: '2026-09-01' }));
    await check();
  });
});
