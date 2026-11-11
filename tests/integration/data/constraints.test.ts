import { beforeEach, describe, expect, it } from 'vitest';
import {
  isCheckViolation,
  isConstraintError,
  isForeignKeyViolation,
  isOdoNonMonotonic,
  isSimulatorRequiresDemo,
  isUniqueViolation,
} from '@/data/db/errors';
import {
  errorOf,
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
type Extra = Record<string, string | number | null>;

let t: TestDb;
beforeEach(async () => {
  t = await openBootedDb();
});

async function reject(fn: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  const msg = await errorOf(fn);
  expect(msg, 'doveva lanciare').not.toBeNull();
  expect(msg).toMatch(pattern);
}

describe('validazione dei campi (CHECK, STRICT, indici unici)', () => {
  it('targa: spazio e minuscole rifiutati, duplicata rifiutata ma riusabile dopo il soft delete', async () => {
    const { db } = t;
    await reject(() => insertRow(db, 'vehicles', vehicleRow({ plate: 'AB 123CD' })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'vehicles', vehicleRow({ plate: 'ab123cd' })), /CHECK constraint failed/);
    const id = await insertRow(db, 'vehicles', vehicleRow({ plate: 'AB123CD' }));
    const dup = await errorOf(() => insertRow(db, 'vehicles', vehicleRow({ plate: 'AB123CD' })));
    expect(dup).toMatch(/UNIQUE constraint failed/);
    expect(isUniqueViolation(new Error(dup ?? ''), 'plate')).toBe(true);
    await db.run(`UPDATE vehicles SET deleted_at = '2026-10-08T07:30:00.000Z' WHERE id = ?`, [id]);
    await insertRow(db, 'vehicles', vehicleRow({ plate: 'AB123CD' })); // riusabile
  });

  it('VIN minuscolo rifiutato; VIN duplicato rifiutato', async () => {
    const { db } = t;
    await reject(() => insertRow(db, 'vehicles', vehicleRow({ vin: 'zfa1234567890abcd' })), /CHECK constraint failed/);
    await insertRow(db, 'vehicles', vehicleRow({ vin: 'ZFA12345678901234' }));
    await reject(() => insertRow(db, 'vehicles', vehicleRow({ vin: 'ZFA12345678901234' })), /UNIQUE constraint failed/);
  });

  it('date di calendario: 2026-02-30 e 2026-10-7 rifiutate', async () => {
    const { db } = t;
    await reject(() => insertRow(db, 'vehicles', vehicleRow({ first_registration_on: '2026-02-30' })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'vehicles', vehicleRow({ first_registration_on: '2026-10-7' })), /CHECK constraint failed/);
    await insertRow(db, 'vehicles', vehicleRow({ first_registration_on: '2024-02-29' })); // bisestile valida
  });

  it("istanti: senza millisecondi o senza 'Z' rifiutati", async () => {
    const { db } = t;
    await reject(() => insertRow(db, 'vehicles', vehicleRow({ created_at: '2026-10-08T07:30:00Z' })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'vehicles', vehicleRow({ created_at: '2026-10-08 07:30:00.000' })), /CHECK constraint failed/);
  });

  it('id non ULID (lunghezza diversa da 26) rifiutato', async () => {
    await reject(() => insertRow(t.db, 'vehicles', vehicleRow({ id: 'corto' })), /CHECK constraint failed/);
  });

  it('STRICT: testo in una colonna INTEGER rifiutato', async () => {
    await reject(() => insertRow(t.db, 'vehicles', vehicleRow({ model_year: 'abc' })), /cannot store TEXT value in INTEGER column/);
  });

  it("veicolo: alimentazione secondaria uguale alla primaria, campi di vendita senza stato venduto, vendita prima dell'acquisto", async () => {
    const { db } = t;
    await reject(() => insertRow(db, 'vehicles', vehicleRow({ fuel_secondary: 'petrol' })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'vehicles', vehicleRow({ sold_on: '2026-01-01' })), /CHECK constraint failed/);
    await reject(
      () => insertRow(db, 'vehicles', vehicleRow({ status: 'sold', purchase_on: '2026-05-01', sold_on: '2026-01-01' })),
      /CHECK constraint failed/,
    );
    await insertRow(db, 'vehicles', vehicleRow({ status: 'sold', purchase_on: '2020-05-01', sold_on: '2026-01-01', sold_km: 90000 }));
    await insertRow(db, 'vehicles', vehicleRow({ fuel_primary: 'petrol', fuel_secondary: 'lpg' })); // bifuel
  });

  it('i riconoscitori di errore classificano i messaggi di SQLite', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const check = new Error((await errorOf(() => insertRow(db, 'vehicles', vehicleRow({ plate: 'a' })))) ?? '');
    expect(isCheckViolation(check)).toBe(true);
    expect(isConstraintError(check)).toBe(true);
    const fk = new Error((await errorOf(() => insertRow(db, 'fuel_logs', fuelLogRow(nextId())))) ?? '');
    expect(isForeignKeyViolation(fk)).toBe(true);
    expect(isUniqueViolation(fk)).toBe(false);
    expect(v).toHaveLength(26);
  });
});

