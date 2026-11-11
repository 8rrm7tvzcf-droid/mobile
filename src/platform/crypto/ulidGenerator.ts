// Generatore di ULID (porta IdGenerator). Hermes non ha una sorgente casuale affidabile di default e il pacchetto
// 'ulid' rifiuta di partire senza (o ripiega su Math.random): gli passiamo noi i byte casuali del sistema operativo,
// presi da expo-crypto. La fabbrica e' monotona: due ID generati nello stesso millisecondo restano ordinati.
import { getRandomBytes } from 'expo-crypto';
import { monotonicFactory } from 'ulid';
import type { IdGenerator } from '@/domain/ports';

export interface UlidGeneratorOptions {
  /** Sorgente di byte casuali (default: expo-crypto getRandomBytes). */
  randomBytes?: (count: number) => Uint8Array;
  /** Istante in millisecondi usato per la parte temporale dell'ID (default: Date.now). */
  now?: () => number;
}

const REFILL_BYTES = 256; // expo-crypto accetta da 0 a 1024 byte per chiamata
const UINT32 = 4_294_967_296;

export function createUlidGenerator(opts: UlidGeneratorOptions = {}): IdGenerator {
  const randomBytes = opts.randomBytes ?? getRandomBytes;
  let buffer: Uint8Array = new Uint8Array(0);
  let pos = 0;
  // PRNG nel formato atteso da 'ulid': numeri in [0, 1). Ogni numero consuma 4 byte; una chiamata nativa ne rifornisce 64.
  const prng = (): number => {
    if (pos + 4 > buffer.length) {
      buffer = randomBytes(REFILL_BYTES);
      pos = 0;
    }
    const b = buffer;
    const value = (((b[pos] ?? 0) << 24) | ((b[pos + 1] ?? 0) << 16) | ((b[pos + 2] ?? 0) << 8) | (b[pos + 3] ?? 0)) >>> 0;
    pos += 4;
    return value / UINT32;
  };
  const factory = monotonicFactory(prng);
  const now = opts.now;
  return { ulid: () => (now ? factory(now()) : factory()) };
}
