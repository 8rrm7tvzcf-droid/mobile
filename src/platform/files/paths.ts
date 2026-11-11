// Funzioni pure sui percorsi e sui tipi di file, condivise dagli adattatori (telefono e web). Nessun import di pacchetti.
import type { AppDirs } from '@/domain/ports';

/**
 * Cartelle private dell'app come PERCORSI RELATIVI alla radice del FileStore (sul telefono la cartella documenti
 * dell'app, sul web la radice virtuale). Cosi' `${dirs.attachments}/<ULID>.<ext>` e' gia' il `stored_path` del database
 * (schema: GLOB 'attachments/*') e funziona con qualunque FileStore, anche quello di prova su node:fs.
 */
export const APP_DIRS: AppDirs = Object.freeze({ attachments: 'attachments', backups: 'backups', temp: 'temp' });

/** Ultimo segmento di un percorso o URI, senza query/frammento e con i %XX decodificati ('' se non c'e'). */
export function baseName(path: string): string {
  const clean = path.split(/[?#]/, 1)[0] ?? '';
  const parts = clean.split('/').filter((s) => s.length > 0);
  const last = parts[parts.length - 1] ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * Normalizza un percorso virtuale (FileStore sul web): separatore '/', niente segmenti vuoti o '.', niente '..'.
 * Un percorso che esce dalla radice e' un errore (stessa difesa del path traversal dello ZIP).
 */
export function normalizeVirtualPath(path: string): string {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') throw new Error(`Percorso non valido: ${path}`);
    out.push(seg);
  }
  return out.join('/');
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  pdf: 'application/pdf',
  zip: 'application/zip',
  json: 'application/json',
  csv: 'text/csv',
  txt: 'text/plain',
};

/** Tipo MIME dedotto dall'estensione del nome (null se sconosciuta). */
export function guessMimeType(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return null;
  return MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}

const UTI_BY_MIME: Readonly<Record<string, string>> = {
  'application/zip': 'public.zip-archive',
  'application/json': 'public.json',
  'application/pdf': 'com.adobe.pdf',
  'text/csv': 'public.comma-separated-values-text',
  'text/plain': 'public.plain-text',
  'image/jpeg': 'public.jpeg',
  'image/png': 'public.png',
};

/** Uniform Type Identifier iOS per un tipo MIME noto (serve a expo-sharing su iOS; undefined se non lo conosciamo). */
export function mimeToUti(mimeType: string): string | undefined {
  return UTI_BY_MIME[mimeType.toLowerCase()];
}

/** Estensioni di file gia' compressi: nello ZIP si memorizzano senza ricomprimere (piu' veloce, nessun guadagno perso). */
const ALREADY_COMPRESSED = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'zip', 'mp4', 'mov']);

export function isAlreadyCompressed(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && ALREADY_COMPRESSED.has(name.slice(dot + 1).toLowerCase());
}
