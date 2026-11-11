// Migrazione 0001: schema iniziale (data.md 1.3, eseguito e testato su SQLite 3.53) con le modifiche
// M-1..M-5 di SPEC 8.2:
//   M-1  fluid_checks.fluid ammette 'tyre_pressure' + colonna value_millibar
//   M-2  fuel_logs.fuel_type ammette 'hvo' (litri) + colonna grade (es. '100 ottani')
//   M-3  service_records.inspection_result (solo se kind = 'inspection')
//   M-4  vehicles.is_demo
//   M-5  trigger: una sessione OBD con adattatore 'simulator' si collega solo a un veicolo is_demo = 1
//
// Finche' non esistono installazioni questa migrazione si puo' riscrivere; DOPO il primo rilascio e'
// immutabile (il checksum in migrations_log lo rileva): ogni correzione e' una nuova migrazione.
//
// Convenzioni: ID = ULID di 26 caratteri; date di calendario 'YYYY-MM-DD' (suffisso _on, nessun fuso);
// istanti UTC 'YYYY-MM-DDTHH:MM:SS.mmmZ' (suffisso _at); denaro in centesimi; km interi.
import type { Migration } from '../types';

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
const ISO = (c: string): string => `strftime('%Y-%m-%dT%H:%M:%fZ', ${c}) IS ${c}`;

const ID = (c = 'id'): string => `${c} TEXT NOT NULL PRIMARY KEY CHECK (length(${c}) = 26)`;
const REF = (c: string, table: string, onDelete = 'CASCADE', req = true): string =>
  `${c} TEXT${req ? ' NOT NULL' : ''} REFERENCES ${table}(id) ON DELETE ${onDelete}`;
const D = (c: string, req = false): string => `${c} TEXT${req ? ' NOT NULL' : ''} CHECK (date(${c}) IS ${c})`; // data di calendario
const T = (c: string, req = false): string => `${c} TEXT${req ? ' NOT NULL' : ''} CHECK (${ISO(c)})`; // istante UTC
const B = (c: string, def = 0): string => `${c} INTEGER NOT NULL DEFAULT ${def} CHECK (${c} IN (0, 1))`;
const KM = (c: string, req = false): string => `${c} INTEGER${req ? ' NOT NULL' : ''} CHECK (${c} BETWEEN 0 AND 2000000)`;
const CENTS = (c: string, req = false, def = ''): string =>
  `${c} INTEGER${req ? ' NOT NULL' : ''}${def} CHECK (${c} BETWEEN 0 AND 100000000000)`;
const JSONC = (c: string, req = false, def = ''): string =>
  `${c} TEXT${req ? ' NOT NULL' : ''}${def} CHECK (${c} IS NULL OR json_valid(${c}))`;
const AUDIT = `created_at TEXT NOT NULL DEFAULT (${NOW}) CHECK (${ISO('created_at')}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}) CHECK (${ISO('updated_at')}),
  deleted_at TEXT CHECK (${ISO('deleted_at')})`;
const AUDIT_NOSOFT = `created_at TEXT NOT NULL DEFAULT (${NOW}) CHECK (${ISO('created_at')}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}) CHECK (${ISO('updated_at')})`;

/**
 * Le 21 tabelle con `updated_at` gestito dal trigger `trg_<tabella>_touch` (tutte tranne app_settings, il cui
 * `updated_at` lo imposta il repository). Rispetto a data.md 1.3 (20 tabelle) c'e' in piu' `odometer_readings`,
 * che ha le colonne di audit ma nel riferimento non aveva il trigger: senza, una correzione di km non
 * aggiornerebbe `updated_at` (e la sync LWW futura non la vedrebbe).
 */
export const TOUCH_TABLES = [
  'vehicles',
  'workshops',
  'service_records',
  'service_lines',
  'maintenance_items',
  'maintenance_completions',
  'insurance_policies',
  'insurance_coverages',
  'insurance_payments',
  'reminders',
  'fuel_logs',
  'expenses',
  'expense_categories',
  'fluid_checks',
  'odometer_readings',
  'tyre_sets',
  'tyre_fitments',
  'attachments',
  'obd_adapters',
  'obd_sessions',
  'dtc_events',
] as const;

/** Aggiorna `updated_at` solo se il codice non lo ha toccato (cosi' l'import preserva i timestamp). */
export const touchTrigger = (t: string): string =>
  `CREATE TRIGGER trg_${t}_touch AFTER UPDATE ON ${t} WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE ${t} SET updated_at = ${NOW} WHERE id = NEW.id; END`;

