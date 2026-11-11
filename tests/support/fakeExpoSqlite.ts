// Finto `SQLiteDatabase` di expo-sqlite sopra node:sqlite, per provare l'adattatore expoSqlite.ts su PC.
// Riproduce il comportamento che conta, copiato da node_modules/expo-sqlite/build/SQLiteDatabase.js:
//  - withExclusiveTransactionAsync apre una connessione NUOVA allo stesso file, emette BEGIN, esegue il task
//    e poi COMMIT (o ROLLBACK se il task lancia);
//  - le connessioni nuove hanno `foreign_keys` SPENTO (come su dispositivo: e' un PRAGMA per connessione).
/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import type { SqlValue } from '@/domain/ports';
import type { ExpoDatabaseLike } from '@/data/adapters/expoSqlite';

type NodeParam = null | number | bigint | string | NodeJS.ArrayBufferView;

export class FakeExpoDatabase implements ExpoDatabaseLike {
  readonly raw: DatabaseSync;
  /** Quante connessioni di transazione sono state aperte (per i test). */
  static transactionConnections = 0;

  constructor(readonly databasePath: string) {
    // come su dispositivo: le chiavi esterne sono spente finche' non si esegue PRAGMA foreign_keys = ON
    this.raw = new DatabaseSync(databasePath, { enableForeignKeyConstraints: false });
  }

  async execAsync(source: string): Promise<void> {
    this.raw.exec(source);
  }

  async runAsync(source: string, params: SqlValue[]): Promise<{ changes: number }> {
    return { changes: Number(this.raw.prepare(source).run(...(params as NodeParam[])).changes) };
  }

  async getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]> {
    return this.raw
      .prepare(source)
      .all(...(params as NodeParam[]))
      .map((r) => ({ ...r }) as T);
  }

  async getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null> {
    const r = this.raw.prepare(source).get(...(params as NodeParam[]));
    return r ? ({ ...r } as T) : null;
  }

  async withExclusiveTransactionAsync(task: (txn: ExpoDatabaseLike) => Promise<void>): Promise<void> {
    const txn = new FakeExpoDatabase(this.databasePath);
    FakeExpoDatabase.transactionConnections++;
    let error: unknown;
    let failed = false;
    try {
      await txn.execAsync('BEGIN');
      await task(txn);
      await txn.execAsync('COMMIT');
    } catch (e) {
      await txn.execAsync('ROLLBACK'); // come la libreria: se non c'e' transazione attiva lancia lui
      error = e;
      failed = true;
    } finally {
      await txn.closeAsync();
    }
    if (failed) throw error;
  }

  async closeAsync(): Promise<void> {
    this.raw.close();
  }
}
