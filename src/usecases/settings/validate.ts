// Validazione dei valori delle impostazioni: messaggi in italiano, pronti per la UI.
import { LOCK_TIMEOUTS_SECONDS, type DefaultedSettingKey } from './defaults';

const isInt = (v: unknown, min: number, max: number): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isBool = (v: unknown): boolean => typeof v === 'boolean';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface Check {
  ok: (v: unknown) => boolean;
  message: string;
}

const CHECKS: { readonly [K in DefaultedSettingKey]: Check } = {
  'units.distance': { ok: (v) => v === 'km' || v === 'mi', message: "L'unità di misura deve essere km o mi." },
  'notify.enabled': { ok: isBool, message: 'Il valore deve essere sì o no.' },
  'notify.time': {
    ok: (v) => typeof v === 'string' && TIME_RE.test(v),
    message: "L'orario degli avvisi deve essere nel formato HH:MM, per esempio 09:00.",
  },
  'notify.privacy': {
    ok: (v) => v === 'generic' || v === 'full',
    message: 'La riservatezza degli avvisi deve essere «generica» o «completa».',
  },
  'notify.maxScheduled': { ok: (v) => isInt(v, 1, 64), message: 'Il numero massimo di avvisi pianificati va da 1 a 64.' },
  'forecast.windowDays': { ok: (v) => isInt(v, 30, 730), message: 'La finestra di calcolo va da 30 a 730 giorni.' },
  'forecast.halfLifeDays': { ok: (v) => isInt(v, 7, 365), message: "L'emivita del calcolo va da 7 a 365 giorni." },
  'forecast.defaultAnnualKm': {
    ok: (v) => isInt(v, 1000, 100000),
    message: 'I km annui di partenza vanno da 1.000 a 100.000.',
  },
  'telemetry.rawRetentionDays': { ok: (v) => isInt(v, 1, 365), message: 'La conservazione dei dati OBD va da 1 a 365 giorni.' },
  'telemetry.maxMb': { ok: (v) => isInt(v, 1, 2048), message: 'Lo spazio per i dati OBD va da 1 a 2.048 MB.' },
  'trash.retentionDays': { ok: (v) => isInt(v, 1, 365), message: 'La permanenza nel cestino va da 1 a 365 giorni.' },
  'lock.enabled': { ok: isBool, message: 'Il valore deve essere sì o no.' },
  'lock.timeoutSeconds': {
    ok: (v) => typeof v === 'number' && (LOCK_TIMEOUTS_SECONDS as readonly number[]).includes(v),
    message: 'Il blocco automatico può scattare subito o dopo 30 secondi, 1, 5 o 15 minuti.',
  },
  'backup.lastExportAt': {
    ok: (v) => v === null || (typeof v === 'string' && ISO_INSTANT_RE.test(v)),
    message: "La data dell'ultimo backup non è valida.",
  },
  'backup.nudgeDays': { ok: (v) => isInt(v, 1, 365), message: 'Il promemoria di backup va da 1 a 365 giorni.' },
  'onboarding.done': { ok: isBool, message: 'Il valore deve essere sì o no.' },
};

/** Messaggio di errore in italiano se `value` non e' ammesso per `key`, altrimenti null. */
export function settingError(key: DefaultedSettingKey, value: unknown): string | null {
  const c = CHECKS[key];
  return c.ok(value) ? null : c.message;
}

/** `true` se `value` e' un valore ammesso per `key` (serve a scartare valori corrotti letti dal database). */
export const isValidSetting = (key: DefaultedSettingKey, value: unknown): boolean => CHECKS[key].ok(value);
