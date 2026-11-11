// DATA-5: il tetto di dimensione dello ZIP (SPEC 8.5: «tetto di 2 GB» come protezione) si controllava DOPO aver decompresso
// tutto in memoria: uno ZIP di pochi KB che si espande a centinaia di MB (deflate fino a ~1000:1) esauriva la memoria del
// telefono prima che il controllo scattasse. Ora openArchive passa il tetto al codec (UnzipOptions.maxTotalBytes), che
// legge le dimensioni dichiarate nell'indice e rifiuta PRIMA di decomprimere.
// Atteso: con un tetto di 1 MB il codec non produce mai piu' di 1 MB di dati decompressi.
// Nota rispetto alla prova originale: il codec simulato ora e' quello di produzione (createZipCodec, fflate) con un contatore;
// l'asserzione (byte decompressi <= tetto) e' la stessa.
/// <reference types="node" />
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { ZipCodec } from '@/domain/ports';
import { createZipCodec } from '@/platform/files/zipCodec';
import { openArchive } from '@/usecases/backup/archive';
import { nodeHash } from '../../integration/usecases/backup/harness';

describe('openArchive: tetto di dimensione', () => {
  const cap = 1024 * 1024;
  const bombOf = (bytes: number): Uint8Array => zipSync({ 'attachments/01TESTID000000000000000001.jpg': new Uint8Array(bytes) });
  const counting = (): { zip: ZipCodec; inflated: () => number } => {
    const real = createZipCodec();
    let inflated = 0;
    return {
      inflated: () => inflated,
      zip: {
        zip: (e) => real.zip(e),
        unzip: (bytes, opts) => {
          const out = real.unzip(bytes, opts);
          inflated += out.reduce((n, e) => n + e.bytes.length, 0);
          return out;
        },
      },
    };
  };

  it('non decomprime oltre il tetto prima di rifiutare il file', async () => {
    const bomb = bombOf(64 * 1024 * 1024); // 64 MB di zeri
    expect(bomb.length).toBeLessThan(200 * 1024); // il file compresso e' piccolo
    const c = counting();
    await expect(openArchive({ fs: { zip: c.zip, hash: nodeHash } } as never, bomb, cap)).rejects.toMatchObject({ code: 'TOO_BIG' });
    expect(c.inflated()).toBeLessThanOrEqual(cap);
  });

  it('rifiuta con TOO_BIG anche se la bomba e\' spezzata in tante voci piccole (somma delle dimensioni dichiarate)', async () => {
    const parts: Record<string, Uint8Array> = {};
    for (let i = 0; i < 8; i++) parts[`attachments/01TESTID00000000000000000${i}.jpg`] = new Uint8Array(400 * 1024);
    const c = counting();
    await expect(openArchive({ fs: { zip: c.zip, hash: nodeHash } } as never, zipSync(parts), cap)).rejects.toMatchObject({ code: 'TOO_BIG' });
    expect(c.inflated()).toBe(0);
  });

  it('un codec che ignora il tetto viene comunque fermato dal controllo sulle dimensioni reali', async () => {
    const real = createZipCodec();
    const blind: ZipCodec = { zip: (e) => real.zip(e), unzip: (b) => real.unzip(b) }; // senza opts
    await expect(openArchive({ fs: { zip: blind, hash: nodeHash } } as never, bombOf(2 * 1024 * 1024), cap)).rejects.toMatchObject({ code: 'TOO_BIG' });
  });
});
