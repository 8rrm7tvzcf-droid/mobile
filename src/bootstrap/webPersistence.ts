// Persistenza del database dell'ANTEPRIMA WEB (sql.js vive in memoria): a ogni scrittura, con una breve attesa per
// raggruppare le scritture ravvicinate, si salva una copia del file SQLite in IndexedDB; all'avvio la si ricarica.
//
// Attenzione a sql.js: `export()` CHIUDE e RIAPRE il database, quindi (a) non si puo' chiamare durante una transazione
// o un'operazione in corso, (b) i PRAGMA per connessione (foreign_keys!) tornano ai valori predefiniti e vanno riapplicati.
// Per questo ogni operazione passa da un cancello "lettori/scrittore" (IdleGate): il salvataggio entra in esclusiva,
// quando nessuna operazione e' in corso, e riapplica i PRAGMA prima di lasciar passare le altre.
import type { SqlDatabase } from '@/domain/ports';

// ---------------------------------------------------------------------------------------------------------------------
// Cancello: molte operazioni insieme, oppure una sola esclusiva (con precedenza per non farla aspettare all'infinito).

export class IdleGate {
  private active = 0;
  private exclusive = false;
  private exclusiveWaiting = 0;
  private waiters: Array<() => void> = [];

  private wait(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const resolve of w) resolve();
  }

  /** Entra come operazione normale; restituisce la funzione per uscire. */
  async enter(): Promise<() => void> {
    while (this.exclusive || this.exclusiveWaiting > 0) await this.wait();
    this.active++;
    let left = false;
    return () => {
      if (left) return;
      left = true;
      this.active--;
      this.wake();
    };
  }

  /** Esegue `fn` quando nessuna operazione e' in corso e impedisce che ne partano altre finche' non ha finito. */
  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    this.exclusiveWaiting++;
    try {
      while (this.exclusive || this.active > 0) await this.wait();
    } finally {
      this.exclusiveWaiting--;
    }
    this.exclusive = true;
    try {
      return await fn();
    } finally {
      this.exclusive = false;
      this.wake();
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Database con salvataggio automatico

export interface SnapshotSaver {
  save(bytes: Uint8Array): Promise<void>;
}

/** Il sottoinsieme dell'adattatore sql.js che serve (SqlJsAdapterDatabase lo soddisfa). */
export interface ExportableDatabase extends SqlDatabase {
  exportBytes(): Uint8Array;
  close(): Promise<void>;
}

export interface PersistingDatabaseOptions {
  store: SnapshotSaver;
  /** Riapplica i PRAGMA dopo l'export (con sql.js: applyPragmas(db, { journalMode: 'skip' })). */
  reapplyPragmas: (db: SqlDatabase) => Promise<void>;
  /** Attesa dall'ultima scrittura prima di salvare (default 400 ms). */
  debounceMs?: number;
  /** Errore di salvataggio: l'anteprima continua a funzionare, solo non persiste (default: console.warn). */
  onError?: (error: unknown) => void;
}

export interface PersistingDatabase extends SqlDatabase {
  /** Salva subito se ci sono scritture non ancora salvate. Non lancia mai. */
  flush(): Promise<void>;
  /** Salva, poi chiude il database. */
  close(): Promise<void>;
}

export function createPersistingDatabase(inner: ExportableDatabase, opts: PersistingDatabaseOptions): PersistingDatabase {
  const debounceMs = opts.debounceMs ?? 400;
  const onError =
    opts.onError ??
    ((e: unknown): void => {
      console.warn("[anteprima web] salvataggio del database non riuscito: i dati non resteranno dopo il ricaricamento", e);
    });
  const gate = new IdleGate();
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();

  const saveIfDirty = async (): Promise<void> => {
    if (!dirty) return;
    dirty = false;
    try {
      const bytes = await gate.runExclusive(async () => {
        const b = inner.exportBytes();
        await opts.reapplyPragmas(inner);
        return b;
      });
      await opts.store.save(bytes);
    } catch (e) {
      dirty = true; // si riprovera' alla prossima scrittura
      onError(e);
    }
  };

  const flush = (): Promise<void> => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    chain = chain.then(saveIfDirty);
    return chain;
  };

  const markDirty = (): void => {
    dirty = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, debounceMs);
  };

  const read = async <T>(fn: () => Promise<T>): Promise<T> => {
    const leave = await gate.enter();
    try {
      return await fn();
    } finally {
      leave();
    }
  };
  const write = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await read(fn);
    } finally {
      markDirty();
    }
  };

  return {
    exec: (sql) => write(() => inner.exec(sql)),
    run: (sql, params) => write(() => inner.run(sql, params)),
    all: <T>(sql: string, params?: Parameters<SqlDatabase['all']>[1]) => read(() => inner.all<T>(sql, params)),
    get: <T>(sql: string, params?: Parameters<SqlDatabase['get']>[1]) => read(() => inner.get<T>(sql, params)),
    transaction: <T>(fn: (tx: SqlDatabase) => Promise<T>, mode?: 'deferred' | 'exclusive') =>
      write(() => inner.transaction(fn, mode)),
    flush,
    async close() {
      await flush();
      await inner.close();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Archivio delle copie: IndexedDB

export interface SnapshotStore extends SnapshotSaver {
  load(): Promise<Uint8Array | null>;
  clear(): Promise<void>;
}

export interface IndexedDbStoreOptions {
  dbName?: string;
  storeName?: string;
  key?: string;
  /** Default: globalThis.indexedDB. Serve ai test. */
  factory?: IDBFactory | undefined;
}

const DEFAULT_DB_NAME = 'mygarage-web-preview';

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('errore IndexedDB'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('errore IndexedDB'));
    tx.onabort = () => reject(tx.error ?? new Error('transazione IndexedDB annullata'));
  });
}

/** Archivio che non conserva nulla (IndexedDB assente, ad esempio in una finestra privata): l'anteprima funziona ma non persiste. */
export function createNullSnapshotStore(): SnapshotStore {
  return { load: async () => null, save: async () => undefined, clear: async () => undefined };
}

export function createIndexedDbSnapshotStore(opts: IndexedDbStoreOptions = {}): SnapshotStore {
  const factory = 'factory' in opts ? opts.factory : (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) return createNullSnapshotStore();
  const dbName = opts.dbName ?? DEFAULT_DB_NAME;
  const storeName = opts.storeName ?? 'snapshots';
  const key = opts.key ?? 'main';

  let opened: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB non disponibile'));
      req.onblocked = () => reject(new Error('IndexedDB bloccato da un\'altra scheda'));
    }).catch((e: unknown) => {
      opened = null;
      throw e;
    });
    return opened;
  };

  return {
    async load() {
      const db = await open();
      const tx = db.transaction(storeName, 'readonly');
      const value: unknown = await requestToPromise(tx.objectStore(storeName).get(key));
      if (value instanceof Uint8Array) return value;
      if (value instanceof ArrayBuffer) return new Uint8Array(value);
      return null;
    },
    async save(bytes) {
      const db = await open();
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(bytes, key);
      await transactionDone(tx);
    },
    async clear() {
      const db = await open();
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      await transactionDone(tx);
    },
  };
}
