// Viste (v_costs, v_vehicle_odometer, v_item_last_done) e query chiave di data.md 1.6.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  fuelLogRow,
  insertRow,
  itemRow,
  nextId,
  odometerRow,
  openBootedDb,
  policyRow,
  reminderRow,
  serviceRow,
  vehicleRow,
  type TestDb,
} from '../../support/db';

const NOW = '2026-10-08T07:30:00.000Z';
const DELETED = '2026-10-01T00:00:00.000Z';
let t: TestDb;
beforeEach(async () => {
  t = await openBootedDb();
});

describe('v_costs: i costi non si duplicano', () => {
  it('unisce interventi, rifornimenti, spese e rate PAGATE; esclude cancellati e rate non pagate', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const other = await insertRow(db, 'vehicles', vehicleRow());
    const sr = await insertRow(db, 'service_records', serviceRow(v, { service_on: '2026-03-01', total_cents: 21000 }));
    await insertRow(db, 'service_lines', {
      id: nextId(), service_record_id: sr, line_type: 'part', description: 'Filtro', amount_cents: 21000, created_at: NOW, updated_at: NOW,
    }); // il dettaglio NON si somma al totale
    await insertRow(db, 'service_records', serviceRow(v, { total_cents: 9999, deleted_at: DELETED }));
    await insertRow(db, 'fuel_logs', fuelLogRow(v, { filled_on: '2026-09-01', total_cents: 5500 }));
    await insertRow(db, 'fuel_logs', fuelLogRow(v, { filled_on: '2025-12-15', total_cents: 6000 }));
    await insertRow(db, 'fuel_logs', fuelLogRow(v, { total_cents: 1, deleted_at: DELETED }));
    await insertRow(db, 'expenses', {
      id: nextId(), vehicle_id: v, spent_on: '2026-04-10', category_id: 'sys_parking', amount_cents: 1200, created_at: NOW, updated_at: NOW,
    });
    const pol = await insertRow(db, 'insurance_policies', policyRow(v));
    const pay = (n: number, o: Record<string, string | number | null>) => ({
      id: nextId(), policy_id: pol, installment_no: n, due_on: '2026-01-01', amount_cents: 20000, created_at: NOW, updated_at: NOW, ...o,
    });
    await insertRow(db, 'insurance_payments', pay(1, { paid_on: '2026-01-05' }));
    await insertRow(db, 'insurance_payments', pay(2, {})); // non pagata: fuori
    await insertRow(db, 'insurance_payments', pay(3, { paid_on: '2026-02-01', deleted_at: DELETED })); // cancellata: fuori
    // un altro veicolo non si mescola
    await insertRow(db, 'fuel_logs', fuelLogRow(other, { total_cents: 77777 }));

    const rows = await db.all<{ anno: string; source: string; cents: number }>(
      `SELECT substr(on_date,1,4) AS anno, source, SUM(cents) AS cents
       FROM v_costs WHERE vehicle_id = ? GROUP BY anno, source ORDER BY anno DESC, source`,
      [v],
    );
    expect(rows).toEqual([
      { anno: '2026', source: 'expense', cents: 1200 },
      { anno: '2026', source: 'fuel', cents: 5500 },
      { anno: '2026', source: 'insurance', cents: 20000 },
      { anno: '2026', source: 'service', cents: 21000 },
      { anno: '2025', source: 'fuel', cents: 6000 },
    ]);
    const total = await db.get<{ total: number }>('SELECT SUM(cents) AS total FROM v_costs WHERE vehicle_id = ?', [v]);
    expect(total?.total).toBe(1200 + 5500 + 20000 + 21000 + 6000);
  });

  it("una polizza cancellata (soft delete) toglie dai costi anche le sue rate pagate", async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const pol = await insertRow(db, 'insurance_policies', policyRow(v));
    await insertRow(db, 'insurance_payments', {
      id: nextId(), policy_id: pol, installment_no: 1, due_on: '2026-01-01', amount_cents: 20000, paid_on: '2026-01-05',
      created_at: NOW, updated_at: NOW,
    });
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM v_costs WHERE vehicle_id = ?', [v]))?.n).toBe(1);
    await db.run('UPDATE insurance_policies SET deleted_at = ? WHERE id = ?', [DELETED, pol]);
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM v_costs WHERE vehicle_id = ?', [v]))?.n).toBe(0);
  });
});

