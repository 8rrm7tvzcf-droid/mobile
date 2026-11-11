// Le tre implementazioni della porta SqlDatabase che si provano con gli stessi test:
//  - node:sqlite (la usano i test dei repository),
//  - sql.js (anteprima web),
//  - expo-sqlite, qui con un FINTO su node:sqlite (file reale + connessioni di transazione separate).
/// <reference types="node" />
import { join } from 'node:path';
import type { SqlDatabase } from '@/domain/ports';
import type { DatabaseTimeouts } from '@/data/adapters/sqlDatabase';
import { applyPragmas } from '@/data/db/pragmas';
import { createExpoSqlDatabase } from '@/data/adapters/expoSqlite';
import { openSqlJsDatabase } from '@/data/adapters/sqlJs';
import { FakeExpoDatabase } from './fakeExpoSqlite';
import { makeTempDir } from './nodeFileStore';
import { openNodeDb } from './nodeSqlite';

export interface OpenedDb {
  db: SqlDatabase;
  close(): Promise<void>;
}

export interface AdapterHarness {
  name: string;
  /** true se la connessione e' una sola (le transazioni serializzano anche le operazioni radice). */
  singleConnection: boolean;
  open(opts?: DatabaseTimeouts): Promise<OpenedDb>;
}

export const ADAPTERS: AdapterHarness[] = [
  {
    name: 'node:sqlite',
    singleConnection: true,
    open: async (opts) => {
      const db = openNodeDb(':memory:', opts);
      await applyPragmas(db, { journalMode: 'skip' });
      return { db, close: () => db.close() };
    },
  },
  {
    name: 'sql.js',
    singleConnection: true,
    open: async (opts) => {
      const db = await openSqlJsDatabase(opts);
      return { db, close: () => db.close() };
    },
  },
  {
    name: 'expo-sqlite (finto su node:sqlite)',
    singleConnection: false,
    open: async (opts) => {
      const tmp = makeTempDir();
      const raw = new FakeExpoDatabase(join(tmp.dir, 'test.db'));
      const db = createExpoSqlDatabase(raw, opts?.transactionTimeoutMs !== undefined ? { transactionTimeoutMs: opts.transactionTimeoutMs } : {});
      await applyPragmas(db); // come openExpoDatabase: foreign_keys, WAL, busy_timeout...
      return {
        db,
        close: async () => {
          await raw.closeAsync();
          tmp.cleanup();
        },
      };
    },
  },
];
