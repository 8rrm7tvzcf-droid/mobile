// Adattatore della porta SqlDatabase su sql.js (SQLite compilato in WebAssembly): per l'ANTEPRIMA WEB su PC.
// Il web di expo-sqlite e' ancora alpha (richiede header COOP/COEP): per la UI sul PC si usa questo adattatore,
// con un database IN MEMORIA (nessuna persistenza: `exportBytes()` permette di salvarlo altrove).
// sql.js si importa in modo dinamico, cosi' non pesa sul bundle nativo e il modulo resta caricabile ovunque.
//
// Per il browser serve che il file `sql-wasm.wasm` sia raggiungibile: passare `locateFile` (es. una copia in
// public/ o l'URL del bundle). In Node (test) sql.js lo trova da solo.
//
// ATTENZIONE (bundle nativo): questo modulo NON e' riesportato da src/data/index.ts e deve essere importato
// SOLO dal bootstrap web (es. bootstrap/root.web.ts). Metro include ogni import dinamico con stringa letterale:
// su Android/iOS 'sql.js' si risolve in dist/sql-wasm.js, che richiede 'fs'/'path' e rompe il bundle.
// Lo stesso vale in senso inverso per ./expoSqlite (solo bootstrap nativo).
import type { SqlJsDatabase, SqlJsStatic, SqlJsValue } from 'sql.js';
import type { SqlDatabase, SqlValue } from '@/domain/ports';
import { applyPragmas } from '../db/pragmas';
import { createSingleConnectionDatabase, type DatabaseTimeouts, type SqlEngine, type SqlRow } from './sqlDatabase';

export interface SqlJsAdapterDatabase extends SqlDatabase {
  readonly raw: SqlJsDatabase;
  /** Il database serializzato (file SQLite): per scaricarlo o salvarlo (es. IndexedDB). */
  exportBytes(): Uint8Array;
  close(): Promise<void>;
}

export interface SqlJsOptions extends DatabaseTimeouts {
  locateFile?: (file: string) => string;
  /** File SQLite esistente da aprire; assente = database vuoto in memoria. */
  data?: ArrayLike<number>;
}

/** Costruisce la porta sopra un `Database` di sql.js gia' creato. */
export function createSqlJsDatabase(raw: SqlJsDatabase, opts: DatabaseTimeouts = {}): SqlJsAdapterDatabase {
  const rows = (sql: string, params: SqlValue[], firstOnly: boolean): SqlRow[] => {
    const stmt = raw.prepare(sql);
    try {
      stmt.bind(params as SqlJsValue[]);
      const out: SqlRow[] = [];
      while (stmt.step()) {
        out.push(stmt.getAsObject() as SqlRow);
        if (firstOnly) break;
      }
      return out;
    } finally {
      stmt.free();
    }
  };
  const engine: SqlEngine = {
    exec: (sql) => {
      raw.exec(sql);
    },
    run: (sql, params) => {
      raw.run(sql, params as SqlJsValue[]);
      return raw.getRowsModified();
    },
    all: (sql, params) => rows(sql, params, false),
    get: (sql, params) => rows(sql, params, true)[0],
  };
  const base = createSingleConnectionDatabase(engine, opts);
  return Object.assign(base, {
    raw,
    exportBytes: (): Uint8Array => raw.export(),
    close: async (): Promise<void> => {
      raw.close();
    },
  });
}

/** Carica sql.js (WebAssembly), crea il database e applica i PRAGMA (senza WAL: e' in memoria). */
export async function openSqlJsDatabase(opts: SqlJsOptions = {}): Promise<SqlJsAdapterDatabase> {
  const mod = await import('sql.js');
  const init = mod.default ?? (mod as unknown as typeof mod.default);
  const SQL: SqlJsStatic = await init(opts.locateFile ? { locateFile: opts.locateFile } : undefined);
  const raw = new SQL.Database(opts.data ?? null);
  const db = createSqlJsDatabase(raw, {
    ...(opts.lockTimeoutMs !== undefined ? { lockTimeoutMs: opts.lockTimeoutMs } : {}),
    ...(opts.transactionTimeoutMs !== undefined ? { transactionTimeoutMs: opts.transactionTimeoutMs } : {}),
  });
  await applyPragmas(db, { journalMode: 'skip' });
  return db;
}
