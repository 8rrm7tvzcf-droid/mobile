// Lettura delle impostazioni (tabella app_settings, valori JSON). I casi d'uso non importano `data`: SQL a mano.
// I valori predefiniti rispecchiano SETTING_DEFAULTS (SPEC Appendice C).
import type { SqlDatabase } from '@/domain/ports';

export interface NotifySettings {
  enabled: boolean;
  /** 'HH:MM' locale. */
  time: string;
  privacy: 'generic' | 'full';
  maxScheduled: number;
}

export interface BackupSettings {
  lastExportAt: string | null;
  nudgeDays: number;
}

async function readRaw(db: SqlDatabase, keys: readonly string[]): Promise<Map<string, unknown>> {
  const rows = await db.all<{ key: string; value: string }>(
    `SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => '?').join(', ')})`,
    [...keys],
  );
  const out = new Map<string, unknown>();
  for (const r of rows) {
    try {
      out.set(r.key, JSON.parse(r.value));
    } catch {
      // valore illeggibile: vale il predefinito
    }
  }
  return out;
}

export async function readNotifySettings(db: SqlDatabase): Promise<NotifySettings> {
  const m = await readRaw(db, ['notify.enabled', 'notify.time', 'notify.privacy', 'notify.maxScheduled']);
  const enabled = m.get('notify.enabled');
  const time = m.get('notify.time');
  const privacy = m.get('notify.privacy');
  const max = m.get('notify.maxScheduled');
  return {
    enabled: typeof enabled === 'boolean' ? enabled : true,
    time: typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '09:00',
    privacy: privacy === 'full' ? 'full' : 'generic',
    maxScheduled: typeof max === 'number' && Number.isInteger(max) && max >= 1 && max <= 64 ? max : 60,
  };
}

export async function readBackupSettings(db: SqlDatabase): Promise<BackupSettings> {
  const m = await readRaw(db, ['backup.lastExportAt', 'backup.nudgeDays']);
  const last = m.get('backup.lastExportAt');
  const nudge = m.get('backup.nudgeDays');
  return {
    lastExportAt: typeof last === 'string' && last.length >= 10 ? last : null,
    nudgeDays: typeof nudge === 'number' && Number.isFinite(nudge) && nudge >= 1 ? Math.trunc(nudge) : 30,
  };
}