describe('chilometri: coerenza monotona (trigger ODO_NON_MONOTONIC)', () => {
  it('retrodatazione valida in mezzo; rifiutati i valori fuori sequenza; stesso giorno libero', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-01-01', 10000));
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-06-01', 15000));
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-03-01', 12000)); // in mezzo: ok
    const tooHigh = await errorOf(() => insertRow(db, 'odometer_readings', odometerRow(v, '2026-03-02', 16000)));
    const tooLow = await errorOf(() => insertRow(db, 'odometer_readings', odometerRow(v, '2026-07-01', 14000)));
    expect(tooHigh).toMatch(/ODO_NON_MONOTONIC/);
    expect(tooLow).toMatch(/ODO_NON_MONOTONIC/);
    expect(isOdoNonMonotonic(new Error(tooHigh ?? ''))).toBe(true);
    // stesso giorno: nessun vincolo (anche un valore piu' basso)
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-06-01', 14990));
    // un altro veicolo e' indipendente
    const v2 = await insertRow(db, 'vehicles', vehicleRow());
    await insertRow(db, 'odometer_readings', odometerRow(v2, '2026-06-01', 100));
  });

  it("una lettura 'ignored' o cancellata e' accettata e non pesa sul confronto", async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-01-01', 10000));
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-02-01', 99999, { status: 'ignored' }));
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-03-01', 11000)); // l'ignorata non blocca
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-04-01', 5, { deleted_at: '2026-10-08T07:30:00.000Z' }));
  });

  it("UPDATE che romperebbe la monotonia e' rifiutato; un UPDATE coerente passa", async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-01-01', 10000));
    const mid = await insertRow(db, 'odometer_readings', odometerRow(v, '2026-03-01', 12000));
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-06-01', 15000));
    await reject(() => db.run('UPDATE odometer_readings SET km = 20000 WHERE id = ?', [mid]), /ODO_NON_MONOTONIC/);
    await reject(() => db.run("UPDATE odometer_readings SET read_on = '2026-07-01' WHERE id = ?", [mid]), /ODO_NON_MONOTONIC/);
    await db.run('UPDATE odometer_readings SET km = 13000 WHERE id = ?', [mid]);
    // riabilitare una lettura ignorata che rompe la sequenza e' rifiutato
    const bad = await insertRow(db, 'odometer_readings', odometerRow(v, '2026-04-01', 500, { status: 'ignored' }));
    await reject(() => db.run("UPDATE odometer_readings SET status = 'valid' WHERE id = ?", [bad]), /ODO_NON_MONOTONIC/);
  });

  it("source e riferimento devono coincidere: 'fuel' senza fuel_log_id rifiutato; una sola lettura per rifornimento", async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    await reject(() => insertRow(db, 'odometer_readings', odometerRow(v, '2026-01-01', 1, { source: 'fuel' })), /CHECK constraint failed/);
    const f = await insertRow(db, 'fuel_logs', fuelLogRow(v));
    await reject(() => insertRow(db, 'odometer_readings', odometerRow(v, '2026-01-01', 1, { fuel_log_id: f })), /CHECK constraint failed/);
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-09-01', 1000, { source: 'fuel', fuel_log_id: f }));
    await reject(
      () => insertRow(db, 'odometer_readings', odometerRow(v, '2026-09-01', 1001, { source: 'fuel', fuel_log_id: f })),
      /UNIQUE constraint failed/,
    );
  });

  it('il trigger touch aggiorna updated_at di una lettura corretta (odometer_readings)', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const old = '2020-01-01T00:00:00.000Z';
    const o = await insertRow(db, 'odometer_readings', odometerRow(v, '2026-01-01', 10000, { created_at: old, updated_at: old }));
    await db.run('UPDATE odometer_readings SET km = 10100 WHERE id = ?', [o]);
    const row = await db.get<{ updated_at: string }>('SELECT updated_at FROM odometer_readings WHERE id = ?', [o]);
    expect((row?.updated_at ?? '') > old).toBe(true);
  });
});

