// Coda dei file da cancellare (pending_file_deletions). Il trigger trg_attachments_gc la riempie nella STESSA transazione
// che elimina la riga dell'allegato; i file si rimuovono dopo il commit e solo allora si toglie la riga dalla coda:
// un crash nel mezzo lascia la voce in coda e il file viene rimosso al prossimo avvio (runPendingFileDeletions).
import type { FileDeps } from '../context';
import { attachmentFilePath } from './paths';

export interface PendingDeletionResult {
  removed: number;
  failed: number;
}

/**
 * Svuota la coda. Da chiamare all'avvio e dopo ogni eliminazione definitiva. Non rimuove mai un file ancora
 * referenziato da un allegato (es. un backup importato che riusa lo stesso percorso). Un file che non si riesce a
 * rimuovere resta in coda e si riprova al prossimo avvio.
 */
export async function runPendingFileDeletions(d: Pick<FileDeps, 'db' | 'fs'>): Promise<PendingDeletionResult> {
  const rows = await d.db.all<{ id: number; stored_path: string }>('SELECT id, stored_path FROM pending_file_deletions ORDER BY id');
  let removed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const inUse = await d.db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM attachments WHERE stored_path = ? OR thumb_path = ?',
        [row.stored_path, row.stored_path],
      );
      const target = attachmentFilePath(d.fs.dirs, row.stored_path);
      if (target !== null && (inUse?.n ?? 0) === 0 && (await d.fs.files.exists(target))) {
        await d.fs.files.remove(target);
        removed++;
      }
      // percorso non sicuro o file gia' assente o ancora in uso: la voce non serve piu'
      await d.db.run('DELETE FROM pending_file_deletions WHERE id = ?', [row.id]);
    } catch {
      failed++;
    }
  }
  return { removed, failed };
}
