import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createZipCodec } from '@/platform/files/zipCodec';

const codec = createZipCodec({ mtime: Date.UTC(2026, 9, 13) });
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('ZipCodec (fflate)', () => {
  it('round trip: nomi, byte e ordine delle voci si conservano', () => {
    const binary = Uint8Array.from({ length: 4096 }, (_, i) => (i * 31 + 7) % 256);
    const zipped = codec.zip([
      { name: 'manifest.json', bytes: strToU8('{"format":"mygarage.backup","version":1}') },
      { name: 'data.json', bytes: strToU8('{"vehicles":[{"name":"Clio"}]}') },
      { name: 'attachments/01ABC.pdf', bytes: binary },
      { name: 'csv/spese.csv', bytes: strToU8('data;importo\n2026-10-01;45,50\n') },
    ]);
    expect(zipped[0]).toBe(0x50); // 'PK'
    expect(zipped[1]).toBe(0x4b);
    const entries = codec.unzip(zipped);
    expect(entries.map((e) => e.name).sort()).toEqual(['attachments/01ABC.pdf', 'csv/spese.csv', 'data.json', 'manifest.json']);
    const byName = new Map(entries.map((e) => [e.name, e.bytes]));
    expect(text(byName.get('data.json') as Uint8Array)).toBe('{"vehicles":[{"name":"Clio"}]}');
    expect(text(byName.get('csv/spese.csv') as Uint8Array)).toBe('data;importo\n2026-10-01;45,50\n');
    expect(Array.from(byName.get('attachments/01ABC.pdf') as Uint8Array)).toEqual(Array.from(binary));
  });

  it('supporta voci vuote e caratteri non ASCII nei nomi e nei contenuti', () => {
    const entries = codec.unzip(
      codec.zip([
        { name: 'vuoto.txt', bytes: new Uint8Array(0) },
        { name: 'note/officina-città.txt', bytes: strToU8('Revisione € 79,02 — ok') },
      ]),
    );
    const byName = new Map(entries.map((e) => [e.name, e.bytes]));
    expect(byName.get('vuoto.txt')?.byteLength).toBe(0);
    expect(text(byName.get('note/officina-città.txt') as Uint8Array)).toBe('Revisione € 79,02 — ok');
  });

  it('comprime il testo ripetitivo ma non ricomprime le immagini (memorizzate cosi\' come sono)', () => {
    const repetitive = strToU8('riga di testo identica\n'.repeat(500));
    const smallText = codec.zip([{ name: 'data.json', bytes: repetitive }]);
    expect(smallText.byteLength).toBeLessThan(repetitive.byteLength / 5);

    const jpeg = Uint8Array.from({ length: 2000 }, () => 0x41); // comprimibile se si volesse, ma .jpg va memorizzato
    const stored = codec.zip([{ name: 'attachments/A.jpg', bytes: jpeg }]);
    expect(stored.byteLength).toBeGreaterThan(jpeg.byteLength); // memorizzato: dati + intestazioni
    expect(Array.from(codec.unzip(stored)[0]?.bytes ?? [])).toEqual(Array.from(jpeg));
  });

  it('con la stessa data fissata l\'output e\' identico (ripetibile)', () => {
    const entries = [{ name: 'a.txt', bytes: strToU8('uno') }, { name: 'b.txt', bytes: strToU8('due') }];
    expect(Array.from(codec.zip(entries))).toEqual(Array.from(createZipCodec({ mtime: Date.UTC(2026, 9, 13) }).zip(entries)));
  });

  it('zip rifiuta nomi vuoti e duplicati', () => {
    expect(() => codec.zip([{ name: '', bytes: new Uint8Array(1) }])).toThrow(/senza nome/);
    expect(() =>
      codec.zip([
        { name: 'a.txt', bytes: new Uint8Array(1) },
        { name: 'a.txt', bytes: new Uint8Array(2) },
      ]),
    ).toThrow(/duplicata/);
  });

  it('unzip lancia su byte che non sono uno ZIP', () => {
    expect(() => codec.unzip(new Uint8Array(0))).toThrow(/non valido o danneggiato/);
    expect(() => codec.unzip(strToU8('questo non e uno zip, e un testo qualunque'))).toThrow(/non valido o danneggiato/);
    expect(() => codec.unzip(Uint8Array.from({ length: 300 }, (_, i) => (i * 7) % 256))).toThrow(Error);
  });

  it('unzip lancia su un archivio troncato', () => {
    const zipped = codec.zip([{ name: 'data.json', bytes: strToU8('x'.repeat(5000)) }]);
    expect(() => codec.unzip(zipped.slice(0, Math.floor(zipped.length / 2)))).toThrow(/non valido o danneggiato/);
  });

  it('unzip lancia su un archivio con i dati compressi corrotti', () => {
    const zipped = codec.zip([{ name: 'data.json', bytes: strToU8('abcdefgh'.repeat(2000)) }]);
    const broken = zipped.slice();
    for (let i = 40; i < 80; i++) broken[i] = 0xff; // dentro il flusso deflate della prima voce
    expect(() => codec.unzip(broken)).toThrow(Error);
  });

  it('unzip salta le voci di cartella e non toglie nulla ai nomi', () => {
    const withDir = zipSync({ 'attachments/': new Uint8Array(0), 'attachments/A.pdf': strToU8('pdf') });
    expect(codec.unzip(withDir).map((e) => e.name)).toEqual(['attachments/A.pdf']);
  });

  it('unzip NON valida i nomi: ".." e percorsi assoluti passano al chiamante, che deve rifiutarli (zip-slip)', () => {
    const hostile = zipSync({ '../../evil.txt': strToU8('x'), '/abs.txt': strToU8('y'), 'ok.txt': strToU8('z') });
    expect(
      codec
        .unzip(hostile)
        .map((e) => e.name)
        .sort(),
    ).toEqual(['../../evil.txt', '/abs.txt', 'ok.txt']);
  });

  it('un archivio vuoto (nessuna voce) e\' un errore', () => {
    expect(() => codec.unzip(zipSync({}))).toThrow();
  });
});

