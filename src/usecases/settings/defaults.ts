// Impostazioni dell'app (SPEC Appendice C): chiavi, tipi e valori predefiniti.
// I casi d'uso non possono importare `data/`: la tabella dei predefiniti e' quindi ripetuta qui,
// e un test (tests/integration/usecases/settings) la confronta con quella del seed per tenerle allineate.

/** Tipo del valore di ogni chiave di `app_settings` (valori JSON, nessun segreto). */
export interface SettingsMap {
  'device.id': string;
  'units.distance': 'km' | 'mi';
  'notify.enabled': boolean;
  /** 'HH:MM' locale. */
  'notify.time': string;
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
  /** Istante UTC dell'ultima esportazione, o null se mai eseguita. */
  'backup.lastExportAt': string | null;
  'backup.nudgeDays': number;
  'onboarding.done': boolean;
}

export type SettingKey = keyof SettingsMap;

/** Chiavi con un valore predefinito statico (tutte tranne `device.id`, generato al primo avvio). */
export type DefaultedSettingKey = Exclude<SettingKey, 'device.id'>;

export const SETTING_DEFAULTS: { readonly [K in DefaultedSettingKey]: SettingsMap[K] } = {
  'units.distance': 'km',
  'notify.enabled': true,
  'notify.time': '09:00',
  'notify.privacy': 'generic',
  'notify.maxScheduled': 60,
  'forecast.windowDays': 180,
  'forecast.halfLifeDays': 90,
  'forecast.defaultAnnualKm': 12000,
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

/** Tutte le impostazioni con i valori correnti (predefiniti dove l'utente non ha scelto). */
export type AppSettings = { readonly [K in DefaultedSettingKey]: SettingsMap[K] } & {
  /** `device.id`: null se il boot del database non e' ancora passato. */
  readonly deviceId: string | null;
};

/** Valori ammessi per il timeout del blocco app (F-10), in secondi. */
export const LOCK_TIMEOUTS_SECONDS = [0, 30, 60, 300, 900] as const;
