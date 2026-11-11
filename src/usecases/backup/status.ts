// Stato del backup (SPEC F-06, 6.3.4 banner «Fai un backup», data.md 5.6): ultimo backup, giorni trascorsi e promemoria.
import { diffDays } from '@/domain/dates';
import type { SqlDatabase } from '@/domain/ports';
import type { Deps } from '../context';
import { readSetting } from '../settings';

export interface BackupStatus {
  /** Istante UTC dell'ultimo backup (esportazione o importazione), o null se mai. */
  lastBackupAt: string | null;
  /** Giorni dall'ultimo backup; null se mai. */
  daysSinceLastBackup: number | null;
  /** Ci sono dati da salvare (almeno un'auto che non sia la demo). */
  hasData: boolean;
  /** Modifiche ai dati dell'utente (righe inserite, cambiate o eliminate) dopo l'ultimo backup. */
  changesSinceBackup: number;
  nudgeDays: number;
  /** Mostrare il banner «Fai un backup»: dati presenti, almeno 5 modifiche e `nudgeDays` giorni senza backup. */
  needsReminder: boolean;
}

/** Almeno questo numero di modifiche prima di ricordare il backup (F-06). */
export const NUDGE_MIN_CHANGES = 5;

const REAL_VEHICLES = 'SELECT id FROM vehicles WHERE is_demo = 0';

// Una query per tabella: conta le righe «dell'utente» (auto demo, promemoria generati e dati OBD esclusi) cambiate dopo `?`.
const CHANGE_QUERIES: readonly string[] = [
  `SELECT COUNT(*) AS n FROM vehicles WHERE is_demo = 0 AND updated_at > ?`,
  `SELECT COUNT(*) AS n FROM workshops WHERE updated_at > ?`,
  `SELECT COUNT(*) AS n FROM expense_categories WHERE is_system = 0 AND updated_at > ?`,
  `SELECT COUNT(*) AS n FROM fuel_logs WHERE vehicle_id IN (${REAL_VEHICLES}) AND updated_at > ?`,
  `SELECT COUNT(*) AS n FROM service_records WHERE vehicle_id IN (${REAL_VEHICLES}) AND updated_at > ?`,
  `SELECT COUNT(*) AS n FROM service_lines l JOIN service_records s ON s.id = l.service_record_id
     WHERE s.vehicle_id IN (${REAL_VEHICLES}) AND l.updated_at > ?`,
  `SELECT COUNT(*) AS n FROM fluid_checks WHERE vehicle_id IN (${REAL_VEHICLES}) AND updated_at > ?`,
  `SELECT COUNT(*) AS n FROM expenses WHERE vehicle_id IN (${REAL_VEHICLES}) AND updated_at > ?`,
  `SELECT COUNT(*) AS n FROM odometer_readings WHERE vehicle_id IN (${REAL_VEHICLES}) AND source <> 'obd' AND updated_at > ?`,
  `SELECT COUNT(*) AS n FROM maintenance_items WHERE vehicle_id IN (${REAL_VEHICLES}) AND updated_at > ?`,
  `SELECT COUNT(*) AS n FROM maintenance_completions c JOIN maintenance_items i ON i.id = c.item_id
     WHERE i.vehicle_id IN (${REAL_VEHICLES}) AND c.updated_at > ?`,
  `SELECT COUNT(*) AS n FROM insurance_policies WHERE vehicle_id IN (${REAL_VEHICLES}) AND updated_at > ?`,
  `SELECT COUNT(*) AS n FROM insurance_payments ip JOIN insurance_policies p ON p.id = ip.policy_id
     WHERE p.vehicle_id IN (${REAL_VEHICLES}) AND ip.updated_at > ?`,
  `SELECT COUNT(*) AS n FROM reminders WHERE origin = 'manual' AND vehicle_id IN (${REAL_VEHICLES}) AND updated_at > ?`,
  `SELECT COUNT(*) AS n FROM tyre_sets WHERE vehicle_id IN (${REAL_VEHICLES}) AND updated_at > ?`,
  `SELECT COUNT(*) AS n FROM attachments WHERE owner_vehicle_id IN (${REAL_VEHICLES}) AND updated_at > ?`,
];

async function countChanges(db: SqlDatabase, since: string): Promise<number> {
  let total = 0;
  for (const sql of CHANGE_QUERIES) total += (await db.get<{ n: number }>(sql, [since]))?.n ?? 0;
  return total;
}

/** Stato del backup per la schermata «Backup e dati» (S-72) e il banner di «Oggi». */
export async function getBackupStatus(d: Pick<Deps, 'db' | 'clock'>): Promise<BackupStatus> {
  const lastBackupAt = await readSetting(d.db, 'backup.lastExportAt');
  const nudgeDays = await readSetting(d.db, 'backup.nudgeDays');
  const today = d.clock.todayLocal();
  const first = await d.db.get<{ n: number; first: string | null }>(
    `SELECT COUNT(*) AS n, MIN(created_at) AS first FROM vehicles WHERE is_demo = 0 AND deleted_at IS NULL`,
  );
  const hasData = (first?.n ?? 0) > 0;
  const changesSinceBackup = hasData ? await countChanges(d.db, lastBackupAt ?? '') : 0;
  const daysSinceLastBackup = lastBackupAt === null ? null : Math.max(0, diffDays(lastBackupAt.slice(0, 10), today));
  // se non c'e' mai stato un backup il conto parte dal primo dato inserito
  const reference = lastBackupAt ?? first?.first ?? null;
  const days = reference === null ? 0 : Math.max(0, diffDays(reference.slice(0, 10), today));
  return {
    lastBackupAt,
    daysSinceLastBackup,
    hasData,
    changesSinceBackup,
    nudgeDays,
    needsReminder: hasData && changesSinceBackup >= NUDGE_MIN_CHANGES && days >= nudgeDays,
  };
}

const UPSERT_SETTING = `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;

/** Registra la data dell'ultimo backup (dopo un'esportazione o un'importazione il contatore delle modifiche riparte). */
export async function markBackupDone(db: SqlDatabase, nowIso: string): Promise<void> {
  await db.run(UPSERT_SETTING, ['backup.lastExportAt', JSON.stringify(nowIso), nowIso]);
}
