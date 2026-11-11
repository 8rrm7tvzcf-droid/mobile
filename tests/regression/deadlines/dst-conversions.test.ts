// Conversione ora locale <-> UTC attorno al cambio dell'ora legale (DL-6): lo scarto e' quello dell'istante convertito,
// non quello di adesso. Orologio coerente con Europe/Rome (CET +60, CEST +120).
import { describe, expect, it } from 'vitest';
import { centralEuropeOffsetMinutes } from '@/domain/dates';
import type { Clock } from '@/domain/ports';
import { isoToLocal, localToIso, utcOffsetAt } from '@/usecases/queries/localTime';

const minutes = (iso: string): number => Math.floor(Date.parse(iso) / 60000);

function romeClockAt(utcIso: string): Clock {
  const local = new Date(Date.parse(utcIso) + centralEuropeOffsetMinutes(minutes(utcIso)) * 60000).toISOString();
  return {
    nowIso: () => utcIso,
    todayLocal: () => local.slice(0, 10),
    nowLocal: () => ({ date: local.slice(0, 10), time: local.slice(11, 16) }),
    timeZone: () => 'Europe/Rome',
  };
}

describe("regola dell'ora legale europea", () => {
  it("cambia alle 01:00 UTC dell'ultima domenica di marzo e di ottobre", () => {
    expect(centralEuropeOffsetMinutes(minutes('2026-03-29T00:59:00Z'))).toBe(60);
    expect(centralEuropeOffsetMinutes(minutes('2026-03-29T01:00:00Z'))).toBe(120);
    expect(centralEuropeOffsetMinutes(minutes('2026-10-25T00:59:00Z'))).toBe(120);
    expect(centralEuropeOffsetMinutes(minutes('2026-10-25T01:00:00Z'))).toBe(60);
    expect(centralEuropeOffsetMinutes(minutes('2027-03-28T01:00:00Z'))).toBe(120);
    expect(centralEuropeOffsetMinutes(minutes('2026-12-31T12:00:00Z'))).toBe(60);
  });
});

describe('localToIso / isoToLocal con lo scarto del giorno di destinazione', () => {
  it("cambio d'autunno: 09:00 del 25/10/2026 e' 08:00Z anche se adesso e' ancora ora legale", () => {
    const clock = romeClockAt('2026-10-24T18:00:00.000Z'); // CEST
    expect(localToIso({ date: '2026-10-25', time: '09:00' }, clock)).toBe('2026-10-25T08:00:00.000Z');
    expect(isoToLocal('2026-10-25T08:00:00.000Z', clock)).toEqual({ date: '2026-10-25', time: '09:00' });
  });

  it("cambio di primavera: 09:00 del 28/03/2027 e' 07:00Z anche se adesso e' ancora ora solare", () => {
    const clock = romeClockAt('2027-03-27T19:00:00.000Z'); // CET
    expect(localToIso({ date: '2027-03-28', time: '09:00' }, clock)).toBe('2027-03-28T07:00:00.000Z');
    expect(isoToLocal('2027-03-28T07:00:00.000Z', clock)).toEqual({ date: '2027-03-28', time: '09:00' });
  });

  it('ora ripetuta: la prima; ora inesistente: lo scarto di prima del salto', () => {
    expect(localToIso({ date: '2026-10-25', time: '02:30' }, romeClockAt('2026-10-24T18:00:00.000Z'))).toBe('2026-10-25T00:30:00.000Z');
    expect(localToIso({ date: '2027-03-28', time: '02:30' }, romeClockAt('2027-03-27T19:00:00.000Z'))).toBe('2027-03-28T01:30:00.000Z');
  });

  it("un orologio che dichiara Roma ma non e' coerente (UTC trattato come locale) e un fuso non europeo restano sullo scarto di adesso", () => {
    const utcAsLocal: Clock = {
      nowIso: () => '2026-10-08T07:30:00.000Z',
      todayLocal: () => '2026-10-08',
      nowLocal: () => ({ date: '2026-10-08', time: '07:30' }),
      timeZone: () => 'Europe/Rome',
    };
    expect(utcOffsetAt(utcAsLocal, Date.parse('2027-07-01T00:00:00Z'))).toBe(0);
    const tokyo: Clock = { ...utcAsLocal, nowLocal: () => ({ date: '2026-10-08', time: '16:30' }), timeZone: () => 'Asia/Tokyo' };
    expect(utcOffsetAt(tokyo, Date.parse('2027-07-01T00:00:00Z'))).toBe(540);
  });
});
