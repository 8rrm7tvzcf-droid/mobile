// Riconciliazione dei promemoria (SPEC 8.3, data.md 3.9): invarianti I1-I5, idempotenza, cicli saltati, polizze e rate.
import { describe, expect, it } from 'vitest';
import { reconcileAll, reconcileVehicle, updateDeadlineRule } from '@/usecases/deadlines';
import { insertRow, policyRow, reminderRow } from '../../../support/db';
import { addItem, addOdo, addPolicy, addVehicle, expectOneOpenPerItem, makeEnv, openReminders, rows } from './helpers';

const OIL = { name: 'Cambio olio', baseline_on: '2026-03-01', baseline_km: 12000, interval_km: 15000, interval_months: 12 };

async function garage() {
  const env = await makeEnv();
  const v = await addVehicle(env, { nickname: 'Panda', first_registration_on: '2020-03-15' });
  await addOdo(env, v, '2026-01-01', 10000);
  await addOdo(env, v, '2026-06-01', 15000);
  const item = await addItem(env, v, OIL);
  return { env, v, item };
}

/** Le righe dei promemoria senza gli istanti di scrittura e gli id (per confrontare stato ricostruito e stato originale). */
const normalised = (r: Record<string, unknown>[]) =>
  r.map(({ id: _id, created_at: _c, updated_at: _u, computed_at: _k, ...rest }) => rest);