describe('v_vehicle_odometer: km attuali', () => {
  it('prende il giorno piu recente tra le letture valide e, a pari giorno, il km piu alto', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-01-01', 10000));
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-06-01', 14990));
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-06-01', 15000));
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-07-01', 99999, { status: 'ignored' }));
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-08-01', 99999, { deleted_at: DELETED }));
    expect(await db.get('SELECT km, as_of FROM v_vehicle_odometer WHERE vehicle_id = ?', [v])).toEqual({ km: 15000, as_of: '2026-06-01' });
  });

  it("nessuna riga se il veicolo non ha letture valide", async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-07-01', 500, { status: 'ignored' }));
    expect(await db.get('SELECT km FROM v_vehicle_odometer WHERE vehicle_id = ?', [v])).toBeUndefined();
  });

  it("input per la media km/giorno: una lettura per giorno, solo valide", async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-01-01', 10000));
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-03-01', 12000));
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-03-01', 12010));
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-04-01', 5, { status: 'ignored' }));
    const rows = await db.all(
      `SELECT read_on, MAX(km) AS km FROM odometer_readings
       WHERE vehicle_id = ? AND status = 'valid' AND deleted_at IS NULL GROUP BY read_on ORDER BY read_on`,
      [v],
    );
    expect(rows).toEqual([
      { read_on: '2026-01-01', km: 10000 },
      { read_on: '2026-03-01', km: 12010 },
    ]);
  });
});

describe('v_item_last_done: ultimo fatto di una regola', () => {
  it("senza completamenti vale la base (baseline); con completamenti vale l'ultimo non annullato", async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const withBaseline = await insertRow(db, 'maintenance_items', itemRow(v, { baseline_on: '2025-01-15', baseline_km: 30000 }));
    const neverDone = await insertRow(db, 'maintenance_items', itemRow(v, { name: 'Mai fatto' }));
    const done = await insertRow(db, 'maintenance_items', itemRow(v, { name: 'Fatto', baseline_on: '2024-01-01', baseline_km: 1000 }));
    const deletedItem = await insertRow(db, 'maintenance_items', itemRow(v, { name: 'Cancellata', deleted_at: DELETED }));
    const comp = (o: Record<string, string | number | null>) => ({
      id: nextId(), item_id: done, source: 'manual', created_at: NOW, updated_at: NOW, ...o,
    });
    await insertRow(db, 'maintenance_completions', comp({ done_on: '2025-03-01', done_km: 40000 }));
    await insertRow(db, 'maintenance_completions', comp({ done_on: '2026-03-01', done_km: 52000 }));
    await insertRow(db, 'maintenance_completions', comp({ done_on: '2026-09-01', done_km: 60000, deleted_at: DELETED })); // annullata

    const last = async (id: string) =>
      db.get('SELECT last_done_on, last_done_km FROM v_item_last_done WHERE item_id = ?', [id]);
    expect(await last(withBaseline)).toEqual({ last_done_on: '2025-01-15', last_done_km: 30000 });
    expect(await last(neverDone)).toEqual({ last_done_on: null, last_done_km: null });
    expect(await last(done)).toEqual({ last_done_on: '2026-03-01', last_done_km: 52000 });
    expect(await last(deletedItem)).toBeUndefined();

    // input del motore: regole + ultimo fatto (query 1.6)
    const input = await db.all<{ id: string; last_done_on: string | null }>(
      `SELECT i.id, d.last_done_on FROM maintenance_items i JOIN v_item_last_done d ON d.item_id = i.id
       WHERE i.vehicle_id = ? AND i.is_active = 1 AND i.deleted_at IS NULL ORDER BY i.sort_order, i.id`,
      [v],
    );
    expect(input).toHaveLength(3);
  });

  it('a pari data il completamento piu recente (created_at) vince', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const item = await insertRow(db, 'maintenance_items', itemRow(v));
    const comp = (o: Record<string, string | number | null>) => ({
      id: nextId(), item_id: item, done_on: '2026-03-01', source: 'manual', updated_at: NOW, ...o,
    });
    await insertRow(db, 'maintenance_completions', comp({ done_km: 100, created_at: '2026-03-01T10:00:00.000Z' }));
    await insertRow(db, 'maintenance_completions', comp({ done_km: 200, created_at: '2026-03-01T11:00:00.000Z' }));
    expect(await db.get('SELECT last_done_km FROM v_item_last_done WHERE item_id = ?', [item])).toEqual({ last_done_km: 200 });
  });
});

