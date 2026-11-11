import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createIndexedDbSnapshotStore,
  createNullSnapshotStore,
  createPersistingDatabase,
  IdleGate,
  type ExportableDatabase,
} from '@/bootstrap/webPersistence';
import { applyPragmas } from '@/data/db/pragmas';
import { openSqlJsDatabase, type SqlJsAdapterDatabase } from '@/data/adapters/sqlJs';

// ---------------------------------------------------------------------------------------------------------------------
describe('IdleGate', () => {
  it('piu\' operazioni normali insieme; quella esclusiva aspetta che finiscano tutte', async () => {
    const gate = new IdleGate();
    const log: string[] = [];
    const leaveA = await gate.enter();
    const leaveB = await gate.enter();
    const excl = gate.runExclusive(async () => {
      log.push('esclusiva');
    });
    await Promise.resolve();
    expect(log).toEqual([]);
    leaveA();
    await Promise.resolve();
    expect(log).toEqual([]); // B e' ancora dentro
    leaveB();
    await excl;
    expect(log).toEqual(['esclusiva']);
  });

  it("durante l'esclusiva le nuove operazioni aspettano; l'esclusiva in attesa ha la precedenza su quelle nuove", async () => {
    const gate = new IdleGate();
    const log: string[] = [];
    const leave1 = await gate.enter();
    const excl = gate.runExclusive(async () => {
      log.push('esclusiva');
    });
    const late = gate.enter().then((leave) => {
      log.push('tardiva');
      leave();
    });
    leave1();
    await Promise.all([excl, late]);
    expect(log).toEqual(['esclusiva', 'tardiva']);
  });

  it("l'uscita e' idempotente", async () => {
    const gate = new IdleGate();
    const leave = await gate.enter();
    leave();
    leave();
    await expect(gate.runExclusive(() => 42)).resolves.toBe(42);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('createPersistingDatabase (con sql.js vero)', () => {
  let inner: SqlJsAdapterDatabase;
  const saved: Uint8Array[] = [];
  const store = { save: vi.fn(async (b: Uint8Array) => void saved.push(b)) };
  const reapplyPragmas = (d: Parameters<typeof applyPragmas>[0]): Promise<void> => applyPragmas(d, { journalMode: 'skip' });

  beforeEach(async () => {
    vi.useFakeTimers();
    saved.length = 0;
    store.save.mockClear();
    inner = await openSqlJsDatabase();
    await inner.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); CREATE TABLE c (id INTEGER PRIMARY KEY, t_id INTEGER NOT NULL REFERENCES t(id))');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const wrap = (over: Partial<Parameters<typeof createPersistingDatabase>[1]> = {}) =>
    createPersistingDatabase(inner as ExportableDatabase, { store, reapplyPragmas, ...over });

  const rowsOf = async (bytes: Uint8Array): Promise<unknown[]> => {
    const copy = await openSqlJsDatabase({ data: bytes });
    const rows = await copy.all('SELECT v FROM t ORDER BY id');
    await copy.close();
    return rows;
  };

  it("salva dopo l'attesa di raggruppamento e la copia contiene i dati", async () => {
    const db = wrap();
    await db.run('INSERT INTO t (v) VALUES (?)', ['uno']);
    expect(store.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(399);
    expect(store.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(await rowsOf(saved[0] as Uint8Array)).toEqual([{ v: 'uno' }]);
  });

  it('piu\' scritture ravvicinate = un solo salvataggio', async () => {
    const db = wrap();
    for (let i = 0; i < 5; i++) await db.run('INSERT INTO t (v) VALUES (?)', [`r${i}`]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(await rowsOf(saved[0] as Uint8Array)).toHaveLength(5);
  });

  it('le letture non sporcano: nessun salvataggio', async () => {
    const db = wrap();
    await db.all('SELECT * FROM t');
    await db.get('SELECT * FROM t');
    await vi.advanceTimersByTimeAsync(2000);
    await db.flush();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("dopo l'export i PRAGMA (foreign_keys) vengono riapplicati: i vincoli continuano a valere", async () => {
    const db = wrap();
    await db.run('INSERT INTO t (v) VALUES (?)', ['uno']);
    await db.flush();
    expect(store.save).toHaveBeenCalledTimes(1);
    const fk = await db.get<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(fk?.foreign_keys).toBe(1);
    await expect(db.run('INSERT INTO c (t_id) VALUES (999)')).rejects.toThrow(/FOREIGN KEY/i);
  });

  it("senza riapplicare i PRAGMA l'export li azzera (e' il motivo per cui il wrapper li riapplica)", async () => {
    const db = wrap({ reapplyPragmas: async () => undefined });
    await db.run('INSERT INTO t (v) VALUES (?)', ['uno']);
    await db.flush();
    const fk = await db.get<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(fk?.foreign_keys).toBe(0);
  });

  it('flush salva subito; se non c\'e\' nulla di nuovo non salva', async () => {
    const db = wrap();
    await db.run('INSERT INTO t (v) VALUES (?)', ['uno']);
    await db.flush();
    expect(store.save).toHaveBeenCalledTimes(1);
    await db.flush();
    expect(store.save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000); // il timer era stato annullato
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it('il salvataggio aspetta la fine di una transazione in corso (un export a meta\' la annullerebbe)', async () => {
    const db = wrap();
    let finishTx: () => void = () => undefined;
    const txGate = new Promise<void>((r) => (finishTx = r));
    const tx = db.transaction(async (t) => {
      await t.run('INSERT INTO t (v) VALUES (?)', ['dentro']);
      await txGate;
      await t.run('INSERT INTO t (v) VALUES (?)', ['ancora dentro']);
    });
    await vi.advanceTimersByTimeAsync(0);
    const outside = db.run('INSERT INTO t (v) VALUES (?)', ['fuori']); // accodata dietro la transazione
    const flushed = db.flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.save).not.toHaveBeenCalled(); // la transazione e' ancora aperta
    finishTx();
    await tx;
    await outside;
    await flushed;
    await db.flush();
    expect(store.save).toHaveBeenCalled();
    const last = saved[saved.length - 1] as Uint8Array;
    expect((await rowsOf(last)).map((r) => (r as { v: string }).v)).toEqual(['dentro', 'ancora dentro', 'fuori']);
  });

  it('un errore di salvataggio non rompe il database: si segnala e si riprova alla volta dopo', async () => {
    const onError = vi.fn();
    store.save.mockRejectedValueOnce(new Error('quota piena'));
    const db = wrap({ onError });
    await db.run('INSERT INTO t (v) VALUES (?)', ['uno']);
    await db.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    await expect(db.all('SELECT * FROM t')).resolves.toHaveLength(1);
    await db.flush(); // ancora sporco: riprova
    expect(store.save).toHaveBeenCalledTimes(2);
    expect(saved).toHaveLength(1);
  });

  it('close salva e poi chiude', async () => {
    const closeSpy = vi.spyOn(inner, 'close');
    const db = wrap();
    await db.run('INSERT INTO t (v) VALUES (?)', ['uno']);
    await db.close();
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
/** IndexedDB minimo in memoria: solo cio' che usa createIndexedDbSnapshotStore. */
function fakeIdb(): { factory: IDBFactory; data: Map<string, Map<string, unknown>> } {
  const data = new Map<string, Map<string, unknown>>(); // "db/store" -> chiave -> valore
  const later = (fn: () => void): void => void setTimeout(fn, 0);
  const factory = {
    open(name: string) {
      const req: Record<string, unknown> = {};
      later(() => {
        const stores = new Set<string>(
          [...data.keys()].filter((k) => k.startsWith(`${name}/`)).map((k) => k.slice(name.length + 1)),
        );
        const db = {
          objectStoreNames: { contains: (s: string) => stores.has(s) },
          createObjectStore: (s: string) => {
            stores.add(s);
            data.set(`${name}/${s}`, new Map());
          },
          transaction: (storeName: string) => {
            const tx: Record<string, unknown> = {};
            const map = data.get(`${name}/${storeName}`) ?? new Map<string, unknown>();
            data.set(`${name}/${storeName}`, map);
            const request = (run: () => unknown) => {
              const r: Record<string, unknown> = {};
              later(() => {
                r['result'] = run();
                (r['onsuccess'] as (() => void) | undefined)?.();
                later(() => (tx['oncomplete'] as (() => void) | undefined)?.());
              });
              return r;
            };
            tx['objectStore'] = () => ({
              get: (k: string) => request(() => map.get(k)),
              put: (v: unknown, k: string) => request(() => void map.set(k, v)),
              delete: (k: string) => request(() => void map.delete(k)),
            });
            return tx;
          },
        };
        req['result'] = db;
        if (!data.has(`${name}/snapshots`)) (req['onupgradeneeded'] as () => void)();
        (req['onsuccess'] as () => void)();
      });
      return req;
    },
  };
  return { factory: factory as unknown as IDBFactory, data };
}

describe('createIndexedDbSnapshotStore', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);

  it('senza copie salvate load() restituisce null', async () => {
    const { factory } = fakeIdb();
    expect(await createIndexedDbSnapshotStore({ factory }).load()).toBeNull();
  });

  it('save e load fanno il giro, anche da un\'istanza nuova (come dopo un ricaricamento)', async () => {
    const { factory } = fakeIdb();
    await createIndexedDbSnapshotStore({ factory }).save(bytes);
    const again = await createIndexedDbSnapshotStore({ factory }).load();
    expect(again).toEqual(bytes);
  });

  it('save sostituisce la copia precedente; clear la elimina', async () => {
    const { factory } = fakeIdb();
    const s = createIndexedDbSnapshotStore({ factory });
    await s.save(bytes);
    await s.save(new Uint8Array([9]));
    expect(await s.load()).toEqual(new Uint8Array([9]));
    await s.clear();
    expect(await s.load()).toBeNull();
  });

  it('senza IndexedDB (finestra privata, ambiente senza browser) si ripiega su un archivio che non conserva nulla', async () => {
    const s = createIndexedDbSnapshotStore({ factory: undefined });
    await s.save(bytes);
    expect(await s.load()).toBeNull();
    await expect(createNullSnapshotStore().clear()).resolves.toBeUndefined();
  });
});
