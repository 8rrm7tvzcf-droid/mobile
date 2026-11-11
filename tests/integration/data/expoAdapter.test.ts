// Comportamento specifico dell'adattatore expo-sqlite (provato con un finto che riproduce le connessioni di
// transazione separate di withExclusiveTransactionAsync). Il contratto comune e' in adapters.test.ts.
/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExpoSqlDatabase, openExpoDatabase, type ExpoSqlDatabase } from '@/data/adapters/expoSqlite';
import { applyPragmas, readPragmas } from '@/data/db/pragmas';
import { errorOf } from '../../support/db';
import { FakeExpoDatabase } from '../../support/fakeExpoSqlite';
import { makeTempDir } from '../../support/nodeFileStore';

vi.mock('expo-sqlite', async () => {
  const { FakeExpoDatabase: Fake } = await import('../../support/fakeExpoSqlite');
  const path = await import('node:path');
  return {
    openDatabaseAsync: async (name: string, _options?: unknown, directory?: string) =>
      new Fake(path.join(directory ?? '.', name)),
  };
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('adattatore expo-sqlite', () => {
  let tmp: ReturnType<typeof makeTempDir>;
  let raw: FakeExpoDatabase;
  let db: ExpoSqlDatabase;

  beforeEach(async () => {
    tmp = makeTempDir();
    raw = new FakeExpoDatabase(join(tmp.dir, 'mygarage.db'));
    db = createExpoSqlDatabase(raw, { busyTimeoutMs: 50 });
    await applyPragmas(db, { busyTimeoutMs: 50 });
    await db.exec(`
      CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id));
    `);
  });
  afterEach(async () => {
    await raw.closeAsync();
    tmp.cleanup();
  });

  it("espone databasePath e l'oggetto grezzo", () => {
    expect(db.databasePath).toBe(join(tmp.dir, 'mygarage.db'));
    expect(db.raw).toBe(raw);
  });

  it('ogni transazione gira su una connessione nuova con i PRAGMA della connessione principale', async () => {
    const before = FakeExpoDatabase.transactionConnections;
    await db.transaction(async (tx) => {
      expect(await readPragmas(tx)).toMatchObject({ foreign_keys: 1, secure_delete: 1, synchronous: 1, busy_timeout: 50 });
    }, 'exclusive');
    expect(FakeExpoDatabase.transactionConnections).toBe(before + 1);
  });

  it('foreign_keys spento sulla connessione principale (migrazioni con rebuildsTables) resta spento nella transazione', async () => {
    await db.exec('PRAGMA foreign_keys = OFF');
    await db.transaction(async (tx) => {
      expect((await readPragmas(tx)).foreign_keys).toBe(0);
      await tx.run('INSERT INTO child (id, parent_id) VALUES (1, 99)'); // orfano consentito mentre le FK sono spente
      expect(await tx.all('PRAGMA foreign_key_check')).toHaveLength(1);
      await tx.run('DELETE FROM child');
    }, 'exclusive');
    await db.exec('PRAGMA foreign_keys = ON');
    expect(await errorOf(() => db.transaction((tx) => tx.run('INSERT INTO child (id, parent_id) VALUES (1, 99)').then(() => undefined))))
      .toMatch(/FOREIGN KEY constraint failed/);
  });

  it("una lettura radice durante la transazione non aspetta e vede lo stato confermato (WAL)", async () => {
    await db.run('INSERT INTO parent (id, name) VALUES (1, ?)', ['vecchio']);
    const tx = db.transaction(async (t) => {
      await t.run('UPDATE parent SET name = ? WHERE id = 1', ['nuovo']);
      await sleep(30);
    }, 'exclusive');
    await sleep(10);
    expect(await db.get('SELECT name FROM parent WHERE id = 1')).toEqual({ name: 'vecchio' });
    await tx;
    expect(await db.get('SELECT name FROM parent WHERE id = 1')).toEqual({ name: 'nuovo' });
  });

  it("se BEGIN IMMEDIATE fallisce (database occupato) l'errore e quello vero, non un 'cannot rollback'", async () => {
    const other = new DatabaseSync(db.databasePath);
    other.exec('BEGIN IMMEDIATE'); // un altro processo (es. il task in background) tiene il lock di scrittura
    try {
      const msg = await errorOf(() =>
        db.transaction(async (tx) => {
          await tx.run('INSERT INTO parent (id, name) VALUES (1, ?)', ['x']);
        }, 'exclusive'),
      );
      expect(msg).toMatch(/database is locked/);
      expect(msg).not.toMatch(/cannot rollback/);
    } finally {
      other.exec('ROLLBACK');
      other.close();
    }
    // il lock e' libero: la transazione successiva funziona
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO parent (id, name) VALUES (2, ?)', ['ok']);
    }, 'exclusive');
    expect(await db.all('SELECT name FROM parent')).toEqual([{ name: 'ok' }]);
  });

  it('una transazione di sola lettura (deferred) non blocca le scritture di un altro processo', async () => {
    const other = new DatabaseSync(db.databasePath);
    other.exec('PRAGMA busy_timeout = 50');
    try {
      await db.transaction(async (tx) => {
        await tx.all('SELECT * FROM parent');
        other.exec(`INSERT INTO parent (id, name) VALUES (5, 'altro-processo')`); // BEGIN deferred: nessun lock di scrittura
      }, 'deferred');
    } finally {
      other.close();
    }
    expect(await db.all('SELECT name FROM parent')).toEqual([{ name: 'altro-processo' }]);
  });

  it('close chiude la connessione principale', async () => {
    await db.close();
    expect(await errorOf(() => db.all('SELECT 1'))).not.toBeNull();
    raw = new FakeExpoDatabase(join(tmp.dir, 'altro.db')); // per l'afterEach
  });
});

describe('openExpoDatabase', () => {
  it('apre il file, applica i PRAGMA (WAL compreso) e restituisce la porta', async () => {
    const tmp = makeTempDir();
    try {
      const db = await openExpoDatabase({ name: 'prova.db', directory: tmp.dir, busyTimeoutMs: 123 });
      expect(db.databasePath).toBe(join(tmp.dir, 'prova.db'));
      expect(await readPragmas(db)).toMatchObject({ foreign_keys: 1, journal_mode: 'wal', synchronous: 1, busy_timeout: 123, secure_delete: 1 });
      await db.close();
    } finally {
      tmp.cleanup();
    }
  });
});
