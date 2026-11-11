// Orologio del dispositivo: implementa la porta Clock (SPEC 8.6). Sul telefono legge il fuso da expo-localization,
// sul web (anteprima) da Intl: expo-localization funziona anche li' e puo' dare `null`, nel qual caso si ripiega su Intl.
// Le date di calendario sono quelle del fuso riportato da timeZone(), cosi' orologio e scheduler concordano sempre.
import { getCalendars } from 'expo-localization';
import type { Clock } from '@/domain/ports';
import { isValidTimeZone, localDateTimeOf } from './zoned';

/** Ultimo ripiego se il dispositivo non dichiara un fuso valido: l'app e' italiana. */
export const FALLBACK_TIME_ZONE = 'Europe/Rome';

export interface DeviceClockOptions {
  /** Istante corrente (default: Date.now). Serve ai test. */
  now?: () => number;
  /** Fuso dichiarato dal sistema (default: expo-localization, poi Intl). Serve ai test. */
  readTimeZone?: () => string | null | undefined;
}

function readExpoTimeZone(): string | null | undefined {
  return getCalendars()[0]?.timeZone;
}

function readIntlTimeZone(): string | undefined {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** Fuso IANA valido del dispositivo: expo-localization -> Intl -> Europe/Rome. Non lancia mai. */
export function resolveDeviceTimeZone(read: () => string | null | undefined = readExpoTimeZone): string {
  try {
    const tz = read();
    if (tz && isValidTimeZone(tz)) return tz;
  } catch {
    // modulo non disponibile o errore nativo: si prova Intl
  }
  const intl = readIntlTimeZone();
  return intl && isValidTimeZone(intl) ? intl : FALLBACK_TIME_ZONE;
}

export function createDeviceClock(opts: DeviceClockOptions = {}): Clock {
  const now = opts.now ?? Date.now;
  const timeZone = (): string => resolveDeviceTimeZone(opts.readTimeZone ?? readExpoTimeZone);
  return {
    nowIso: () => new Date(now()).toISOString(),
    todayLocal: () => localDateTimeOf(now(), timeZone()).date,
    nowLocal: () => localDateTimeOf(now(), timeZone()),
    timeZone,
  };
}
