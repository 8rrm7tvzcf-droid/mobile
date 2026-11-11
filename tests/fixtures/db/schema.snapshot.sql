-- index ix_att_expense
CREATE INDEX ix_att_expense ON attachments(expense_id) WHERE expense_id IS NOT NULL;

-- index ix_att_fluid
CREATE INDEX ix_att_fluid ON attachments(fluid_check_id) WHERE fluid_check_id IS NOT NULL;

-- index ix_att_fuel
CREATE INDEX ix_att_fuel ON attachments(fuel_log_id) WHERE fuel_log_id IS NOT NULL;

-- index ix_att_owner
CREATE INDEX ix_att_owner ON attachments(owner_vehicle_id, created_at DESC) WHERE deleted_at IS NULL;

-- index ix_att_policy
CREATE INDEX ix_att_policy ON attachments(policy_id) WHERE policy_id IS NOT NULL;

-- index ix_att_service
CREATE INDEX ix_att_service ON attachments(service_record_id) WHERE service_record_id IS NOT NULL;

-- index ix_att_tyre
CREATE INDEX ix_att_tyre ON attachments(tyre_set_id) WHERE tyre_set_id IS NOT NULL;

-- index ix_completions_item
CREATE INDEX ix_completions_item ON maintenance_completions(item_id, done_on DESC) WHERE deleted_at IS NULL;

-- index ix_coverages_policy
CREATE INDEX ix_coverages_policy ON insurance_coverages(policy_id);

-- index ix_dtc_vehicle_code
CREATE INDEX ix_dtc_vehicle_code ON dtc_events(vehicle_id, code, state) WHERE deleted_at IS NULL;

-- index ix_dtc_vehicle_seen
CREATE INDEX ix_dtc_vehicle_seen ON dtc_events(vehicle_id, last_seen_at DESC) WHERE deleted_at IS NULL;

-- index ix_expenses_category
CREATE INDEX ix_expenses_category ON expenses(category_id);

-- index ix_expenses_vehicle_date
CREATE INDEX ix_expenses_vehicle_date ON expenses(vehicle_id, spent_on DESC) WHERE deleted_at IS NULL;

-- index ix_fitments_set
CREATE INDEX ix_fitments_set ON tyre_fitments(tyre_set_id, fitted_on DESC) WHERE deleted_at IS NULL;

-- index ix_fluid_vehicle
CREATE INDEX ix_fluid_vehicle ON fluid_checks(vehicle_id, fluid, checked_on DESC) WHERE deleted_at IS NULL;

-- index ix_fuel_vehicle_date
CREATE INDEX ix_fuel_vehicle_date ON fuel_logs(vehicle_id, filled_on DESC) WHERE deleted_at IS NULL;

-- index ix_items_template
CREATE INDEX ix_items_template ON maintenance_items(template_id) WHERE template_id IS NOT NULL;

-- index ix_items_vehicle
CREATE INDEX ix_items_vehicle ON maintenance_items(vehicle_id) WHERE deleted_at IS NULL AND is_active = 1;

-- index ix_lines_record
CREATE INDEX ix_lines_record ON service_lines(service_record_id, position);

-- index ix_notif_reminder
CREATE INDEX ix_notif_reminder ON notification_schedule(reminder_id);

-- index ix_obd_sessions_vehicle
CREATE INDEX ix_obd_sessions_vehicle ON obd_sessions(vehicle_id, started_at DESC);

-- index ix_odo_vehicle_day
CREATE INDEX ix_odo_vehicle_day ON odometer_readings(vehicle_id, read_on DESC, km DESC) WHERE status = 'valid' AND deleted_at IS NULL;

-- index ix_payments_due
CREATE INDEX ix_payments_due ON insurance_payments(due_on) WHERE paid_on IS NULL AND deleted_at IS NULL;

-- index ix_policies_vehicle
CREATE INDEX ix_policies_vehicle ON insurance_policies(vehicle_id, end_on DESC) WHERE deleted_at IS NULL;

-- index ix_reminders_due
CREATE INDEX ix_reminders_due ON reminders(effective_due_on) WHERE status = 'open' AND deleted_at IS NULL;

-- index ix_reminders_vehicle
CREATE INDEX ix_reminders_vehicle ON reminders(vehicle_id, status) WHERE deleted_at IS NULL;

-- index ix_service_vehicle_date
CREATE INDEX ix_service_vehicle_date ON service_records(vehicle_id, service_on DESC) WHERE deleted_at IS NULL;

-- index ix_service_workshop
CREATE INDEX ix_service_workshop ON service_records(workshop_id) WHERE workshop_id IS NOT NULL;

-- index ix_tyre_sets_vehicle
CREATE INDEX ix_tyre_sets_vehicle ON tyre_sets(vehicle_id) WHERE deleted_at IS NULL;

-- index ix_vehicles_adapter
CREATE INDEX ix_vehicles_adapter ON vehicles(preferred_adapter_id) WHERE preferred_adapter_id IS NOT NULL;

-- index ix_vehicles_status
CREATE INDEX ix_vehicles_status ON vehicles(status) WHERE deleted_at IS NULL;

