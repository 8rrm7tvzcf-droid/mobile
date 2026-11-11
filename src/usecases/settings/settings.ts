// Impostazioni tipizzate su `app_settings` (F-11). Letture senza errori (un valore assente o corrotto torna il predefinito),
// scritture validate; dopo il commit si emette {data-changed, settings}.
import type { SqlDatabase } from '@/domain/ports';
import { invalid, ok, type Deps, type UsecaseResult } from '../context';
import {
  DEFAULTED_SETTING_KEYS,
  SETTING_DEFAULTS,
  type AppSettings,
  type DefaultedSettingKey,
  type SettingsMap,
} from './defaults';
import { isValidSetting, settingError } from './validate';

interface SettingRow {
  key: string;
  value: string;
}

function decode(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** Legge una chiave su una connessione (o transazione) qualsiasi: la usano gli altri casi d'uso dentro le loro transazioni. */
export async function readSetting<K extends DefaultedSettingKey>(db: SqlDatabase, key: K): Promise<SettingsMap[K]> {
  const row = await db.get<SettingRow>('SELECT key, value FROM app_settings WHERE key = ?', [key]);
  const value = decode(row?.value);
  return value !== undefined && isValidSetting(key, value)
    ? (value as SettingsMap[K])
    : (SETTING_DEFAULTS[key] as SettingsMap[K]);
}

export async function getSetting<K extends DefaultedSettingKey>(d: Pick<Deps, 'db'>, key: K): Promise<SettingsMap[K]> {
  return readSetting(d.db, key);
}

/** Tutte le impostazioni: i predefiniti sovrascritti dai valori validi presenti nel database. */
export async function getSettings(d: Pick<Deps, 'db'>): Promise<AppSettings> {
  const rows = await d.db.all<SettingRow>('SELECT key, value FROM app_settings');
  const stored = new Map(rows.map((r) => [r.key, decode(r.value)]));
  const out: Record<string, unknown> = {};
  for (const key of DEFAULTED_SETTING_KEYS) {
    const v = stored.get(key);
    out[key] = v !== undefined && isValidSetting(key, v) ? v : SETTING_DEFAULTS[key];
  }
  const id = stored.get('device.id');
  out['deviceId'] = typeof id === 'string' && id.length > 0 ? id : null;
  return out as unknown as AppSettings;
}

/** `device.id`: l'identificatore del dispositivo generato al primo avvio (null se il boot non e' ancora passato). */
export async function getDeviceId(d: Pick<Deps, 'db'>): Promise<string | null> {
  return (await getSettings(d)).deviceId;
}

export type SettingsPatch = { [K in DefaultedSettingKey]?: SettingsMap[K] };

const UPSERT = `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;

/**
 * Scrive piu' impostazioni in una transazione. Valida tutto prima di scrivere; non riscrive i valori uguali a quelli
 * correnti e, se nulla cambia, non emette eventi. `device.id` e le chiavi sconosciute sono rifiutati.
 */
export async function setSettings(d: Deps, patch: SettingsPatch): Promise<UsecaseResult<void>> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  for (const [key, value] of entries) {
    if (key === 'device.id') return invalid(key, "L'identificatore del dispositivo non si modifica.");
    if (!(DEFAULTED_SETTING_KEYS as string[]).includes(key)) return invalid(key, 'Impostazione sconosciuta.');
    const message = settingError(key as DefaultedSettingKey, value);
    if (message) return invalid(key, message);
  }
  if (entries.length === 0) return ok(undefined);
  const changed = await d.db.transaction(async (tx) => {
    const now = d.clock.nowIso();
    let n = 0;
    for (const [key, value] of entries) {
      const current = await tx.get<SettingRow>('SELECT key, value FROM app_settings WHERE key = ?', [key]);
      const json = JSON.stringify(value);
      if (current?.value === json) continue;
      await tx.run(UPSERT, [key, json, now]);
      n++;
    }
    return n;
  }, 'exclusive');
  if (changed > 0) d.events.emit({ type: 'data-changed', scope: 'settings' });
  return ok(undefined);
}

export async function setSetting<K extends DefaultedSettingKey>(
  d: Deps,
  key: K,
  value: SettingsMap[K],
): Promise<UsecaseResult<void>> {
  return setSettings(d, { [key]: value } as SettingsPatch);
}

/** Riporta una chiave al valore predefinito (cancella la riga). */
export async function resetSetting(d: Deps, key: DefaultedSettingKey): Promise<UsecaseResult<void>> {
  if (!(DEFAULTED_SETTING_KEYS as string[]).includes(key)) return invalid(String(key), 'Impostazione sconosciuta.');
  const removed = await d.db.transaction((tx) => tx.run('DELETE FROM app_settings WHERE key = ?', [key]), 'exclusive');
  if (removed.changes > 0) d.events.emit({ type: 'data-changed', scope: 'settings' });
  return ok(undefined);
}
