// Ripristino e importazione (SPEC F-07, 8.5, data.md 5.5).
//  - inspectBackup: anteprima senza scrivere nulla (data, conteggi, versione; NOT_A_BACKUP, BACKUP_TOO_NEW, ...);
//  - importBackup: copia di sicurezza (VACUUM INTO), allegati in cartella temporanea con hash verificato, transazione
//    esclusiva con defer_foreign_keys e foreign_key_check finale (qualsiasi violazione = ROLLBACK TOTALE), allegati
//    spostati dopo il commit, ricalcolo dei promemoria ed evento 'backup-imported'.
// Modalita' 'replace' svuota le tabelle utente e inserisce tutto; 'merge' fa upsert per id (vince `updated_at` piu'
// recente) e non cancella mai le righe con cancellazione morbida. Le righe figlie SENZA cancellazione morbida (righe
// intervento, garanzie) seguono il genitore: se vince il genitore locale restano solo le righe locali, se vince quello
// del backup le righe locali si sostituiscono con quelle del backup (un upsert per id le duplicherebbe o le farebbe
// risorgere, perche' updateServiceRecord e syncCoverages le rigenerano con nuovi ULID).
import type { SqlDatabase, SqlValue } from '@/domain/ports';
import type { FileDeps } from '../context';
import { baseName, joinPath, toFsPath } from '../attachments/paths';
import { runPendingFileDeletions } from '../attachments/pending';
import { sniffMime } from '../attachments/sniff';
import { EXPIRY_KEY_PREFIX, cleanupDanglingExpiryLinks } from '../attachments/store';
import { reconcileAll } from '../deadlines';
import { DEFAULTED_SETTING_KEYS, isValidSetting } from '../settings';
import type { DefaultedSettingKey } from '../settings';
import { openArchive } from './archive';
import type { OpenedArchive } from './archive';
import { BackupAbort, backupGuard, bok, mapImportSqlError } from './errors';
import type { BackupResult } from './errors';
import { LOCAL_SETTINGS, TABLES, countRows } from './format';
import type { BackupDocument, BackupRow, TableSpec } from './format';
import { markBackupDone } from './status';

export type ImportMode = 'replace' | 'merge';

export interface InspectOptions {
  /** Tetto di dimensione (default 2 GB, SPEC 8.5). */
  maxBytes?: number;
}

export interface ImportOptions extends InspectOptions {
  mode: ImportMode;
}

/** Un conflitto di targa: la stessa targa con ULID diverso. In «Unisci» fa fallire l'importazione (rollback totale). */
export interface PlateConflict {
  plate: string;
  localVehicleId: string;
  backupVehicleId: string;
}

export interface BackupPreview {
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  /** Istante UTC della creazione del backup. */
  exportedAt: string;
  includesTrash: boolean;
  /** Righe per tabella contenute nel file. */
  counts: Record<string, number>;
  /** Riepilogo per la schermata di conferma: «3 auto, 214 interventi, 36 allegati». */
  summary: { vehicles: number; services: number; fuelLogs: number; expenses: number; policies: number; reminders: number; attachments: number };
  /** Allegati con il file dentro il backup. */
  attachmentFiles: number;
  /** Allegati senza file (il backup non li conteneva): resteranno senza anteprima. */
  attachmentsWithoutFile: number;
  sizeBytes: number;
  /** true se il file e' un data.json «nudo» (nessun allegato). */
  jsonOnly: boolean;
  /** Auto presenti ora sul dispositivo (demo esclusa): «Sostituisci» le cancella. */
  localVehicles: number;
  plateConflicts: PlateConflict[];
}

export interface TableImportStats {
  inserted: number;
  updated: number;
  keptLocal: number;
}