describe('trigger touch: updated_at', () => {
  it('si aggiorna da solo se il codice non lo tocca, si preserva se lo imposta il codice (import)', async () => {
    const { db } = t;
    const id = await insertRow(db, 'vehicles', vehicleRow());
    await db.run(`UPDATE vehicles SET nickname = 'Panda' WHERE id = ?`, [id]);
    const touched = await db.get<{ updated_at: string }>('SELECT updated_at FROM vehicles WHERE id = ?', [id]);
    expect(touched?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(touched?.updated_at).not.toBe(NOW);
    await db.run(`UPDATE vehicles SET nickname = 'Pandina', updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`, [id]);
    const kept = await db.get<{ updated_at: string }>('SELECT updated_at FROM vehicles WHERE id = ?', [id]);
    expect(kept?.updated_at).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('promemoria', () => {
  it("uno solo aperto per regola; un nuovo aperto e' consentito dopo il completamento", async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const item = await insertRow(db, 'maintenance_items', itemRow(v));
    const gen = (o: Extra = {}) => reminderRow(v, { origin: 'generated', item_id: item, effective_due_on: '2026-12-01', ...o });
    const first = await insertRow(db, 'reminders', gen());
    await reject(() => insertRow(db, 'reminders', gen()), /UNIQUE constraint failed/);
    await db.run(`UPDATE reminders SET status = 'done', completed_on = '2026-11-01' WHERE id = ?`, [first]);
    await insertRow(db, 'reminders', gen());
  });

  it('origine e sorgente devono combaciare; done senza completed_on rifiutato', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const item = await insertRow(db, 'maintenance_items', itemRow(v));
    await reject(() => insertRow(db, 'reminders', reminderRow(v, { origin: 'generated' })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'reminders', reminderRow(v, { origin: 'manual', item_id: item })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'reminders', reminderRow(v, { status: 'done' })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'reminders', reminderRow(v, { due_on: null })), /CHECK constraint failed/); // serve due_on o due_km
    await insertRow(db, 'reminders', reminderRow(v, { due_on: null, due_km: 150000 }));
  });

  it("regole: 'interval_last_done' richiede un intervallo; 'fixed_date' non puo' averne", async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    await reject(
      () => insertRow(db, 'maintenance_items', itemRow(v, { interval_km: null, interval_months: null })),
      /CHECK constraint failed/,
    );
    await reject(() => insertRow(db, 'maintenance_items', itemRow(v, { schedule_type: 'fixed_date' })), /CHECK constraint failed/);
    await insertRow(
      db,
      'maintenance_items',
      itemRow(v, { schedule_type: 'fixed_date', interval_km: null, interval_months: null, fixed_due_on: '2027-03-31' }),
    );
  });

  it('completamenti: la sorgente service richiede service_record_id (e viceversa)', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const item = await insertRow(db, 'maintenance_items', itemRow(v));
    const sr = await insertRow(db, 'service_records', serviceRow(v));
    const comp = (o: Extra) => ({
      id: nextId(), item_id: item, done_on: '2026-03-01', source: 'manual', created_at: NOW, updated_at: NOW, ...o,
    });
    await reject(() => insertRow(db, 'maintenance_completions', comp({ source: 'service' })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'maintenance_completions', comp({ service_record_id: sr })), /CHECK constraint failed/);
    await insertRow(db, 'maintenance_completions', comp({ source: 'service', service_record_id: sr }));
    // lo stesso intervento non completa due volte la stessa regola
    await reject(() => insertRow(db, 'maintenance_completions', comp({ source: 'service', service_record_id: sr })), /UNIQUE constraint failed/);
  });
});

describe('assicurazioni', () => {
  it('classe di merito 19 e fine <= inizio rifiutate; rata duplicata rifiutata; massimale RCA di 6.070.000 EUR accettato', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    await reject(() => insertRow(db, 'insurance_policies', policyRow(v, { merit_class: 19 })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'insurance_policies', policyRow(v, { end_on: '2026-01-01' })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'insurance_policies', policyRow(v, { end_on: '2025-12-31' })), /CHECK constraint failed/);
    const p = await insertRow(db, 'insurance_policies', policyRow(v, { merit_class: 1 }));
    const pay = (n: number) => ({
      id: nextId(), policy_id: p, installment_no: n, due_on: '2026-01-01', amount_cents: 20000, created_at: NOW, updated_at: NOW,
    });
    await insertRow(db, 'insurance_payments', pay(1));
    await reject(() => insertRow(db, 'insurance_payments', pay(1)), /UNIQUE constraint failed/);
    await reject(() => insertRow(db, 'insurance_payments', pay(13)), /CHECK constraint failed/);
    const cov = (code: string, limit: number) => ({
      id: nextId(), policy_id: p, code, limit_cents: limit, created_at: NOW, updated_at: NOW,
    });
    await insertRow(db, 'insurance_coverages', cov('rca', 607_000_000));
    await reject(() => insertRow(db, 'insurance_coverages', cov('rca', 1)), /UNIQUE constraint failed/);
    await reject(() => insertRow(db, 'insurance_coverages', cov('kasko', -1)), /CHECK constraint failed/);
  });
});