-- index ux_att_cover
CREATE UNIQUE INDEX ux_att_cover ON attachments(owner_vehicle_id) WHERE is_cover = 1 AND deleted_at IS NULL;

-- index ux_completion_fluid_item
CREATE UNIQUE INDEX ux_completion_fluid_item ON maintenance_completions(fluid_check_id, item_id) WHERE fluid_check_id IS NOT NULL AND deleted_at IS NULL;

-- index ux_completion_record_item
CREATE UNIQUE INDEX ux_completion_record_item ON maintenance_completions(service_record_id, item_id) WHERE service_record_id IS NOT NULL AND deleted_at IS NULL;

-- index ux_fitments_open
CREATE UNIQUE INDEX ux_fitments_open ON tyre_fitments(vehicle_id) WHERE removed_on IS NULL AND deleted_at IS NULL;

-- index ux_odo_fluid
CREATE UNIQUE INDEX ux_odo_fluid ON odometer_readings(fluid_check_id) WHERE fluid_check_id IS NOT NULL;

-- index ux_odo_fuel
CREATE UNIQUE INDEX ux_odo_fuel ON odometer_readings(fuel_log_id) WHERE fuel_log_id IS NOT NULL;

-- index ux_odo_obd
CREATE UNIQUE INDEX ux_odo_obd ON odometer_readings(obd_session_id) WHERE obd_session_id IS NOT NULL;

-- index ux_odo_service
CREATE UNIQUE INDEX ux_odo_service ON odometer_readings(service_record_id) WHERE service_record_id IS NOT NULL;

-- index ux_reminder_open_item
CREATE UNIQUE INDEX ux_reminder_open_item ON reminders(item_id) WHERE status = 'open' AND item_id IS NOT NULL AND deleted_at IS NULL;

-- index ux_reminder_open_payment
CREATE UNIQUE INDEX ux_reminder_open_payment ON reminders(payment_id) WHERE status = 'open' AND payment_id IS NOT NULL AND deleted_at IS NULL;

-- index ux_reminder_open_policy
CREATE UNIQUE INDEX ux_reminder_open_policy ON reminders(policy_id) WHERE status = 'open' AND policy_id IS NOT NULL AND deleted_at IS NULL;

-- index ux_vehicles_plate
CREATE UNIQUE INDEX ux_vehicles_plate ON vehicles(plate) WHERE plate IS NOT NULL AND deleted_at IS NULL;

-- index ux_vehicles_vin
CREATE UNIQUE INDEX ux_vehicles_vin ON vehicles(vin) WHERE vin IS NOT NULL AND deleted_at IS NULL;

-- table app_settings
CREATE TABLE app_settings (
  key TEXT NOT NULL PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 64),
  value TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at)
) STRICT;

-- table attachments
CREATE TABLE attachments (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  owner_vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_record_id TEXT REFERENCES service_records(id) ON DELETE CASCADE,
  policy_id TEXT REFERENCES insurance_policies(id) ON DELETE CASCADE,
  fuel_log_id TEXT REFERENCES fuel_logs(id) ON DELETE CASCADE,
  expense_id TEXT REFERENCES expenses(id) ON DELETE CASCADE,
  fluid_check_id TEXT REFERENCES fluid_checks(id) ON DELETE CASCADE,
  tyre_set_id TEXT REFERENCES tyre_sets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('photo','receipt','invoice','policy','registration_doc','inspection','other')),
  title TEXT CHECK (length(title) <= 80),
  file_name TEXT NOT NULL,
  stored_path TEXT NOT NULL UNIQUE CHECK (stored_path GLOB 'attachments/*' AND stored_path NOT GLOB '*..*'),
  thumb_path TEXT CHECK (thumb_path GLOB 'attachments/*' AND thumb_path NOT GLOB '*..*'),
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 0 AND 268435456),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  width_px INTEGER, height_px INTEGER,
  is_cover INTEGER NOT NULL DEFAULT 0 CHECK (is_cover IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at),
  CHECK ((service_record_id IS NOT NULL) + (policy_id IS NOT NULL) + (fuel_log_id IS NOT NULL)
       + (expense_id IS NOT NULL) + (fluid_check_id IS NOT NULL) + (tyre_set_id IS NOT NULL) <= 1),
  CHECK (is_cover = 0 OR kind = 'photo')
) STRICT;

-- table dtc_events
CREATE TABLE dtc_events (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES obd_sessions(id) ON DELETE SET NULL,
  code TEXT NOT NULL CHECK (code GLOB '[PCBU][0-3][0-9A-F][0-9A-F][0-9A-F]'),
  kind TEXT NOT NULL CHECK (kind IN ('stored','pending','permanent')),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','absent','cleared','ignored')),
  first_seen_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', first_seen_at) IS first_seen_at),
  last_seen_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', last_seen_at) IS last_seen_at),
  seen_count INTEGER NOT NULL DEFAULT 1 CHECK (seen_count >= 1),
  odometer_km INTEGER CHECK (odometer_km BETWEEN 0 AND 2000000),
  mil_on_when_seen INTEGER CHECK (mil_on_when_seen IN (0, 1)),
  freeze_frame TEXT CHECK (freeze_frame IS NULL OR json_valid(freeze_frame)),
  cleared_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', cleared_at) IS cleared_at),
  title_it TEXT,
  user_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at),
  CHECK (last_seen_at >= first_seen_at),
  CHECK ((state = 'cleared') = (cleared_at IS NOT NULL))
) STRICT;

