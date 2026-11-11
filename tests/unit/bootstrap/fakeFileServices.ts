// Servizi per file di PROVA per i test del bootstrap: FileStore in memoria vero, ZIP vero (fflate), SHA-256 di node,
// selettore e condivisione finti. Chi lo importa deve simulare 'expo-crypto' (lo importa hashService) con vi.mock.
import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import type { FileServices, PickedFile } from '@/domain/ports';
import { createMemoryFileStore, type MemoryFileStore } from '@/platform/files/memoryFileStore';
import { APP_DIRS } from '@/platform/files/paths';
import { createZipCodec } from '@/platform/files/zipCodec';

export type FakeFileServices = FileServices & {
  files: MemoryFileStore;
  picker: { pickDocument: ReturnType<typeof vi.fn>; pickImage: ReturnType<typeof vi.fn> };
  sharer: { shareFile: ReturnType<typeof vi.fn> };
};

export const sha256OfBytes = async (bytes: Uint8Array): Promise<string> => createHash('sha256').update(bytes).digest('hex');

export function fakeFileServices(picked: PickedFile | null = null): FakeFileServices {
  return {
    files: createMemoryFileStore({ sha256Hex: sha256OfBytes }),
    zip: createZipCodec({ mtime: 0 }),
    hash: { sha256Hex: sha256OfBytes },
    dirs: { ...APP_DIRS },
    picker: { pickDocument: vi.fn(async () => picked), pickImage: vi.fn(async () => picked) },
    sharer: { shareFile: vi.fn(async () => undefined) },
  };
}