describe('pneumatici', () => {
  const set = (v: string, o: Extra = {}) => ({
    id: nextId(), vehicle_id: v, label: 'Estive', season: 'summer', created_at: NOW, updated_at: NOW, ...o,
  });
  const fit = (setId: string, v: string, o: Extra = {}) => ({
    id: nextId(), tyre_set_id: setId, vehicle_id: v, fitted_on: '2026-04-15', created_at: NOW, updated_at: NOW, ...o,
  });

  it('due set montati insieme rifiutati; montaggio dopo lo smontaggio accettato', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const s1 = await insertRow(db, 'tyre_sets', set(v));
    const s2 = await insertRow(db, 'tyre_sets', set(v, { label: 'Invernali', season: 'winter' }));
    const f1 = await insertRow(db, 'tyre_fitments', fit(s1, v));
    await reject(() => insertRow(db, 'tyre_fitments', fit(s2, v)), /UNIQUE constraint failed/);
    await db.run(`UPDATE tyre_fitments SET removed_on = '2026-11-10' WHERE id = ?`, [f1]);
    await insertRow(db, 'tyre_fitments', fit(s2, v, { fitted_on: '2026-11-10' }));
  });

  it('un set di un altro veicolo e rifiutato (FK composta); smontaggio prima del montaggio rifiutato', async () => {
    const { db } = t;
    const v1 = await insertRow(db, 'vehicles', vehicleRow());
    const v2 = await insertRow(db, 'vehicles', vehicleRow());
    const s1 = await insertRow(db, 'tyre_sets', set(v1));
    await reject(() => insertRow(db, 'tyre_fitments', fit(s1, v2)), /FOREIGN KEY constraint failed/);
    await reject(() => insertRow(db, 'tyre_fitments', fit(s1, v1, { removed_on: '2026-01-01' })), /CHECK constraint failed/);
  });
});

describe('allegati', () => {
  const att = (v: string, o: Extra = {}) => ({
    id: nextId(), owner_vehicle_id: v, kind: 'photo', file_name: 'a.jpg', stored_path: `attachments/${nextId()}.jpg`,
    mime_type: 'image/jpeg', size_bytes: 1000, sha256: 'a'.repeat(64), created_at: NOW, updated_at: NOW, ...o,
  });

  it('un solo genitore; path traversal e sha256 non esadecimale minuscolo rifiutati; una sola copertina', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const sr = await insertRow(db, 'service_records', serviceRow(v));
    const pol = await insertRow(db, 'insurance_policies', policyRow(v));
    await insertRow(db, 'attachments', att(v, { service_record_id: sr }));
    await reject(() => insertRow(db, 'attachments', att(v, { service_record_id: sr, policy_id: pol })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'attachments', att(v, { stored_path: 'attachments/../../etc/passwd' })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'attachments', att(v, { stored_path: '/tmp/x.jpg' })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'attachments', att(v, { sha256: 'A'.repeat(64) })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'attachments', att(v, { sha256: 'a'.repeat(63) })), /CHECK constraint failed/);
    await insertRow(db, 'attachments', att(v, { is_cover: 1 }));
    await reject(() => insertRow(db, 'attachments', att(v, { is_cover: 1 })), /UNIQUE constraint failed/);
    await reject(() => insertRow(db, 'attachments', att(v, { kind: 'receipt', is_cover: 1 })), /CHECK constraint failed/);
  });
});

