import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getRandomBytes: vi.fn() }));
vi.mock('expo-crypto', () => ({ getRandomBytes: mocks.getRandomBytes }));

import { createUlidGenerator } from '@/platform/crypto/ulidGenerator';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Byte pseudo-casuali ma deterministici (LCG): per provare il generatore non serve il caso vero. */
function lcgBytes(seed = 12345): (n: number) => Uint8Array {
  let s = seed;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      out[i] = s >>> 24;
    }
    return out;
  };
}

describe('createUlidGenerator', () => {
  it('produce ULID validi di 26 caratteri (alfabeto Crockford)', () => {
    const gen = createUlidGenerator({ randomBytes: lcgBytes() });
    for (let i = 0; i < 50; i++) expect(gen.ulid()).toMatch(ULID_RE);
  });

  it('gli ID sono tutti diversi e crescenti anche nello stesso millisecondo', () => {
    const gen = createUlidGenerator({ randomBytes: lcgBytes(), now: () => 1_786_000_000_000 });
    const ids = Array.from({ length: 500 }, () => gen.ulid());
    expect(new Set(ids).size).toBe(500);
    expect([...ids].sort()).toEqual(ids);
  });

  it("la parte temporale e' quella dell'orologio iniettato", () => {
    const gen = createUlidGenerator({ randomBytes: lcgBytes(), now: () => 1 });
    expect(gen.ulid().slice(0, 10)).toBe('0000000001');
    const later = createUlidGenerator({ randomBytes: lcgBytes(), now: () => 1_786_000_000_000 });
    expect(later.ulid().slice(0, 10)).not.toBe('0000000000');
  });

  it('chiede i byte al sistema a blocchi, non uno per carattere', () => {
    const rb = vi.fn(lcgBytes());
    const gen = createUlidGenerator({ randomBytes: rb });
    for (let i = 0; i < 4; i++) gen.ulid(); // 4 ID = al massimo 64 numeri casuali = 256 byte
    expect(rb.mock.calls.length).toBeLessThanOrEqual(2);
    expect(rb.mock.calls[0]?.[0]).toBeLessThanOrEqual(1024); // limite di expo-crypto
  });

  it('di default usa getRandomBytes di expo-crypto (non Math.random)', () => {
    const spy = vi.spyOn(Math, 'random');
    mocks.getRandomBytes.mockImplementation(lcgBytes(99));
    const id = createUlidGenerator().ulid();
    expect(id).toMatch(ULID_RE);
    expect(mocks.getRandomBytes).toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
