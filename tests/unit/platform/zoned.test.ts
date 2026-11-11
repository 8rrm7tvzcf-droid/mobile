import { describe, expect, it } from 'vitest';
import { isValidTimeZone, localDateTimeOf, localToInstant, tzOffsetMs, zonedParts } from '@/platform/clock/zoned';

const ROME = 'Europe/Rome';
const iso = (d: Date): string => d.toISOString();

describe('localToInstant', () => {
  it('Roma in inverno (CET, UTC+1)', () => {
    expect(iso(localToInstant('2026-11-30', '09:00', ROME))).toBe('2026-11-30T08:00:00.000Z');
  });

  it('Roma in estate (CEST, UTC+2)', () => {
    expect(iso(localToInstant('2026-07-15', '09:00', ROME))).toBe('2026-07-15T07:00:00.000Z');
  });

  it("notte del cambio ora legale 28/03/2027: le 09:00 sono gia' in ora legale", () => {
    expect(iso(localToInstant('2027-03-28', '09:00', ROME))).toBe('2027-03-28T07:00:00.000Z');
    expect(iso(localToInstant('2027-03-27', '09:00', ROME))).toBe('2027-03-27T08:00:00.000Z');
  });

  it('ora inesistente (02:30 del 28/03/2027): scatta alle 03:30 locali, come new Date()', () => {
    const d = localToInstant('2027-03-28', '02:30', ROME);
    expect(iso(d)).toBe('2027-03-28T01:30:00.000Z');
    expect(localDateTimeOf(d.getTime(), ROME)).toEqual({ date: '2027-03-28', time: '03:30' });
  });

  it("ora ripetuta (02:30 del 25/10/2026): vale la prima occorrenza (ancora ora legale)", () => {
    expect(iso(localToInstant('2026-10-25', '02:30', ROME))).toBe('2026-10-25T00:30:00.000Z');
    // le 09:00 dello stesso giorno sono gia' in ora solare
    expect(iso(localToInstant('2026-10-25', '09:00', ROME))).toBe('2026-10-25T08:00:00.000Z');
  });

  it('altri fusi: UTC, New York (ora legale USA) e Kiribati (UTC+14)', () => {
    expect(iso(localToInstant('2026-06-01', '12:00', 'UTC'))).toBe('2026-06-01T12:00:00.000Z');
    expect(iso(localToInstant('2026-06-01', '12:00', 'America/New_York'))).toBe('2026-06-01T16:00:00.000Z');
    expect(iso(localToInstant('2026-06-01', '12:00', 'Pacific/Kiritimati'))).toBe('2026-05-31T22:00:00.000Z');
  });

  it('andata e ritorno con localDateTimeOf per ogni ora di un giorno normale', () => {
    for (let h = 0; h < 24; h++) {
      const time = `${String(h).padStart(2, '0')}:15`;
      const d = localToInstant('2026-05-20', time, ROME);
      expect(localDateTimeOf(d.getTime(), ROME)).toEqual({ date: '2026-05-20', time });
    }
  });

  it('rifiuta ore e date non valide', () => {
    expect(() => localToInstant('2026-11-30', '24:00', ROME)).toThrow(RangeError);
    expect(() => localToInstant('2026-11-30', '9:00', ROME)).toThrow(RangeError);
    expect(() => localToInstant('2026-02-30', '09:00', ROME)).toThrow(RangeError);
  });
});

describe('zonedParts e tzOffsetMs', () => {
  it('la mezzanotte non diventa ora 24', () => {
    const ms = Date.UTC(2026, 0, 1, 23, 0, 0); // mezzanotte a Roma
    expect(zonedParts(ms, ROME)).toMatchObject({ year: 2026, month: 1, day: 2, hour: 0, minute: 0 });
  });

  it('scarto di Roma: +1h in inverno, +2h in estate', () => {
    expect(tzOffsetMs(Date.UTC(2026, 0, 15), ROME)).toBe(3_600_000);
    expect(tzOffsetMs(Date.UTC(2026, 6, 15), ROME)).toBe(7_200_000);
  });
});

describe('isValidTimeZone', () => {
  it('accetta gli identificatori IANA e rifiuta il resto', () => {
    expect(isValidTimeZone('Europe/Rome')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mondo/Inesistente')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});
