// Manutenzione dei dati all'avvio (SPEC 8.6, passo 4; data.md 1.4 e 2.5):
//   - cestino: cancella DEFINITIVAMENTE le righe con soft delete piu' vecchie di trash.retentionDays (30);
//   - coda dei file da cancellare (pending_file_deletions): rimuove i file e poi le righe, riprova al prossimo avvio;
//   - telemetria: i campioni grezzi piu' vecchi di telemetry.rawRetentionDays o oltre telemetry.maxMb diventano
//     rollup a 60 s (min/max/media) e la sessione riceve samples_pruned_at; le statistiche di sessione restano.
// Ogni passo e' indipendente e un errore non blocca l'avvio dell'app: finisce in `errors`.
import type { Clock, FileStore, SqlDatabase } from '@/domain/ports';
import { createSettingsRepository } from '../repositories/settingsRepository';

/** Tabelle con soft delete (colonna deleted_at) che hanno un cestino. Le figlie di dettaglio cadono in cascata. */
export const TRASH_TABLES = [
  'attachments',
  'reminders',
  'maintenance_completions',
  'maintenance_items',
  'insurance_payments',
  'insurance_policies',
  'tyre_fitments',
  'tyre_sets',
  'dtc_events',
  'odometer_readings',
  'fluid_checks',
  'expenses',
  'fuel_logs',
  'service_records',
  'workshops',
  'vehicles',
  'obd_adapters',
] as const;

/** Stima dei byte per riga di telemetry_samples (misurata in data.md 1.4: ~25 byte/riga con chiavi intere). */
export const TELEMETRY_ROW_BYTES = 25;
export const ROLLUP_BUCKET_MS = 60_000;

export type PurgeSummary = Record<string, number>;

/**
 * Elimina definitivamente le righe cancellate (soft delete) da piu' di `retentionDays` giorni.
 * Le categorie di spesa create dall'utente si eliminano solo se nessuna spesa le usa (FK RESTRICT).
 */