export interface ImportResult {
  mode: ImportMode;
  /** «inseriti 214, aggiornati 3, mantenuti i locali 12» */
  inserted: number;
  updated: number;
  keptLocal: number;
  byTable: Record<string, TableImportStats>;
  attachmentFilesInstalled: number;
  /** ID degli allegati importati o aggiornati che non hanno il file (mancava nel backup o non si e' potuto copiare). */
  attachmentsWithoutFile: string[];
  /** Impostazioni del backup scartate perche' sconosciute o non valide. */
  skippedSettings: string[];
  /** Copia del database fatta prima dell'importazione (null se non e' riuscita in modalita' «Unisci»). */
  safetyCopyPath: string | null;
  backup: { exportedAt: string; appVersion: string; formatVersion: number };
}

const ID_RE = /^[0-9A-Za-z]{26}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const COLUMN_RE = /^[a-z][a-z0-9_]*$/;
const ALLOWED_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);
const KEEP_SAFETY_COPIES = 3;
const SAFETY_COPY_RE = /^pre-import-.*\.db$/;

const quote = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/**
 * Tabelle figlie senza cancellazione morbida che le funzioni d'uso rigenerano con nuovi ULID a ogni modifica del genitore:
 * in «Unisci» seguono il genitore invece di fare l'upsert per id (che duplicherebbe o farebbe risorgere le righe).
 */
const OWNED_CHILDREN: Readonly<Record<string, { parentTable: string; parentCol: string }>> = {
  service_lines: { parentTable: 'service_records', parentCol: 'service_record_id' },
  insurance_coverages: { parentTable: 'insurance_policies', parentCol: 'policy_id' },
};

// ------------------------------------------------------------------ lettura e validazione

async function loadBytes(d: FileDeps, source: Uint8Array | string): Promise<Uint8Array> {
  if (typeof source !== 'string') return source;
  try {
    return await d.fs.files.read(source);
  } catch {
    throw new BackupAbort('SOURCE_UNREADABLE', 'Non riesco a leggere il file scelto.');
  }
}

async function localSchemaVersion(db: SqlDatabase): Promise<number> {
  return (await db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM migrations_log'))?.v ?? 1;
}

/** Controlla le righe di una tabella contro lo schema locale: colonne note, valori scalari, id di 26 caratteri. */
function checkRows(t: TableSpec, raw: unknown, columns: ReadonlySet<string>): BackupRow[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new BackupAbort('BAD_DATA', `La tabella ${t.name} del backup non è valida.`);
  const rows: BackupRow[] = [];
  for (const r of raw as unknown[]) {
    if (typeof r !== 'object' || r === null || Array.isArray(r)) throw new BackupAbort('BAD_DATA', `Una riga di ${t.name} non è valida.`);
    const out: BackupRow = {};
    for (const [k, v] of Object.entries(r)) {
      if ((t.omit ?? []).includes(k)) continue; // colonne locali (es. obd_sessions.seq)
      if (!COLUMN_RE.test(k) || !columns.has(k)) throw new BackupAbort('BAD_DATA', `Colonna sconosciuta in ${t.name}: ${k.slice(0, 40)}.`);
      if (!(v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)))) {
        throw new BackupAbort('BAD_DATA', `Valore non valido in ${t.name}.${k}.`);
      }
      out[k] = v;
    }
    if (typeof out['id'] !== 'string' || !ID_RE.test(out['id'])) throw new BackupAbort('BAD_DATA', `Una riga di ${t.name} ha un id non valido.`);
    rows.push(out);
  }
  return rows;
}

interface Prepared {
  sizeBytes: number;
  archive: OpenedArchive;
  doc: BackupDocument;
  tables: Map<string, BackupRow[]>;
  columns: Map<string, Set<string>>;
}

async function tableColumns(db: SqlDatabase, table: string): Promise<Set<string>> {
  return new Set((await db.all<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name));
}