const up: string[] = [
  // ---------------------------------------------------------------- infrastruttura
  `CREATE TABLE migrations_log (
  version INTEGER NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  app_version TEXT,
  applied_at TEXT NOT NULL DEFAULT (${NOW})
) STRICT`,

  `CREATE TABLE app_settings (
  key TEXT NOT NULL PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 64),
  value TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL DEFAULT (${NOW}) CHECK (${ISO('updated_at')})
) STRICT`,

  // ---------------------------------------------------------------- cataloghi (seed da codice, id = slug)
  `CREATE TABLE service_templates (
  id TEXT NOT NULL PRIMARY KEY CHECK (id GLOB 'tpl_*'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  name_it TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('legal','maintenance','check','tyres','other')),
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('interval_last_done','interval_calendar','fixed_date')),
  interval_km INTEGER CHECK (interval_km BETWEEN 100 AND 1000000),
  interval_months INTEGER CHECK (interval_months BETWEEN 1 AND 240),
  period_end TEXT NOT NULL DEFAULT 'exact' CHECK (period_end IN ('exact','end_of_month')),
  anchor_month INTEGER CHECK (anchor_month BETWEEN 1 AND 12),
  anchor_day INTEGER CHECK (anchor_day BETWEEN 1 AND 31),
  soon_days INTEGER NOT NULL DEFAULT 30 CHECK (soon_days BETWEEN 0 AND 365),
  soon_km INTEGER NOT NULL DEFAULT 1500 CHECK (soon_km BETWEEN 0 AND 100000),
  ${JSONC('notify_offsets_days', true, " DEFAULT '[30,7,0]'")},
  ${JSONC('applies_to')},
  ${B('default_enabled', 1)},
  ${B('is_indicative', 1)},
  note_it TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  CHECK (schedule_type <> 'interval_last_done' OR interval_km IS NOT NULL OR interval_months IS NOT NULL),
  CHECK (schedule_type <> 'interval_calendar' OR interval_months IS NOT NULL),
  CHECK ((anchor_month IS NULL) = (anchor_day IS NULL)),
  CHECK (schedule_type <> 'fixed_date' OR (interval_km IS NULL AND interval_months IS NULL))
) STRICT`,

  `CREATE TABLE expense_categories (
  id TEXT NOT NULL PRIMARY KEY CHECK (id GLOB 'sys_*' OR length(id) = 26),
  name_it TEXT NOT NULL CHECK (length(name_it) BETWEEN 1 AND 40),
  icon TEXT,
  ${B('is_system')},
  sort_order INTEGER NOT NULL DEFAULT 100,
  ${AUDIT}
) STRICT`,

  // ---------------------------------------------------------------- adattatori OBD e veicoli
  `CREATE TABLE obd_adapters (
  ${ID()},
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  transport TEXT NOT NULL CHECK (transport IN ('ble','classic','wifi','simulator')),
  address TEXT NOT NULL,
  service_uuid TEXT, write_char_uuid TEXT, notify_char_uuid TEXT,
  ${B('write_without_response')},
  elm_version TEXT, elm_description TEXT,
  ${B('clone_suspected')},
  last_protocol TEXT,
  mtu INTEGER CHECK (mtu BETWEEN 20 AND 517),
  ${T('last_connected_at')},
  notes TEXT,
  ${AUDIT},
  UNIQUE (transport, address)
) STRICT`,

  `CREATE TABLE vehicles (
  ${ID()},
  nickname TEXT CHECK (length(nickname) <= 60),
  plate TEXT CHECK (length(plate) BETWEEN 2 AND 10 AND plate NOT GLOB '*[^A-Z0-9]*'),
  plate_country TEXT NOT NULL DEFAULT 'IT' CHECK (length(plate_country) = 2),
  vin TEXT CHECK (length(vin) BETWEEN 5 AND 17 AND vin NOT GLOB '*[^A-Z0-9]*'),
  make TEXT NOT NULL CHECK (length(make) BETWEEN 1 AND 40),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 60),
  trim TEXT CHECK (length(trim) <= 80),
  model_year INTEGER CHECK (model_year BETWEEN 1900 AND 2100),
  ${D('first_registration_on')},
  powertrain TEXT NOT NULL DEFAULT 'ice' CHECK (powertrain IN ('ice','mhev','hev','phev','bev','fcev')),
  fuel_primary TEXT NOT NULL CHECK (fuel_primary IN ('petrol','diesel','lpg','cng','electric','hydrogen')),
  fuel_secondary TEXT CHECK (fuel_secondary IN ('petrol','lpg','cng','electric')),
  engine_cc INTEGER CHECK (engine_cc BETWEEN 50 AND 20000),
  power_kw INTEGER CHECK (power_kw BETWEEN 1 AND 2000),
  euro_class TEXT CHECK (length(euro_class) <= 10),
  color TEXT CHECK (length(color) <= 30),
  transmission TEXT CHECK (transmission IN ('manual','automatic','cvt','dct','other')),
  tank_capacity_ml INTEGER CHECK (tank_capacity_ml BETWEEN 1000 AND 1000000),
  distance_unit TEXT NOT NULL DEFAULT 'km' CHECK (distance_unit IN ('km','mi')),
  annual_km_estimate INTEGER CHECK (annual_km_estimate BETWEEN 100 AND 200000),
  ${D('purchase_on')}, ${KM('purchase_km')}, ${CENTS('purchase_price_cents')},
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold','scrapped','archived')),
  ${D('sold_on')}, ${KM('sold_km')}, ${CENTS('sold_price_cents')},
  ${REF('preferred_adapter_id', 'obd_adapters', 'SET NULL', false)},
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  ${B('is_demo')},
  ${AUDIT},
  CHECK (fuel_secondary IS NULL OR fuel_secondary <> fuel_primary),
  CHECK ((sold_on IS NULL AND sold_km IS NULL AND sold_price_cents IS NULL) OR status IN ('sold','scrapped')),
  CHECK (sold_on IS NULL OR purchase_on IS NULL OR sold_on >= purchase_on)
) STRICT`,

  `CREATE TABLE workshops (
  ${ID()},
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  phone TEXT, email TEXT, website TEXT, address TEXT, city TEXT, notes TEXT,
  ${B('is_favorite')},
  ${AUDIT}
) STRICT`,

  // ---------------------------------------------------------------- registri (rifornimenti, interventi, controlli livelli)
  `CREATE TABLE fuel_logs (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  ${D('filled_on', true)},
  fuel_type TEXT NOT NULL CHECK (fuel_type IN ('petrol','diesel','lpg','cng','electric','hydrogen','adblue','hvo')),
  grade TEXT CHECK (length(grade) <= 40),
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('L','kg','kWh')),
  unit_price_milli INTEGER CHECK (unit_price_milli BETWEEN 0 AND 100000000),
  ${CENTS('total_cents', true)},
  ${B('is_full', 1)},
  ${B('missed_before')},
  station TEXT CHECK (length(station) <= 80),
  notes TEXT,
  ${AUDIT},
  CHECK ((quantity_unit = 'L'   AND fuel_type IN ('petrol','diesel','lpg','adblue','hvo'))
      OR (quantity_unit = 'kg'  AND fuel_type IN ('cng','hydrogen'))
      OR (quantity_unit = 'kWh' AND fuel_type = 'electric'))
) STRICT`,

  `CREATE TABLE service_records (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  ${D('service_on', true)},
  kind TEXT NOT NULL CHECK (kind IN ('scheduled','repair','inspection','tyres','bodywork','accessories','diagnostic','other')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  ${REF('workshop_id', 'workshops', 'SET NULL', false)},
  ${CENTS('total_cents', true, ' DEFAULT 0')},
  invoice_number TEXT CHECK (length(invoice_number) <= 40),
  ${D('paid_on')},
  ${D('warranty_until_on')},
  inspection_result TEXT CHECK (inspection_result IN ('regular','repeat','suspended')),
  notes TEXT,
  ${AUDIT},
  CHECK (inspection_result IS NULL OR kind = 'inspection')
) STRICT`,

  `CREATE TABLE service_lines (
  ${ID()},
  ${REF('service_record_id', 'service_records')},
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  line_type TEXT NOT NULL CHECK (line_type IN ('labor','part','fluid','fee','other')),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  quantity_milli INTEGER NOT NULL DEFAULT 1000 CHECK (quantity_milli > 0),
  ${CENTS('unit_price_cents')},
  ${CENTS('amount_cents', true, ' DEFAULT 0')},
  part_code TEXT CHECK (length(part_code) <= 60),
  brand TEXT CHECK (length(brand) <= 60),
  spec TEXT CHECK (length(spec) <= 120),
  fluid_kind TEXT CHECK (fluid_kind IN ('engine_oil','coolant','brake_fluid','washer','adblue','gearbox_oil','power_steering','other')),
  warranty_months INTEGER CHECK (warranty_months BETWEEN 1 AND 240),
  ${AUDIT_NOSOFT},
  CHECK (fluid_kind IS NULL OR line_type = 'fluid')
) STRICT`,

  `CREATE TABLE fluid_checks (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  ${D('checked_on', true)},
  fluid TEXT NOT NULL CHECK (fluid IN ('engine_oil','coolant','brake_fluid','washer','adblue','power_steering','gearbox_oil','tyre_pressure','other')),
  level TEXT NOT NULL CHECK (level IN ('ok','low','topped_up','high')),
  added_ml INTEGER CHECK (added_ml BETWEEN 1 AND 100000),
  value_millibar INTEGER CHECK (value_millibar BETWEEN 500 AND 6000),
  product TEXT CHECK (length(product) <= 80),
  notes TEXT,
  ${AUDIT},
  CHECK (added_ml IS NULL OR level = 'topped_up')
) STRICT`,

  `CREATE TABLE expenses (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  ${D('spent_on', true)},
  ${REF('category_id', 'expense_categories', 'RESTRICT')},
  ${CENTS('amount_cents', true)},
  description TEXT CHECK (length(description) <= 200),
  vendor TEXT CHECK (length(vendor) <= 80),
  notes TEXT,
  ${AUDIT}
) STRICT`,

  // ---------------------------------------------------------------- OBD (sessioni prima delle letture che le referenziano)
  `CREATE TABLE obd_sessions (
  ${ID()},
  seq INTEGER NOT NULL UNIQUE CHECK (seq >= 1),
  ${REF('vehicle_id', 'vehicles')},
  ${REF('adapter_id', 'obd_adapters', 'SET NULL', false)},
  kind TEXT NOT NULL CHECK (kind IN ('snapshot','live','diagnostic')),
  ${T('started_at', true)},
  ${T('ended_at')},
  end_reason TEXT CHECK (end_reason IN ('user','disconnect','error','timeout','app_closed')),
  protocol TEXT,
  vin_matches INTEGER CHECK (vin_matches IN (0, 1)),
  ${JSONC('supported_pids')},
  mil_on INTEGER CHECK (mil_on IN (0, 1)),
  dtc_count INTEGER CHECK (dtc_count BETWEEN 0 AND 255),
  ${JSONC('stats')},
  sample_interval_ms INTEGER CHECK (sample_interval_ms BETWEEN 50 AND 60000),
  ${T('samples_pruned_at')},
  app_version TEXT,
  ${AUDIT_NOSOFT},
  CHECK (ended_at IS NULL OR ended_at >= started_at)
) STRICT`,

  // M-5: la demo non sporca i dati reali. Un adattatore 'simulator' si collega solo a un veicolo is_demo = 1.
  `CREATE TRIGGER trg_obd_sessions_sim_demo_ins BEFORE INSERT ON obd_sessions
WHEN NEW.adapter_id IS NOT NULL
 AND (SELECT transport FROM obd_adapters WHERE id = NEW.adapter_id) = 'simulator'
 AND COALESCE((SELECT is_demo FROM vehicles WHERE id = NEW.vehicle_id), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'SIMULATOR_REQUIRES_DEMO_VEHICLE');
END`,
  `CREATE TRIGGER trg_obd_sessions_sim_demo_upd BEFORE UPDATE OF adapter_id, vehicle_id ON obd_sessions
WHEN NEW.adapter_id IS NOT NULL
 AND (SELECT transport FROM obd_adapters WHERE id = NEW.adapter_id) = 'simulator'
 AND COALESCE((SELECT is_demo FROM vehicles WHERE id = NEW.vehicle_id), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'SIMULATOR_REQUIRES_DEMO_VEHICLE');
END`,

  `CREATE TABLE telemetry_samples (
  session_seq INTEGER NOT NULL REFERENCES obd_sessions(seq) ON DELETE CASCADE,
  pid INTEGER NOT NULL CHECK (pid BETWEEN 0 AND 65535),
  t_ms INTEGER NOT NULL CHECK (t_ms >= 0),
  value REAL NOT NULL,
  PRIMARY KEY (session_seq, pid, t_ms)
) STRICT, WITHOUT ROWID`,

  `CREATE TABLE telemetry_rollups (
  session_seq INTEGER NOT NULL REFERENCES obd_sessions(seq) ON DELETE CASCADE,
  pid INTEGER NOT NULL CHECK (pid BETWEEN 0 AND 65535),
  bucket INTEGER NOT NULL CHECK (bucket >= 0),
  n INTEGER NOT NULL CHECK (n >= 1),
  v_min REAL NOT NULL, v_max REAL NOT NULL, v_avg REAL NOT NULL,
  PRIMARY KEY (session_seq, pid, bucket)
) STRICT, WITHOUT ROWID`,

  `CREATE TABLE dtc_events (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  ${REF('session_id', 'obd_sessions', 'SET NULL', false)},
  code TEXT NOT NULL CHECK (code GLOB '[PCBU][0-3][0-9A-F][0-9A-F][0-9A-F]'),
  kind TEXT NOT NULL CHECK (kind IN ('stored','pending','permanent')),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','absent','cleared','ignored')),
  ${T('first_seen_at', true)},
  ${T('last_seen_at', true)},
  seen_count INTEGER NOT NULL DEFAULT 1 CHECK (seen_count >= 1),
  ${KM('odometer_km')},
  mil_on_when_seen INTEGER CHECK (mil_on_when_seen IN (0, 1)),
  ${JSONC('freeze_frame')},
  ${T('cleared_at')},
  title_it TEXT,
  user_note TEXT,
  ${AUDIT},
  CHECK (last_seen_at >= first_seen_at),
  CHECK ((state = 'cleared') = (cleared_at IS NOT NULL))
) STRICT`,

  // ---------------------------------------------------------------- odometro (fonte unica dei km)
  `CREATE TABLE odometer_readings (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  ${D('read_on', true)},
  ${KM('km', true)},
  source TEXT NOT NULL CHECK (source IN ('manual','obd','fuel','service','fluid_check','import')),
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','ignored')),
  ${REF('fuel_log_id', 'fuel_logs', 'CASCADE', false)},
  ${REF('service_record_id', 'service_records', 'CASCADE', false)},
  ${REF('fluid_check_id', 'fluid_checks', 'CASCADE', false)},
  ${REF('obd_session_id', 'obd_sessions', 'CASCADE', false)},
  note TEXT,
  ${AUDIT},
  CHECK ((source = 'fuel')        = (fuel_log_id IS NOT NULL)),
  CHECK ((source = 'service')     = (service_record_id IS NOT NULL)),
  CHECK ((source = 'fluid_check') = (fluid_check_id IS NOT NULL)),
  CHECK ((source = 'obd')         = (obd_session_id IS NOT NULL))
) STRICT`,

  // coerenza monotona: confronto solo con letture di giorni DIVERSI (stesso giorno = nessun vincolo)
  `CREATE TRIGGER trg_odo_mono_ins BEFORE INSERT ON odometer_readings
WHEN NEW.status = 'valid' AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'ODO_NON_MONOTONIC') WHERE EXISTS (
    SELECT 1 FROM odometer_readings o
    WHERE o.vehicle_id = NEW.vehicle_id AND o.status = 'valid' AND o.deleted_at IS NULL
      AND ((o.read_on < NEW.read_on AND o.km > NEW.km) OR (o.read_on > NEW.read_on AND o.km < NEW.km)));
END`,
  `CREATE TRIGGER trg_odo_mono_upd BEFORE UPDATE OF vehicle_id, read_on, km, status, deleted_at ON odometer_readings
WHEN NEW.status = 'valid' AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'ODO_NON_MONOTONIC') WHERE EXISTS (
    SELECT 1 FROM odometer_readings o
    WHERE o.id <> NEW.id AND o.vehicle_id = NEW.vehicle_id AND o.status = 'valid' AND o.deleted_at IS NULL
      AND ((o.read_on < NEW.read_on AND o.km > NEW.km) OR (o.read_on > NEW.read_on AND o.km < NEW.km)));
END`,

  // ---------------------------------------------------------------- regole di manutenzione
  `CREATE TABLE maintenance_items (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  template_id TEXT REFERENCES service_templates(id) ON DELETE SET NULL,
  template_version INTEGER,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  category TEXT NOT NULL CHECK (category IN ('legal','maintenance','check','tyres','other')),
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('interval_last_done','interval_calendar','fixed_date')),
  interval_km INTEGER CHECK (interval_km BETWEEN 100 AND 1000000),
  interval_months INTEGER CHECK (interval_months BETWEEN 1 AND 240),
  period_end TEXT NOT NULL DEFAULT 'exact' CHECK (period_end IN ('exact','end_of_month')),
  ${D('fixed_due_on')},
  ${D('baseline_on')},
  ${KM('baseline_km')},
  soon_days INTEGER NOT NULL DEFAULT 30 CHECK (soon_days BETWEEN 0 AND 365),
  soon_km INTEGER NOT NULL DEFAULT 1500 CHECK (soon_km BETWEEN 0 AND 100000),
  ${JSONC('notify_offsets_days', true, " DEFAULT '[30,7,0]'")},
  ${B('notify_enabled', 1)},
  ${B('is_active', 1)},
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  ${AUDIT},
  CHECK (schedule_type <> 'interval_last_done' OR interval_km IS NOT NULL OR interval_months IS NOT NULL),
  CHECK (schedule_type <> 'interval_calendar' OR interval_months IS NOT NULL),
  CHECK (schedule_type <> 'fixed_date' OR (interval_km IS NULL AND interval_months IS NULL))
) STRICT`,

  `CREATE TABLE maintenance_completions (
  ${ID()},
  ${REF('item_id', 'maintenance_items')},
  ${D('done_on', true)},
  ${KM('done_km')},
  ${D('prev_fixed_due_on')},
  source TEXT NOT NULL CHECK (source IN ('service','check','manual','import')),
  ${REF('service_record_id', 'service_records', 'CASCADE', false)},
  ${REF('fluid_check_id', 'fluid_checks', 'CASCADE', false)},
  notes TEXT,
  ${AUDIT},
  CHECK ((source = 'service') = (service_record_id IS NOT NULL)),
  CHECK ((source = 'check')   = (fluid_check_id IS NOT NULL))
) STRICT`,

  // ---------------------------------------------------------------- assicurazioni
  `CREATE TABLE insurance_policies (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  kind TEXT NOT NULL CHECK (kind IN ('rca','kasko','furto_incendio','other')),
  company TEXT NOT NULL CHECK (length(company) BETWEEN 1 AND 80),
  agency_name TEXT,
  policy_number TEXT CHECK (length(policy_number) <= 40),
  ${D('start_on', true)},
  ${D('end_on', true)},
  ${CENTS('premium_cents', true, ' DEFAULT 0')},
  payment_frequency TEXT NOT NULL DEFAULT 'annual' CHECK (payment_frequency IN ('single','annual','semiannual','quarterly','monthly')),
  merit_class INTEGER CHECK (merit_class BETWEEN 1 AND 18),
  ${B('black_box')},
  claims_phone TEXT, claims_email TEXT, assistance_phone TEXT,
  agent_name TEXT, agent_phone TEXT, agent_email TEXT,
  ${REF('renewed_from_id', 'insurance_policies', 'SET NULL', false)},
  ${D('cancelled_on')},
  notes TEXT,
  ${AUDIT},
  CHECK (end_on > start_on),
  CHECK (cancelled_on IS NULL OR cancelled_on >= start_on)
) STRICT`,

  `CREATE TABLE insurance_coverages (
  ${ID()},
  ${REF('policy_id', 'insurance_policies')},
  code TEXT NOT NULL CHECK (code IN ('rca','kasko','furto','incendio','cristalli','eventi_naturali','atti_vandalici','assistenza','infortuni_conducente','tutela_legale','altro')),
  ${CENTS('limit_cents')},
  ${CENTS('deductible_cents')},
  deductible_bp INTEGER CHECK (deductible_bp BETWEEN 0 AND 10000),
  notes TEXT,
  ${AUDIT_NOSOFT},
  UNIQUE (policy_id, code)
) STRICT`,

  `CREATE TABLE insurance_payments (
  ${ID()},
  ${REF('policy_id', 'insurance_policies')},
  installment_no INTEGER NOT NULL CHECK (installment_no BETWEEN 1 AND 12),
  ${D('due_on', true)},
  ${CENTS('amount_cents', true)},
  ${D('paid_on')},
  notes TEXT,
  ${AUDIT},
  UNIQUE (policy_id, installment_no)
) STRICT`,

  // ---------------------------------------------------------------- promemoria (occorrenze)
  `CREATE TABLE reminders (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  origin TEXT NOT NULL CHECK (origin IN ('generated','manual')),
  ${REF('item_id', 'maintenance_items', 'CASCADE', false)},
  ${REF('policy_id', 'insurance_policies', 'CASCADE', false)},
  ${REF('payment_id', 'insurance_payments', 'CASCADE', false)},
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  notes TEXT,
  category TEXT NOT NULL DEFAULT 'maintenance' CHECK (category IN ('legal','maintenance','check','insurance','tyres','other')),
  ${D('due_on')},
  due_time TEXT CHECK (due_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  ${KM('due_km')},
  ${D('forecast_on')},
  forecast_confidence TEXT CHECK (forecast_confidence IN ('none','low','medium','high')),
  ${D('effective_due_on')},
  due_trigger TEXT CHECK (due_trigger IN ('time','km','both')),
  soon_days INTEGER NOT NULL DEFAULT 30 CHECK (soon_days BETWEEN 0 AND 365),
  soon_km INTEGER NOT NULL DEFAULT 1500 CHECK (soon_km BETWEEN 0 AND 100000),
  ${JSONC('notify_offsets_days', true, " DEFAULT '[30,7,0]'")},
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','skipped')),
  ${T('snoozed_until')},
  ${KM('snooze_until_km')},
  ${D('completed_on')},
  completion_id TEXT REFERENCES maintenance_completions(id) ON DELETE SET NULL,
  repeat_every INTEGER CHECK (repeat_every BETWEEN 1 AND 1000),
  repeat_unit TEXT CHECK (repeat_unit IN ('day','week','month','year')),
  ${D('repeat_origin_on')},
  ${T('computed_at')},
  ${AUDIT},
  CHECK ((origin = 'manual' AND item_id IS NULL AND policy_id IS NULL AND payment_id IS NULL)
      OR (origin = 'generated' AND (item_id IS NOT NULL) + (policy_id IS NOT NULL) + (payment_id IS NOT NULL) = 1)),
  CHECK (due_on IS NOT NULL OR due_km IS NOT NULL),
  CHECK ((repeat_every IS NULL) = (repeat_unit IS NULL)),
  CHECK (repeat_every IS NULL OR (origin = 'manual' AND repeat_origin_on IS NOT NULL)),
  CHECK (due_time IS NULL OR origin = 'manual'),
  CHECK ((status = 'open') = (completed_on IS NULL) OR status = 'skipped')
) STRICT`,

  // cache dello stato OS delle notifiche (la fonte di verita' resta il sistema operativo)
  `CREATE TABLE notification_schedule (
  key TEXT NOT NULL PRIMARY KEY CHECK (key GLOB 'mg1:*'),
  ${REF('reminder_id', 'reminders', 'CASCADE', false)},
  ${T('fire_at', true)},
  tz TEXT NOT NULL,
  hash TEXT NOT NULL,
  ${T('planned_at', true)}
) STRICT`,

  // ---------------------------------------------------------------- pneumatici
  `CREATE TABLE tyre_sets (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  season TEXT NOT NULL CHECK (season IN ('summer','winter','all_season')),
  brand TEXT, model TEXT,
  width_mm INTEGER CHECK (width_mm BETWEEN 100 AND 450),
  aspect_pct INTEGER CHECK (aspect_pct BETWEEN 20 AND 90),
  rim_in INTEGER CHECK (rim_in BETWEEN 10 AND 26),
  load_index INTEGER CHECK (load_index BETWEEN 50 AND 130),
  speed_symbol TEXT CHECK (speed_symbol IN ('M','N','P','Q','R','S','T','U','H','V','W','Y')),
  ${B('m_s')},
  ${B('three_peak')},
  quantity INTEGER NOT NULL DEFAULT 4 CHECK (quantity BETWEEN 1 AND 6),
  ${JSONC('dot_codes')},
  ${D('purchased_on')},
  ${CENTS('purchase_price_cents')},
  storage_location TEXT CHECK (length(storage_location) <= 80),
  ${D('retired_on')},
  notes TEXT,
  ${AUDIT},
  UNIQUE (id, vehicle_id)
) STRICT`,

  `CREATE TABLE tyre_fitments (
  ${ID()},
  tyre_set_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  ${D('fitted_on', true)},
  ${KM('fitted_km')},
  ${D('removed_on')},
  ${KM('removed_km')},
  ${REF('workshop_id', 'workshops', 'SET NULL', false)},
  notes TEXT,
  ${AUDIT},
  FOREIGN KEY (tyre_set_id, vehicle_id) REFERENCES tyre_sets(id, vehicle_id) ON DELETE CASCADE,
  CHECK (removed_on IS NULL OR removed_on >= fitted_on),
  CHECK (removed_km IS NULL OR fitted_km IS NULL OR removed_km >= fitted_km)
) STRICT`,

  // ---------------------------------------------------------------- allegati (file nello storage dell'app, metadati qui)
  `CREATE TABLE attachments (
  ${ID()},
  ${REF('owner_vehicle_id', 'vehicles')},
  ${REF('service_record_id', 'service_records', 'CASCADE', false)},
  ${REF('policy_id', 'insurance_policies', 'CASCADE', false)},
  ${REF('fuel_log_id', 'fuel_logs', 'CASCADE', false)},
  ${REF('expense_id', 'expenses', 'CASCADE', false)},
  ${REF('fluid_check_id', 'fluid_checks', 'CASCADE', false)},
  ${REF('tyre_set_id', 'tyre_sets', 'CASCADE', false)},
  kind TEXT NOT NULL CHECK (kind IN ('photo','receipt','invoice','policy','registration_doc','inspection','other')),
  title TEXT CHECK (length(title) <= 80),
  file_name TEXT NOT NULL,
  stored_path TEXT NOT NULL UNIQUE CHECK (stored_path GLOB 'attachments/*' AND stored_path NOT GLOB '*..*'),
  thumb_path TEXT CHECK (thumb_path GLOB 'attachments/*' AND thumb_path NOT GLOB '*..*'),
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 0 AND 268435456),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  width_px INTEGER, height_px INTEGER,
  ${B('is_cover')},
  ${AUDIT},
  CHECK ((service_record_id IS NOT NULL) + (policy_id IS NOT NULL) + (fuel_log_id IS NOT NULL)
       + (expense_id IS NOT NULL) + (fluid_check_id IS NOT NULL) + (tyre_set_id IS NOT NULL) <= 1),
  CHECK (is_cover = 0 OR kind = 'photo')
) STRICT`,

  `CREATE TABLE pending_file_deletions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stored_path TEXT NOT NULL,
  queued_at TEXT NOT NULL DEFAULT (${NOW})
) STRICT`,
  `CREATE TRIGGER trg_attachments_gc AFTER DELETE ON attachments
BEGIN
  INSERT INTO pending_file_deletions (stored_path) VALUES (OLD.stored_path);
  INSERT INTO pending_file_deletions (stored_path) SELECT OLD.thumb_path WHERE OLD.thumb_path IS NOT NULL;
END`,

  // ---------------------------------------------------------------- indici
  `CREATE UNIQUE INDEX ux_vehicles_plate ON vehicles(plate) WHERE plate IS NOT NULL AND deleted_at IS NULL`,
  `CREATE UNIQUE INDEX ux_vehicles_vin ON vehicles(vin) WHERE vin IS NOT NULL AND deleted_at IS NULL`,
  `CREATE INDEX ix_vehicles_status ON vehicles(status) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_vehicles_adapter ON vehicles(preferred_adapter_id) WHERE preferred_adapter_id IS NOT NULL`,
  `CREATE INDEX ix_odo_vehicle_day ON odometer_readings(vehicle_id, read_on DESC, km DESC) WHERE status = 'valid' AND deleted_at IS NULL`,
  `CREATE UNIQUE INDEX ux_odo_fuel ON odometer_readings(fuel_log_id) WHERE fuel_log_id IS NOT NULL`,
  `CREATE UNIQUE INDEX ux_odo_service ON odometer_readings(service_record_id) WHERE service_record_id IS NOT NULL`,
  `CREATE UNIQUE INDEX ux_odo_fluid ON odometer_readings(fluid_check_id) WHERE fluid_check_id IS NOT NULL`,
  `CREATE UNIQUE INDEX ux_odo_obd ON odometer_readings(obd_session_id) WHERE obd_session_id IS NOT NULL`,
  `CREATE INDEX ix_service_vehicle_date ON service_records(vehicle_id, service_on DESC) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_service_workshop ON service_records(workshop_id) WHERE workshop_id IS NOT NULL`,
  `CREATE INDEX ix_lines_record ON service_lines(service_record_id, position)`,
  `CREATE INDEX ix_items_vehicle ON maintenance_items(vehicle_id) WHERE deleted_at IS NULL AND is_active = 1`,
  `CREATE INDEX ix_items_template ON maintenance_items(template_id) WHERE template_id IS NOT NULL`,
  `CREATE INDEX ix_completions_item ON maintenance_completions(item_id, done_on DESC) WHERE deleted_at IS NULL`,
  `CREATE UNIQUE INDEX ux_completion_record_item ON maintenance_completions(service_record_id, item_id) WHERE service_record_id IS NOT NULL AND deleted_at IS NULL`,
  `CREATE UNIQUE INDEX ux_completion_fluid_item ON maintenance_completions(fluid_check_id, item_id) WHERE fluid_check_id IS NOT NULL AND deleted_at IS NULL`,
  `CREATE INDEX ix_policies_vehicle ON insurance_policies(vehicle_id, end_on DESC) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_payments_due ON insurance_payments(due_on) WHERE paid_on IS NULL AND deleted_at IS NULL`,
  `CREATE INDEX ix_coverages_policy ON insurance_coverages(policy_id)`,
  `CREATE UNIQUE INDEX ux_reminder_open_item ON reminders(item_id) WHERE status = 'open' AND item_id IS NOT NULL AND deleted_at IS NULL`,
  `CREATE UNIQUE INDEX ux_reminder_open_policy ON reminders(policy_id) WHERE status = 'open' AND policy_id IS NOT NULL AND deleted_at IS NULL`,
  `CREATE UNIQUE INDEX ux_reminder_open_payment ON reminders(payment_id) WHERE status = 'open' AND payment_id IS NOT NULL AND deleted_at IS NULL`,
  `CREATE INDEX ix_reminders_due ON reminders(effective_due_on) WHERE status = 'open' AND deleted_at IS NULL`,
  `CREATE INDEX ix_reminders_vehicle ON reminders(vehicle_id, status) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_notif_reminder ON notification_schedule(reminder_id)`,
  `CREATE INDEX ix_fuel_vehicle_date ON fuel_logs(vehicle_id, filled_on DESC) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_expenses_vehicle_date ON expenses(vehicle_id, spent_on DESC) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_expenses_category ON expenses(category_id)`,
  `CREATE INDEX ix_fluid_vehicle ON fluid_checks(vehicle_id, fluid, checked_on DESC) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_tyre_sets_vehicle ON tyre_sets(vehicle_id) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_fitments_set ON tyre_fitments(tyre_set_id, fitted_on DESC) WHERE deleted_at IS NULL`,
  `CREATE UNIQUE INDEX ux_fitments_open ON tyre_fitments(vehicle_id) WHERE removed_on IS NULL AND deleted_at IS NULL`,
  `CREATE INDEX ix_att_owner ON attachments(owner_vehicle_id, created_at DESC) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_att_service ON attachments(service_record_id) WHERE service_record_id IS NOT NULL`,
  `CREATE INDEX ix_att_policy ON attachments(policy_id) WHERE policy_id IS NOT NULL`,
  `CREATE INDEX ix_att_fuel ON attachments(fuel_log_id) WHERE fuel_log_id IS NOT NULL`,
  `CREATE INDEX ix_att_expense ON attachments(expense_id) WHERE expense_id IS NOT NULL`,
  `CREATE INDEX ix_att_fluid ON attachments(fluid_check_id) WHERE fluid_check_id IS NOT NULL`,
  `CREATE INDEX ix_att_tyre ON attachments(tyre_set_id) WHERE tyre_set_id IS NOT NULL`,
  `CREATE UNIQUE INDEX ux_att_cover ON attachments(owner_vehicle_id) WHERE is_cover = 1 AND deleted_at IS NULL`,
  `CREATE INDEX ix_obd_sessions_vehicle ON obd_sessions(vehicle_id, started_at DESC)`,
  `CREATE INDEX ix_dtc_vehicle_code ON dtc_events(vehicle_id, code, state) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_dtc_vehicle_seen ON dtc_events(vehicle_id, last_seen_at DESC) WHERE deleted_at IS NULL`,

  // ---------------------------------------------------------------- viste di lettura
  `CREATE VIEW v_vehicle_odometer AS
SELECT o.vehicle_id, o.read_on AS as_of, MAX(o.km) AS km
FROM odometer_readings o
WHERE o.status = 'valid' AND o.deleted_at IS NULL
  AND o.read_on = (SELECT MAX(p.read_on) FROM odometer_readings p
                   WHERE p.vehicle_id = o.vehicle_id AND p.status = 'valid' AND p.deleted_at IS NULL)
GROUP BY o.vehicle_id`,

  `CREATE VIEW v_item_last_done AS
SELECT i.id AS item_id,
       CASE WHEN c.id IS NOT NULL THEN c.done_on ELSE i.baseline_on END AS last_done_on,
       CASE WHEN c.id IS NOT NULL THEN c.done_km ELSE i.baseline_km END AS last_done_km
FROM maintenance_items i
LEFT JOIN maintenance_completions c ON c.id = (
  SELECT c2.id FROM maintenance_completions c2
  WHERE c2.item_id = i.id AND c2.deleted_at IS NULL
  ORDER BY c2.done_on DESC, c2.created_at DESC, c2.id DESC LIMIT 1)
WHERE i.deleted_at IS NULL`,

  `CREATE VIEW v_costs AS
SELECT vehicle_id, service_on AS on_date, 'service' AS source, id AS source_id, total_cents AS cents
  FROM service_records WHERE deleted_at IS NULL
UNION ALL SELECT vehicle_id, filled_on, 'fuel', id, total_cents FROM fuel_logs WHERE deleted_at IS NULL
UNION ALL SELECT vehicle_id, spent_on, 'expense', id, amount_cents FROM expenses WHERE deleted_at IS NULL
UNION ALL SELECT p.vehicle_id, ip.paid_on, 'insurance', ip.id, ip.amount_cents
  FROM insurance_payments ip JOIN insurance_policies p ON p.id = ip.policy_id
  WHERE ip.paid_on IS NOT NULL AND ip.deleted_at IS NULL AND p.deleted_at IS NULL`,

  ...TOUCH_TABLES.map(touchTrigger),
];

export const migration0001: Migration = {
  version: 1,
  name: 'init',
  up,
};
