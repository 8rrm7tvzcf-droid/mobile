// Percorsi dei file dell'app (allegati, backup, temp) e utilita' sui FileStore. TypeScript puro.
// Nel database i percorsi degli allegati sono SEMPRE relativi ('attachments/<ULID>.<ext>', vincolo CHECK dello schema):
// il percorso reale si ottiene sotto `AppDirs.attachments`, che puo' essere un percorso o un URI `file://...`.
import type { AppDirs, FileStore } from '@/domain/ports';

export const ATTACHMENT_PREFIX = 'attachments/';

/** Unisce una cartella (percorso o URI, con o senza barra finale) e un nome. */
export function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[\\/]+$/, '')}/${name.replace(/^[\\/]+/, '')}`;
}

/** Ultimo componente di un percorso (accetta '/' e '\\'). */
export function baseName(p: string): string {
  return p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
}

/** Percorso nativo per SQLite (VACUUM INTO non accetta gli URI `file://`). */
export function toFsPath(pathOrUri: string): string {
  if (!pathOrUri.startsWith('file://')) return pathOrUri;
  const stripped = pathOrUri.slice('file://'.length);
  try {
    return decodeURI(stripped);
  } catch {
    return stripped;
  }
}

/** `attachments/<nome>` senza sottocartelle, senza '..', senza separatori Windows: la forma ammessa da backup e allegati. */
const FLAT_STORED_PATH = /^attachments\/[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9]{1,8})?$/;

export function isFlatStoredPath(p: string): boolean {
  return FLAT_STORED_PATH.test(p) && !p.includes('..');
}

/** Percorso sicuro dentro attachments/ (anche annidato, per eventuali miniature): niente '..', '\\', percorsi assoluti. */
export function isSafeStoredPath(p: string): boolean {
  return (
    p.startsWith(ATTACHMENT_PREFIX) &&
    p.length > ATTACHMENT_PREFIX.length &&
    !p.includes('..') &&
    !p.includes('\\') &&
    !/[\u0000-\u001f]/.test(p) &&
    !p.includes('//')
  );
}

/** Percorso reale di un file allegato a partire dal `stored_path` del database; null se il percorso non e' sicuro. */
export function attachmentFilePath(dirs: Pick<AppDirs, 'attachments'>, storedPath: string): string | null {
  if (!isSafeStoredPath(storedPath)) return null;
  return joinPath(dirs.attachments, storedPath.slice(ATTACHMENT_PREFIX.length));
}

/**
 * Svuota una cartella (file e, se ci sono, sottocartelle) senza rimuovere la cartella stessa. Il FileStore non ha
 * una cancellazione ricorsiva: si scende a mano. Restituisce quante voci ha rimosso; un errore su una voce non
 * ferma le altre (l'esito si verifica poi con `listTree`).
 */
export async function clearDir(files: Pick<FileStore, 'list' | 'remove'>, dir: string): Promise<number> {
  let removed = 0;
  for (const name of await files.list(dir)) {
    const p = joinPath(dir, name);
    let children: string[] = [];
    try {
      children = await files.list(p);
    } catch {
      children = [];
    }
    if (children.length > 0) removed += await clearDir(files, p);
    try {
      await files.remove(p);
      removed++;
    } catch {
      // resta: la verifica finale la segnala
    }
  }
  return removed;
}

/** Tutte le voci sotto una cartella (percorsi relativi alla cartella), per verificare che sia vuota. */
export async function listTree(files: Pick<FileStore, 'list'>, dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const name of await files.list(dir)) {
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    out.push(rel);
    let children: string[] = [];
    try {
      children = await files.list(joinPath(dir, name));
    } catch {
      children = [];
    }
    if (children.length > 0) out.push(...(await listTree(files, joinPath(dir, name), rel)));
  }
  return out;
}
