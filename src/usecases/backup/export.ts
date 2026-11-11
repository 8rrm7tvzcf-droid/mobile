// Esportazione del backup (SPEC F-06, 8.5, data.md 5.2-5.3): ZIP completo `MyGarage-AAAA-MM-GG.zip` salvato in
// `d.fs.dirs.backups`. La UI lo condivide con `d.fs.sharer.shareFile(path, 'application/zip', ...)`: non si lascia il
// backup solo nello storage dell'app (sparisce con la disinstallazione).
import type { SqlDatabase } from '@/domain/ports';
import type { FileDeps } from '../context';
import { attachmentFilePath, baseName, joinPath } from '../attachments/paths';
import { EXPIRY_KEY_PREFIX } from '../attachments/store';
import { DEFAULTED_SETTING_KEYS } from '../settings';
import { buildArchive } from './archive';
import { buildCsvFiles } from './csvEntities';
import type { CsvVariant } from './csv';
import { BackupAbort, backupGuard } from './errors';
import type { BackupResult } from './errors';
import { BACKUP_FORMAT, FORMAT_VERSION, LOCAL_SETTINGS, TABLES } from './format';
import type { BackupDocument, BackupFileRef, BackupRow } from './format';
import { markBackupDone } from './status';

export interface ExportBackupOptions {
  /** Versione dell'app (Constants.expoConfig.version), scritta nel file; i casi d'uso non importano Expo. */
  appVersion?: string;
  /** Include anche gli elementi nel cestino (default: no). */
  includeTrash?: boolean;
  /** Aggiunge la cartella `csv/` con le esportazioni nella variante indicata (default: nessuna). */
  csv?: CsvVariant | false;
}

export interface SkippedBackupFile {
  attachmentId: string;
  path: string;
  /** Il file non e' piu' nello storage dell'app: la riga resta nel backup, senza il file. */
  reason: 'missing';
}

export interface ExportBackupResult {
  /** Percorso (o URI) dello ZIP in `d.fs.dirs.backups`: passalo a `d.fs.sharer.shareFile`. */
  path: string;
  fileName: string;
  mimeType: 'application/zip';
  sizeBytes: number;
  exportedAt: string;
  counts: Record<string, number>;
  /** Quanti allegati sono nello ZIP. */
  attachmentFiles: number;
  skippedFiles: SkippedBackupFile[];
}

export const BACKUP_FILE_RE = /^MyGarage-\d{4}-\d{2}-\d{2}.*\.zip$/;
/** Quanti backup tenere nella cartella dell'app (i piu' recenti). */
export const KEEP_BACKUPS = 3;

/** Il nome del file di backup per una data locale: `MyGarage-2026-10-13.zip`. */
export const backupFileName = (todayLocal: string): string => `MyGarage-${todayLocal}.zip`;

/**
 * Legge tutte le tabelle utente e costruisce il documento `data.json` (senza toccare i file). Va chiamata su una
 * transazione di lettura per avere un'istantanea coerente. Applica le regole di esclusione di SPEC 8.5.
 */