-- table expense_categories
CREATE TABLE expense_categories (
  id TEXT NOT NULL PRIMARY KEY CHECK (id GLOB 'sys_*' OR length(id) = 26),
  name_it TEXT NOT NULL CHECK (length(name_it) BETWEEN 1 AND 40),
  icon TEXT,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at)
) STRICT;

-- table expenses
CREATE TABLE expenses (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  spent_on TEXT NOT NULL CHECK (date(spent_on) IS spent_on),
  category_id TEXT NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 0 AND 100000000000),
  description TEXT CHECK (length(description) <= 200),
  vendor TEXT CHECK (length(vendor) <= 80),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at)
) STRICT;

-- table fluid_checks
CREATE TABLE fluid_checks (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  checked_on TEXT NOT NULL CHECK (date(checked_on) IS checked_on),
  fluid TEXT NOT NULL CHECK (fluid IN ('engine_oil','coolant','brake_fluid','washer','adblue','power_steering','gearbox_oil','tyre_pressure','other')),
  level TEXT NOT NULL CHECK (level IN ('ok','low','topped_up','high')),
  added_ml INTEGER CHECK (added_ml BETWEEN 1 AND 100000),
  value_millibar INTEGER CHECK (value_millibar BETWEEN 500 AND 6000),
  product TEXT CHECK (length(product) <= 80),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at),
  CHECK (added_ml IS NULL OR level = 'topped_up')
) STRICT;

-- table fuel_logs
CREATE TABLE fuel_logs (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  filled_on TEXT NOT NULL CHECK (date(filled_on) IS filled_on),
  fuel_type TEXT NOT NULL CHECK (fuel_type IN ('petrol','diesel','lpg','cng','electric','hydrogen','adblue','hvo')),
  grade TEXT CHECK (length(grade) <= 40),
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('L','kg','kWh')),
  unit_price_milli INTEGER CHECK (unit_price_milli BETWEEN 0 AND 100000000),
  total_cents INTEGER NOT NULL CHECK (total_cents BETWEEN 0 AND 100000000000),
  is_full INTEGER NOT NULL DEFAULT 1 CHECK (is_full IN (0, 1)),
  missed_before INTEGER NOT NULL DEFAULT 0 CHECK (missed_before IN (0, 1)),
  station TEXT CHECK (length(station) <= 80),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at),
  CHECK ((quantity_unit = 'L'   AND fuel_type IN ('petrol','diesel','lpg','adblue','hvo'))
      OR (quantity_unit = 'kg'  AND fuel_type IN ('cng','hydrogen'))
      OR (quantity_unit = 'kWh' AND fuel_type = 'electric'))
) STRICT;

-- table insurance_coverages
CREATE TABLE insurance_coverages (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  policy_id TEXT NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (code IN ('rca','kasko','furto','incendio','cristalli','eventi_naturali','atti_vandalici','assistenza','infortuni_conducente','tutela_legale','altro')),
  limit_cents INTEGER CHECK (limit_cents BETWEEN 0 AND 100000000000),
  deductible_cents INTEGER CHECK (deductible_cents BETWEEN 0 AND 100000000000),
  deductible_bp INTEGER CHECK (deductible_bp BETWEEN 0 AND 10000),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  UNIQUE (policy_id, code)
) STRICT;

-- table insurance_payments
CREATE TABLE insurance_payments (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  policy_id TEXT NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
  installment_no INTEGER NOT NULL CHECK (installment_no BETWEEN 1 AND 12),
  due_on TEXT NOT NULL CHECK (date(due_on) IS due_on),
  amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 0 AND 100000000000),
  paid_on TEXT CHECK (date(paid_on) IS paid_on),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at),
  UNIQUE (policy_id, installment_no)
) STRICT;

-- table insurance_policies
CREATE TABLE insurance_policies (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('rca','kasko','furto_incendio','other')),
  company TEXT NOT NULL CHECK (length(company) BETWEEN 1 AND 80),
  agency_name TEXT,
  policy_number TEXT CHECK (length(policy_number) <= 40),
  start_on TEXT NOT NULL CHECK (date(start_on) IS start_on),
  end_on TEXT NOT NULL CHECK (date(end_on) IS end_on),
  premium_cents INTEGER NOT NULL DEFAULT 0 CHECK (premium_cents BETWEEN 0 AND 100000000000),
  payment_frequency TEXT NOT NULL DEFAULT 'annual' CHECK (payment_frequency IN ('single','annual','semiannual','quarterly','monthly')),
  merit_class INTEGER CHECK (merit_class BETWEEN 1 AND 18),
  black_box INTEGER NOT NULL DEFAULT 0 CHECK (black_box IN (0, 1)),
  claims_phone TEXT, claims_email TEXT, assistance_phone TEXT,
  agent_name TEXT, agent_phone TEXT, agent_email TEXT,
  renewed_from_id TEXT REFERENCES insurance_policies(id) ON DELETE SET NULL,
  cancelled_on TEXT CHECK (date(cancelled_on) IS cancelled_on),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at),
  CHECK (end_on > start_on),
  CHECK (cancelled_on IS NULL OR cancelled_on >= start_on)
) STRICT;

