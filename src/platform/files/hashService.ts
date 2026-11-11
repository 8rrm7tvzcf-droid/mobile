// Porta HashService: SHA-256 sui byte, in esadecimale minuscolo (64 caratteri). Sul telefono e sul web passa da
// expo-crypto (sul web usa Web Crypto); se expo-crypto non riesce e crypto.subtle esiste, si ripiega su quello.
import { CryptoDigestAlgorithm, digest as expoDigest } from 'expo-crypto';
import type { HashService } from '@/domain/ports';

export type DigestFn = (bytes: Uint8Array) => Promise<ArrayBuffer>;

export const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

const expoSha256: DigestFn = (bytes) => expoDigest(CryptoDigestAlgorithm.SHA256, bytes as BufferSource);

const subtleSha256: DigestFn | null = (() => {
  const subtle = (globalThis as { crypto?: { subtle?: { digest(a: string, d: BufferSource): Promise<ArrayBuffer> } } }).crypto?.subtle;
  return subtle ? (bytes) => subtle.digest('SHA-256', bytes as BufferSource) : null;
})();

export interface HashServiceOptions {
  /** Calcolo principale (default: expo-crypto). Serve ai test. */
  primary?: DigestFn;
  /** Ripiego se il principale lancia (default: crypto.subtle, se presente). */
  fallback?: DigestFn | null;
}

export function createHashService(opts: HashServiceOptions = {}): HashService {
  const primary = opts.primary ?? expoSha256;
  const fallback = opts.fallback === undefined ? subtleSha256 : opts.fallback;
  return {
    async sha256Hex(bytes) {
      try {
        return toHex(await primary(bytes));
      } catch (e) {
        if (!fallback) throw e;
        return toHex(await fallback(bytes));
      }
    },
  };
}
