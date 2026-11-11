// Contratto della porta SqlDatabase: gli stessi test girano su node:sqlite, sql.js e sull'adattatore expo-sqlite
// (con un finto su node:sqlite che riproduce le connessioni di transazione separate).
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseBusyError, Mutex, type DatabaseTimeouts } from '@/data/adapters/sqlDatabase';
import { readPragmas } from '@/data/db/pragmas';
import type { SqlDatabase } from '@/domain/ports';
import { ADAPTERS, type OpenedDb } from '../../support/adapters';
import { errorOf } from '../../support/db';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe.each(ADAPTERS)('porta SqlDatabase su $name', (adapter) => {
  const opened: OpenedDb[] = [];
  const open = async (opts?: DatabaseTimeouts): Promise<SqlDatabase> => {
    const o = await adapter.open(opts);
    opened.push(o);
    return o.db;
  };
  afterEach(async () => {
    for (const o of opened.splice(0)) await o.close();
  });

  const setup = async (opts?: DatabaseTimeouts): Promise<SqlDatabase> => {
    const db = await open(opts);
    await db.exec(`
      CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE CASCADE, data BLOB);
    `);
    return db;
  };
  const names = async (db: SqlDatabase): Promise<string[]> =>
    (await db.all<{ name: string }>('SELECT name FROM parent ORDER BY id')).map((r) => r.name);

  it('exec, run, all e get con parametri posizionali', async () => {
    const db = await setup();
    expect(await db.run('INSERT INTO parent (id, name) VALUES (?, ?)', [1, 'uno'])).toEqual({ changes: 1 });
    await db.exec(`INSERT INTO parent (id, name) VALUES (2, 'due'); INSERT INTO parent (id, name) VALUES (3, 'tre')`);
    expect(await db.run('UPDATE parent SET name = name || ?', ['!'])).toEqual({ changes: 3 });
    expect(await db.run('DELETE FROM parent WHERE id = ?', [99])).toEqual({ changes: 0 });
    expect(await db.all('SELECT id, name FROM parent ORDER BY id')).toEqual([
      { id: 1, name: 'uno!' }, { id: 2, name: 'due!' }, { id: 3, name: 'tre!' },
    ]);
    expect(await db.get('SELECT name FROM parent WHERE id = ?', [2])).toEqual({ name: 'due!' });
    expect(await db.get('SELECT name FROM parent WHERE id = ?', [42])).toBeUndefined();
    expect(await db.all('SELECT * FROM parent WHERE id > ?', [100])).toEqual([]);
    expect(await db.all('SELECT count(*) AS n FROM parent')).toEqual([{ n: 3 }]); // ok anche senza params
  });

  it("le righe sono oggetti semplici e i numeri interi tornano come number", async () => {
    const db = await setup();
    await db.run('INSERT INTO parent (id, name) VALUES (?, ?)', [7, 'x']);
    const row = await db.get<{ id: number; name: string }>('SELECT id, name FROM parent');
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect(typeof row?.id).toBe('number');
  });

  it('null, testo con apici e byte (BLOB) viaggiano senza alterarsi', async () => {
    const db = await setup();
    await db.run('INSERT INTO parent (id, name) VALUES (1, ?)', ["l'auto \"nuova\"; DROP TABLE parent;--"]);
    await db.run('INSERT INTO child (id, parent_id, data) VALUES (1, 1, ?)', [Uint8Array.from([0, 1, 2, 255])]);
    await db.run('INSERT INTO child (id, parent_id, data) VALUES (2, 1, ?)', [null]);
    expect(await db.get('SELECT name FROM parent')).toEqual({ name: "l'auto \"nuova\"; DROP TABLE parent;--" });
    const rows = await db.all<{ id: number; data: Uint8Array | null }>('SELECT id, data FROM child ORDER BY id');
    expect(Array.from(rows[0]?.data ?? [])).toEqual([0, 1, 2, 255]);
    expect(rows[1]?.data).toBeNull();
  });

  it('un errore SQL arriva al chiamante con il testo del vincolo violato', async () => {
    const db = await setup();
    await db.run('INSERT INTO parent (id, name) VALUES (1, ?)', ['a']);
    expect(await errorOf(() => db.run('INSERT INTO parent (id, name) VALUES (1, ?)', ['b']))).toMatch(/UNIQUE constraint failed/);
    expect(await errorOf(() => db.run('INSERT INTO parent (id, name) VALUES (2, NULL)'))).toMatch(/NOT NULL constraint failed/);
    expect(await errorOf(() => db.all('SELECT * FROM non_esiste'))).toMatch(/no such table/);
  });

  it('PRAGMA foreign_keys e attivo (anche dentro le transazioni)', async () => {
    const db = await setup();
    await db.run('INSERT INTO parent (id, name) VALUES (1, ?)', ['a']);
    expect(await errorOf(() => db.run('INSERT INTO child (id, parent_id) VALUES (1, 99)'))).toMatch(/FOREIGN KEY constraint failed/);
    const inTx = await errorOf(() =>
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO child (id, parent_id) VALUES (2, 99)');
      }, 'exclusive'),
    );
    expect(inTx).toMatch(/FOREIGN KEY constraint failed/);
    // e la cascata funziona dentro la transazione
    await db.run('INSERT INTO child (id, parent_id) VALUES (3, 1)');
    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM parent WHERE id = 1');
    });
    expect(await db.all('SELECT * FROM child')).toEqual([]);
  });

  it('transaction: COMMIT, valore restituito e visibilita dopo la fine', async () => {
    const db = await setup();
    const out = await db.transaction(async (tx) => {
      await tx.run('INSERT INTO parent (id, name) VALUES (1, ?)', ['a']);
      await tx.run('INSERT INTO parent (id, name) VALUES (2, ?)', ['b']);
      return (await tx.get<{ n: number }>('SELECT count(*) AS n FROM parent'))?.n;
    }, 'exclusive');
    expect(out).toBe(2);
    expect(await names(db)).toEqual(['a', 'b']);
  });

  it("transaction: se la callback lancia annulla tutto e rilancia l'errore originale", async () => {
    const db = await setup();
    await db.run('INSERT INTO parent (id, name) VALUES (1, ?)', ['gia-presente']);
    const err = await errorOf(() =>
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO parent (id, name) VALUES (2, ?)', ['perso']);
        await tx.run('UPDATE parent SET name = ? WHERE id = 1', ['modificato']);
        throw new Error('boom');
      }, 'exclusive'),
    );
    expect(err).toBe('boom');
    expect(await names(db)).toEqual(['gia-presente']);
    // dopo un rollback si puo' aprire un'altra transazione
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO parent (id, name) VALUES (3, ?)', ['ok']);
    });
    expect(await names(db)).toEqual(['gia-presente', 'ok']);
  });

  it('transaction: un vincolo violato a meta annulla anche le scritture precedenti', async () => {
    const db = await setup();
    const err = await errorOf(() =>
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO parent (id, name) VALUES (1, ?)', ['a']);
        await tx.run('INSERT INTO parent (id, name) VALUES (1, ?)', ['dup']);
      }),
    );
    expect(err).toMatch(/UNIQUE constraint failed/);
    expect(await names(db)).toEqual([]);
  });

  it('transazioni annidate: la interna si annulla da sola (SAVEPOINT) senza toccare la esterna', async () => {
    const db = await setup();
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO parent (id, name) VALUES (1, ?)', ['esterna']);
      const inner = await errorOf(() =>
        tx.transaction(async (tx2) => {
          await tx2.run('INSERT INTO parent (id, name) VALUES (2, ?)', ['interna-persa']);
          throw new Error('annulla interna');
        }),
      );
      expect(inner).toBe('annulla interna');
      const ok = await tx.transaction(async (tx2) => {
        await tx2.run('INSERT INTO parent (id, name) VALUES (3, ?)', ['interna-ok']);
        return 'fatto';
      });
      expect(ok).toBe('fatto');
    });
    expect(await names(db)).toEqual(['esterna', 'interna-ok']);

    // se l'esterna fallisce dopo una interna riuscita, annulla anche quella
    const err = await errorOf(() =>
      db.transaction(async (tx) => {
        await tx.transaction(async (tx2) => {
          await tx2.run('INSERT INTO parent (id, name) VALUES (9, ?)', ['x']);
        });
        throw new Error('esterna fallisce');
      }),
    );
    expect(err).toBe('esterna fallisce');
    expect(await names(db)).toEqual(['esterna', 'interna-ok']);
  });

  it('transazioni concorrenti: una alla volta, in ordine di arrivo', async () => {
    const db = await setup();
    const events: string[] = [];
    const run = (label: string, ms: number, mode: 'deferred' | 'exclusive') =>
      db.transaction(async (tx) => {
        events.push(`${label}:start`);
        await tx.run('INSERT INTO parent (id, name) VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM parent), ?)', [label]);
        await sleep(ms);
        events.push(`${label}:end`);
      }, mode);
    await Promise.all([run('t1', 30, 'exclusive'), run('t2', 5, 'deferred'), run('t3', 5, 'exclusive')]);
    expect(events).toEqual(['t1:start', 't1:end', 't2:start', 't2:end', 't3:start', 't3:end']);
    expect(await names(db)).toEqual(['t1', 't2', 't3']);
  });

  it("una transazione fallita non blocca quelle in coda", async () => {
    const db = await setup();
    const results = await Promise.allSettled([
      db.transaction(async () => {
        await sleep(10);
        throw new Error('prima fallisce');
      }),
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO parent (id, name) VALUES (1, ?)', ['seconda']);
      }),
    ]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled']);
    expect(await names(db)).toEqual(['seconda']);
  });

  it("tx non si puo' usare dopo la fine della transazione", async () => {
    const db = await setup();
    let leaked: SqlDatabase | undefined;
    await db.transaction(async (tx) => {
      leaked = tx;
      await tx.run('INSERT INTO parent (id, name) VALUES (1, ?)', ['a']);
    });
    expect(await errorOf(() => (leaked as SqlDatabase).run('INSERT INTO parent (id, name) VALUES (2, ?)', ['b']))).toMatch(/conclusa/);
    expect(await names(db)).toEqual(['a']);
  });

  it('PRAGMA user_version dentro la transazione torna indietro con il rollback', async () => {
    const db = await setup();
    await errorOf(() =>
      db.transaction(async (tx) => {
        await tx.exec('PRAGMA user_version = 7');
        throw new Error('annulla');
      }, 'exclusive'),
    );
    expect(await db.get('PRAGMA user_version')).toEqual({ user_version: 0 });
    await db.transaction(async (tx) => {
      await tx.exec('PRAGMA user_version = 3');
    }, 'exclusive');
    expect(await db.get('PRAGMA user_version')).toEqual({ user_version: 3 });
  });

  it("una transazione aperta sul database radice dentro un'altra scade invece di bloccarsi per sempre", async () => {
    const db = await setup({ transactionTimeoutMs: 80 });
    const err = await errorOf(() =>
      db.transaction(async () => {
        await db.transaction(async (inner) => {
          await inner.run('INSERT INTO parent (id, name) VALUES (1, ?)', ['sbagliato']);
        });
      }),
    );
    expect(err).toMatch(/occupato da una transazione/);
    expect(await names(db)).toEqual([]);
    // dopo l'errore il database e di nuovo utilizzabile
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO parent (id, name) VALUES (2, ?)', ['ok']);
    });
    expect(await names(db)).toEqual(['ok']);
  });

  it('i PRAGMA di apertura sono attivi sulla connessione', async () => {
    const db = await setup();
    const p = await readPragmas(db);
    expect(p.foreign_keys).toBe(1);
    expect(p.secure_delete).toBe(1);
  });

  if (adapter.singleConnection) {
    it("una scrittura fuori dalla transazione aspetta la fine di quella in corso (non finisce dentro il suo rollback)", async () => {
      const db = await setup();
      const tx = db.transaction(async (t) => {
        await t.run('INSERT INTO parent (id, name) VALUES (1, ?)', ['dentro']);
        await sleep(40);
        throw new Error('annulla');
      });
      await sleep(10); // la transazione e' aperta
      const outside = db.run('INSERT INTO parent (id, name) VALUES (2, ?)', ['fuori']);
      expect(await errorOf(() => tx)).toBe('annulla');
      await outside;
      expect(await names(db)).toEqual(['fuori']);
    });

    it("anche le letture fuori transazione aspettano e non vedono dati non confermati", async () => {
      const db = await setup();
      const tx = db.transaction(async (t) => {
        await t.run('INSERT INTO parent (id, name) VALUES (1, ?)', ['non-confermato']);
        await sleep(40);
        throw new Error('annulla');
      });
      await sleep(10);
      const read = db.all('SELECT name FROM parent');
      await errorOf(() => tx);
      expect(await read).toEqual([]);
    });

    it('usare il database radice dentro la callback scade con DatabaseBusyError invece di bloccarsi per sempre', async () => {
      const db = await setup({ lockTimeoutMs: 80 });
      const err = await errorOf(() =>
        db.transaction(async () => {
          await db.run('INSERT INTO parent (id, name) VALUES (1, ?)', ['sbagliato']); // andava usato tx
        }),
      );
      expect(err).toMatch(/occupato da una transazione/);
      expect(err).toBe(new DatabaseBusyError().message);
      expect(await names(db)).toEqual([]);
    });
  }
});

describe('Mutex', () => {
  it('FIFO e rilascio idempotente', async () => {
    const m = new Mutex();
    const order: number[] = [];
    const task = async (n: number, ms: number): Promise<void> => {
      const release = await m.acquire();
      order.push(n);
      await sleep(ms);
      release();
      release(); // un secondo rilascio non fa danni
    };
    await Promise.all([task(1, 20), task(2, 1), task(3, 1)]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('un acquire con timeout scade e non occupa il turno', async () => {
    const m = new Mutex();
    const release = await m.acquire();
    expect(await errorOf(() => m.acquire(20))).toMatch(/occupato/);
    release();
    const again = await m.acquire(20); // il lock e' libero: il turno scaduto non lo tiene
    again();
  });
});