describe('reconcileVehicle', () => {
  it('crea un solo promemoria aperto per la voce, con i valori calcolati dal motore', async () => {
    const { env, v, item } = await garage();
    await reconcileVehicle(env.deps, v);
    const open = await openReminders(env.db, v);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      origin: 'generated',
      item_id: item,
      title: 'Cambio olio',
      category: 'maintenance',
      due_on: '2027-03-01',
      due_km: 27000,
      status: 'open',
    });
    expect(open[0]!['effective_due_on']).not.toBeNull();
    expect(open[0]!['computed_at']).toBe('2026-10-08T07:30:00.000Z');
  });

  it('I5 idempotente: la seconda esecuzione non cambia nessuna riga (nemmeno updated_at e computed_at) e non emette eventi', async () => {
    const { env, v } = await garage();
    await reconcileVehicle(env.deps, v);
    const first = await rows(env.db, 'SELECT * FROM reminders ORDER BY id');
    const eventsAfterFirst = env.events.length;
    env.clock.set('2026-10-08T07:45:00.000Z');
    await reconcileVehicle(env.deps, v);
    await reconcileAll(env.deps);
    expect(await rows(env.db, 'SELECT * FROM reminders ORDER BY id')).toEqual(first);
    expect(env.events.length).toBe(eventsAfterFirst);
    expect(eventsAfterFirst).toBe(1); // un solo evento, alla prima esecuzione che ha cambiato qualcosa
    expect(env.events[0]).toEqual({ type: 'data-changed', scope: 'reminders', vehicleId: v });
  });

  it('I1: il DB rifiuta un secondo promemoria aperto per la stessa voce e la riconciliazione non ne crea', async () => {
    const { env, v, item } = await garage();
    await reconcileVehicle(env.deps, v);
    await expect(
      insertRow(env.db, 'reminders', reminderRow(v, { origin: 'generated', item_id: item, title: 'Doppione', due_on: '2027-01-01' })),
    ).rejects.toThrow(/UNIQUE/);
    await reconcileVehicle(env.deps, v);
    await expectOneOpenPerItem(env.db, v);
  });

  it('I2: il motore non modifica i dati dell utente (km, voci, completamenti, polizze); dei manuali tocca solo la cache', async () => {
    const { env, v } = await garage();
    const manual = await insertRow(
      env.db,
      'reminders',
      reminderRow(v, { title: 'Controllo gomme', notes: 'nota mia', due_on: null, due_km: 16000, soon_days: 12, soon_km: 700, snoozed_until: '2026-10-20T07:00:00.000Z' }),
    );
    await addPolicy(env, v, { end_on: '2027-01-01' });
    const userTables = ['vehicles', 'maintenance_items', 'maintenance_completions', 'odometer_readings', 'insurance_policies'];
    const before = await Promise.all(userTables.map((t) => rows(env.db, `SELECT * FROM ${t} ORDER BY id`)));
    const manualBefore = (await rows(env.db, 'SELECT * FROM reminders WHERE id = ?', [manual]))[0]!;

    await reconcileVehicle(env.deps, v);

    const after = await Promise.all(userTables.map((t) => rows(env.db, `SELECT * FROM ${t} ORDER BY id`)));
    expect(after).toEqual(before);
    const manualAfter = (await rows(env.db, 'SELECT * FROM reminders WHERE id = ?', [manual]))[0]!;
    for (const k of ['title', 'notes', 'due_on', 'due_km', 'soon_days', 'soon_km', 'snoozed_until', 'status', 'origin', 'category']) {
      expect(manualAfter[k]).toEqual(manualBefore[k]);
    }
    expect(manualAfter['effective_due_on']).not.toBeNull(); // la cache si e riempita
    expect(manualAfter['due_trigger']).not.toBeNull();
  });

  it('I2: lo snooze e le note di un promemoria generato sopravvivono ai ricalcoli', async () => {
    const { env, v } = await garage();
    await reconcileVehicle(env.deps, v);
    const [r] = await openReminders(env.db, v);
    await env.db.run(
      `UPDATE reminders SET snoozed_until = '2026-10-20T07:00:00.000Z', snooze_until_km = 16000, notes = 'ricordami' WHERE id = ?`,
      [r!['id'] as string],
    );
    await addOdo(env, v, '2026-10-05', 17000); // cambia la previsione: la cache si aggiorna
    await reconcileVehicle(env.deps, v);
    const [after] = await openReminders(env.db, v);
    expect(after!['id']).toBe(r!['id']);
    expect(after).toMatchObject({ snoozed_until: '2026-10-20T07:00:00.000Z', snooze_until_km: 16000, notes: 'ricordami' });
  });

  it('I3: senza ingredienti non inventa nulla (nessun promemoria) e dice perche', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env, {});
    await addItem(env, v, { name: 'Senza base', baseline_on: null, baseline_km: null });
    await addItem(env, v, { name: 'Solo km, senza km di base', interval_km: 10000, interval_months: null, baseline_on: '2026-05-01', baseline_km: null });
    await addItem(env, v, { name: 'Bollo senza data', schedule_type: 'interval_calendar', interval_km: null, interval_months: 12, fixed_due_on: null });
    await reconcileVehicle(env.deps, v);
    expect(await openReminders(env.db, v)).toEqual([]);
    const items = await rows(env.db, 'SELECT id, name FROM maintenance_items ORDER BY name');
    const reasons: Record<string, string[]> = {};
    for (const it of items) {
      const r = await updateDeadlineRule(env.deps, it['id'] as string, {});
      if (r.ok) {
        expect(r.value.state).toBe('unknown');
        reasons[it['name'] as string] = r.value.reasons;
      }
    }
    expect(reasons['Senza base']).toContain('NO_LAST_DONE');
    expect(reasons['Solo km, senza km di base']).toContain('NO_LAST_KM');
    expect(reasons['Bollo senza data']).toContain('NO_FIXED_DATE');
    expect(Object.keys(reasons)).toHaveLength(3);
  });

  it('I3: l ingrediente mancante diventa un motivo, la parte nota si usa (solo mesi: scadenza a tempo, nessun km inventato)', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env);
    await addItem(env, v, { name: 'Olio senza km', baseline_on: '2026-05-01', baseline_km: null, interval_km: 15000, interval_months: 12 });
    await reconcileVehicle(env.deps, v);
    const [r] = await openReminders(env.db, v);
    expect(r).toMatchObject({ due_on: '2027-05-01', due_km: null });
  });

  it('I5: la cache si butta e si ricostruisce: stessi valori (a parte id e istanti)', async () => {
    const { env, v } = await garage();
    await insertRow(env.db, 'reminders', reminderRow(v, { title: 'Manuale', due_on: '2026-12-01' }));
    await addPolicy(env, v, { end_on: '2027-01-01' });
    await reconcileVehicle(env.deps, v);
    const original = normalised(await rows(env.db, `SELECT * FROM reminders WHERE origin = 'generated' ORDER BY title`));
    expect(original.length).toBeGreaterThanOrEqual(2);

    await env.db.run(`DELETE FROM reminders WHERE origin = 'generated'`);
    await reconcileVehicle(env.deps, v);
    expect(normalised(await rows(env.db, `SELECT * FROM reminders WHERE origin = 'generated' ORDER BY title`))).toEqual(original);

    // cache sporcata: viene corretta in place, senza duplicati
    await env.db.run(
      `UPDATE reminders SET due_on = '1999-01-01', effective_due_on = NULL, due_trigger = NULL WHERE origin = 'generated' AND item_id IS NOT NULL`,
    );
    await reconcileVehicle(env.deps, v);
    expect(normalised(await rows(env.db, `SELECT * FROM reminders WHERE origin = 'generated' ORDER BY title`))).toEqual(original);
    await expectOneOpenPerItem(env.db, v);
  });

  it('un promemoria generato orfano (voce disattivata) viene rimosso con soft delete e torna se la voce si riattiva', async () => {
    const { env, v, item } = await garage();
    await reconcileVehicle(env.deps, v);
    await env.db.run('UPDATE maintenance_items SET is_active = 0 WHERE id = ?', [item]);
    await reconcileVehicle(env.deps, v);
    expect(await openReminders(env.db, v)).toEqual([]);
    const gone = await rows(env.db, 'SELECT deleted_at FROM reminders WHERE item_id = ?', [item]);
    expect(gone).toHaveLength(1);
    expect(gone[0]!['deleted_at']).not.toBeNull(); // soft delete, non cancellazione
    await env.db.run('UPDATE maintenance_items SET is_active = 1 WHERE id = ?', [item]);
    await reconcileVehicle(env.deps, v);
    expect(await openReminders(env.db, v)).toHaveLength(1);
  });

  it('un ciclo SALTATO non rinasce; rinasce se cambia la regola', async () => {
    const { env, v, item } = await garage();
    await reconcileVehicle(env.deps, v);
    const [r] = await openReminders(env.db, v);
    await env.db.run(`UPDATE reminders SET status = 'skipped', completed_on = '2026-10-08' WHERE id = ?`, [r!['id'] as string]);
    await reconcileVehicle(env.deps, v);
    expect(await openReminders(env.db, v)).toEqual([]);
    await env.db.run('UPDATE maintenance_items SET interval_months = 6 WHERE id = ?', [item]);
    await reconcileVehicle(env.deps, v);
    expect(await openReminders(env.db, v)).toHaveLength(1);
  });

  it('polizze e rate: promemoria "Scadenza RCA ..." e "Rata n/N"; la rata pagata si chiude da sola', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env);
    const p = await insertRow(env.db, 'insurance_policies', policyRow(v, { company: 'Acme', end_on: '2027-01-01' }));
    const mk = (n: number, due: string, paid: string | null) =>
      insertRow(env.db, 'insurance_payments', {
        id: `01TESTPAY${String(n).padStart(17, '0')}`,
        policy_id: p,
        installment_no: n,
        due_on: due,
        amount_cents: 20000,
        paid_on: paid,
      });
    await mk(1, '2026-01-01', '2026-01-02');
    const second = await mk(2, '2026-11-01', null);
    await reconcileVehicle(env.deps, v);
    const titles = (await openReminders(env.db, v)).map((r) => r['title']).sort();
    expect(titles).toEqual(['Rata 2/2', 'Scadenza RCA Acme']);
    await env.db.run(`UPDATE insurance_payments SET paid_on = '2026-10-07' WHERE id = ?`, [second]);
    await reconcileVehicle(env.deps, v);
    expect((await openReminders(env.db, v)).map((r) => r['title'])).toEqual(['Scadenza RCA Acme']);
    const done = await rows(env.db, `SELECT status, completed_on FROM reminders WHERE payment_id = ?`, [second]);
    expect(done).toEqual([{ status: 'done', completed_on: '2026-10-07' }]);
  });

  it('veicolo non attivo, nel cestino o inesistente: nessuna modifica e nessun errore', async () => {
    const env = await makeEnv();
    const archived = await addVehicle(env, { status: 'archived' });
    await addItem(env, archived, OIL);
    const trashed = await addVehicle(env, { deleted_at: '2026-10-01T00:00:00.000Z' });
    await addItem(env, trashed, OIL);
    await reconcileVehicle(env.deps, archived);
    await reconcileVehicle(env.deps, trashed);
    await reconcileVehicle(env.deps, '01TESTID99999999999999999X');
    await reconcileAll(env.deps);
    expect(await rows(env.db, 'SELECT id FROM reminders')).toEqual([]);
    expect(env.events).toEqual([]);
  });

  it('reconcileAll riconcilia tutti i veicoli attivi', async () => {
    const env = await makeEnv();
    const a = await addVehicle(env);
    const b = await addVehicle(env, { make: 'Altra', model: 'Auto' });
    await addItem(env, a, OIL);
    await addItem(env, b, OIL);
    await reconcileAll(env.deps);
    expect(await openReminders(env.db, a)).toHaveLength(1);
    expect(await openReminders(env.db, b)).toHaveLength(1);
    expect(env.events.map((e) => (e.type === 'data-changed' ? e.vehicleId : null)).sort()).toEqual([a, b].sort());
  });

  it('la cache avanza con il tempo senza nuove letture e il promemoria resta lo stesso', async () => {
    const { env, v } = await garage();
    await reconcileVehicle(env.deps, v);
    const [early] = await openReminders(env.db, v);
    env.clock.set('2027-02-01T07:30:00.000Z'); // quattro mesi dopo, nessuna lettura nuova
    await reconcileVehicle(env.deps, v);
    const [later] = await openReminders(env.db, v);
    expect(later!['id']).toBe(early!['id']);
  });
});
