// Cestino di 30 giorni (SPEC F-05) per tutte le entita' con eliminazione recuperabile e pulizia dello storage all'avvio.
// Le auto (`purgeExpiredTrash` in '../vehicles') e gli allegati (`purgeExpiredAttachments`) hanno gia' il loro svuotamento;
// qui c'e' quello degli altri registri (rifornimenti, interventi, spese, polizze, ...) e il passaggio che li riunisce.
import { addDays } from '@/domain/dates';
import type { DomainEvent } from '@/domain/ports';
import type { FileDeps } from '../context';
import { readSetting } from '../settings';
import { purgeExpiredTrash as purgeExpiredVehicles } from '../vehicles';
import { purgeExpiredAttachments } from './attachments';
import { clearDir } from './paths';
import { runPendingFileDeletions } from './pending';
import { cleanupDanglingExpiryLinks } from './store';

type Scope = Extract<DomainEvent, { type: 'data-changed' }>['scope'];

// L'eliminazione definitiva di una riga cancella a cascata i figli (righe di intervento, rate, completamenti, letture km
// collegate, allegati: per questi il trigger accoda i file) e imposta a NULL i riferimenti morbidi (officina, rinnovo).
const PURGEABLE: readonly { table: string; scope: Scope; extra?: string }[] = [
  { table: 'reminders', scope: 'reminders' },
  { table: 'insurance_payments', scope: 'insurance' },
  { table: 'insurance_policies', scope: 'insurance' },
  { table: 'fuel_logs', scope: 'fuel' },
  { table: 'service_records', scope: 'service' },
  { table: 'fluid_checks', scope: 'service' },
  { table: 'expenses', scope: 'vehicles' },
  { table: 'odometer_readings', scope: 'odometer' },
  { table: 'maintenance_completions', scope: 'reminders' },
  { table: 'maintenance_items', scope: 'reminders' },
  { table: 'tyre_fitments', scope: 'vehicles' },
  { table: 'tyre_sets', scope: 'vehicles' },
  { table: 'dtc_events', scope: 'vehicles' },
  { table: 'workshops', scope: 'service' },
  // una categoria di spesa dell'utente si elimina solo se nessuna spesa (nemmeno nel cestino) la usa: il vincolo e' RESTRICT
  {
    table: 'expense_categories',
    scope: 'vehicles',
    extra: 'AND is_system = 0 AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.category_id = expense_categories.id)',
  },
];

/**
 * Elimina definitivamente le righe nel cestino da piu' di `trash.retentionDays` giorni (rifornimenti, interventi, spese,
 * controlli, letture km, polizze e rate, scadenze, regole, gomme, codici errore, officine, categorie dell'utente).
 * I file degli allegati collegati escono dalla coda `pending_file_deletions`.
 */
export async function purgeExpiredRecords(d: FileDeps): Promise<{ total: number; byTable: Record<string, number> }> {
  const retention = await readSetting(d.db, 'trash.retentionDays');
  const cutoff = addDays(d.clock.todayLocal(), -retention); // eliminata il giorno X: definitiva a X + retention
  const byTable: Record<string, number> = {};
  const scopes = new Set<Scope>();
  await d.db.transaction(async (tx) => {
    for (const p of PURGEABLE) {
      const r = await tx.run(`DELETE FROM ${p.table} WHERE deleted_at IS NOT NULL AND substr(deleted_at, 1, 10) <= ? ${p.extra ?? ''}`, [cutoff]);
      if (r.changes > 0) {
        byTable[p.table] = r.changes;
        scopes.add(p.scope);
      }
    }
    await cleanupDanglingExpiryLinks(tx);
  }, 'exclusive');
  const total = Object.values(byTable).reduce((n, c) => n + c, 0);
  if (total > 0) {
    await runPendingFileDeletions(d);
    for (const scope of scopes) d.events.emit({ type: 'data-changed', scope });
  }
  return { total, byTable };
}

export interface StorageMaintenanceReport {
  vehiclesPurged: number;
  recordsPurged: number;
  attachmentsPurged: number;
  /** File degli allegati eliminati rimossi dalla coda. */
  pendingFilesRemoved: number;
  /** Voci rimosse dalla cartella temporanea (esportazioni condivise, copie del selettore, avanzi di un'importazione). */
  tempFilesRemoved: number;
  /** Passi che non sono riusciti (gli altri sono stati eseguiti). */
  errors: string[];
}

/**
 * Pulizia all'avvio dell'app: cestino scaduto (auto, registri, allegati), coda dei file da cancellare e cartella
 * temporanea. Idempotente; un passo che fallisce non ferma gli altri.
 */
export async function runStorageMaintenance(d: FileDeps): Promise<StorageMaintenanceReport> {
  const report: StorageMaintenanceReport = {
    vehiclesPurged: 0,
    recordsPurged: 0,
    attachmentsPurged: 0,
    pendingFilesRemoved: 0,
    tempFilesRemoved: 0,
    errors: [],
  };
  const step = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      report.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  await step('auto nel cestino', async () => void (report.vehiclesPurged = await purgeExpiredVehicles(d)));
  await step('registri nel cestino', async () => void (report.recordsPurged = (await purgeExpiredRecords(d)).total));
  await step('allegati nel cestino', async () => void (report.attachmentsPurged = await purgeExpiredAttachments(d)));
  await step('coda dei file', async () => void (report.pendingFilesRemoved = (await runPendingFileDeletions(d)).removed));
  await step('cartella temporanea', async () => void (report.tempFilesRemoved = await clearDir(d.fs.files, d.fs.dirs.temp)));
  return report;
}
