// Porta FileStore su expo-file-system 57 (API a oggetti File/Directory). Solo telefono: sul web non c'e' un file system.
// Percorsi: gli URI `file://...` e i percorsi assoluti si usano cosi' come sono; quelli relativi si risolvono
// sotto `root` (default: la cartella documenti dell'app) e non possono uscirne ('..' e' un errore).
// `list` restituisce i NOMI delle voci, come il FileStore di test.
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import type { FileStore } from '@/domain/ports';
import { toHex } from './hashService';

/** Percorso nativo `/data/...` -> URI `file:///data/...`; gli URI e i percorsi relativi restano invariati. */
export function toFileUri(path: string): string {
  return path.startsWith('/') ? `file://${path}` : path;
}

export interface ExpoFileStore extends FileStore {
  /** Crea la cartella (e le intermedie) se manca; non fa nulla se esiste. */
  ensureDir(dir: string): Promise<void>;
  /** URI `file://` assoluto di un percorso del negozio (per expo-sharing e per chi vuole un URI vero). */
  resolveUri(path: string): string;
}

const isAbsolute = (p: string): boolean => p.startsWith('file://') || p.startsWith('/');

function assertInsideRoot(p: string): void {
  if (p.split('/').includes('..')) throw new Error(`Percorso non valido: ${p}`);
}

export function createExpoFileStore(root: Directory = Paths.document): ExpoFileStore {
  const file = (p: string): File => {
    if (isAbsolute(p)) return new File(toFileUri(p));
    assertInsideRoot(p);
    return new File(root, p);
  };
  const dir = (p: string): Directory => {
    if (isAbsolute(p)) return new Directory(toFileUri(p));
    assertInsideRoot(p);
    return new Directory(root, p);
  };

  return {
    async ensureDir(path) {
      dir(path).create({ intermediates: true, idempotent: true });
    },
    resolveUri(path) {
      return file(path).uri;
    },
    async write(path, bytes) {
      const f = file(path);
      f.parentDirectory.create({ intermediates: true, idempotent: true });
      f.create({ overwrite: true, intermediates: true });
      f.write(bytes);
    },
    async read(path) {
      return new Uint8Array(await file(path).bytes());
    },
    async remove(path) {
      const f = file(path);
      if (f.exists) {
        f.delete();
        return;
      }
      const d = dir(path);
      if (d.exists) d.delete();
    },
    async exists(path) {
      return file(path).exists || dir(path).exists;
    },
    async list(path) {
      const d = dir(path);
      return d.exists ? d.list().map((entry) => entry.name) : [];
    },
    async sha256(path) {
      const bytes = await file(path).bytes();
      return toHex(await digest(CryptoDigestAlgorithm.SHA256, bytes));
    },
  };
}