describe('OBD e DTC', () => {
  const adapter = (o: Extra = {}) => ({
    id: nextId(), name: 'ELM327', transport: 'ble', address: 'AA:BB:CC:DD:EE:FF', created_at: NOW, updated_at: NOW, ...o,
  });
  const session = (v: string, seq: number, o: Extra = {}) => ({
    id: nextId(), seq, vehicle_id: v, kind: 'live', started_at: NOW, created_at: NOW, updated_at: NOW, ...o,
  });
  const dtc = (v: string, o: Extra = {}) => ({
    id: nextId(), vehicle_id: v, code: 'P0420', kind: 'stored', first_seen_at: NOW, last_seen_at: NOW,
    created_at: NOW, updated_at: NOW, ...o,
  });

  it("adattatore duplicato, fine prima dell'inizio, codici DTC non validi e stato cleared senza cleared_at rifiutati", async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    await insertRow(db, 'obd_adapters', adapter());
    await reject(() => insertRow(db, 'obd_adapters', adapter()), /UNIQUE constraint failed/);
    await reject(() => insertRow(db, 'obd_sessions', session(v, 1, { ended_at: '2026-10-08T07:29:59.000Z' })), /CHECK constraint failed/);
    await insertRow(db, 'obd_sessions', session(v, 1, { ended_at: '2026-10-08T07:35:00.000Z' }));
    await reject(() => insertRow(db, 'obd_sessions', session(v, 1)), /UNIQUE constraint failed/); // seq unico
    await insertRow(db, 'dtc_events', dtc(v));
    await reject(() => insertRow(db, 'dtc_events', dtc(v, { code: 'P4200' })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'dtc_events', dtc(v, { code: 'p0420' })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'dtc_events', dtc(v, { state: 'cleared' })), /CHECK constraint failed/);
    await insertRow(db, 'dtc_events', dtc(v, { state: 'cleared', cleared_at: NOW }));
  });

  it('campione di telemetria duplicato rifiutato; il PID e un intero (mode << 8 | pid)', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    await insertRow(db, 'obd_sessions', session(v, 7));
    await db.run('INSERT INTO telemetry_samples (session_seq, pid, t_ms, value) VALUES (7, 268, 0, 850.5)');
    await reject(() => db.run('INSERT INTO telemetry_samples (session_seq, pid, t_ms, value) VALUES (7, 268, 0, 851)'), /UNIQUE constraint failed/);
    await reject(() => db.run('INSERT INTO telemetry_samples (session_seq, pid, t_ms, value) VALUES (99, 268, 0, 1)'), /FOREIGN KEY constraint failed/);
  });

  describe('M-5: adattatore simulator solo su veicoli demo', () => {
    it('sessione con adattatore simulator su veicolo reale rifiutata, su veicolo demo accettata', async () => {
      const { db } = t;
      const real = await insertRow(db, 'vehicles', vehicleRow());
      const demo = await insertRow(db, 'vehicles', vehicleRow({ is_demo: 1 }));
      const sim = await insertRow(db, 'obd_adapters', adapter({ transport: 'simulator', address: 'simulator' }));
      const ble = await insertRow(db, 'obd_adapters', adapter());
      const msg = await errorOf(() => insertRow(db, 'obd_sessions', session(real, 1, { adapter_id: sim })));
      expect(msg).toMatch(/SIMULATOR_REQUIRES_DEMO_VEHICLE/);
      expect(isSimulatorRequiresDemo(new Error(msg ?? ''))).toBe(true);
      await insertRow(db, 'obd_sessions', session(demo, 1, { adapter_id: sim }));
      await insertRow(db, 'obd_sessions', session(real, 2, { adapter_id: ble })); // adattatore reale su auto reale
      await insertRow(db, 'obd_sessions', session(real, 3)); // senza adattatore
      await insertRow(db, 'obd_sessions', session(demo, 4, { adapter_id: ble })); // adattatore reale su demo: consentito
    });

    it('spostare una sessione simulata su un veicolo reale (UPDATE) e rifiutato', async () => {
      const { db } = t;
      const real = await insertRow(db, 'vehicles', vehicleRow());
      const demo = await insertRow(db, 'vehicles', vehicleRow({ is_demo: 1 }));
      const sim = await insertRow(db, 'obd_adapters', adapter({ transport: 'simulator', address: 'simulator' }));
      const s = await insertRow(db, 'obd_sessions', session(demo, 1, { adapter_id: sim }));
      await reject(() => db.run('UPDATE obd_sessions SET vehicle_id = ? WHERE id = ?', [real, s]), /SIMULATOR_REQUIRES_DEMO_VEHICLE/);
      const s2 = await insertRow(db, 'obd_sessions', session(real, 2));
      await reject(() => db.run('UPDATE obd_sessions SET adapter_id = ? WHERE id = ?', [sim, s2]), /SIMULATOR_REQUIRES_DEMO_VEHICLE/);
    });
  });
});

