// Adattatore della porta SqlDatabase su expo-sqlite 57 (telefono: Android/iOS). E' l'UNICO file dello strato dati
// che importa expo-sqlite (e solo con import dinamico dentro openExpoDatabase, cosi' il resto e' testabile in Node).
//
// Transazioni: withExclusiveTransactionAsync apre una connessione NUOVA, e le connessioni nuove hanno
// `foreign_keys` SPENTO (e' un PRAGMA per connessione, spento di default in SQLite) e BEGIN gia' emesso;
// dentro una transazione PRAGMA foreign_keys e' un no-op. Per questo la callback comincia con
// COMMIT (della BEGIN vuota emessa dalla libreria) -> PRAGMA -> BEGIN IMMEDIATE (o BEGIN), poi la libreria
// fa da sola COMMIT/ROLLBACK. Il valore di foreign_keys si copia da quello della connessione principale,
// cosi' le migrazioni con `rebuildsTables` (che spengono le FK fuori dalla transazione) funzionano.
// Le transazioni passano da una coda FIFO (una alla volta); le letture fuori transazione non aspettano (WAL),
// le scritture fuori transazione contano sul busy_timeout: dentro la callback usare SEMPRE `tx`.
import type { SqlDatabase, SqlValue } from '@/domain/ports';
import { DEFAULT_BUSY_TIMEOUT_MS, applyPragmas, type PragmaOptions } from '../db/pragmas';
import {
  createMultiConnectionDatabase,
  type SqlEngine,
  type SqlRow,
  type TransactionRunner,
} from './sqlDatabase';

/** Il sottoinsieme di `SQLiteDatabase` (expo-sqlite) che l'adattatore usa: permette di provarlo con un finto in Node. */
export interface ExpoDatabaseLike {
  readonly databasePath: string;
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlValue[]): Promise<{ changes: number }>;
  getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null>;
  withExclusiveTransactionAsync(task: (txn: ExpoDatabaseLike) => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

export interface ExpoSqlDatabase extends SqlDatabase {
  /** L'oggetto `SQLiteDatabase` di expo-sqlite (per serializeAsync, ecc.). */
  readonly raw: ExpoDatabaseLike;
  /** Percorso nativo del file del database. */
  readonly databasePath: string;
  close(): Promise<void>;
}

const engineOf = (db: ExpoDatabaseLike): SqlEngine => ({
  exec: (sql) => db.execAsync(sql),
  run: async (sql, params) => (await db.runAsync(sql, params)).changes,
  all: (sql, params) => db.getAllAsync<SqlRow>(sql, params),
  get: async (sql, params) => (await db.getFirstAsync<SqlRow>(sql, params)) ?? undefined,
});

export interface ExpoAdapterOptions {
  busyTimeoutMs?: number;
  /** Quanto aspetta una transazione il proprio turno (default 30000 ms). */
  transactionTimeoutMs?: number;
}

/** Costruisce la porta sopra un `SQLiteDatabase` gia' aperto. */
export function createExpoSqlDatabase(raw: ExpoDatabaseLike, opts: ExpoAdapterOptions = {}): ExpoSqlDatabase {
  const busy = Math.trunc(opts.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS);

  const runTransaction: TransactionRunner = async (mode, body) => {
    const fkRow = await raw.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys', []);
    const foreignKeys = Number(fkRow?.foreign_keys ?? 1) === 0 ? 'OFF' : 'ON';
    let result: Awaited<ReturnType<typeof body>> | undefined;
    let produced = false;
    await raw.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync('COMMIT'); // chiude la BEGIN vuota emessa dalla libreria: ora i PRAGMA hanno effetto
      try {
        await txn.execAsync(
          `PRAGMA busy_timeout = ${busy}; PRAGMA foreign_keys = ${foreignKeys}; PRAGMA synchronous = NORMAL; PRAGMA secure_delete = ON`,
        );
        await txn.execAsync(mode === 'exclusive' ? 'BEGIN IMMEDIATE' : 'BEGIN');
      } catch (e) {
        // riporta la connessione in transazione, altrimenti il ROLLBACK della libreria maschererebbe l'errore vero
        await txn.execAsync('BEGIN').catch(() => undefined);
        throw e;
      }
      result = await body(engineOf(txn));
      produced = true;
    });
    if (!produced) throw new Error('transazione terminata senza risultato');
    return result as Awaited<ReturnType<typeof body>>;
  };

  const base = createMultiConnectionDatabase(
    engineOf(raw),
    runTransaction,
    opts.transactionTimeoutMs !== undefined ? { transactionTimeoutMs: opts.transactionTimeoutMs } : {},
  );
  return Object.assign(base, {
    raw,
    databasePath: raw.databasePath,
    close: () => raw.closeAsync(),
  });
}

export interface OpenExpoOptions {
  /** Nome del file (default 'mygarage.db'). */
  name?: string;
  /** Cartella (default: quella predefinita di expo-sqlite, `<documenti>/SQLite`). */
  directory?: string;
  pragmas?: PragmaOptions;
  busyTimeoutMs?: number;
}

/** Apre il database su file e applica i PRAGMA. Ogni processo (app, task in background) apre la PROPRIA connessione. */
export async function openExpoDatabase(opts: OpenExpoOptions = {}): Promise<ExpoSqlDatabase> {
  const SQLite = await import('expo-sqlite');
  const raw = await SQLite.openDatabaseAsync(opts.name ?? 'mygarage.db', undefined, opts.directory);
  const db = createExpoSqlDatabase(raw, {
    ...(opts.busyTimeoutMs !== undefined ? { busyTimeoutMs: opts.busyTimeoutMs } : {}),
  });
  await applyPragmas(db, {
    ...opts.pragmas,
    busyTimeoutMs: opts.pragmas?.busyTimeoutMs ?? opts.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
  });
  return db;
}
