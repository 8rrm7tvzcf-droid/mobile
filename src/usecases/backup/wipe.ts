// «Cancella tutti i dati» (SPEC F-09, 6.3.11, data.md 6.3): procedura verificabile.
// Qui sta la parte che i casi d'uso possono fare: notifiche, righe di tutte le tabelle utente, impostazioni ai predefiniti,
// file di attachments/, backups/ e temp/. Restano ai livelli sopra (bootstrap/UI): digitare «ELIMINA», nuova
// autenticazione se il blocco e' attivo, annullare il task `mg-replan`, svuotare SecureStore e le preferenze locali,
// cancellare i file del database con la connessione chiusa e ripartire dall'onboarding.
import type { SqlDatabase } from '@/domain/ports';
import type { NotificationScheduler } from '@/domain/ports';
import type { FileDeps } from '../context';
import { clearDir, listTree } from '../attachments/paths';
import { DEFAULTED_SETTING_KEYS, SETTING_DEFAULTS } from '../settings';
import { TABLES } from './format';

export type WipeDeps = FileDeps & { scheduler: NotificationScheduler };

export interface WipeReport {
  /** Notifiche pianificate annullate. */
  notificationsCancelled: number;
  /** false se il sistema non ha permesso di elencarle o annullarle: la UI avvisa l'utente. */
  notificationsOk: boolean;
  /** Voci rimosse da attachments/, backups/ e temp/. */
  filesRemoved: number;
  verification: {
    /** Righe rimaste per tabella (solo quelle non vuote). */
    rowsLeft: Record<string, number>;
    /** Voci rimaste nelle tre cartelle (percorsi relativi, con il nome della cartella davanti). */
    filesLeft: string[];
  };
  /** true se la verifica non ha trovato niente: database vuoto e cartelle vuote. */
  complete: boolean;
}

const SCOPES = ['vehicles', 'odometer', 'service', 'fuel', 'insurance', 'reminders', 'settings'] as const;

async function countRows(db: SqlDatabase, table: string, where?: string): Promise<number> {
  return (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ''}`))?.n ?? 0;
}

/**
 * Cancella tutti i dati dell'utente. I cataloghi di sistema (modelli di scadenza, categorie di spesa di sistema) e
 * `device.id` restano. Idempotente: se qualcosa non si e' potuto togliere (`complete: false`) si puo' ripetere.
 * I backup gia' esportati e condivisi (cloud, mail, PC) non si possono cancellare dall'app: la UI lo avvisa.
 */
export async function wipeAllData(d: WipeDeps): Promise<WipeReport> {
  // 1. notifiche pianificate
  let notificationsCancelled = 0;
  let notificationsOk = true;
  try {
    const scheduled = await d.scheduler.listScheduled();
    await d.scheduler.cancel(scheduled.map((s) => s.key));
    notificationsCancelled = scheduled.length;
  } catch {
    notificationsOk = false;
  }

  // 2. database: pagine cancellate azzerate (secure_delete) e righe di tutte le tabelle utente
  await d.db.exec('PRAGMA secure_delete = ON');
  const now = d.clock.nowIso();
  await d.db.transaction(async (tx) => {
    await tx.exec('PRAGMA defer_foreign_keys = ON');
    await tx.exec('DELETE FROM telemetry_samples');
    await tx.exec('DELETE FROM telemetry_rollups');
    await tx.exec('DELETE FROM notification_schedule');
    for (const t of [...TABLES].reverse()) await tx.exec(`DELETE FROM ${t.name}${t.deleteWhere ? ` WHERE ${t.deleteWhere}` : ''}`);
    await tx.exec('DELETE FROM pending_file_deletions');
    // impostazioni: tutto ai predefiniti (device.id e' un ULID casuale, non un dato dell'utente: resta)
    await tx.exec(`DELETE FROM app_settings WHERE key <> 'device.id'`);
    for (const key of DEFAULTED_SETTING_KEYS) {
      await tx.run('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)', [key, JSON.stringify(SETTING_DEFAULTS[key]), now]);
    }
  }, 'exclusive');

  // 3. file: allegati, copie di sicurezza e backup, temporanei
  let filesRemoved = 0;
  const dirs = { attachments: d.fs.dirs.attachments, backups: d.fs.dirs.backups, temp: d.fs.dirs.temp };
  for (const dir of Object.values(dirs)) filesRemoved += await clearDir(d.fs.files, dir);

  // 4. residui nel file del database: VACUUM riscrive il file, il checkpoint svuota il WAL (se non applicabili si ignora)
  for (const sql of ['VACUUM', 'PRAGMA wal_checkpoint(TRUNCATE)']) {
    try {
      await d.db.exec(sql);
    } catch {
      // non applicabile su questo motore: secure_delete ha gia' azzerato le pagine
    }
  }

  // 5. verifica
  const rowsLeft: Record<string, number> = {};
  const extra = ['telemetry_samples', 'telemetry_rollups', 'notification_schedule', 'pending_file_deletions'];
  for (const t of TABLES) {
    const n = await countRows(d.db, t.name, t.deleteWhere);
    if (n > 0) rowsLeft[t.name] = n;
  }
  for (const t of extra) {
    const n = await countRows(d.db, t);
    if (n > 0) rowsLeft[t] = n;
  }
  const filesLeft: string[] = [];
  for (const [name, dir] of Object.entries(dirs)) for (const rel of await listTree(d.fs.files, dir)) filesLeft.push(`${name}/${rel}`);

  for (const scope of SCOPES) d.events.emit({ type: 'data-changed', scope });
  return {
    notificationsCancelled,
    notificationsOk,
    filesRemoved,
    verification: { rowsLeft, filesLeft },
    complete: Object.keys(rowsLeft).length === 0 && filesLeft.length === 0,
  };
}
