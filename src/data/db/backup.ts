// Copia di sicurezza pre-migrazione con VACUUM INTO (data.md 2.1 punto 4): copia consistente anche in WAL,
// senza chiudere la connessione; NON si puo' eseguire dentro una transazione. Si tengono le ultime N copie.
// Il percorso di destinazione dentro expo-sqlite va verificato su dispositivo (confidenza media).
import type { FileStore, SqlDatabase } from '@/domain/ports';

export interface VacuumBackupOptions {
  /** Cartella delle copie (senza barra finale); puo' essere un URI `file://...` o un percorso di file system. */
  dir: string;
  /** Solo list/remove, per la rotazione delle copie. */
  files: Pick<FileStore, 'list' | 'remove'>;
  nowIso: () => string;
  /** Quante copie conservare (default 3). */
  keep?: number;
  /** Crea la cartella se manca: VACUUM INTO non la crea. */
  ensureDir?: (dir: string) => Promise<void>;
}

const NAME_RE = /^pre-v(\d+)-to-v(\d+)-(.+)\.db$/;

/** VACUUM INTO vuole un percorso nativo, non un URI. */
export function toFsPath(pathOrUri: string): string {
  if (!pathOrUri.startsWith('file://')) return pathOrUri;
  const stripped = pathOrUri.slice('file://'.length);
  try {
    return decodeURI(stripped);
  } catch {
    return stripped;
  }
}

const baseName = (p: string): string => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);

/** Nome del file di copia; il timestamp e' sicuro per i file system (niente ':'). */
export function backupFileName(from: number, to: number, nowIso: string): string {
  return `pre-v${from}-to-v${to}-${nowIso.replace(/[^0-9A-Za-z]/g, '-')}.db`;
}

/** Restituisce la funzione `backup(from, to)` da passare a migrate()/bootDatabase(). */
export function createVacuumBackup(db: SqlDatabase, opts: VacuumBackupOptions): (from: number, to: number) => Promise<void> {
  const keep = opts.keep ?? 3;
  return async (from, to) => {
    const dir = toFsPath(opts.dir).replace(/[\\/]+$/, '');
    if (opts.ensureDir) await opts.ensureDir(dir);
    const name = backupFileName(from, to, opts.nowIso());
    const target = `${dir}/${name}`;
    await db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    // rotazione: si tengono le ultime `keep` copie (ordinate per timestamp), le altre si cancellano
    const names = (await opts.files.list(dir))
      .map(baseName)
      .map((n) => ({ n, m: NAME_RE.exec(n) }))
      .filter((x): x is { n: string; m: RegExpExecArray } => x.m !== null)
      .sort((a, b) => (a.m[3] as string).localeCompare(b.m[3] as string));
    const stale = names.slice(0, Math.max(0, names.length - keep));
    for (const s of stale) await opts.files.remove(`${dir}/${s.n}`);
  };
}
