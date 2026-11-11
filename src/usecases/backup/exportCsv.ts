// Esportazione CSV (SPEC F-08, data.md 5.4). Un CSV per entita'; se se ne chiede piu' di una il risultato e' uno ZIP.
// Il file va nella cartella temporanea dell'app (contiene dati personali): la UI lo condivide con `d.fs.sharer` e la
// cartella temporanea si svuota all'avvio successivo.
import type { FileDeps } from '../context';
import { joinPath } from '../attachments/paths';
import { utf8 } from './archive';
import { CSV_ENTITIES, CSV_ENTITY_NAMES, buildCsvFiles } from './csvEntities';
import type { CsvEntityName, CsvScope } from './csvEntities';
import type { CsvVariant } from './csv';
import { BackupAbort, backupGuard } from './errors';
import type { BackupResult } from './errors';

export interface ExportCsvOptions {
  /** 'excel-it': `;`, BOM, gg/mm/aaaa, virgola decimale. 'data': `,`, ISO, punto decimale, senza BOM. */
  variant: CsvVariant;
  /** Default: tutte le auto (demo esclusa). */
  scope?: CsvScope;
  /** Default: tutte le entita'. */
  entities?: readonly CsvEntityName[];
}

export interface ExportCsvResult {
  path: string;
  fileName: string;
  mimeType: 'text/csv' | 'application/zip';
  /** Le entita' esportate con il numero di righe. */
  files: { name: string; rows: number }[];
}

export async function exportCsv(d: FileDeps, opts: ExportCsvOptions): Promise<BackupResult<ExportCsvResult>> {
  return backupGuard(async () => {
    const scope = opts.scope ?? 'all';
    const entities = [...new Set(opts.entities ?? CSV_ENTITY_NAMES)];
    if (entities.length === 0 || entities.some((e) => !(e in CSV_ENTITIES))) throw new BackupAbort('BAD_DATA', 'Scegli almeno un elenco da esportare.');
    if (scope !== 'all') {
      const v = await d.db.get<{ id: string }>('SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [scope.vehicleId]);
      if (!v) throw new BackupAbort('ITEM_NOT_FOUND', "L'auto non esiste.");
    }
    const built = await d.db.transaction((tx) => buildCsvFiles(tx, opts.variant, scope, entities), 'deferred');
    const today = d.clock.todayLocal();
    const files = entities.map((e) => ({ name: e as string, rows: built.rows[e] ?? 0 }));

    if (entities.length === 1) {
      const name = entities[0] as CsvEntityName;
      const fileName = `MyGarage-${name}-${today}.csv`;
      const path = joinPath(d.fs.dirs.temp, fileName);
      await d.fs.files.write(path, utf8(built.files[CSV_ENTITIES[name].file] as string));
      return { path, fileName, mimeType: 'text/csv' as const, files };
    }
    const fileName = `MyGarage-CSV-${today}.zip`;
    const path = joinPath(d.fs.dirs.temp, fileName);
    const zip = d.fs.zip.zip(Object.entries(built.files).map(([name, text]) => ({ name, bytes: utf8(text) })));
    await d.fs.files.write(path, zip);
    return { path, fileName, mimeType: 'application/zip' as const, files };
  });
}