describe('modifiche M-1..M-4 a 0001_init', () => {
  it('M-1: la pressione dei pneumatici e un tipo di controllo livelli, con valore in millibar (500..6000)', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const chk = (o: Extra) => ({
      id: nextId(), vehicle_id: v, checked_on: '2026-10-01', fluid: 'tyre_pressure', level: 'ok', created_at: NOW, updated_at: NOW, ...o,
    });
    await insertRow(db, 'fluid_checks', chk({ value_millibar: 2200 }));
    await insertRow(db, 'fluid_checks', chk({}));
    await insertRow(db, 'fluid_checks', chk({ level: 'topped_up', value_millibar: 2500 }));
    await reject(() => insertRow(db, 'fluid_checks', chk({ value_millibar: 499 })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'fluid_checks', chk({ value_millibar: 6001 })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'fluid_checks', chk({ fluid: 'tyres' })), /CHECK constraint failed/);
    // regola preesistente: i millilitri aggiunti solo con rabbocco
    await reject(() => insertRow(db, 'fluid_checks', chk({ fluid: 'engine_oil', added_ml: 500 })), /CHECK constraint failed/);
    await insertRow(db, 'fluid_checks', chk({ fluid: 'engine_oil', level: 'topped_up', added_ml: 500 }));
  });

  it('M-2: HVO in litri con grado facoltativo; HVO in kg rifiutato; unita coerenti col carburante', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow({ fuel_primary: 'diesel' }));
    const id = await insertRow(db, 'fuel_logs', fuelLogRow(v, { fuel_type: 'hvo', grade: 'HVO100' }));
    expect(await db.get('SELECT fuel_type, grade, quantity_unit FROM fuel_logs WHERE id = ?', [id])).toEqual({
      fuel_type: 'hvo', grade: 'HVO100', quantity_unit: 'L',
    });
    const petrol = await insertRow(db, 'fuel_logs', fuelLogRow(v, { grade: '100 ottani' }));
    expect(await db.get('SELECT grade FROM fuel_logs WHERE id = ?', [petrol])).toEqual({ grade: '100 ottani' });
    await reject(() => insertRow(db, 'fuel_logs', fuelLogRow(v, { fuel_type: 'hvo', quantity_unit: 'kg' })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'fuel_logs', fuelLogRow(v, { fuel_type: 'diesel', quantity_unit: 'kWh' })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'fuel_logs', fuelLogRow(v, { fuel_type: 'cng', quantity_unit: 'L' })), /CHECK constraint failed/);
    await insertRow(db, 'fuel_logs', fuelLogRow(v, { fuel_type: 'cng', quantity_unit: 'kg', quantity_milli: 12000 }));
    await insertRow(db, 'fuel_logs', fuelLogRow(v, { fuel_type: 'electric', quantity_unit: 'kWh' }));
    await reject(() => insertRow(db, 'fuel_logs', fuelLogRow(v, { quantity_milli: 0 })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'fuel_logs', fuelLogRow(v, { grade: 'x'.repeat(41) })), /CHECK constraint failed/);
  });

  it("M-3: l'esito della revisione vale solo se kind = 'inspection'", async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    for (const res of ['regular', 'repeat', 'suspended']) {
      await insertRow(db, 'service_records', serviceRow(v, { kind: 'inspection', title: 'Revisione', inspection_result: res }));
    }
    await insertRow(db, 'service_records', serviceRow(v, { kind: 'inspection', title: 'Revisione' })); // esito facoltativo
    await reject(() => insertRow(db, 'service_records', serviceRow(v, { kind: 'repair', inspection_result: 'regular' })), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'service_records', serviceRow(v, { kind: 'inspection', inspection_result: 'ok' })), /CHECK constraint failed/);
  });

  it('M-4: is_demo vale 0 di default e solo 0/1', async () => {
    const { db } = t;
    const id = await insertRow(db, 'vehicles', vehicleRow());
    expect(await db.get('SELECT is_demo FROM vehicles WHERE id = ?', [id])).toEqual({ is_demo: 0 });
    await insertRow(db, 'vehicles', vehicleRow({ is_demo: 1 }));
    await reject(() => insertRow(db, 'vehicles', vehicleRow({ is_demo: 2 })), /CHECK constraint failed/);
  });
});

