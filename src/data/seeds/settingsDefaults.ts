// Impostazioni predefinite (SPEC Appendice C): chiave -> valore JSON, NESSUN segreto.
// Si caricano a ogni avvio con INSERT OR IGNORE: un valore gia' presente (scelto dall'utente) non si tocca mai.

/** Tipi dei valori per chiave. `device.id` non ha un predefinito statico: lo genera il seed al primo avvio. */
export interface SettingsMap {
  'device.id': string;
  'units.distance': 'km' | 'mi';
  'notify.enabled': boolean;
  'notify.time': string; // 'HH:MM' locale
  'notify.privacy': 'generic' | 'full';
  'notify.maxScheduled': number;
  'forecast.windowDays': number;
  'forecast.halfLifeDays': number;
  'forecast.defaultAnnualKm': number;
  'telemetry.rawRetentionDays': number;
  'telemetry.maxMb': number;
  'trash.retentionDays': number;
  'lock.enabled': boolean;
  'lock.timeoutSeconds': number;
  'backup.lastExportAt': string | null;
  'backup.nudgeDays': number;
  'onboarding.done': boolean;
}

export type SettingKey = keyof SettingsMap;

/** Chiavi con un valore predefinito statico (tutte tranne `device.id`). */
export type DefaultedSettingKey = Exclude<SettingKey, 'device.id'>;

export const SETTING_DEFAULTS: { readonly [K in DefaultedSettingKey]: SettingsMap[K] } = {
  'units.distance': 'km',
  'notify.enabled': true,
  'notify.time': '09:00', // le 09:00 evitano la finestra dell'ora legale (02:00-03:00)
  'notify.privacy': 'generic', // 'generic' non mostra la targa sul blocco schermo
  'notify.maxScheduled': 60, // sotto il tetto iOS di 64
  'forecast.windowDays': 180,
  'forecast.halfLifeDays': 90,
  'forecast.defaultAnnualKm': 12000, // segnaposto a bassa confidenza, sempre etichettato "stima iniziale"
  'telemetry.rawRetentionDays': 30,
  'telemetry.maxMb': 50,
  'trash.retentionDays': 30,
  'lock.enabled': false,
  'lock.timeoutSeconds': 60,
  'backup.lastExportAt': null,
  'backup.nudgeDays': 30,
  'onboarding.done': false,
};

export const DEFAULTED_SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as DefaultedSettingKey[];
