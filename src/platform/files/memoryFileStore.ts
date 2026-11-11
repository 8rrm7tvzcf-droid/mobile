// Porta FileStore in MEMORIA, per l'anteprima web (SPEC 8.4: sul web non c'e' un file system) e per i test.
// Percorsi virtuali con '/' (cartelle implicite: esistono finche' c'e' almeno un file sotto). Opzionalmente ogni
// scrittura/cancellazione si ripete su un `FileBackend` (IndexedDB, vedi indexedDbFileBackend.ts) in coda e senza
// bloccare: un errore del backend si segnala con `onBackendError` ma non fa fallire l'operazione in memoria.
import type { FileStore } from '@/domain/ports';
import { createHashService } from './hashService';
import { normalizeVirtualPath } from './paths';

/** Dove si conservano i file tra una sessione e l'altra (IndexedDB nel browser). */
export interface FileBackend {
  loadAll(): Promise<Array<[path: string, bytes: Uint8Array]>>;
  put(path: string, bytes: Uint8Array): Promise<void>;
  delete(paths: string[]): Promise<void>;
  clear(): Promise<void>;
}

export interface MemoryFileStoreOptions {
  /** SHA-256 esadecimale dei byte (default: createHashService()). */
  sha256Hex?: (bytes: Uint8Array) => Promise<string>;
  backend?: FileBackend;
  /** Contenuto di partenza (di solito `backend.loadAll()`). */
  initial?: Iterable<[path: string, bytes: Uint8Array]>;
  onBackendError?: (error: unknown) => void;
}

export interface MemoryFileStore extends FileStore {
  /** Si risolve quando tutte le scritture accodate sul backend sono finite (non lancia mai). */
  settled(): Promise<void>;
}

export function createMemoryFileStore(opts: MemoryFileStoreOptions = {}): MemoryFileStore {
  const files = new Map<string, Uint8Array>();
  for (const [path, bytes] of opts.initial ?? []) files.set(normalizeVirtualPath(path), bytes.slice());
  const sha256Hex = opts.sha256Hex ?? createHashService().sha256Hex;
  const backend = opts.backend;
  const onBackendError =
    opts.onBackendError ??
    ((e: unknown): void => {
      console.warn('[anteprima web] salvataggio dei file non riuscito: dopo il ricaricamento potrebbero mancare', e);
    });

  let chain: Promise<void> = Promise.resolve();
  const enqueue = (job: () => Promise<void>): void => {
    if (!backend) return;
    chain = chain.then(job).catch(onBackendError);
  };

  const getOrThrow = (path: string): { key: string; bytes: Uint8Array } => {
    const key = normalizeVirtualPath(path);
    const bytes = files.get(key);
    if (!bytes) throw new Error(`File non trovato: ${path}`);
    return { key, bytes };
  };

  return {
    async write(path, bytes) {
      const key = normalizeVirtualPath(path);
      if (key === '') throw new Error('Percorso del file mancante');
      const copy = bytes.slice();
      files.set(key, copy);
      enqueue(() => (backend as FileBackend).put(key, copy));
    },
    async read(path) {
      return getOrThrow(path).bytes.slice();
    },
    async remove(path) {
      const key = normalizeVirtualPath(path);
      const prefix = `${key}/`;
      const removed: string[] = [];
      for (const k of files.keys()) {
        if (key === '' || k === key || k.startsWith(prefix)) removed.push(k);
      }
      for (const k of removed) files.delete(k);
      if (removed.length > 0) enqueue(() => (backend as FileBackend).delete(removed));
    },
    async exists(path) {
      const key = normalizeVirtualPath(path);
      if (key === '' || files.has(key)) return true;
      const prefix = `${key}/`;
      for (const k of files.keys()) if (k.startsWith(prefix)) return true;
      return false;
    },
    async list(dir) {
      const key = normalizeVirtualPath(dir);
      const prefix = key === '' ? '' : `${key}/`;
      const names = new Set<string>();
      for (const k of files.keys()) {
        if (!k.startsWith(prefix)) continue;
        const name = k.slice(prefix.length).split('/', 1)[0];
        if (name) names.add(name);
      }
      return [...names].sort();
    },
    async sha256(path) {
      return sha256Hex(getOrThrow(path).bytes);
    },
    settled: () => chain,
  };
}

/** Carica i file dal backend (un errore di lettura equivale a "nessun file") e restituisce il negozio collegato ad esso. */
export async function openPersistentFileStore(
  backend: FileBackend,
  opts: Omit<MemoryFileStoreOptions, 'backend' | 'initial'> = {},
): Promise<MemoryFileStore> {
  const onBackendError =
    opts.onBackendError ??
    ((e: unknown): void => {
      console.warn('[anteprima web] impossibile leggere i file salvati', e);
    });
  const initial = await backend.loadAll().catch((e: unknown) => {
    onBackendError(e);
    return [] as Array<[string, Uint8Array]>;
  });
  return createMemoryFileStore({ ...opts, backend, initial });
}