describe('altri vincoli del registro', () => {
  it('righe di intervento: fluid_kind solo per line_type fluid; importi interi non negativi', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const sr = await insertRow(db, 'service_records', serviceRow(v));
    const line = (o: Extra) => ({
      id: nextId(), service_record_id: sr, line_type: 'part', description: 'Filtro', created_at: NOW, updated_at: NOW, ...o,
    });
    await insertRow(db, 'service_lines', line({ amount_cents: 1500 }));
    await reject(() => insertRow(db, 'service_lines', line({ fluid_kind: 'engine_oil' })), /CHECK constraint failed/);
    await insertRow(db, 'service_lines', line({ line_type: 'fluid', fluid_kind: 'engine_oil', spec: '5W-30 ACEA C3' }));
    await reject(() => insertRow(db, 'service_lines', line({ amount_cents: -1 })), /CHECK constraint failed/);
  });

  it('categoria di spesa: non si cancella se ha spese (RESTRICT); officina cancellata -> SET NULL', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    await insertRow(db, 'expenses', {
      id: nextId(), vehicle_id: v, spent_on: '2026-09-01', category_id: 'sys_tolls', amount_cents: 450, created_at: NOW, updated_at: NOW,
    });
    await reject(() => db.run(`DELETE FROM expense_categories WHERE id = 'sys_tolls'`), /FOREIGN KEY constraint failed/);
    const w = await insertRow(db, 'workshops', { id: nextId(), name: 'Officina Rossi', created_at: NOW, updated_at: NOW });
    const sr = await insertRow(db, 'service_records', serviceRow(v, { workshop_id: w }));
    await db.run('DELETE FROM workshops WHERE id = ?', [w]);
    expect(await db.get('SELECT workshop_id FROM service_records WHERE id = ?', [sr])).toEqual({ workshop_id: null });
  });

  it('i km oltre 2.000.000 e i valori negativi sono rifiutati', async () => {
    const { db } = t;
    const v = await insertRow(db, 'vehicles', vehicleRow());
    await reject(() => insertRow(db, 'odometer_readings', odometerRow(v, '2026-01-01', 2_000_001)), /CHECK constraint failed/);
    await reject(() => insertRow(db, 'odometer_readings', odometerRow(v, '2026-01-01', -1)), /CHECK constraint failed/);
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-01-01', 2_000_000));
  });
});