-- table maintenance_completions
CREATE TABLE maintenance_completions (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  item_id TEXT NOT NULL REFERENCES maintenance_items(id) ON DELETE CASCADE,
  done_on TEXT NOT NULL CHECK (date(done_on) IS done_on),
  done_km INTEGER CHECK (done_km BETWEEN 0 AND 2000000),
  prev_fixed_due_on TEXT CHECK (date(prev_fixed_due_on) IS prev_fixed_due_on),
  source TEXT NOT NULL CHECK (source IN ('service','check','manual','import')),
  service_record_id TEXT REFERENCES service_records(id) ON DELETE CASCADE,
  fluid_check_id TEXT REFERENCES fluid_checks(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at),
  CHECK ((source = 'service') = (service_record_id IS NOT NULL)),
  CHECK ((source = 'check')   = (fluid_check_id IS NOT NULL))
) STRICT;

-- table maintenance_items
CREATE TABLE maintenance_items (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES service_templates(id) ON DELETE SET NULL,
  template_version INTEGER,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  category TEXT NOT NULL CHECK (category IN ('legal','maintenance','check','tyres','other')),
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('interval_last_done','interval_calendar','fixed_date')),
  interval_km INTEGER CHECK (interval_km BETWEEN 100 AND 1000000),
  interval_months INTEGER CHECK (interval_months BETWEEN 1 AND 240),
  period_end TEXT NOT NULL DEFAULT 'exact' CHECK (period_end IN ('exact','end_of_month')),
  fixed_due_on TEXT CHECK (date(fixed_due_on) IS fixed_due_on),
  baseline_on TEXT CHECK (date(baseline_on) IS baseline_on),
  baseline_km INTEGER CHECK (baseline_km BETWEEN 0 AND 2000000),
  soon_days INTEGER NOT NULL DEFAULT 30 CHECK (soon_days BETWEEN 0 AND 365),
  soon_km INTEGER NOT NULL DEFAULT 1500 CHECK (soon_km BETWEEN 0 AND 100000),
  notify_offsets_days TEXT NOT NULL DEFAULT '[30,7,0]' CHECK (notify_offsets_days IS NULL OR json_valid(notify_offsets_days)),
  notify_enabled INTEGER NOT NULL DEFAULT 1 CHECK (notify_enabled IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at),
  CHECK (schedule_type <> 'interval_last_done' OR interval_km IS NOT NULL OR interval_months IS NOT NULL),
  CHECK (schedule_type <> 'interval_calendar' OR interval_months IS NOT NULL),
  CHECK (schedule_type <> 'fixed_date' OR (interval_km IS NULL AND interval_months IS NULL))
) STRICT;

-- table migrations_log
CREATE TABLE migrations_log (
  version INTEGER NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  app_version TEXT,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- table notification_schedule
CREATE TABLE notification_schedule (
  key TEXT NOT NULL PRIMARY KEY CHECK (key GLOB 'mg1:*'),
  reminder_id TEXT REFERENCES reminders(id) ON DELETE CASCADE,
  fire_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', fire_at) IS fire_at),
  tz TEXT NOT NULL,
  hash TEXT NOT NULL,
  planned_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', planned_at) IS planned_at)
) STRICT;

-- table obd_adapters
CREATE TABLE obd_adapters (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  transport TEXT NOT NULL CHECK (transport IN ('ble','classic','wifi','simulator')),
  address TEXT NOT NULL,
  service_uuid TEXT, write_char_uuid TEXT, notify_char_uuid TEXT,
  write_without_response INTEGER NOT NULL DEFAULT 0 CHECK (write_without_response IN (0, 1)),
  elm_version TEXT, elm_description TEXT,
  clone_suspected INTEGER NOT NULL DEFAULT 0 CHECK (clone_suspected IN (0, 1)),
  last_protocol TEXT,
  mtu INTEGER CHECK (mtu BETWEEN 20 AND 517),
  last_connected_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', last_connected_at) IS last_connected_at),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at),
  UNIQUE (transport, address)
) STRICT;

-- table obd_sessions
CREATE TABLE obd_sessions (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  seq INTEGER NOT NULL UNIQUE CHECK (seq >= 1),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  adapter_id TEXT REFERENCES obd_adapters(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('snapshot','live','diagnostic')),
  started_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', started_at) IS started_at),
  ended_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', ended_at) IS ended_at),
  end_reason TEXT CHECK (end_reason IN ('user','disconnect','error','timeout','app_closed')),
  protocol TEXT,
  vin_matches INTEGER CHECK (vin_matches IN (0, 1)),
  supported_pids TEXT CHECK (supported_pids IS NULL OR json_valid(supported_pids)),
  mil_on INTEGER CHECK (mil_on IN (0, 1)),
  dtc_count INTEGER CHECK (dtc_count BETWEEN 0 AND 255),
  stats TEXT CHECK (stats IS NULL OR json_valid(stats)),
  sample_interval_ms INTEGER CHECK (sample_interval_ms BETWEEN 50 AND 60000),
  samples_pruned_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', samples_pruned_at) IS samples_pruned_at),
  app_version TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
) STRICT;

-- table odometer_readings
CREATE TABLE odometer_readings (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  read_on TEXT NOT NULL CHECK (date(read_on) IS read_on),
  km INTEGER NOT NULL CHECK (km BETWEEN 0 AND 2000000),
  source TEXT NOT NULL CHECK (source IN ('manual','obd','fuel','service','fluid_check','import')),
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','ignored')),
  fuel_log_id TEXT REFERENCES fuel_logs(id) ON DELETE CASCADE,
  service_record_id TEXT REFERENCES service_records(id) ON DELETE CASCADE,
  fluid_check_id TEXT REFERENCES fluid_checks(id) ON DELETE CASCADE,
  obd_session_id TEXT REFERENCES obd_sessions(id) ON DELETE CASCADE,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at),
  CHECK ((source = 'fuel')        = (fuel_log_id IS NOT NULL)),
  CHECK ((source = 'service')     = (service_record_id IS NOT NULL)),
  CHECK ((source = 'fluid_check') = (fluid_check_id IS NOT NULL)),
  CHECK ((source = 'obd')         = (obd_session_id IS NOT NULL))
) STRICT;

