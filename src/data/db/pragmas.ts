// PRAGMA da eseguire all'apertura di OGNI connessione (app e task in background): SPEC 8.1, data.md 1.1.
import type { SqlDatabase } from '@/domain/ports';

export interface PragmaOptions {
  /**
   * 'WAL' (default) e' persistente nel file e permette letture concorrenti al task in background.
   * 'skip' lascia la modalita' com'e' (utile per database in memoria o per sql.js, dove WAL non ha senso).
   */
  journalMode?: 'WAL' | 'skip';
  busyTimeoutMs?: number;
}

export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

export async function applyPragmas(db: SqlDatabase, opts: PragmaOptions = {}): Promise<void> {
  // busy_timeout per primo: cosi' anche il cambio di journal_mode aspetta se un'altra connessione e' attiva
  await db.exec(`PRAGMA busy_timeout = ${Math.trunc(opts.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS)}`);
  await db.exec('PRAGMA foreign_keys = ON'); // per connessione, fuori da transazioni
  if ((opts.journalMode ?? 'WAL') === 'WAL') await db.exec('PRAGMA journal_mode = WAL');
  await db.exec('PRAGMA synchronous = NORMAL'); // sicuro con WAL
  await db.exec('PRAGMA secure_delete = ON'); // GDPR: le pagine cancellate vengono azzerate
}

export interface PragmaState {
  foreign_keys: number;
  journal_mode: string;
  synchronous: number;
  busy_timeout: number;
  secure_delete: number;
}

/** Legge lo stato corrente dei PRAGMA (diagnostica e test). */
export async function readPragmas(db: SqlDatabase): Promise<PragmaState> {
  const one = async (name: string): Promise<number | string> => {
    const row = await db.get<Record<string, number | string>>(`PRAGMA ${name}`);
    return row ? (Object.values(row)[0] as number | string) : 0;
  };
  return {
    foreign_keys: Number(await one('foreign_keys')),
    journal_mode: String(await one('journal_mode')),
    synchronous: Number(await one('synchronous')),
    busy_timeout: Number(await one('busy_timeout')),
    secure_delete: Number(await one('secure_delete')),
  };
}

/** SQLite minimo richiesto: le tabelle STRICT arrivano con la 3.37 (data.md 1.3). */
export const MIN_SQLITE_VERSION = '3.37.0';

export class SqliteTooOldError extends Error {
  readonly version: string;
  readonly required: string;
  constructor(version: string, required: string = MIN_SQLITE_VERSION) {
    super(`SQLite ${version} troppo vecchio: serve la ${required} o successiva (tabelle STRICT)`);
    this.name = 'SqliteTooOldError';
    this.version = version;
    this.required = required;
  }
}

/** Confronto numerico di versioni 'x.y.z' (parti mancanti = 0): negativo se a < b, 0 se uguali, positivo se a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Controlla che il SQLite della piattaforma abbia cio' che lo schema usa (STRICT) e restituisce la versione.
 * Su expo-sqlite 57 la versione non e' stata verificata (SPEC SP-1): il boot la riporta in BootResult.sqliteVersion.
 */
export async function checkSqliteSupport(db: SqlDatabase): Promise<string> {
  const row = await db.get<{ v: string }>('SELECT sqlite_version() AS v');
  const version = String(row?.v ?? '0');
  if (compareVersions(version, MIN_SQLITE_VERSION) < 0) throw new SqliteTooOldError(version);
  return version;
}
