import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

// hashService (importato dal FileStore) legge expo-crypto: i test passano l'SHA-256 di node
vi.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: vi.fn() }));

import {
  createMemoryFileStore,
  openPersistentFileStore,
  type FileBackend,
  type MemoryFileStoreOptions,
} from '@/platform/files/memoryFileStore';
import { createIndexedDbFileBackend, createNullFileBackend } from '@/platform/files/indexedDbFileBackend';

const sha256Hex = async (bytes: Uint8Array): Promise<string> => createHash('sha256').update(bytes).digest('hex');
const bytes = (...n: number[]): Uint8Array => Uint8Array.from(n);
const make = (opts: MemoryFileStoreOptions = {}) => createMemoryFileStore({ sha256Hex, ...opts });

describe('FileStore in memoria', () => {
  it('write / read / exists / remove sul singolo file', async () => {
    const fs = make();
    expect(await fs.exists('attachments/A.pdf')).toBe(false);
    await fs.write('attachments/A.pdf', bytes(1, 2, 3));
    expect(await fs.exists('attachments/A.pdf')).toBe(true);
    expect(Array.from(await fs.read('attachments/A.pdf'))).toEqual([1, 2, 3]);
    await fs.remove('attachments/A.pdf');
    expect(await fs.exists('attachments/A.pdf')).toBe(false);
    await expect(fs.read('attachments/A.pdf')).rejects.toThrow(/non trovato/);
  });

  it("remove di un file assente non fa nulla; write sopra un file esistente lo sostituisce", async () => {
    const fs = make();
    await expect(fs.remove('niente.txt')).resolves.toBeUndefined();
    await fs.write('a.txt', bytes(1));
    await fs.write('a.txt', bytes(9, 9));
    expect(Array.from(await fs.read('a.txt'))).toEqual([9, 9]);
  });

  it('copia i byte in scrittura e in lettura: modificare gli originali non altera il contenuto', async () => {
    const fs = make();
    const src = bytes(1, 2, 3);
    await fs.write('a.bin', src);
    src[0] = 99;
    const out = await fs.read('a.bin');
    expect(out[0]).toBe(1);
    out[1] = 77;
    expect(Array.from(await fs.read('a.bin'))).toEqual([1, 2, 3]);
  });

  it('le cartelle sono implicite: list restituisce i nomi dei figli diretti, ordinati e senza doppioni', async () => {
    const fs = make();
    await fs.write('temp/export-1/MyGarage.zip', bytes(1));
    await fs.write('temp/export-1/data.json', bytes(2));
    await fs.write('temp/foto.jpg', bytes(3));
    await fs.write('attachments/A.pdf', bytes(4));
    expect(await fs.list('temp')).toEqual(['export-1', 'foto.jpg']);
    expect(await fs.list('temp/export-1')).toEqual(['MyGarage.zip', 'data.json']);
    expect(await fs.list('')).toEqual(['attachments', 'temp']);
    expect(await fs.list('vuota')).toEqual([]);
    expect(await fs.list('tem')).toEqual([]); // il prefisso di testo non e' una cartella
  });

  it('exists vale anche per le cartelle; remove di una cartella toglie tutto cio\' che c\'e\' sotto (e solo quello)', async () => {
    const fs = make();
    await fs.write('temp/x/a.bin', bytes(1));
    await fs.write('temp/x/y/b.bin', bytes(2));
    await fs.write('temp/xx.bin', bytes(3));
    expect(await fs.exists('temp/x')).toBe(true);
    expect(await fs.exists('temp')).toBe(true);
    await fs.remove('temp/x');
    expect(await fs.exists('temp/x')).toBe(false);
    expect(await fs.exists('temp/x/y/b.bin')).toBe(false);
    expect(await fs.exists('temp/xx.bin')).toBe(true); // 'temp/xx.bin' non e' sotto 'temp/x'
  });

  it('normalizza i percorsi (barre doppie, ./, barra iniziale) e rifiuta i percorsi che escono dalla radice', async () => {
    const fs = make();
    await fs.write('/attachments//./A.pdf', bytes(1));
    expect(await fs.exists('attachments/A.pdf')).toBe(true);
    await expect(fs.write('../fuori.txt', bytes(1))).rejects.toThrow(/non valido/);
    await expect(fs.read('attachments/../../x')).rejects.toThrow(/non valido/);
    await expect(fs.write('', bytes(1))).rejects.toThrow(/mancante/);
  });

  it('sha256 e\' quello dei byte salvati; su un file assente lancia', async () => {
    const fs = make();
    await fs.write('a.txt', new TextEncoder().encode('abc'));
    expect(await fs.sha256('a.txt')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    await expect(fs.sha256('manca.txt')).rejects.toThrow(/non trovato/);
  });

  it('il contenuto iniziale si normalizza e si copia', async () => {
    const seed = bytes(5, 6);
    const fs = make({ initial: [['/attachments/S.pdf', seed]] });
    seed[0] = 0;
    expect(Array.from(await fs.read('attachments/S.pdf'))).toEqual([5, 6]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
class RecordingBackend implements FileBackend {
  readonly calls: string[] = [];
  readonly data = new Map<string, Uint8Array>();
  failNext = false;
  async loadAll(): Promise<Array<[string, Uint8Array]>> {
    return [...this.data.entries()];
  }
  async put(path: string, b: Uint8Array): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('quota piena');
    }
    this.calls.push(`put ${path}`);
    this.data.set(path, b);
  }
  async delete(paths: string[]): Promise<void> {
    this.calls.push(`delete ${paths.join(',')}`);
    for (const p of paths) this.data.delete(p);
  }
  async clear(): Promise<void> {
    this.data.clear();
  }
}

describe('FileStore in memoria con backend (persistenza)', () => {
  it('ogni scrittura e cancellazione si ripete sul backend, nell\'ordine, senza bloccare', async () => {
    const backend = new RecordingBackend();
    const fs = make({ backend });
    await fs.write('attachments/A.pdf', bytes(1));
    await fs.write('temp/x/b.bin', bytes(2));
    await fs.write('temp/x/c.bin', bytes(3));
    await fs.remove('temp/x');
    await fs.remove('niente.txt'); // nessun file: nessuna chiamata
    await fs.settled();
    expect(backend.calls).toEqual(['put attachments/A.pdf', 'put temp/x/b.bin', 'put temp/x/c.bin', 'delete temp/x/b.bin,temp/x/c.bin']);
    expect([...backend.data.keys()]).toEqual(['attachments/A.pdf']);
  });

  it('un errore del backend si segnala ma non fa fallire l\'operazione, e le scritture successive proseguono', async () => {
    const backend = new RecordingBackend();
    const onBackendError = vi.fn();
    const fs = make({ backend, onBackendError });
    backend.failNext = true;
    await expect(fs.write('a.bin', bytes(1))).resolves.toBeUndefined();
    await fs.write('b.bin', bytes(2));
    await fs.settled();
    expect(onBackendError).toHaveBeenCalledTimes(1);
    expect(String((onBackendError.mock.calls[0] as unknown[])[0])).toContain('quota piena');
    expect(Array.from(await fs.read('a.bin'))).toEqual([1]); // in memoria c'e' comunque
    expect([...backend.data.keys()]).toEqual(['b.bin']);
  });

  it('openPersistentFileStore ricarica i file dal backend', async () => {
    const backend = new RecordingBackend();
    backend.data.set('attachments/Z.pdf', bytes(7, 8));
    const fs = await openPersistentFileStore(backend, { sha256Hex });
    expect(Array.from(await fs.read('attachments/Z.pdf'))).toEqual([7, 8]);
    await fs.write('attachments/N.pdf', bytes(9));
    await fs.settled();
    expect(backend.data.has('attachments/N.pdf')).toBe(true);
  });

  it('se il backend non si legge si riparte da vuoto e l\'errore si segnala', async () => {
    const onBackendError = vi.fn();
    const backend: FileBackend = { ...createNullFileBackend(), loadAll: async () => Promise.reject(new Error('IndexedDB bloccato')) };
    const fs = await openPersistentFileStore(backend, { sha256Hex, onBackendError });
    expect(await fs.list('')).toEqual([]);
    expect(onBackendError).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
/** IndexedDB minimo in memoria: solo cio' che usa createIndexedDbFileBackend (get/put/delete/clear, getAllKeys/getAll). */
function fakeIdb(): { factory: IDBFactory; data: Map<string, Map<string, unknown>>; opens: () => number } {
  const data = new Map<string, Map<string, unknown>>(); // "db/store" -> chiave -> valore
  let opened = 0;
  const later = (fn: () => void): void => void setTimeout(fn, 0);
  const factory = {
    open(name: string) {
      opened++;
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
              clear: () => request(() => map.clear()),
              getAllKeys: () => request(() => [...map.keys()]),
              getAll: () => request(() => [...map.values()]),
            });
            return tx;
          },
        };
        req['result'] = db;
        if (!stores.has('files')) (req['onupgradeneeded'] as () => void)();
        (req['onsuccess'] as () => void)();
      });
      return req;
    },
  };
  return { factory: factory as unknown as IDBFactory, data, opens: () => opened };
}

describe('FileBackend su IndexedDB', () => {
  it('senza IndexedDB e\' un backend che non conserva nulla', async () => {
    const backend = createIndexedDbFileBackend({ factory: undefined });
    await backend.put('a', bytes(1));
    expect(await backend.loadAll()).toEqual([]);
    await expect(backend.clear()).resolves.toBeUndefined();
  });

  it('put / loadAll / delete / clear (round trip), con un solo database aperto', async () => {
    const { factory, opens } = fakeIdb();
    const backend = createIndexedDbFileBackend({ factory });
    expect(await backend.loadAll()).toEqual([]);
    await backend.put('attachments/A.pdf', bytes(1, 2));
    await backend.put('attachments/B.pdf', bytes(3));
    const again = createIndexedDbFileBackend({ factory });
    const all = new Map(await again.loadAll());
    expect([...all.keys()].sort()).toEqual(['attachments/A.pdf', 'attachments/B.pdf']);
    expect(Array.from(all.get('attachments/A.pdf') as Uint8Array)).toEqual([1, 2]);
    await backend.delete(['attachments/A.pdf']);
    await backend.delete([]);
    expect((await again.loadAll()).map(([k]) => k)).toEqual(['attachments/B.pdf']);
    await backend.clear();
    expect(await backend.loadAll()).toEqual([]);
    expect(opens()).toBe(2); // uno per istanza di backend
  });

  it('un FileStore con backend IndexedDB sopravvive a una nuova apertura (stessa factory)', async () => {
    const { factory } = fakeIdb();
    const first = await openPersistentFileStore(createIndexedDbFileBackend({ factory }), { sha256Hex });
    await first.write('attachments/FOTO.jpg', bytes(10, 20, 30));
    await first.write('temp/t.bin', bytes(1));
    await first.remove('temp');
    await first.settled();
    const second = await openPersistentFileStore(createIndexedDbFileBackend({ factory }), { sha256Hex });
    expect(Array.from(await second.read('attachments/FOTO.jpg'))).toEqual([10, 20, 30]);
    expect(await second.exists('temp')).toBe(false);
  });
});