-- table pending_file_deletions
CREATE TABLE pending_file_deletions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stored_path TEXT NOT NULL,
  queued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- table reminders
CREATE TABLE reminders (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  origin TEXT NOT NULL CHECK (origin IN ('generated','manual')),
  item_id TEXT REFERENCES maintenance_items(id) ON DELETE CASCADE,
  policy_id TEXT REFERENCES insurance_policies(id) ON DELETE CASCADE,
  payment_id TEXT REFERENCES insurance_payments(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  notes TEXT,
  category TEXT NOT NULL DEFAULT 'maintenance' CHECK (category IN ('legal','maintenance','check','insurance','tyres','other')),
  due_on TEXT CHECK (date(due_on) IS due_on),
  due_time TEXT CHECK (due_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  due_km INTEGER CHECK (due_km BETWEEN 0 AND 2000000),
  forecast_on TEXT CHECK (date(forecast_on) IS forecast_on),
  forecast_confidence TEXT CHECK (forecast_confidence IN ('none','low','medium','high')),
  effective_due_on TEXT CHECK (date(effective_due_on) IS effective_due_on),
  due_trigger TEXT CHECK (due_trigger IN ('time','km','both')),
  soon_days INTEGER NOT NULL DEFAULT 30 CHECK (soon_days BETWEEN 0 AND 365),
  soon_km INTEGER NOT NULL DEFAULT 1500 CHECK (soon_km BETWEEN 0 AND 100000),
  notify_offsets_days TEXT NOT NULL DEFAULT '[30,7,0]' CHECK (notify_offsets_days IS NULL OR json_valid(notify_offsets_days)),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','skipped')),
  snoozed_until TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', snoozed_until) IS snoozed_until),
  snooze_until_km INTEGER CHECK (snooze_until_km BETWEEN 0 AND 2000000),
  completed_on TEXT CHECK (date(completed_on) IS completed_on),
  completion_id TEXT REFERENCES maintenance_completions(id) ON DELETE SET NULL,
  repeat_every INTEGER CHECK (repeat_every BETWEEN 1 AND 1000),
  repeat_unit TEXT CHECK (repeat_unit IN ('day','week','month','year')),
  repeat_origin_on TEXT CHECK (date(repeat_origin_on) IS repeat_origin_on),
  computed_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', computed_at) IS computed_at),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at),
  CHECK ((origin = 'manual' AND item_id IS NULL AND policy_id IS NULL AND payment_id IS NULL)
      OR (origin = 'generated' AND (item_id IS NOT NULL) + (policy_id IS NOT NULL) + (payment_id IS NOT NULL) = 1)),
  CHECK (due_on IS NOT NULL OR due_km IS NOT NULL),
  CHECK ((repeat_every IS NULL) = (repeat_unit IS NULL)),
  CHECK (repeat_every IS NULL OR (origin = 'manual' AND repeat_origin_on IS NOT NULL)),
  CHECK (due_time IS NULL OR origin = 'manual'),
  CHECK ((status = 'open') = (completed_on IS NULL) OR status = 'skipped')
) STRICT;

-- table service_lines
CREATE TABLE service_lines (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  service_record_id TEXT NOT NULL REFERENCES service_records(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  line_type TEXT NOT NULL CHECK (line_type IN ('labor','part','fluid','fee','other')),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  quantity_milli INTEGER NOT NULL DEFAULT 1000 CHECK (quantity_milli > 0),
  unit_price_cents INTEGER CHECK (unit_price_cents BETWEEN 0 AND 100000000000),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents BETWEEN 0 AND 100000000000),
  part_code TEXT CHECK (length(part_code) <= 60),
  brand TEXT CHECK (length(brand) <= 60),
  spec TEXT CHECK (length(spec) <= 120),
  fluid_kind TEXT CHECK (fluid_kind IN ('engine_oil','coolant','brake_fluid','washer','adblue','gearbox_oil','power_steering','other')),
  warranty_months INTEGER CHECK (warranty_months BETWEEN 1 AND 240),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  CHECK (fluid_kind IS NULL OR line_type = 'fluid')
) STRICT;

-- table service_records
CREATE TABLE service_records (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_on TEXT NOT NULL CHECK (date(service_on) IS service_on),
  kind TEXT NOT NULL CHECK (kind IN ('scheduled','repair','inspection','tyres','bodywork','accessories','diagnostic','other')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  workshop_id TEXT REFERENCES workshops(id) ON DELETE SET NULL,
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents BETWEEN 0 AND 100000000000),
  invoice_number TEXT CHECK (length(invoice_number) <= 40),
  paid_on TEXT CHECK (date(paid_on) IS paid_on),
  warranty_until_on TEXT CHECK (date(warranty_until_on) IS warranty_until_on),
  inspection_result TEXT CHECK (inspection_result IN ('regular','repeat','suspended')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at),
  CHECK (inspection_result IS NULL OR kind = 'inspection')
) STRICT;

-- table service_templates
CREATE TABLE service_templates (
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
  notify_offsets_days TEXT NOT NULL DEFAULT '[30,7,0]' CHECK (notify_offsets_days IS NULL OR json_valid(notify_offsets_days)),
  applies_to TEXT CHECK (applies_to IS NULL OR json_valid(applies_to)),
  default_enabled INTEGER NOT NULL DEFAULT 1 CHECK (default_enabled IN (0, 1)),
  is_indicative INTEGER NOT NULL DEFAULT 1 CHECK (is_indicative IN (0, 1)),
  note_it TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  CHECK (schedule_type <> 'interval_last_done' OR interval_km IS NOT NULL OR interval_months IS NOT NULL),
  CHECK (schedule_type <> 'interval_calendar' OR interval_months IS NOT NULL),
  CHECK ((anchor_month IS NULL) = (anchor_day IS NULL)),
  CHECK (schedule_type <> 'fixed_date' OR (interval_km IS NULL AND interval_months IS NULL))
) STRICT;

-- table telemetry_rollups
CREATE TABLE telemetry_rollups (
  session_seq INTEGER NOT NULL REFERENCES obd_sessions(seq) ON DELETE CASCADE,
  pid INTEGER NOT NULL CHECK (pid BETWEEN 0 AND 65535),
  bucket INTEGER NOT NULL CHECK (bucket >= 0),
  n INTEGER NOT NULL CHECK (n >= 1),
  v_min REAL NOT NULL, v_max REAL NOT NULL, v_avg REAL NOT NULL,
  PRIMARY KEY (session_seq, pid, bucket)
) STRICT, WITHOUT ROWID;

-- table telemetry_samples
CREATE TABLE telemetry_samples (
  session_seq INTEGER NOT NULL REFERENCES obd_sessions(seq) ON DELETE CASCADE,
  pid INTEGER NOT NULL CHECK (pid BETWEEN 0 AND 65535),
  t_ms INTEGER NOT NULL CHECK (t_ms >= 0),
  value REAL NOT NULL,
  PRIMARY KEY (session_seq, pid, t_ms)
) STRICT, WITHOUT ROWID;

-- table tyre_fitments
CREATE TABLE tyre_fitments (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  tyre_set_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  fitted_on TEXT NOT NULL CHECK (date(fitted_on) IS fitted_on),
  fitted_km INTEGER CHECK (fitted_km BETWEEN 0 AND 2000000),
  removed_on TEXT CHECK (date(removed_on) IS removed_on),
  removed_km INTEGER CHECK (removed_km BETWEEN 0 AND 2000000),
  workshop_id TEXT REFERENCES workshops(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at),
  FOREIGN KEY (tyre_set_id, vehicle_id) REFERENCES tyre_sets(id, vehicle_id) ON DELETE CASCADE,
  CHECK (removed_on IS NULL OR removed_on >= fitted_on),
  CHECK (removed_km IS NULL OR fitted_km IS NULL OR removed_km >= fitted_km)
) STRICT;

-- table tyre_sets
CREATE TABLE tyre_sets (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  season TEXT NOT NULL CHECK (season IN ('summer','winter','all_season')),
  brand TEXT, model TEXT,
  width_mm INTEGER CHECK (width_mm BETWEEN 100 AND 450),
  aspect_pct INTEGER CHECK (aspect_pct BETWEEN 20 AND 90),
  rim_in INTEGER CHECK (rim_in BETWEEN 10 AND 26),
  load_index INTEGER CHECK (load_index BETWEEN 50 AND 130),
  speed_symbol TEXT CHECK (speed_symbol IN ('M','N','P','Q','R','S','T','U','H','V','W','Y')),
  m_s INTEGER NOT NULL DEFAULT 0 CHECK (m_s IN (0, 1)),
  three_peak INTEGER NOT NULL DEFAULT 0 CHECK (three_peak IN (0, 1)),
  quantity INTEGER NOT NULL DEFAULT 4 CHECK (quantity BETWEEN 1 AND 6),
  dot_codes TEXT CHECK (dot_codes IS NULL OR json_valid(dot_codes)),
  purchased_on TEXT CHECK (date(purchased_on) IS purchased_on),
  purchase_price_cents INTEGER CHECK (purchase_price_cents BETWEEN 0 AND 100000000000),
  storage_location TEXT CHECK (length(storage_location) <= 80),
  retired_on TEXT CHECK (date(retired_on) IS retired_on),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at),
  UNIQUE (id, vehicle_id)
) STRICT;

-- table vehicles
CREATE TABLE vehicles (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  nickname TEXT CHECK (length(nickname) <= 60),
  plate TEXT CHECK (length(plate) BETWEEN 2 AND 10 AND plate NOT GLOB '*[^A-Z0-9]*'),
  plate_country TEXT NOT NULL DEFAULT 'IT' CHECK (length(plate_country) = 2),
  vin TEXT CHECK (length(vin) BETWEEN 5 AND 17 AND vin NOT GLOB '*[^A-Z0-9]*'),
  make TEXT NOT NULL CHECK (length(make) BETWEEN 1 AND 40),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 60),
  trim TEXT CHECK (length(trim) <= 80),
  model_year INTEGER CHECK (model_year BETWEEN 1900 AND 2100),
  first_registration_on TEXT CHECK (date(first_registration_on) IS first_registration_on),
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
  purchase_on TEXT CHECK (date(purchase_on) IS purchase_on), purchase_km INTEGER CHECK (purchase_km BETWEEN 0 AND 2000000), purchase_price_cents INTEGER CHECK (purchase_price_cents BETWEEN 0 AND 100000000000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold','scrapped','archived')),
  sold_on TEXT CHECK (date(sold_on) IS sold_on), sold_km INTEGER CHECK (sold_km BETWEEN 0 AND 2000000), sold_price_cents INTEGER CHECK (sold_price_cents BETWEEN 0 AND 100000000000),
  preferred_adapter_id TEXT REFERENCES obd_adapters(id) ON DELETE SET NULL,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at),
  CHECK (fuel_secondary IS NULL OR fuel_secondary <> fuel_primary),
  CHECK ((sold_on IS NULL AND sold_km IS NULL AND sold_price_cents IS NULL) OR status IN ('sold','scrapped')),
  CHECK (sold_on IS NULL OR purchase_on IS NULL OR sold_on >= purchase_on)
) STRICT;

