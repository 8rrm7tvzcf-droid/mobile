// Implementazione della porta FileStore su node:fs (SOLO test) e cartelle temporanee.
/// <reference types="node" />
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { FileStore } from '@/domain/ports';

/** Crea una cartella temporanea univoca; `cleanup()` la rimuove (da chiamare in afterEach/afterAll). */
export function makeTempDir(prefix = 'mygarage-test-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** FileStore su file system reale. I percorsi relativi si risolvono sotto `root`, quelli assoluti restano tali. */
export function createNodeFileStore(root: string): FileStore & { resolvePath(p: string): string } {
  const abs = (p: string): string => (isAbsolute(p) ? p : resolve(root, p));
  return {
    resolvePath: abs,
    async write(path, bytes) {
      const full = abs(path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, bytes);
    },
    async read(path) {
      return new Uint8Array(readFileSync(abs(path)));
    },
    async remove(path) {
      rmSync(abs(path), { force: true });
    },
    async exists(path) {
      try {
        statSync(abs(path));
        return true;
      } catch {
        return false;
      }
    },
    async list(dir) {
      try {
        return readdirSync(abs(dir));
      } catch {
        return [];
      }
    },
    async sha256(path) {
      return createHash('sha256').update(readFileSync(abs(path))).digest('hex');
    },
  };
}