export async function collectBackupData(
  db: SqlDatabase,
  o: { includeTrash: boolean; appVersion: string; exportedAt: string },
): Promise<BackupDocument> {
  const data: Record<string, BackupRow[]> = {};
  const ids: Record<string, Set<string>> = {};
  for (const t of TABLES) {
    const conds: string[] = [];
    if (t.soft && !o.includeTrash && !t.ref) conds.push('deleted_at IS NULL');
    if (t.where) conds.push(t.where);
    const all = await db.all<BackupRow>(
      `SELECT * FROM ${t.name}${conds.length > 0 ? ` WHERE ${conds.join(' AND ')}` : ''} ORDER BY ${t.orderBy ?? 'id'}`,
    );
    const has = (table: string, v: unknown): boolean => ids[table]?.has(String(v)) === true;
    // potatura: i figli di un genitore escluso (cestino, auto demo) non si esportano
    const rows = all
      .map((r) => ({ ...r }))
      .filter(
        (r) =>
          t.parents.every(([col, p]) => has(p, r[col])) &&
          (t.optionalParents ?? []).every(([col, p]) => r[col] === null || r[col] === undefined || has(p, r[col])),
      );
    const kept = new Set(rows.map((r) => String(r['id'])));
    for (const r of rows) {
      for (const [col, p] of t.nullRefs ?? []) {
        const v = r[col];
        if (v !== null && v !== undefined && !(p === t.name ? kept.has(String(v)) : has(p, v))) r[col] = null; // come ON DELETE SET NULL
      }
      for (const k of t.omit ?? []) delete r[k];
      for (const k of t.nulls ?? []) r[k] = null;
    }
    data[t.name] = rows;
    ids[t.name] = kept;
  }

  const settings: Record<string, unknown> = {};
  for (const s of await db.all<{ key: string; value: string }>('SELECT key, value FROM app_settings ORDER BY key')) {
    if (LOCAL_SETTINGS.has(s.key)) continue;
    let v: unknown;
    try {
      v = JSON.parse(s.value);
    } catch {
      continue;
    }
    if ((DEFAULTED_SETTING_KEYS as string[]).includes(s.key)) settings[s.key] = v;
    else if (s.key.startsWith(EXPIRY_KEY_PREFIX)) {
      // legame documento -> scadenza: solo se entrambi viaggiano nel backup
      if (ids['attachments']?.has(s.key.slice(EXPIRY_KEY_PREFIX.length)) && typeof v === 'string' && ids['reminders']?.has(v)) settings[s.key] = v;
    }
  }

  const files: BackupFileRef[] = (data['attachments'] ?? []).map((a) => ({
    attachmentId: String(a['id']),
    path: String(a['stored_path']),
    sha256: String(a['sha256']),
    size: Number(a['size_bytes']),
  }));
  const schema = await db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM migrations_log');
  const device = await db.get<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'device.id'`);
  let deviceId: string | null = null;
  try {
    const parsed: unknown = device ? JSON.parse(device.value) : null;
    deviceId = typeof parsed === 'string' ? parsed : null;
  } catch {
    deviceId = null;
  }
  return {
    format: BACKUP_FORMAT,
    formatVersion: FORMAT_VERSION,
    schemaVersion: schema?.v ?? 1,
    appVersion: o.appVersion,
    exportedAt: o.exportedAt,
    sourceDeviceId: deviceId,
    includesTrash: o.includeTrash,
    counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
    settings,
    data,
    files,
  };
}

/** Tiene gli ultimi `KEEP_BACKUPS` ZIP nella cartella dei backup (mai quello appena scritto). */
async function rotateBackups(d: FileDeps, keepName: string): Promise<void> {
  const names = (await d.fs.files.list(d.fs.dirs.backups)).map(baseName).filter((n) => BACKUP_FILE_RE.test(n));
  const old = names.filter((n) => n !== keepName).sort().reverse().slice(Math.max(0, KEEP_BACKUPS - 1));
  for (const n of old) await d.fs.files.remove(joinPath(d.fs.dirs.backups, n)).catch(() => undefined);
}

/**
 * Esporta il backup completo. Esclude telemetria, notification_schedule, pending_file_deletions, migrations_log, cataloghi
 * di sistema, impostazioni locali, cestino (salvo `includeTrash`) e l'auto demo. Registra la data dell'ultimo backup.
 *
 * Un allegato che non e' piu' nello storage viene saltato e segnalato in `skippedFiles`; un allegato con hash diverso da
 * quello registrato (file alterato) blocca l'esportazione con `HASH_MISMATCH`.
 */
export async function exportBackup(d: FileDeps, opts: ExportBackupOptions = {}): Promise<BackupResult<ExportBackupResult>> {
  return backupGuard(async () => {
    const exportedAt = d.clock.nowIso();
    const snapshot = await d.db.transaction(async (tx) => {
      const doc = await collectBackupData(tx, { includeTrash: opts.includeTrash === true, appVersion: opts.appVersion ?? 'sconosciuta', exportedAt });
      const csv = opts.csv ? (await buildCsvFiles(tx, opts.csv, 'all')).files : {};
      return { doc, csv };
    }, 'deferred');
    const doc = snapshot.doc;

    const fileBytes = new Map<string, Uint8Array>();
    const present: BackupFileRef[] = [];
    const skippedFiles: SkippedBackupFile[] = [];
    for (const f of doc.files) {
      const p = attachmentFilePath(d.fs.dirs, f.path);
      if (p === null || !(await d.fs.files.exists(p))) {
        skippedFiles.push({ attachmentId: f.attachmentId, path: f.path, reason: 'missing' });
        continue;
      }
      const bytes = await d.fs.files.read(p);
      if ((await d.fs.hash.sha256Hex(bytes)) !== f.sha256) {
        throw new BackupAbort('HASH_MISMATCH', `Il file allegato ${f.path} è stato alterato e non può entrare nel backup.`);
      }
      fileBytes.set(f.path, bytes);
      present.push(f);
    }
    doc.files = present;

    const zip = await buildArchive(d, doc, fileBytes, snapshot.csv);
    const fileName = backupFileName(d.clock.todayLocal());
    const path = joinPath(d.fs.dirs.backups, fileName);
    await d.fs.files.write(path, zip);
    await rotateBackups(d, fileName).catch(() => undefined); // la rotazione e' una pulizia: non deve far fallire un backup riuscito
    await d.db.transaction((tx) => markBackupDone(tx, exportedAt), 'exclusive');
    d.events.emit({ type: 'data-changed', scope: 'settings' });

    return {
      path,
      fileName,
      mimeType: 'application/zip' as const,
      sizeBytes: zip.length,
      exportedAt,
      counts: doc.counts,
      attachmentFiles: present.length,
      skippedFiles,
    };
  });
}