-- table workshops
CREATE TABLE workshops (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  phone TEXT, email TEXT, website TEXT, address TEXT, city TEXT, notes TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at)
) STRICT;

-- trigger trg_attachments_gc
CREATE TRIGGER trg_attachments_gc AFTER DELETE ON attachments
BEGIN
  INSERT INTO pending_file_deletions (stored_path) VALUES (OLD.stored_path);
  INSERT INTO pending_file_deletions (stored_path) SELECT OLD.thumb_path WHERE OLD.thumb_path IS NOT NULL;
END;

-- trigger trg_attachments_touch
CREATE TRIGGER trg_attachments_touch AFTER UPDATE ON attachments WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE attachments SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_dtc_events_touch
CREATE TRIGGER trg_dtc_events_touch AFTER UPDATE ON dtc_events WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE dtc_events SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_expense_categories_touch
CREATE TRIGGER trg_expense_categories_touch AFTER UPDATE ON expense_categories WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE expense_categories SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_expenses_touch
CREATE TRIGGER trg_expenses_touch AFTER UPDATE ON expenses WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE expenses SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_fluid_checks_touch
CREATE TRIGGER trg_fluid_checks_touch AFTER UPDATE ON fluid_checks WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE fluid_checks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_fuel_logs_touch
CREATE TRIGGER trg_fuel_logs_touch AFTER UPDATE ON fuel_logs WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE fuel_logs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_insurance_coverages_touch
CREATE TRIGGER trg_insurance_coverages_touch AFTER UPDATE ON insurance_coverages WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE insurance_coverages SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_insurance_payments_touch
CREATE TRIGGER trg_insurance_payments_touch AFTER UPDATE ON insurance_payments WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE insurance_payments SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_insurance_policies_touch
CREATE TRIGGER trg_insurance_policies_touch AFTER UPDATE ON insurance_policies WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE insurance_policies SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_maintenance_completions_touch
CREATE TRIGGER trg_maintenance_completions_touch AFTER UPDATE ON maintenance_completions WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE maintenance_completions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_maintenance_items_touch
CREATE TRIGGER trg_maintenance_items_touch AFTER UPDATE ON maintenance_items WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE maintenance_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_obd_adapters_touch
CREATE TRIGGER trg_obd_adapters_touch AFTER UPDATE ON obd_adapters WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE obd_adapters SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_obd_sessions_sim_demo_ins
CREATE TRIGGER trg_obd_sessions_sim_demo_ins BEFORE INSERT ON obd_sessions
WHEN NEW.adapter_id IS NOT NULL
 AND (SELECT transport FROM obd_adapters WHERE id = NEW.adapter_id) = 'simulator'
 AND COALESCE((SELECT is_demo FROM vehicles WHERE id = NEW.vehicle_id), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'SIMULATOR_REQUIRES_DEMO_VEHICLE');
