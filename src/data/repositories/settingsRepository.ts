// Repository delle impostazioni (tabella app_settings: chiave -> valore JSON, nessun segreto).
// SQL a mano, nessun ORM (SPEC D-05). Non emette eventi: li emettono i casi d'uso dopo il commit.
import type { Clock, SqlDatabase } from '@/domain/ports';
import {
  SETTING_DEFAULTS,
  type DefaultedSettingKey,
  type SettingKey,
  type SettingsMap,
} from '../seeds/settingsDefaults';

export interface SettingsRepository {
  /** Valore della chiave; se la riga manca (non dovrebbe: il boot inserisce i predefiniti) torna il predefinito. */
  get<K extends DefaultedSettingKey>(key: K): Promise<SettingsMap[K]>;
  /** `device.id`: ULID generato al primo avvio. Lancia se manca (il boot non e' ancora passato). */
  deviceId(): Promise<string>;
  /** Valore grezzo (JSON gia' decodificato) per chiavi non tipizzate (es. `notify.lastSync`); undefined se assente. */
  getRaw(key: string): Promise<unknown>;
  set<K extends SettingKey>(key: K, value: SettingsMap[K]): Promise<void>;
  setRaw(key: string, value: unknown): Promise<void>;
  /** Scrive piu' chiavi in una sola transazione. */
  setMany(entries: Partial<SettingsMap>): Promise<void>;
  /** Tutte le impostazioni presenti (JSON decodificato). */
  getAll(): Promise<Record<string, unknown>>;
  /** Cancella una chiave (tranne `device.id`); il prossimo `get` torna il predefinito. */
  remove(key: string): Promise<void>;
}

interface SettingRow {
  key: string;
  value: string;
}

function encode(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('valore di impostazione non serializzabile in JSON');
  return json;
}

const UPSERT = `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;

export function createSettingsRepository(db: SqlDatabase, clock: Pick<Clock, 'nowIso'>): SettingsRepository {
  const getRaw = async (key: string): Promise<unknown> => {
    const row = await db.get<SettingRow>('SELECT key, value FROM app_settings WHERE key = ?', [key]);
    return row === undefined ? undefined : (JSON.parse(row.value) as unknown);
  };
  const setRaw = async (key: string, value: unknown): Promise<void> => {
    await db.run(UPSERT, [key, encode(value), clock.nowIso()]);
  };

  return {
    async get<K extends DefaultedSettingKey>(key: K): Promise<SettingsMap[K]> {
      const raw = await getRaw(key);
      return raw === undefined ? (SETTING_DEFAULTS[key] as SettingsMap[K]) : (raw as SettingsMap[K]);
    },
    async deviceId(): Promise<string> {
      const raw = await getRaw('device.id');
      if (typeof raw !== 'string' || raw.length === 0) throw new Error('device.id mancante: il boot del database non e\' stato eseguito');
      return raw;
    },
    getRaw,
    set: (key, value) => setRaw(key, value),
    setRaw,
    async setMany(entries) {
      const now = clock.nowIso();
      await db.transaction(async (tx) => {
        for (const [key, value] of Object.entries(entries)) {
          if (value === undefined) continue;
          await tx.run(UPSERT, [key, encode(value), now]);
        }
      });
    },
    async getAll() {
      const rows = await db.all<SettingRow>('SELECT key, value FROM app_settings ORDER BY key');
      const out: Record<string, unknown> = {};
      for (const r of rows) out[r.key] = JSON.parse(r.value) as unknown;
      return out;
    },
    async remove(key) {
      if (key === 'device.id') throw new Error('device.id non si cancella');
      await db.run('DELETE FROM app_settings WHERE key = ?', [key]);
    },
  };
}