describe('query chiave', () => {
  it('Home "Da fare": promemoria aperti, non rimandati, di veicoli attivi, ordinati per scadenza', async () => {
    const { db } = t;
    const active = await insertRow(db, 'vehicles', vehicleRow({ nickname: 'Panda' }));
    const sold = await insertRow(db, 'vehicles', vehicleRow({ status: 'sold' }));
    const mk = (v: string, title: string, due: string | null, o: Record<string, string | number | null> = {}) =>
      reminderRow(v, { title, due_on: due, due_km: due === null ? 90000 : null, effective_due_on: due, ...o });
    await insertRow(db, 'reminders', mk(active, 'C tardi', '2026-12-31'));
    await insertRow(db, 'reminders', mk(active, 'A presto', '2026-10-20'));
    await insertRow(db, 'reminders', mk(active, 'Senza data', null));
    await insertRow(db, 'reminders', mk(active, 'Rimandato', '2026-10-09', { snoozed_until: '2026-10-20T07:00:00.000Z' }));
    await insertRow(db, 'reminders', mk(active, 'Rimandato scaduto', '2026-10-10', { snoozed_until: '2026-10-07T07:00:00.000Z' }));
    await insertRow(db, 'reminders', mk(active, 'Fatto', '2026-10-01', { status: 'done', completed_on: '2026-10-02' }));
    await insertRow(db, 'reminders', mk(active, 'Cancellato', '2026-10-01', { deleted_at: DELETED }));
    await insertRow(db, 'reminders', mk(sold, 'Auto venduta', '2026-10-01'));

    const sql = `SELECT r.title, v.nickname FROM reminders r JOIN vehicles v ON v.id = r.vehicle_id
      WHERE r.status = 'open' AND r.deleted_at IS NULL AND v.deleted_at IS NULL AND v.status = 'active'
        AND (r.snoozed_until IS NULL OR r.snoozed_until <= :now)
      ORDER BY r.effective_due_on IS NULL, r.effective_due_on LIMIT 50`.replace(':now', '?');
    const rows = await db.all<{ title: string }>(sql, [NOW]);
    expect(rows.map((r) => r.title)).toEqual(['Rimandato scaduto', 'A presto', 'C tardi', 'Senza data']);

    // nessuna scansione completa dei promemoria: si usa un indice (ix_reminders_vehicle / ix_reminders_due)
    const plan = await db.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, [NOW]);
    const detail = plan.map((p) => p.detail).join(' | ');
    expect(detail).toMatch(/SEARCH r USING INDEX ix_reminders_(vehicle|due)|SCAN r USING INDEX ix_reminders_due/);
    expect(detail).not.toMatch(/SCAN r(\s|$)/);
  });

  it('input dei consumi: rifornimenti del carburante con i km collegati', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const f1 = await insertRow(db, 'fuel_logs', fuelLogRow(v, { filled_on: '2026-08-01' }));
    const f2 = await insertRow(db, 'fuel_logs', fuelLogRow(v, { filled_on: '2026-09-01', is_full: 0 }));
    await insertRow(db, 'fuel_logs', fuelLogRow(v, { filled_on: '2026-09-02', fuel_type: 'lpg' }));
    await insertRow(db, 'fuel_logs', fuelLogRow(v, { filled_on: '2026-09-03', deleted_at: DELETED }));
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-08-01', 1000, { source: 'fuel', fuel_log_id: f1 }));
    const rows = await db.all<{ id: string; km: number | null; is_full: number }>(
      `SELECT f.id, f.filled_on, f.quantity_milli, f.is_full, f.missed_before, o.km
       FROM fuel_logs f LEFT JOIN odometer_readings o ON o.fuel_log_id = f.id AND o.deleted_at IS NULL
       WHERE f.vehicle_id = ? AND f.deleted_at IS NULL AND f.fuel_type = ?
       ORDER BY f.filled_on, f.created_at, f.id`,
      [v, 'petrol'],
    );
    expect(rows.map((r) => [r.id, r.km, r.is_full])).toEqual([
      [f1, 1000, 1],
      [f2, null, 0],
    ]);
  });

  it("olio rabboccato nell'anno (indizio di consumo anomalo)", async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const chk = (o: Record<string, string | number | null>) => ({
      id: nextId(), vehicle_id: v, fluid: 'engine_oil', level: 'topped_up', created_at: NOW, updated_at: NOW, ...o,
    });
    await insertRow(db, 'fluid_checks', chk({ checked_on: '2026-02-01', added_ml: 500 }));
    await insertRow(db, 'fluid_checks', chk({ checked_on: '2026-06-01', added_ml: 700 }));
    await insertRow(db, 'fluid_checks', chk({ checked_on: '2025-06-01', added_ml: 900 }));
    await insertRow(db, 'fluid_checks', chk({ checked_on: '2026-07-01', added_ml: 100, deleted_at: DELETED }));
    await insertRow(db, 'fluid_checks', chk({ checked_on: '2026-08-01', fluid: 'coolant', added_ml: 300 }));
    const sum = await db.get<{ ml: number }>(
      `SELECT COALESCE(SUM(added_ml),0) AS ml FROM fluid_checks
       WHERE vehicle_id = ? AND fluid = 'engine_oil' AND checked_on BETWEEN ? AND ? AND deleted_at IS NULL`,
      [v, '2026-01-01', '2026-12-31'],
    );
    expect(sum?.ml).toBe(1200);
  });
});
