// Migrazione 0002 "da manuale" con ricostruzione di tabella (data.md 2.3), usata dai test per provare il runner
// (e come ricetta di riferimento per le migrazioni reali che dovranno cambiare un CHECK).
import type { Migration } from '@/data/db/types';

// Esempio: aggiunge il tipo di carburante 'lng' al CHECK di fuel_logs (SQLite non permette di modificare un CHECK).
// Ricetta ufficiale "12 passi" adattata: viste da ricreare, indici e trigger da ricreare, colonne sempre elencate.
const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
export const migrationFuelLng: Migration = {
  version: 2,
  name: 'fuel_type_lng',
  rebuildsTables: true,
  up: [
    `DROP VIEW v_costs`, // le viste che citano la tabella vanno eliminate e ricreate, altrimenti RENAME fallisce
    `CREATE TABLE fuel_logs_new (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  filled_on TEXT NOT NULL CHECK (date(filled_on) IS filled_on),
  fuel_type TEXT NOT NULL CHECK (fuel_type IN ('petrol','diesel','lpg','cng','lng','electric','hydrogen','adblue','hvo')),
  grade TEXT CHECK (length(grade) <= 40),
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('L','kg','kWh')),
  unit_price_milli INTEGER CHECK (unit_price_milli BETWEEN 0 AND 100000000),
  total_cents INTEGER NOT NULL CHECK (total_cents BETWEEN 0 AND 100000000000),
  is_full INTEGER NOT NULL DEFAULT 1 CHECK (is_full IN (0, 1)),
  missed_before INTEGER NOT NULL DEFAULT 0 CHECK (missed_before IN (0, 1)),
  station TEXT CHECK (length(station) <= 80),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}),
  deleted_at TEXT,
  CHECK ((quantity_unit = 'L'   AND fuel_type IN ('petrol','diesel','lpg','adblue','hvo'))
      OR (quantity_unit = 'kg'  AND fuel_type IN ('cng','lng','hydrogen'))
      OR (quantity_unit = 'kWh' AND fuel_type = 'electric'))
) STRICT`,
    `INSERT INTO fuel_logs_new (id, vehicle_id, filled_on, fuel_type, grade, quantity_milli, quantity_unit, unit_price_milli,
   total_cents, is_full, missed_before, station, notes, created_at, updated_at, deleted_at)
 SELECT id, vehicle_id, filled_on, fuel_type, grade, quantity_milli, quantity_unit, unit_price_milli,
   total_cents, is_full, missed_before, station, notes, created_at, updated_at, deleted_at FROM fuel_logs`,
    `DROP TABLE fuel_logs`, // porta via anche i suoi indici e trigger: vanno ricreati
    `ALTER TABLE fuel_logs_new RENAME TO fuel_logs`,
    `CREATE INDEX ix_fuel_vehicle_date ON fuel_logs(vehicle_id, filled_on DESC) WHERE deleted_at IS NULL`,
    `CREATE TRIGGER trg_fuel_logs_touch AFTER UPDATE ON fuel_logs WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE fuel_logs SET updated_at = ${NOW} WHERE id = NEW.id; END`,
    `CREATE VIEW v_costs AS
SELECT vehicle_id, service_on AS on_date, 'service' AS source, id AS source_id, total_cents AS cents
  FROM service_records WHERE deleted_at IS NULL
UNION ALL SELECT vehicle_id, filled_on, 'fuel', id, total_cents FROM fuel_logs WHERE deleted_at IS NULL
UNION ALL SELECT vehicle_id, spent_on, 'expense', id, amount_cents FROM expenses WHERE deleted_at IS NULL
UNION ALL SELECT p.vehicle_id, ip.paid_on, 'insurance', ip.id, ip.amount_cents
  FROM insurance_payments ip JOIN insurance_policies p ON p.id = ip.policy_id
  WHERE ip.paid_on IS NOT NULL AND ip.deleted_at IS NULL AND p.deleted_at IS NULL`,
  ],
};