describe('ZipCodec: tetto alle dimensioni dichiarate (zip bomb, DATA-5)', () => {
  const bomb = zipSync({ 'a.bin': new Uint8Array(8 * 1024 * 1024) }); // 8 MB di zeri in pochi KB

  it('rifiuta con code ZIP_TOO_BIG prima di decomprimere', () => {
    expect(bomb.byteLength).toBeLessThan(64 * 1024);
    expect(() => codec.unzip(bomb, { maxTotalBytes: 1024 * 1024 })).toThrow(expect.objectContaining({ code: 'ZIP_TOO_BIG' }));
  });

  it('somma le dimensioni di tutte le voci', () => {
    const many = zipSync({ 'a.bin': new Uint8Array(600), 'b.bin': new Uint8Array(600) });
    expect(() => codec.unzip(many, { maxTotalBytes: 1000 })).toThrow(expect.objectContaining({ code: 'ZIP_TOO_BIG' }));
    expect(codec.unzip(many, { maxTotalBytes: 1200 })).toHaveLength(2); // il tetto e' inclusivo
  });

  it('senza tetto o sotto il tetto decomprime come prima; un archivio corrotto resta un errore generico', () => {
    expect(codec.unzip(bomb)[0]?.bytes.length).toBe(8 * 1024 * 1024);
    expect(codec.unzip(bomb, { maxTotalBytes: 8 * 1024 * 1024 })[0]?.bytes.length).toBe(8 * 1024 * 1024);
    const err = (() => {
      try {
        codec.unzip(new Uint8Array([1, 2, 3]), { maxTotalBytes: 10 });
      } catch (e) {
        return e as { code?: string; message: string };
      }
      return null;
    })();
    expect(err?.code).toBeUndefined();
    expect(err?.message).toMatch(/non valido|danneggiato/);
  });
});