/** Apre il file, controlla formato, versione e hash e valida ogni riga contro lo schema locale. Non scrive nulla. */
async function prepare(d: FileDeps, source: Uint8Array | string, maxBytes: number | undefined): Promise<Prepared> {
  const bytes = await loadBytes(d, source);
  const archive = await openArchive(d, bytes, maxBytes);
  const doc = archive.doc;
  if (doc.schemaVersion > (await localSchemaVersion(d.db))) {
    throw new BackupAbort('BACKUP_TOO_NEW', "Questo backup contiene dati di una versione più recente dello schema: aggiorna l'app.");
  }
  const tables = new Map<string, BackupRow[]>();
  const columns = new Map<string, Set<string>>();
  for (const t of TABLES) {
    const cols = await tableColumns(d.db, t.name);
    columns.set(t.name, cols);
    const rows = checkRows(t, doc.data[t.name], cols);
    if (new Set(rows.map((r) => r['id'])).size !== rows.length) throw new BackupAbort('BAD_DATA', `La tabella ${t.name} contiene id duplicati.`);
    tables.set(t.name, rows);
  }
  for (const a of tables.get('attachments') ?? []) {
    const id = a['id'] as string;
    const path = a['stored_path'];
    if (typeof path !== 'string' || !new RegExp(`^attachments/${id}\\.[A-Za-z0-9]{1,8}$`).test(path)) {
      throw new BackupAbort('UNSAFE_PATH', 'Un allegato del backup ha un percorso non ammesso.');
    }
    if (typeof a['sha256'] !== 'string' || !SHA_RE.test(a['sha256'])) throw new BackupAbort('BAD_DATA', 'Un allegato del backup ha un hash non valido.');
    if (typeof a['mime_type'] !== 'string' || !ALLOWED_MIMES.has(a['mime_type'])) throw new BackupAbort('BAD_DATA', 'Un allegato del backup ha un tipo di file non ammesso.');
    const file = archive.files.get(path);
    if (file) {
      if (archive.hashes.get(path) !== a['sha256']) throw new BackupAbort('HASH_MISMATCH', `Il file ${path} non corrisponde al backup.`);
      if (sniffMime(file) === null) throw new BackupAbort('BAD_DATA', `Il file ${path} non è un'immagine o un PDF.`);
    }
  }
  return { sizeBytes: bytes.length, archive, doc, tables, columns };
}

/** Anteprima di un backup (ZIP o data.json) prima di confermare l'importazione. Non scrive nulla. */
export async function inspectBackup(
  d: FileDeps,
  source: Uint8Array | string,
  opts: InspectOptions = {},
): Promise<BackupResult<BackupPreview>> {
  return backupGuard(async () => {
    const { archive, doc, tables, sizeBytes } = await prepare(d, source, opts.maxBytes);
    const counts = countRows(doc);
    const attachments = tables.get('attachments') ?? [];
    const withFile = attachments.filter((a) => archive.files.has(String(a['stored_path']))).length;
    const local = await d.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM vehicles WHERE deleted_at IS NULL AND is_demo = 0');
    const plateConflicts: PlateConflict[] = [];
    for (const v of tables.get('vehicles') ?? []) {
      if (typeof v['plate'] !== 'string' || v['deleted_at']) continue;
      const clash = await d.db.get<{ id: string }>('SELECT id FROM vehicles WHERE plate = ? AND deleted_at IS NULL AND id <> ?', [v['plate'], v['id'] as string]);
      if (clash) plateConflicts.push({ plate: v['plate'], localVehicleId: clash.id, backupVehicleId: v['id'] as string });
    }
    return {
      formatVersion: doc.formatVersion,
      schemaVersion: doc.schemaVersion,
      appVersion: doc.appVersion,
      exportedAt: doc.exportedAt,
      includesTrash: doc.includesTrash,
      counts,
      summary: {
        vehicles: counts['vehicles'] ?? 0,
        services: counts['service_records'] ?? 0,
        fuelLogs: counts['fuel_logs'] ?? 0,
        expenses: counts['expenses'] ?? 0,
        policies: counts['insurance_policies'] ?? 0,
        reminders: counts['reminders'] ?? 0,
        attachments: counts['attachments'] ?? 0,
      },
      attachmentFiles: withFile,
      attachmentsWithoutFile: attachments.length - withFile,
      sizeBytes,
      jsonOnly: archive.jsonOnly,
      localVehicles: local?.n ?? 0,
      plateConflicts,
    };
  });
}

// ------------------------------------------------------------------ importazione

