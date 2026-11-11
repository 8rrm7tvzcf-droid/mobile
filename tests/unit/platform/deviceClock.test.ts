import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getCalendars: vi.fn() }));
vi.mock('expo-localization', () => ({ getCalendars: mocks.getCalendars }));

import { createDeviceClock, FALLBACK_TIME_ZONE, resolveDeviceTimeZone } from '@/platform/clock/deviceClock';

const calendar = (timeZone: string | null): unknown[] => [{ calendar: 'gregory', timeZone, uses24hourClock: true, firstWeekday: 2 }];

describe('resolveDeviceTimeZone', () => {
  beforeEach(() => {
    mocks.getCalendars.mockReset();
  });

  it('usa il fuso di expo-localization', () => {
    mocks.getCalendars.mockReturnValue(calendar('Europe/Rome'));
    expect(resolveDeviceTimeZone()).toBe('Europe/Rome');
  });

  it('se expo-localization da null o un fuso sconosciuto ripiega su Intl', () => {
    const intl = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    mocks.getCalendars.mockReturnValue(calendar(null));
    expect(resolveDeviceTimeZone()).toBe(intl);
    mocks.getCalendars.mockReturnValue(calendar('Mondo/Inesistente'));
    expect(resolveDeviceTimeZone()).toBe(intl);
  });

  it('se il modulo lancia non lancia nemmeno lui', () => {
    mocks.getCalendars.mockImplementation(() => {
      throw new Error('modulo nativo assente');
    });
    expect(typeof resolveDeviceTimeZone()).toBe('string');
    expect(resolveDeviceTimeZone(() => 'Mondo/Inesistente')).not.toBe('Mondo/Inesistente');
  });

  it("il ripiego finale e' Europe/Rome", () => {
    expect(FALLBACK_TIME_ZONE).toBe('Europe/Rome');
  });
});

describe('createDeviceClock', () => {
  beforeEach(() => {
    mocks.getCalendars.mockReset();
  });

  it("nowIso e' un istante UTC con millisecondi", () => {
    const c = createDeviceClock({ now: () => Date.UTC(2026, 9, 8, 7, 30, 15, 123), readTimeZone: () => 'Europe/Rome' });
    expect(c.nowIso()).toBe('2026-10-08T07:30:15.123Z');
  });

  it('date e ora locali seguono il fuso (Roma, ora legale)', () => {
    const c = createDeviceClock({ now: () => Date.UTC(2026, 9, 8, 22, 30), readTimeZone: () => 'Europe/Rome' });
    expect(c.timeZone()).toBe('Europe/Rome');
    expect(c.todayLocal()).toBe('2026-10-09'); // 00:30 del giorno dopo
    expect(c.nowLocal()).toEqual({ date: '2026-10-09', time: '00:30' });
  });

  it('segue il cambio di fuso del dispositivo senza ricrearsi', () => {
    let tz = 'Europe/Rome';
    const c = createDeviceClock({ now: () => Date.UTC(2026, 0, 15, 23, 30), readTimeZone: () => tz });
    expect(c.nowLocal()).toEqual({ date: '2026-01-16', time: '00:30' });
    tz = 'America/New_York';
    expect(c.timeZone()).toBe('America/New_York');
    expect(c.nowLocal()).toEqual({ date: '2026-01-15', time: '18:30' });
  });

  it('di default legge expo-localization', () => {
    mocks.getCalendars.mockReturnValue(calendar('Asia/Tokyo'));
    const c = createDeviceClock({ now: () => Date.UTC(2026, 0, 1, 20, 0) });
    expect(c.timeZone()).toBe('Asia/Tokyo');
    expect(c.todayLocal()).toBe('2026-01-02');
  });
});