END;

-- trigger trg_obd_sessions_sim_demo_upd
CREATE TRIGGER trg_obd_sessions_sim_demo_upd BEFORE UPDATE OF adapter_id, vehicle_id ON obd_sessions
WHEN NEW.adapter_id IS NOT NULL
 AND (SELECT transport FROM obd_adapters WHERE id = NEW.adapter_id) = 'simulator'
 AND COALESCE((SELECT is_demo FROM vehicles WHERE id = NEW.vehicle_id), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'SIMULATOR_REQUIRES_DEMO_VEHICLE');
END;

-- trigger trg_obd_sessions_touch
CREATE TRIGGER trg_obd_sessions_touch AFTER UPDATE ON obd_sessions WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE obd_sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_odo_mono_ins
CREATE TRIGGER trg_odo_mono_ins BEFORE INSERT ON odometer_readings
WHEN NEW.status = 'valid' AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'ODO_NON_MONOTONIC') WHERE EXISTS (
    SELECT 1 FROM odometer_readings o
    WHERE o.vehicle_id = NEW.vehicle_id AND o.status = 'valid' AND o.deleted_at IS NULL
      AND ((o.read_on < NEW.read_on AND o.km > NEW.km) OR (o.read_on > NEW.read_on AND o.km < NEW.km)));