async function createSafetyCopy(d: FileDeps, nowIso: string): Promise<string> {
  const target = joinPath(d.fs.dirs.backups, `pre-import-${nowIso.replace(/[^0-9A-Za-z]/g, '-')}.db`);
  // VACUUM INTO non crea cartelle: un file vuoto crea la cartella ed e' una destinazione ammessa
  await d.fs.files.write(target, new Uint8Array(0));
  try {
    await d.db.exec(`VACUUM INTO '${toFsPath(target).replace(/'/g, "''")}'`);
  } catch (e) {
    await d.fs.files.remove(target).catch(() => undefined);
    throw e;
  }
  return target;
}

async function rotateSafetyCopies(d: FileDeps, keepPath: string | null): Promise<void> {
  const keepName = keepPath === null ? '' : baseName(keepPath);
  const names = (await d.fs.files.list(d.fs.dirs.backups)).map(baseName).filter((n) => SAFETY_COPY_RE.test(n));
  const old = names.filter((n) => n !== keepName).sort().reverse().slice(Math.max(0, KEEP_SAFETY_COPIES - 1));
  for (const n of old) await d.fs.files.remove(joinPath(d.fs.dirs.backups, n)).catch(() => undefined);
}

const UPSERT_SETTING = `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;
const INSERT_SETTING_IF_MISSING = `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`;

async function insertRow(tx: SqlDatabase, table: string, row: BackupRow): Promise<void> {
  const cols = Object.keys(row);
  const seq = table === 'obd_sessions';
  await tx.run(
    `INSERT INTO ${table} (${cols.map(quote).join(', ')}${seq ? ', seq' : ''}) VALUES (${cols.map(() => '?').join(', ')}${
      seq ? ', (SELECT COALESCE(MAX(seq), 0) + 1 FROM obd_sessions)' : ''
    })`,
    cols.map((c) => row[c] as SqlValue),
  );
}

async function updateRow(tx: SqlDatabase, table: string, row: BackupRow): Promise<void> {
  const cols = Object.keys(row).filter((c) => c !== 'id');
  await tx.run(`UPDATE ${table} SET ${cols.map((c) => `${quote(c)} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => row[c] as SqlValue), row['id'] as string]);
}

interface TxOutcome {
  byTable: Record<string, TableImportStats>;
  touchedAttachments: Set<string>;
  skippedSettings: string[];
}

/**
 * Importa un backup. Prima di toccare il database fa una copia di sicurezza con VACUUM INTO (in «Sostituisci», se non
 * riesce, l'importazione non parte). Qualsiasi errore nella transazione la annulla per intero: nessuna riga a meta'.
 * Dopo il commit: allegati nella cartella dell'app, coda dei vecchi file, ricalcolo dei promemoria ed evento
 * `{ type: 'backup-imported' }` (la sincronizzazione delle notifiche ripianifica).
 */
export async function importBackup(d: FileDeps, source: Uint8Array | string, opts: ImportOptions): Promise<BackupResult<ImportResult>> {
  const mode = opts.mode;
  if (mode !== 'replace' && mode !== 'merge') return { ok: false, error: { code: 'BAD_DATA', message: 'Modalità di importazione non valida.' } };
  const staged: string[] = [];
  const cleanupStaged = async (): Promise<void> => {
    for (const p of staged.splice(0)) await d.fs.files.remove(p).catch(() => undefined);
  };

  const res = await backupGuard(async () => {
    const prepared = await prepare(d, source, opts.maxBytes);
    const { doc, archive, tables } = prepared;
    const now = d.clock.nowIso();

    // 1. copia di sicurezza del database attuale
    let safetyCopyPath: string | null = null;
    try {
      safetyCopyPath = await createSafetyCopy(d, now);
    } catch {
      if (mode === 'replace') {
        throw new BackupAbort('SAFETY_COPY_FAILED', 'Non sono riuscito a fare la copia di sicurezza dei dati attuali: l\'importazione non è partita.');
      }
    }

    // 2. quali allegati vanno copiati (in «Unisci» solo quelli nuovi, piu' recenti o con il file locale mancante)
    const attachmentRows = tables.get('attachments') ?? [];
    const toInstall = new Map<string, BackupRow>();
    const repair = new Set<string>();
    if (mode === 'replace') {
      for (const a of attachmentRows) if (archive.files.has(String(a['stored_path']))) toInstall.set(a['id'] as string, a);
    } else {
      const local = await d.db.all<{ id: string; updated_at: string; sha256: string; stored_path: string }>(
        'SELECT id, updated_at, sha256, stored_path FROM attachments',
      );
      const byId = new Map(local.map((l) => [l.id, l]));
      for (const a of attachmentRows) {
        const path = String(a['stored_path']);
        if (!archive.files.has(path)) continue;
        const l = byId.get(a['id'] as string);
        if (!l || String(a['updated_at']) > l.updated_at) toInstall.set(a['id'] as string, a);
        else if (l.sha256 === a['sha256']) {
          const target = joinPath(d.fs.dirs.attachments, baseName(l.stored_path));
          if (!(await d.fs.files.exists(target))) {
            toInstall.set(a['id'] as string, a); // ripara un file locale mancante
            repair.add(a['id'] as string);
          }
        }
      }
    }

    // 3. copia in cartella temporanea (nomi piatti, senza sottocartelle) con hash riletto dal disco
    const runId = d.ids.ulid();
    for (const a of toInstall.values()) {
      const path = String(a['stored_path']);
      const p = joinPath(d.fs.dirs.temp, `import-${runId}-${baseName(path)}`);
      try {
        await d.fs.files.write(p, archive.files.get(path) as Uint8Array);
        staged.push(p);
        if ((await d.fs.files.sha256(p)) !== a['sha256']) throw new Error('hash');
      } catch {
        throw new BackupAbort('IO_ERROR', 'Non sono riuscito a copiare gli allegati (spazio insufficiente?): non è stato importato nulla.');
      }
    }

    // 4. transazione esclusiva: tutto o niente
    let outcome: TxOutcome;
    try {
      outcome = await d.db.transaction((tx) => applyImport(tx, prepared, mode, now), 'exclusive');
    } catch (e) {
      if (safetyCopyPath !== null) await d.fs.files.remove(safetyCopyPath).catch(() => undefined); // il database e' tornato com'era: la copia non serve
      // qualsiasi errore della transazione l'ha gia' annullata per intero: la UI riceve sempre un risultato
      throw mapImportSqlError(e) ?? new BackupAbort('IO_ERROR', `L'importazione non è riuscita (${e instanceof Error ? e.message.slice(0, 120) : 'errore sconosciuto'}). Non è stato importato nulla.`);
    }

    // 5. dopo il commit: gli allegati passano dalla cartella temporanea a quella dell'app
    const installed = new Set<string>();
    for (const [id, a] of toInstall) {
      if (!outcome.touchedAttachments.has(id) && !repair.has(id)) continue; // la transazione ha tenuto la riga locale
      try {
        await d.fs.files.write(joinPath(d.fs.dirs.attachments, baseName(String(a['stored_path']))), archive.files.get(String(a['stored_path'])) as Uint8Array);
        installed.add(id);
      } catch {
        // l'allegato resta senza file: lo segnala il risultato
      }
    }
    // da qui il commit e' avvenuto: le pulizie sono al meglio delle possibilita' e non trasformano un'importazione riuscita in un errore
    try {
      await cleanupStaged();
      await runPendingFileDeletions(d); // in «Sostituisci» i vecchi file escono dalla coda (mai quelli appena installati)
      await rotateSafetyCopies(d, safetyCopyPath);
    } catch {
      // le voci rimaste in coda si riprovano al prossimo avvio (runStorageMaintenance)
    }

    const withoutFile = [...outcome.touchedAttachments].filter((id) => !installed.has(id));
    let inserted = 0;
    let updated = 0;
    let keptLocal = 0;
    for (const s of Object.values(outcome.byTable)) {
      inserted += s.inserted;
      updated += s.updated;
      keptLocal += s.keptLocal;
    }
    const result: ImportResult = {
      mode,
      inserted,
      updated,
      keptLocal,
      byTable: outcome.byTable,
      attachmentFilesInstalled: installed.size,
      attachmentsWithoutFile: withoutFile.sort(),
      skippedSettings: outcome.skippedSettings,
      safetyCopyPath,
      backup: { exportedAt: doc.exportedAt, appVersion: doc.appVersion, formatVersion: doc.formatVersion },
    };
    return result;
  });

  if (!res.ok) {
    await cleanupStaged();
    return res;
  }
  try {
    await reconcileAll(d); // le colonne cache dei promemoria si ricalcolano sempre dopo un'importazione
  } catch {
    // i dati sono gia' importati: la riconciliazione si ripete a ogni avvio
  }
  d.events.emit({ type: 'backup-imported' });
  return bok(res.value);
}

