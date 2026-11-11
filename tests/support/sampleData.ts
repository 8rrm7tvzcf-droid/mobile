// Dati sintetici per i test e per le fixture dei database di esempio (tests/fixtures/db/vN.sqlite).
// Nessuna targa o VIN reale: solo valori palesemente finti.
import type { SqlDatabase } from '@/domain/ports';
import { ulidOf } from './fakes';
import { insertRow } from './db';

const AT = '2026-06-01T08:00:00.000Z';
const base = { created_at: AT, updated_at: AT };

/** Totali attesi dalle viste dopo `populateSampleData` (verificati dai test sulle fixture). */
export const SAMPLE_EXPECTED = {
  vehicles: 2,
  costsByVehicle1: { service: 21000, fuel: 5500 + 6000, expense: 1200, insurance: 20000 },
  currentKm: 15000,
  currentKmAsOf: '2026-06-01',
  lastDoneOnOil: '2026-03-01',
  lastDoneKmOil: 12000,
  openReminders: 2,
} as const;

export const SAMPLE_IDS = {
  vehicle1: ulidOf(1),
  demo: ulidOf(2),
  itemOil: ulidOf(10),
  itemTax: ulidOf(11),
  service1: ulidOf(20),
  policy1: ulidOf(30),
} as const;

/** Popola un database (gia' migrato) con un piccolo garage sintetico. Gli ID sono deterministici. */
export async function populateSampleData(db: SqlDatabase): Promise<void> {
  const v1 = SAMPLE_IDS.vehicle1;
  await insertRow(db, 'vehicles', {
    id: v1, nickname: 'Auto di prova', plate: 'TEST001', make: 'Marca', model: 'Modello', fuel_primary: 'petrol',
    first_registration_on: '2020-03-15', model_year: 2020, ...base,
  });
  await insertRow(db, 'vehicles', {
    id: SAMPLE_IDS.demo, nickname: 'Auto di esempio', make: 'Esempio', model: 'Demo', fuel_primary: 'diesel', is_demo: 1, ...base,
  });

  // km: tre letture + una ignorata
  await insertRow(db, 'odometer_readings', { id: ulidOf(100), vehicle_id: v1, read_on: '2026-01-01', km: 10000, source: 'manual', ...base });
  await insertRow(db, 'odometer_readings', { id: ulidOf(101), vehicle_id: v1, read_on: '2026-06-01', km: 15000, source: 'manual', ...base });
  await insertRow(db, 'odometer_readings', {
    id: ulidOf(102), vehicle_id: v1, read_on: '2026-07-01', km: 99999, source: 'manual', status: 'ignored', ...base,
  });

  // intervento con righe e lettura km collegata
  await insertRow(db, 'workshops', { id: ulidOf(40), name: 'Officina di prova', ...base });
  await insertRow(db, 'service_records', {
    id: SAMPLE_IDS.service1, vehicle_id: v1, service_on: '2026-03-01', kind: 'scheduled', title: 'Tagliando',
    workshop_id: ulidOf(40), total_cents: 21000, ...base,
  });
  await insertRow(db, 'service_lines', {
    id: ulidOf(21), service_record_id: SAMPLE_IDS.service1, position: 0, line_type: 'fluid', description: 'Olio motore',
    fluid_kind: 'engine_oil', spec: '5W-30', amount_cents: 9000, ...base,
  });
  await insertRow(db, 'odometer_readings', {
    id: ulidOf(103), vehicle_id: v1, read_on: '2026-03-01', km: 12000, source: 'service', service_record_id: SAMPLE_IDS.service1, ...base,
  });

  // rifornimenti
  await insertRow(db, 'fuel_logs', {
    id: ulidOf(50), vehicle_id: v1, filled_on: '2026-05-10', fuel_type: 'petrol', quantity_milli: 30000, quantity_unit: 'L',
    unit_price_milli: 1833, total_cents: 5500, ...base,
  });
  await insertRow(db, 'fuel_logs', {
    id: ulidOf(51), vehicle_id: v1, filled_on: '2025-12-15', fuel_type: 'petrol', quantity_milli: 32000, quantity_unit: 'L',
    total_cents: 6000, ...base,
  });

  // spese e categorie di sistema
  await insertRow(db, 'expenses', {
    id: ulidOf(60), vehicle_id: v1, spent_on: '2026-04-10', category_id: 'sys_parking', amount_cents: 1200, ...base,
  });

  // regole, completamenti, promemoria
  await insertRow(db, 'maintenance_items', {
    id: SAMPLE_IDS.itemOil, vehicle_id: v1, template_id: 'tpl_oil_change', template_version: 1, name: 'Cambio olio',
    category: 'maintenance', schedule_type: 'interval_last_done', interval_km: 15000, interval_months: 12,
    baseline_on: '2025-01-15', baseline_km: 5000, ...base,
  });
  await insertRow(db, 'maintenance_items', {
    id: SAMPLE_IDS.itemTax, vehicle_id: v1, template_id: 'tpl_road_tax', name: 'Bollo auto', category: 'legal',
    schedule_type: 'interval_calendar', interval_months: 12, fixed_due_on: '2026-11-30', ...base,
  });
  await insertRow(db, 'maintenance_completions', {
    id: ulidOf(12), item_id: SAMPLE_IDS.itemOil, done_on: '2026-03-01', done_km: 12000, source: 'service',
    service_record_id: SAMPLE_IDS.service1, ...base,
  });
  await insertRow(db, 'reminders', {
    id: ulidOf(70), vehicle_id: v1, origin: 'generated', item_id: SAMPLE_IDS.itemOil, title: 'Cambio olio',
    category: 'maintenance', due_on: '2027-03-01', due_km: 27000, effective_due_on: '2027-03-01', due_trigger: 'both', ...base,
  });
  await insertRow(db, 'reminders', {
    id: ulidOf(71), vehicle_id: v1, origin: 'manual', title: 'Controllare le gomme', due_on: '2026-12-01',
    effective_due_on: '2026-12-01', ...base,
  });

  // assicurazione con garanzie e rate (una pagata)
  await insertRow(db, 'insurance_policies', {
    id: SAMPLE_IDS.policy1, vehicle_id: v1, kind: 'rca', company: 'Compagnia di prova', start_on: '2026-01-01',
    end_on: '2027-01-01', premium_cents: 40000, payment_frequency: 'semiannual', merit_class: 1, ...base,
  });
  await insertRow(db, 'insurance_coverages', { id: ulidOf(31), policy_id: SAMPLE_IDS.policy1, code: 'rca', limit_cents: 607000000, ...base });
  await insertRow(db, 'insurance_payments', {
    id: ulidOf(32), policy_id: SAMPLE_IDS.policy1, installment_no: 1, due_on: '2026-01-01', amount_cents: 20000, paid_on: '2026-01-02', ...base,
  });
  await insertRow(db, 'insurance_payments', {
    id: ulidOf(33), policy_id: SAMPLE_IDS.policy1, installment_no: 2, due_on: '2026-07-01', amount_cents: 20000, ...base,
  });

  // gomme, livelli, allegato
  await insertRow(db, 'tyre_sets', { id: ulidOf(80), vehicle_id: v1, label: 'Estive', season: 'summer', width_mm: 185, aspect_pct: 65, rim_in: 15, ...base });
  await insertRow(db, 'tyre_fitments', { id: ulidOf(81), tyre_set_id: ulidOf(80), vehicle_id: v1, fitted_on: '2026-04-15', fitted_km: 14000, ...base });
  await insertRow(db, 'fluid_checks', {
    id: ulidOf(90), vehicle_id: v1, checked_on: '2026-05-01', fluid: 'tyre_pressure', level: 'ok', value_millibar: 2200, ...base,
  });
  await insertRow(db, 'attachments', {
    id: ulidOf(95), owner_vehicle_id: v1, service_record_id: SAMPLE_IDS.service1, kind: 'invoice', file_name: 'fattura.pdf',
    stored_path: `attachments/${ulidOf(95)}.pdf`, mime_type: 'application/pdf', size_bytes: 1234, sha256: 'd'.repeat(64), ...base,
  });

  // OBD: adattatore simulatore collegato solo all'auto demo; una sessione con campioni; un DTC
  await insertRow(db, 'obd_adapters', { id: ulidOf(110), name: 'Simulatore', transport: 'simulator', address: 'simulator', ...base });
  await insertRow(db, 'obd_sessions', {
    id: ulidOf(111), seq: 1, vehicle_id: SAMPLE_IDS.demo, adapter_id: ulidOf(110), kind: 'live',
    started_at: AT, ended_at: '2026-06-01T08:10:00.000Z', ...base,
  });
  await db.run('INSERT INTO telemetry_samples (session_seq, pid, t_ms, value) VALUES (1, 268, 0, 850), (1, 268, 1000, 870)');
  await insertRow(db, 'dtc_events', {
    id: ulidOf(112), vehicle_id: v1, code: 'P0420', kind: 'stored', first_seen_at: AT, last_seen_at: AT, ...base,
  });
}
