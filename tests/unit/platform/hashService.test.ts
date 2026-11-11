import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ digest: vi.fn() }));
vi.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: mocks.digest }));

import { createHashService, toHex } from '@/platform/files/hashService';

const nodeSha256 = async (bytes: Uint8Array): Promise<ArrayBuffer> => {
  const b = createHash('sha256').update(bytes).digest();
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe('HashService (expo-crypto)', () => {
  it('toHex: esadecimale minuscolo con zeri iniziali', () => {
    expect(toHex(Uint8Array.of(0, 1, 15, 16, 255).buffer)).toBe('00010f10ff');
  });

  it('SHA-256 di vettori noti, passando da expo-crypto con l\'algoritmo SHA-256', async () => {
    mocks.digest.mockImplementation(async (_algo: string, data: Uint8Array) => nodeSha256(data));
    const hash = createHashService();
    expect(await hash.sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await hash.sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(mocks.digest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
  });

  it('il risultato ha sempre 64 caratteri esadecimali minuscoli', async () => {
    mocks.digest.mockImplementation(async (_a: string, d: Uint8Array) => nodeSha256(d));
    const h = await createHashService().sha256Hex(Uint8Array.from({ length: 10_000 }, (_, i) => i % 251));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("se il calcolo principale lancia si ripiega sul secondo (crypto.subtle) e il risultato e' lo stesso", async () => {
    const primary = vi.fn(async () => {
      throw new Error('modulo nativo assente');
    });
    const fallback = vi.fn(nodeSha256);
    const hash = createHashService({ primary, fallback });
    expect(await hash.sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("senza ripiego l'errore originale arriva al chiamante", async () => {
    const hash = createHashService({
      primary: async () => {
        throw new Error('digest non disponibile');
      },
      fallback: null,
    });
    await expect(hash.sha256Hex(new Uint8Array(1))).rejects.toThrow('digest non disponibile');
  });
});