describe('cancellazione a cascata del veicolo', () => {
  it('cancellando un veicolo scompaiono tutte le righe collegate e la coda dei file riceve i path', async () => {
    const { db } = t;
    const base = { created_at: NOW, updated_at: NOW };
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const adapter = await insertRow(db, 'obd_adapters', { id: nextId(), name: 'ELM', transport: 'ble', address: 'x', ...base });
    await db.run('UPDATE vehicles SET preferred_adapter_id = ? WHERE id = ?', [adapter, v]);
    const fuel = await insertRow(db, 'fuel_logs', fuelLogRow(v));
    const sr = await insertRow(db, 'service_records', serviceRow(v));
    await insertRow(db, 'service_lines', { id: nextId(), service_record_id: sr, line_type: 'labor', description: 'Manodopera', ...base });
    const fc = await insertRow(db, 'fluid_checks', { id: nextId(), vehicle_id: v, checked_on: '2026-09-01', fluid: 'engine_oil', level: 'ok', ...base });
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-09-01', 1000, { source: 'fuel', fuel_log_id: fuel }));
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-09-02', 1010, { source: 'service', service_record_id: sr }));
    await insertRow(db, 'odometer_readings', odometerRow(v, '2026-09-03', 1020, { source: 'fluid_check', fluid_check_id: fc }));
    const item = await insertRow(db, 'maintenance_items', itemRow(v));
    await insertRow(db, 'maintenance_completions', { id: nextId(), item_id: item, done_on: '2026-03-01', source: 'manual', ...base });
    const rem = await insertRow(db, 'reminders', reminderRow(v, { origin: 'generated', item_id: item, effective_due_on: '2026-12-01' }));
    await insertRow(db, 'notification_schedule', { key: 'mg1:test:1', reminder_id: rem, fire_at: NOW, tz: 'Europe/Rome', hash: 'h', planned_at: NOW });
    const pol = await insertRow(db, 'insurance_policies', policyRow(v));
    await insertRow(db, 'insurance_coverages', { id: nextId(), policy_id: pol, code: 'rca', ...base });
    await insertRow(db, 'insurance_payments', { id: nextId(), policy_id: pol, installment_no: 1, due_on: '2026-01-01', amount_cents: 100, ...base });
    await insertRow(db, 'expenses', { id: nextId(), vehicle_id: v, spent_on: '2026-09-01', category_id: 'sys_tolls', amount_cents: 450, ...base });
    const ts = await insertRow(db, 'tyre_sets', { id: nextId(), vehicle_id: v, label: 'Estive', season: 'summer', ...base });
    await insertRow(db, 'tyre_fitments', { id: nextId(), tyre_set_id: ts, vehicle_id: v, fitted_on: '2026-04-15', ...base });
    const stored = (n: string) => `attachments/${n}.jpg`;
    await insertRow(db, 'attachments', {
      id: nextId(), owner_vehicle_id: v, service_record_id: sr, kind: 'receipt', file_name: 'a.jpg', stored_path: stored('a'),
      thumb_path: stored('a_t'), mime_type: 'image/jpeg', size_bytes: 10, sha256: 'b'.repeat(64), ...base,
    });
    await insertRow(db, 'attachments', {
      id: nextId(), owner_vehicle_id: v, kind: 'photo', file_name: 'b.jpg', stored_path: stored('b'),
      mime_type: 'image/jpeg', size_bytes: 10, sha256: 'c'.repeat(64), ...base,
    });
    await insertRow(db, 'obd_sessions', { id: nextId(), seq: 1, vehicle_id: v, kind: 'live', started_at: NOW, ...base });
    await db.run('INSERT INTO telemetry_samples (session_seq, pid, t_ms, value) VALUES (1, 268, 0, 800)');
    await db.run('INSERT INTO telemetry_rollups (session_seq, pid, bucket, n, v_min, v_max, v_avg) VALUES (1, 268, 0, 5, 1, 2, 1.5)');
    await insertRow(db, 'dtc_events', { id: nextId(), vehicle_id: v, code: 'P0420', kind: 'stored', first_seen_at: NOW, last_seen_at: NOW, ...base });

    const children = [
      'fuel_logs', 'service_records', 'service_lines', 'fluid_checks', 'odometer_readings', 'maintenance_items',
      'maintenance_completions', 'reminders', 'notification_schedule', 'insurance_policies', 'insurance_coverages',
      'insurance_payments', 'expenses', 'tyre_sets', 'tyre_fitments', 'attachments', 'obd_sessions', 'telemetry_samples',
      'telemetry_rollups', 'dtc_events',
    ];
    for (const table of children) {
      const row = await db.get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`);
      expect(row?.n, table).toBeGreaterThan(0);
    }

    await db.run('DELETE FROM vehicles WHERE id = ?', [v]);

    for (const table of children) {
      const row = await db.get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`);
      expect(row?.n, table).toBe(0);
    }
    const queued = (await db.all<{ stored_path: string }>('SELECT stored_path FROM pending_file_deletions ORDER BY id')).map((r) => r.stored_path);
    expect(queued.sort()).toEqual([stored('a'), stored('a_t'), stored('b')].sort());
    // l'adattatore e' un riferimento "morbido": resta
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM obd_adapters'))?.n).toBe(1);
    expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(await db.all('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  });
});