async function applyImport(tx: SqlDatabase, p: Prepared, mode: ImportMode, now: string): Promise<TxOutcome> {
  const { doc, tables } = p;
  const byTable: Record<string, TableImportStats> = {};
  const touchedAttachments = new Set<string>();
  await tx.exec('PRAGMA defer_foreign_keys = ON'); // l'ordine di inserimento non conta: le FK si verificano al COMMIT

  if (mode === 'replace') {
    for (const t of [...TABLES].reverse()) await tx.exec(`DELETE FROM ${t.name}${t.deleteWhere ? ` WHERE ${t.deleteWhere}` : ''}`);
    await tx.exec(`DELETE FROM app_settings WHERE key GLOB '${EXPIRY_KEY_PREFIX}*'`);
  }

  const templates = new Set((await tx.all<{ id: string }>('SELECT id FROM service_templates')).map((r) => r.id));
  const adapterRemap = new Map<string, string>(); // «Unisci»: stesso adattatore (trasporto + indirizzo) con ULID diverso
  const verdicts = new Map<string, Map<string, 'inserted' | 'replaced' | 'kept'>>(); // «Unisci»: esito per genitore di righe figlie
  const verdictTables = new Set(Object.values(OWNED_CHILDREN).map((o) => o.parentTable));
  const replacedRows = new Map<string, string>(); // id -> updated_at delle righe figlie locali tolte perche' il genitore del backup e' piu' recente

  for (const t of TABLES) {
    const stats: TableImportStats = { inserted: 0, updated: 0, keptLocal: 0 };
    byTable[t.name] = stats;
    for (const row of tables.get(t.name) ?? []) {
      const r: BackupRow = { ...row };
      // riferimenti a cataloghi: una voce di un catalogo piu' recente non blocca l'importazione
      if (t.name === 'maintenance_items' && typeof r['template_id'] === 'string' && !templates.has(r['template_id'])) r['template_id'] = null;
      for (const col of t.name === 'vehicles' ? ['preferred_adapter_id'] : t.name === 'obd_sessions' ? ['adapter_id'] : []) {
        const v = r[col];
        if (typeof v === 'string' && adapterRemap.has(v)) r[col] = adapterRemap.get(v) as string;
      }
      const id = r['id'] as string;

      if (mode === 'replace') {
        await insertRow(tx, t.name, r);
        stats.inserted++;
        if (t.name === 'attachments') touchedAttachments.add(id);
        continue;
      }
      if (t.name === 'obd_adapters') {
        const same = await tx.get<{ id: string }>('SELECT id FROM obd_adapters WHERE transport = ? AND address = ? AND id <> ?', [
          r['transport'] as string,
          r['address'] as string,
          id,
        ]);
        if (same) {
          adapterRemap.set(id, same.id);
          stats.keptLocal++;
          continue;
        }
      }
      // righe figlie senza cancellazione morbida: decide il genitore (sempre elaborato prima, l'ordine di TABLES lo garantisce)
      const owner = OWNED_CHILDREN[t.name];
      const verdict = owner ? verdicts.get(owner.parentTable)?.get(String(r[owner.parentCol])) : undefined;
      if (verdict === 'kept') {
        stats.keptLocal++; // il genitore locale e' piu' recente (o uguale): restano solo le sue righe
        continue;
      }
      if (verdict === 'replaced') {
        // il genitore del backup e' piu' recente: le righe locali sono gia' state tolte, entrano quelle del backup
        const clash = await tx.get<{ id: string }>(`SELECT id FROM ${t.name} WHERE id = ?`, [id]); // stesso id sotto un altro genitore: caso anomalo
        if (clash) await updateRow(tx, t.name, r);
        else await insertRow(tx, t.name, r);
        const before = replacedRows.get(id);
        if (clash || (before !== undefined && before !== r['updated_at'])) stats.updated++;
        else if (before !== undefined) stats.keptLocal++; // identica a quella locale appena tolta
        else stats.inserted++;
        continue;
      }
      const exists = await tx.get<{ u: string }>(`SELECT updated_at AS u FROM ${t.name} WHERE id = ?`, [id]);
      let outcome: 'inserted' | 'replaced' | 'kept';
      if (!exists) {
        await insertRow(tx, t.name, r);
        stats.inserted++;
        outcome = 'inserted';
        if (t.name === 'attachments') touchedAttachments.add(id);
      } else if (typeof r['updated_at'] === 'string' && r['updated_at'] > exists.u) {
        await updateRow(tx, t.name, r);
        stats.updated++;
        outcome = 'replaced';
        if (t.name === 'attachments') touchedAttachments.add(id);
      } else {
        stats.keptLocal++;
        outcome = 'kept';
      }
      // genitore di righe figlie: ricorda chi ha vinto; se vince il backup, le righe locali del genitore si tolgono ora
      if (verdictTables.has(t.name)) {
        let m = verdicts.get(t.name);
        if (!m) verdicts.set(t.name, (m = new Map()));
        m.set(id, outcome);
        if (outcome === 'replaced') {
          for (const [childTable, o] of Object.entries(OWNED_CHILDREN)) {
            if (o.parentTable !== t.name) continue;
            for (const c of await tx.all<{ id: string; u: string }>(`SELECT id, updated_at AS u FROM ${childTable} WHERE ${o.parentCol} = ?`, [id])) {
              replacedRows.set(c.id, c.u);
            }
            await tx.run(`DELETE FROM ${childTable} WHERE ${o.parentCol} = ?`, [id]);
          }
        }
      }
    }
  }

  // impostazioni: solo chiavi note e valori validi; le impostazioni locali non si toccano mai
  const skippedSettings: string[] = [];
  for (const [key, value] of Object.entries(doc.settings)) {
    if (LOCAL_SETTINGS.has(key)) continue;
    const isKnown = (DEFAULTED_SETTING_KEYS as string[]).includes(key);
    const isLink = key.startsWith(EXPIRY_KEY_PREFIX) && ID_RE.test(key.slice(EXPIRY_KEY_PREFIX.length)) && typeof value === 'string' && ID_RE.test(value);
    if ((isKnown && !isValidSetting(key as DefaultedSettingKey, value)) || (!isKnown && !isLink)) {
      skippedSettings.push(key);
      continue;
    }
    await tx.run(mode === 'replace' ? UPSERT_SETTING : INSERT_SETTING_IF_MISSING, [key, JSON.stringify(value), now]);
  }
  // legami documento -> scadenza rimasti senza allegato o senza promemoria
  await cleanupDanglingExpiryLinks(tx);
  if ((tables.get('vehicles') ?? []).length > 0) await tx.run(UPSERT_SETTING, ['onboarding.done', 'true', now]);
  await markBackupDone(tx, now); // dopo un'importazione il contatore delle modifiche riparte
  // un file in coda di cancellazione che un allegato importato riusa non va rimosso
  await tx.exec('DELETE FROM pending_file_deletions WHERE stored_path IN (SELECT stored_path FROM attachments)');

  const bad = await tx.all<Record<string, SqlValue>>('PRAGMA foreign_key_check');
  if (bad.length > 0) throw new BackupAbort('FK_VIOLATION', `Il backup contiene riferimenti rotti (${JSON.stringify(bad[0]).slice(0, 120)}). Non è stato importato nulla.`);
  return { byTable, touchedAttachments, skippedSettings };
}
