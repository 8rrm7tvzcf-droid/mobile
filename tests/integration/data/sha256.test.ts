/// <reference types="node" />
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@/data/db/sha256';

const ref = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

describe('sha256Hex (hash sincrono per i checksum delle migrazioni)', () => {
  it('vettori noti', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('coincide con node:crypto su lunghezze di confine del blocco, UTF-8 e testi lunghi', () => {
    const samples = [
      ...[0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000].map((n) => 'x'.repeat(n)),
      "perche' l'auto e' pronta: caffe, euro \u20ac, emoji \u{1F697}, accenti \u00e8\u00f9\u00ec",
      'CREATE TABLE t (id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26)) STRICT;\n'.repeat(200),
    ];
    for (const s of samples) expect(sha256Hex(s)).toBe(ref(s));
  });

  it('produce 64 caratteri esadecimali minuscoli', () => {
    expect(sha256Hex('qualsiasi')).toMatch(/^[0-9a-f]{64}$/);
  });
});