export async function purgeTrash(
  db: SqlDatabase,
  opts: { nowIso: string; retentionDays: number },
): Promise<PurgeSummary> {
  const days = Math.max(0, Math.trunc(opts.retentionDays));
  const cutoff = `strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-${days} days')`;
  const summary: PurgeSummary = {};
  await db.transaction(async (tx) => {
    for (const table of TRASH_TABLES) {
      const { changes } = await tx.run(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}`, [opts.nowIso]);
      if (changes > 0) summary[table] = changes;
    }
    const { changes } = await tx.run(
      `DELETE FROM expense_categories
       WHERE is_system = 0 AND deleted_at IS NOT NULL AND deleted_at < ${cutoff}
         AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.category_id = expense_categories.id)`,
      [opts.nowIso],
    );
    if (changes > 0) summary['expense_categories'] = changes;
  }, 'exclusive');
  return summary;
}

export interface FileDeletionResult {
  removed: number;
  failed: number;
}

/**
 * Svuota la coda dei file da cancellare, riempita dal trigger trg_attachments_gc quando una riga di allegato
 * viene eliminata. Un file che non si riesce a rimuovere resta in coda (si riprova al prossimo avvio).
 */
export async function processPendingFileDeletions(
  db: SqlDatabase,
  files: Pick<FileStore, 'exists' | 'remove'>,
): Promise<FileDeletionResult> {
  const rows = await db.all<{ id: number; stored_path: string }>('SELECT id, stored_path FROM pending_file_deletions ORDER BY id');
  let removed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (await files.exists(row.stored_path)) await files.remove(row.stored_path);
      await db.run('DELETE FROM pending_file_deletions WHERE id = ?', [row.id]);
      removed++;
    } catch {
      failed++;
    }
  }
  return { removed, failed };
}

export interface TelemetryRetentionResult {
  prunedSessions: number;
  rollupRows: number;
  deletedSamples: number;
}

/** Trasforma i campioni grezzi di una sessione in rollup a 60 s e li elimina. Restituisce righe di rollup e campioni tolti. */
async function pruneSession(
  tx: SqlDatabase,
  seq: number,
  nowIso: string,
): Promise<{ rollupRows: number; deletedSamples: number }> {
  await tx.run('DELETE FROM telemetry_rollups WHERE session_seq = ?', [seq]); // un'esecuzione interrotta non lascia doppioni
  const rollups = await tx.run(
    `INSERT INTO telemetry_rollups (session_seq, pid, bucket, n, v_min, v_max, v_avg)
     SELECT session_seq, pid, t_ms / ${ROLLUP_BUCKET_MS}, count(*), min(value), max(value), avg(value)
     FROM telemetry_samples WHERE session_seq = ? GROUP BY session_seq, pid, t_ms / ${ROLLUP_BUCKET_MS}`,
    [seq],
  );
  const deleted = await tx.run('DELETE FROM telemetry_samples WHERE session_seq = ?', [seq]);
  await tx.run('UPDATE obd_sessions SET samples_pruned_at = ? WHERE seq = ?', [nowIso, seq]);
  return { rollupRows: rollups.changes, deletedSamples: deleted.changes };
}

/**
 * Retention della telemetria: prima le sessioni piu' vecchie di `rawRetentionDays`, poi (se i campioni grezzi
 * superano `maxMb`, stimati a 25 byte/riga) le piu' vecchie rimaste finche' si rientra nel limite.
 */
export async function applyTelemetryRetention(
  db: SqlDatabase,
  opts: { nowIso: string; rawRetentionDays: number; maxMb: number },
): Promise<TelemetryRetentionResult> {
  const days = Math.max(0, Math.trunc(opts.rawRetentionDays));
  const maxRows = Math.floor((Math.max(0, opts.maxMb) * 1_000_000) / TELEMETRY_ROW_BYTES);
  const result: TelemetryRetentionResult = { prunedSessions: 0, rollupRows: 0, deletedSamples: 0 };
  await db.transaction(async (tx) => {
    const old = await tx.all<{ seq: number }>(
      `SELECT seq FROM obd_sessions
       WHERE samples_pruned_at IS NULL AND started_at < strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-${days} days')
         AND EXISTS (SELECT 1 FROM telemetry_samples s WHERE s.session_seq = obd_sessions.seq)
       ORDER BY started_at, seq`,
      [opts.nowIso],
    );
    for (const { seq } of old) {
      const r = await pruneSession(tx, seq, opts.nowIso);
      result.prunedSessions++;
      result.rollupRows += r.rollupRows;
      result.deletedSamples += r.deletedSamples;
    }
    // limite di dimensione: dalle sessioni piu' vecchie in poi
    let total = (await tx.get<{ n: number }>('SELECT count(*) AS n FROM telemetry_samples'))?.n ?? 0;
    while (total > maxRows) {
      const next = await tx.get<{ seq: number }>(
        `SELECT seq FROM obd_sessions
         WHERE samples_pruned_at IS NULL AND EXISTS (SELECT 1 FROM telemetry_samples s WHERE s.session_seq = obd_sessions.seq)
         ORDER BY started_at, seq LIMIT 1`,
      );
      if (!next) break;
      const r = await pruneSession(tx, next.seq, opts.nowIso);
      result.prunedSessions++;
      result.rollupRows += r.rollupRows;
      result.deletedSamples += r.deletedSamples;
      total -= r.deletedSamples;
    }
  }, 'exclusive');
  return result;
}

export interface MaintenanceDeps {
  clock: Pick<Clock, 'nowIso'>;
  /** Per cancellare i file degli allegati rimossi; senza, la coda resta intatta. */
  files?: Pick<FileStore, 'exists' | 'remove'>;
}

export interface MaintenanceReport {
  trash?: PurgeSummary;
  files?: FileDeletionResult;
  telemetry?: TelemetryRetentionResult;
  /** Messaggi dei passi falliti: l'app parte comunque. */
  errors: string[];
}

/** Passo 4 della sequenza di avvio. Legge i parametri da app_settings. */
export async function runDataMaintenance(db: SqlDatabase, deps: MaintenanceDeps): Promise<MaintenanceReport> {
  const report: MaintenanceReport = { errors: [] };
  const nowIso = deps.clock.nowIso();
  const settings = createSettingsRepository(db, deps.clock);
  const step = async (label: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      report.errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  await step('cestino', async () => {
    report.trash = await purgeTrash(db, { nowIso, retentionDays: await settings.get('trash.retentionDays') });
  });
  if (deps.files) {
    const files = deps.files;
    await step('coda file', async () => {
      report.files = await processPendingFileDeletions(db, files);
    });
  }
  await step('telemetria', async () => {
    report.telemetry = await applyTelemetryRetention(db, {
      nowIso,
      rawRetentionDays: await settings.get('telemetry.rawRetentionDays'),
      maxMb: await settings.get('telemetry.maxMb'),
    });
  });
  return report;
}
