// ZIP del backup (data.md 5.3): manifest.json + data.json + attachments/<ULID>.<ext> (+ csv/*.csv).
// La compressione passa dalla porta ZipCodec (in memoria); qui stanno la sicurezza (zip-slip, tetto di dimensione,
// hash ricontrollati) e la forma del manifest.
import type { FileDeps } from '../context';
import { isFlatStoredPath } from '../attachments/paths';
import { BackupAbort } from './errors';
import { BACKUP_FORMAT, upgradeBackup } from './format';
import type { BackupDocument } from './format';

/** Tetto di dimensione (2 GB), sia dell'archivio sia della somma dei contenuti decompressi. */
export const MAX_ARCHIVE_BYTES = 2 * 1024 ** 3;

export interface Manifest {
  format: string;
  formatVersion: number;
  exportedAt: string;
  files: { path: string; sha256: string; size: number }[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');
export const utf8 = (s: string): Uint8Array => encoder.encode(s);
export const fromUtf8 = (b: Uint8Array): string => decoder.decode(b);

/** Una voce dello ZIP e' sicura se non puo' uscire dalla cartella di destinazione (zip-slip). */
export function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > 255) return false;
  if (name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name)) return false;
  if (/[\u0000-\u001f]/.test(name)) return false;
  return !name.split('/').some((seg, i, all) => seg === '..' || seg === '.' || (seg === '' && i !== all.length - 1));
}

/** Costruisce lo ZIP. I file allegati sono gia' stati letti e verificati: `fileBytes` associa stored_path -> byte. */
export async function buildArchive(
  d: Pick<FileDeps, 'fs'>,
  doc: BackupDocument,
  fileBytes: ReadonlyMap<string, Uint8Array>,
  csv: Readonly<Record<string, string>> = {},
): Promise<Uint8Array> {
  const entries: { name: string; bytes: Uint8Array }[] = [{ name: 'data.json', bytes: utf8(JSON.stringify(doc)) }];
  const manifest: Manifest = { format: BACKUP_FORMAT, formatVersion: doc.formatVersion, exportedAt: doc.exportedAt, files: [] };
  for (const f of doc.files) {
    const bytes = fileBytes.get(f.path);
    if (!bytes) throw new BackupAbort('MISSING_FILE', `File allegato mancante: ${f.path}`);
    entries.push({ name: f.path, bytes });
    manifest.files.push({ path: f.path, sha256: f.sha256, size: bytes.length });
  }
  for (const [name, text] of Object.entries(csv)) entries.push({ name: `csv/${name}`, bytes: utf8(text) });
  entries.push({ name: 'manifest.json', bytes: utf8(JSON.stringify(manifest)) });
  return d.fs.zip.zip(entries);
}

export interface OpenedArchive {
  doc: BackupDocument;
  /** stored_path -> contenuto, solo per i file elencati nel manifest e verificati (hash e dimensione). */
  files: Map<string, Uint8Array>;
  /** stored_path -> SHA-256 (verificato) dei file di `files`. */
  hashes: Map<string, string>;
  /** true se il file era un data.json «nudo» (senza allegati). */
  jsonOnly: boolean;
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new BackupAbort('CORRUPT', `${what} non è leggibile: il file è danneggiato.`);
  }
}

const isPk = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b;
const startsWithBrace = (b: Uint8Array): boolean => {
  for (let i = 0; i < Math.min(b.length, 64); i++) {
    const c = b[i] as number;
    if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || (i < 3 && c === 0xef) || (i < 3 && c === 0xbb) || (i < 3 && c === 0xbf)) continue;
    return c === 0x7b; // '{'
  }
  return false;
};

/**
 * Apre un backup (ZIP o data.json) e lo verifica: zip-slip, tetto di dimensione, manifest e dati presenti, formato e
 * versione, hash e dimensioni di ogni allegato. Non scrive nulla. Lancia BackupAbort.
 */