END;

-- trigger trg_odo_mono_upd
CREATE TRIGGER trg_odo_mono_upd BEFORE UPDATE OF vehicle_id, read_on, km, status, deleted_at ON odometer_readings
WHEN NEW.status = 'valid' AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'ODO_NON_MONOTONIC') WHERE EXISTS (
    SELECT 1 FROM odometer_readings o
    WHERE o.id <> NEW.id AND o.vehicle_id = NEW.vehicle_id AND o.status = 'valid' AND o.deleted_at IS NULL
      AND ((o.read_on < NEW.read_on AND o.km > NEW.km) OR (o.read_on > NEW.read_on AND o.km < NEW.km)));
END;

-- trigger trg_odometer_readings_touch
CREATE TRIGGER trg_odometer_readings_touch AFTER UPDATE ON odometer_readings WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE odometer_readings SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_reminders_touch
CREATE TRIGGER trg_reminders_touch AFTER UPDATE ON reminders WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE reminders SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_service_lines_touch
CREATE TRIGGER trg_service_lines_touch AFTER UPDATE ON service_lines WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE service_lines SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_service_records_touch
CREATE TRIGGER trg_service_records_touch AFTER UPDATE ON service_records WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE service_records SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_tyre_fitments_touch
CREATE TRIGGER trg_tyre_fitments_touch AFTER UPDATE ON tyre_fitments WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE tyre_fitments SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_tyre_sets_touch
CREATE TRIGGER trg_tyre_sets_touch AFTER UPDATE ON tyre_sets WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE tyre_sets SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_vehicles_touch
CREATE TRIGGER trg_vehicles_touch AFTER UPDATE ON vehicles WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE vehicles SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- trigger trg_workshops_touch
CREATE TRIGGER trg_workshops_touch AFTER UPDATE ON workshops WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE workshops SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- view v_costs
CREATE VIEW v_costs AS
SELECT vehicle_id, service_on AS on_date, 'service' AS source, id AS source_id, total_cents AS cents
  FROM service_records WHERE deleted_at IS NULL
UNION ALL SELECT vehicle_id, filled_on, 'fuel', id, total_cents FROM fuel_logs WHERE deleted_at IS NULL
UNION ALL SELECT vehicle_id, spent_on, 'expense', id, amount_cents FROM expenses WHERE deleted_at IS NULL
UNION ALL SELECT p.vehicle_id, ip.paid_on, 'insurance', ip.id, ip.amount_cents
  FROM insurance_payments ip JOIN insurance_policies p ON p.id = ip.policy_id
  WHERE ip.paid_on IS NOT NULL AND ip.deleted_at IS NULL AND p.deleted_at IS NULL;

-- view v_item_last_done
CREATE VIEW v_item_last_done AS
SELECT i.id AS item_id,
       CASE WHEN c.id IS NOT NULL THEN c.done_on ELSE i.baseline_on END AS last_done_on,
       CASE WHEN c.id IS NOT NULL THEN c.done_km ELSE i.baseline_km END AS last_done_km
FROM maintenance_items i
LEFT JOIN maintenance_completions c ON c.id = (
  SELECT c2.id FROM maintenance_completions c2
  WHERE c2.item_id = i.id AND c2.deleted_at IS NULL
  ORDER BY c2.done_on DESC, c2.created_at DESC, c2.id DESC LIMIT 1)
WHERE i.deleted_at IS NULL;

-- view v_vehicle_odometer
CREATE VIEW v_vehicle_odometer AS
SELECT o.vehicle_id, o.read_on AS as_of, MAX(o.km) AS km
FROM odometer_readings o
WHERE o.status = 'valid' AND o.deleted_at IS NULL
  AND o.read_on = (SELECT MAX(p.read_on) FROM odometer_readings p
                   WHERE p.vehicle_id = o.vehicle_id AND p.status = 'valid' AND p.deleted_at IS NULL)
GROUP BY o.vehicle_id;
