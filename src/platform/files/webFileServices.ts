// FileServices per il WEB (anteprima su PC, SPEC 8.8 livello 2): FileStore in memoria con copia in IndexedDB,
// fflate, Web Crypto (via expo-crypto), <input type=file> e download via Blob. AppDirs sono prefissi virtuali.
import type { FileServices } from '@/domain/ports';
import { createIndexedDbFileBackend } from './indexedDbFileBackend';
import { createHashService } from './hashService';
import { openPersistentFileStore, type FileBackend, type MemoryFileStore } from './memoryFileStore';
import { APP_DIRS } from './paths';
import { createWebFilePicker, type DocumentLike } from './webFilePicker';
import { createWebFileSharer } from './webFileSharer';
import { createZipCodec } from './zipCodec';

export interface WebFileServices extends FileServices {
  files: MemoryFileStore;
}

export interface WebFileServicesOptions {
  /** Dove si conservano i file (default: IndexedDB del browser; senza IndexedDB solo in memoria). */
  backend?: FileBackend;
  document?: DocumentLike;
}

export async function createWebFileServices(opts: WebFileServicesOptions = {}): Promise<WebFileServices> {
  const hash = createHashService();
  const backend = opts.backend ?? createIndexedDbFileBackend();
  const files = await openPersistentFileStore(backend, { sha256Hex: hash.sha256Hex });
  const dirs = { ...APP_DIRS };
  return {
    files,
    zip: createZipCodec(),
    hash,
    dirs,
    picker: createWebFilePicker({ files, tempDir: dirs.temp, ...(opts.document ? { document: opts.document } : {}) }),
    sharer: createWebFileSharer({ files }),
  };
}