export async function openArchive(d: Pick<FileDeps, 'fs'>, bytes: Uint8Array, maxBytes = MAX_ARCHIVE_BYTES): Promise<OpenedArchive> {
  if (bytes.length > maxBytes) throw new BackupAbort('TOO_BIG', 'Il file è troppo grande per essere importato.');
  if (!isPk(bytes)) {
    if (startsWithBrace(bytes)) {
      return { doc: upgradeBackup(parseJson(fromUtf8(bytes), 'Il file')), files: new Map(), hashes: new Map(), jsonOnly: true };
    }
    throw new BackupAbort('NOT_A_BACKUP', 'Il file non è un backup di MyGarage.');
  }

  let entries: { name: string; bytes: Uint8Array }[];
  try {
    // il tetto passa al codec: rifiuta lo ZIP leggendo le dimensioni dichiarate nell'indice, PRIMA di decomprimere (zip bomb)
    entries = d.fs.zip.unzip(bytes, { maxTotalBytes: maxBytes });
  } catch (e) {
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'ZIP_TOO_BIG') {
      throw new BackupAbort('TOO_BIG', 'Il contenuto del backup è troppo grande per essere importato.');
    }
    throw new BackupAbort('CORRUPT', 'Il file ZIP è danneggiato o incompleto.');
  }

  const byName = new Map<string, Uint8Array>();
  let total = 0;
  for (const e of entries) {
    if (!isSafeEntryName(e.name)) throw new BackupAbort('UNSAFE_PATH', `Percorso non ammesso nello ZIP: ${e.name.slice(0, 80)}`);
    if (e.name.endsWith('/')) continue; // cartella
    if (byName.has(e.name)) throw new BackupAbort('UNSAFE_PATH', `Voce duplicata nello ZIP: ${e.name.slice(0, 80)}`);
    if (e.name.startsWith('attachments/') && !isFlatStoredPath(e.name)) {
      throw new BackupAbort('UNSAFE_PATH', `Allegato con un percorso non ammesso: ${e.name.slice(0, 80)}`);
    }
    total += e.bytes.length; // secondo controllo, sulle dimensioni reali (un codec senza tetto o un indice bugiardo)
    if (total > maxBytes) throw new BackupAbort('TOO_BIG', 'Il contenuto del backup è troppo grande per essere importato.');
    byName.set(e.name, e.bytes);
  }

  const manifestBytes = byName.get('manifest.json');
  const dataBytes = byName.get('data.json');
  if (!manifestBytes || !dataBytes) throw new BackupAbort('NOT_A_BACKUP', 'Il file non è un backup di MyGarage (mancano manifest.json o data.json).');
  const manifest = parseJson(fromUtf8(manifestBytes), 'manifest.json') as Partial<Manifest> | null;
  if (typeof manifest !== 'object' || manifest === null || manifest.format !== BACKUP_FORMAT || !Array.isArray(manifest.files)) {
    throw new BackupAbort('NOT_A_BACKUP', 'Il file non è un backup di MyGarage (manifest non riconosciuto).');
  }
  const doc = upgradeBackup(parseJson(fromUtf8(dataBytes), 'data.json'));

  const files = new Map<string, Uint8Array>();
  const hashes = new Map<string, string>();
  for (const f of manifest.files) {
    if (typeof f !== 'object' || f === null || typeof f.path !== 'string' || typeof f.sha256 !== 'string') {
      throw new BackupAbort('CORRUPT', 'Il manifest del backup non è valido.');
    }
    if (!isFlatStoredPath(f.path)) throw new BackupAbort('UNSAFE_PATH', `Allegato con un percorso non ammesso: ${f.path.slice(0, 80)}`);
    const b = byName.get(f.path);
    if (!b) throw new BackupAbort('MISSING_FILE', `Nel backup manca il file ${f.path}.`);
    if (typeof f.size === 'number' && f.size !== b.length) throw new BackupAbort('HASH_MISMATCH', `Il file ${f.path} è stato alterato.`);
    const actual = await d.fs.hash.sha256Hex(b);
    if (actual !== f.sha256) throw new BackupAbort('HASH_MISMATCH', `Il file ${f.path} è stato alterato.`);
    files.set(f.path, b);
    hashes.set(f.path, actual);
  }
  return { doc, files, hashes, jsonOnly: false };
}
