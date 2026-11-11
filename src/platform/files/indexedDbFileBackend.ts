// FileBackend su IndexedDB per l'anteprima web: una voce per file (chiave = percorso virtuale, valore = Uint8Array).
// Database separato da quello che salva la copia del file SQLite (webPersistence), cosi' si possono azzerare a parte.
import type { FileBackend } from './memoryFileStore';

export interface IndexedDbFileBackendOptions {
  dbName?: string;
  storeName?: string;
  /** Default: globalThis.indexedDB. Serve ai test. */
  factory?: IDBFactory | undefined;
}

export const WEB_FILES_DB_NAME = 'mygarage-web-files';

const requestToPromise = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('errore IndexedDB'));
  });

const transactionDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('errore IndexedDB'));
    tx.onabort = () => reject(tx.error ?? new Error('transazione IndexedDB annullata'));
  });

/** Backend che non conserva nulla (IndexedDB assente, ad esempio in una finestra privata): i file vivono solo in memoria. */
export function createNullFileBackend(): FileBackend {
  return { loadAll: async () => [], put: async () => undefined, delete: async () => undefined, clear: async () => undefined };
}

export function createIndexedDbFileBackend(opts: IndexedDbFileBackendOptions = {}): FileBackend {
  const factory = 'factory' in opts ? opts.factory : (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) return createNullFileBackend();
  const dbName = opts.dbName ?? WEB_FILES_DB_NAME;
  const storeName = opts.storeName ?? 'files';

  let opened: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB non disponibile'));
      req.onblocked = () => reject(new Error("IndexedDB bloccato da un'altra scheda"));
    }).catch((e: unknown) => {
      opened = null;
      throw e;
    });
    return opened;
  };

  return {
    async loadAll() {
      const db = await open();
      const store = db.transaction(storeName, 'readonly').objectStore(storeName);
      const [keys, values] = await Promise.all([requestToPromise(store.getAllKeys()), requestToPromise(store.getAll())]);
      const out: Array<[string, Uint8Array]> = [];
      keys.forEach((key, i) => {
        const value: unknown = values[i];
        if (typeof key !== 'string') return;
        if (value instanceof Uint8Array) out.push([key, value]);
        else if (value instanceof ArrayBuffer) out.push([key, new Uint8Array(value)]);
      });
      return out;
    },
    async put(path, bytes) {
      const db = await open();
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(bytes, path);
      await transactionDone(tx);
    },
    async delete(paths) {
      if (paths.length === 0) return;
      const db = await open();
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const p of paths) store.delete(p);
      await transactionDone(tx);
    },
    async clear() {
      const db = await open();
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      await transactionDone(tx);
    },
  };
}
