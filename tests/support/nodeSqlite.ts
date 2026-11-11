// Implementazione della porta SqlDatabase su node:sqlite (SOLO per i test su PC; mai nel bundle dell'app).
// Permette di eseguire migrazioni, repository e motore su un PC Windows senza Android SDK.
// Node stampa un 'ExperimentalWarning' per node:sqlite: e' normale.
/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import type { SqlDatabase, SqlValue } from '@/domain/ports';
import { createSingleConnectionDatabase, type DatabaseTimeouts, type SqlEngine, type SqlRow } from '@/data/adapters/sqlDatabase';

export interface NodeSqlDatabase extends SqlDatabase {
  /** Connessione grezza, per ispezioni che la porta non espone (es. PRAGMA, sqlite_master). */
  readonly raw: DatabaseSync;
  close(): Promise<void>;
}

type NodeParam = null | number | bigint | string | NodeJS.ArrayBufferView;

function toRow(r: unknown): SqlRow {
  return { ...(r as Record<string, SqlValue>) }; // le righe di node:sqlite hanno prototipo null
}

export function openNodeDb(path = ':memory:', opts: DatabaseTimeouts = {}): NodeSqlDatabase {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON');
  const engine: SqlEngine = {
    exec: (sql) => {
      raw.exec(sql);
    },
    run: (sql, params) => Number(raw.prepare(sql).run(...(params as NodeParam[])).changes),
    all: (sql, params) => raw.prepare(sql).all(...(params as NodeParam[])).map(toRow),
    get: (sql, params) => {
      const r = raw.prepare(sql).get(...(params as NodeParam[]));
      return r ? toRow(r) : undefined;
    },
  };
  const base = createSingleConnectionDatabase(engine, opts);
  return Object.assign(base, {
    raw,
    close: async (): Promise<void> => {
      raw.close();
    },
  });
}
