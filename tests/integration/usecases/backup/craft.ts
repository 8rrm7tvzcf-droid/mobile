// ZIP e documenti costruiti ad arte per i test di importazione (attacchi, file corrotti, versioni nuove).
/// <reference types="node" />
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import type { BackupDocument } from '@/usecases/backup';
import type { BackupEnv } from './harness';

const enc = new TextEncoder();
export const asBytes = (v: Uint8Array | string): Uint8Array => (typeof v === 'string' ? enc.encode(v) : v);

/** Un ZIP con le voci indicate, anche con nomi pericolosi ('../x', '/abs', 'a\\b'). */
export function zipOf(entries: Record<string, Uint8Array | string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, asBytes(v)])));
}

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/**
 * Un backup valido costruito a mano a partire da un documento (modificabile dal test) e dai file allegati.
 * `entries` aggiunge o sostituisce voci (es. per l'attacco zip-slip); `manifestFiles` sostituisce l'elenco del manifest.
 */
export function backupZipFrom(
  doc: unknown,
  files: Record<string, Uint8Array> = {},
  o: { entries?: Record<string, Uint8Array | string>; manifestFiles?: { path: string; sha256: string; size: number }[] } = {},
): Uint8Array {
  const manifest = {
    format: 'mygarage.backup',
    formatVersion: 1,
    exportedAt: '2026-10-08T07:30:00.000Z',
    files: o.manifestFiles ?? Object.entries(files).map(([path, b]) => ({ path, sha256: sha256(b), size: b.length })),
  };
  return zipOf({ 'data.json': JSON.stringify(doc), 'manifest.json': JSON.stringify(manifest), ...files, ...(o.entries ?? {}) });
}

/** Il contenuto di un backup esportato: documento e file allegati per percorso. */
export async function readBackup(env: BackupEnv, path: string): Promise<{ doc: BackupDocument; files: Record<string, Uint8Array> }> {
  const entries = env.deps.fs.zip.unzip(new Uint8Array(await env.files.read(path)));
  const byName = new Map(entries.map((e) => [e.name, e.bytes] as const));
  const doc = JSON.parse(new TextDecoder().decode(byName.get('data.json'))) as BackupDocument;
  const files: Record<string, Uint8Array> = {};
  for (const [name, bytes] of byName) if (name.startsWith('attachments/')) files[name] = bytes;
  return { doc, files };
}

/** Copia profonda di un documento, per modificarlo senza toccare l'originale. */
export const cloneDoc = (doc: BackupDocument): BackupDocument => JSON.parse(JSON.stringify(doc)) as BackupDocument;
