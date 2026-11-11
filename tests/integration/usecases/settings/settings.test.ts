// Impostazioni (F-11, SPEC Appendice C): predefiniti, lettura tipizzata, scrittura validata, eventi.
import { beforeEach, describe, expect, it } from 'vitest';
import { createSettingsRepository } from '@/data/repositories/settingsRepository';
import { SETTING_DEFAULTS as SEED_DEFAULTS } from '@/data/seeds/settingsDefaults';
import {
  DEFAULTED_SETTING_KEYS,
  SETTING_DEFAULTS,
  getDeviceId,
  getSetting,
  getSettings,
  resetSetting,
  setSetting,
  setSettings,
  settingError,
} from '@/usecases/settings';
import { count, makeHarness, unwrap, type Harness } from '../vehicles/harness';

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});

describe('predefiniti', () => {
  it('coincidono con quelli caricati dal seed (src/data): le due tabelle non possono divergere', () => {
    expect(SETTING_DEFAULTS).toEqual(SEED_DEFAULTS);
  });

  it('i valori del seed nel database sono quelli che i casi d uso leggono', async () => {
    const s = await getSettings(h.deps);
    for (const key of DEFAULTED_SETTING_KEYS) expect(s[key], key).toEqual(SETTING_DEFAULTS[key]);
    expect(s.deviceId).toMatch(/^[0-9A-Z]{26}$/);
    expect(await getDeviceId(h.deps)).toBe(s.deviceId);
  });

  it('Appendice C: valori chiave', async () => {
    expect(await getSetting(h.deps, 'units.distance')).toBe('km');
    expect(await getSetting(h.deps, 'notify.time')).toBe('09:00');
    expect(await getSetting(h.deps, 'notify.privacy')).toBe('generic');
    expect(await getSetting(h.deps, 'notify.maxScheduled')).toBe(60);
    expect(await getSetting(h.deps, 'trash.retentionDays')).toBe(30);
    expect(await getSetting(h.deps, 'forecast.defaultAnnualKm')).toBe(12000);
    expect(await getSetting(h.deps, 'backup.lastExportAt')).toBeNull();
    expect(await getSetting(h.deps, 'onboarding.done')).toBe(false);
  });

  it('se la riga manca si torna il predefinito; se e corrotta o di tipo sbagliato pure', async () => {
    await h.db.run(`DELETE FROM app_settings WHERE key = 'notify.time'`);
    expect(await getSetting(h.deps, 'notify.time')).toBe('09:00');
    await h.db.exec(`UPDATE app_settings SET value = '"25:99"' WHERE key = 'notify.time'`);
    expect(await getSetting(h.deps, 'notify.time')).toBe('09:00');
    await h.db.exec(`UPDATE app_settings SET value = '"zzz"' WHERE key = 'notify.maxScheduled'`);
    expect(await getSetting(h.deps, 'notify.maxScheduled')).toBe(60);
    expect((await getSettings(h.deps))['notify.maxScheduled']).toBe(60);
  });

  it('device.id assente: deviceId e null', async () => {
    await h.db.run(`DELETE FROM app_settings WHERE key = 'device.id'`);
    expect(await getDeviceId(h.deps)).toBeNull();
  });
});

describe('setSetting / setSettings', () => {
  it('scrive, rilegge e emette l evento dopo il commit', async () => {
    unwrap(await setSetting(h.deps, 'notify.time', '08:30'));
    expect(await getSetting(h.deps, 'notify.time')).toBe('08:30');
    expect(h.events).toEqual([{ type: 'data-changed', scope: 'settings' }]);
    const row = await h.db.get<{ value: string; updated_at: string }>(`SELECT value, updated_at FROM app_settings WHERE key = 'notify.time'`);
    expect(row).toEqual({ value: '"08:30"', updated_at: '2026-10-08T07:30:00.000Z' });
  });

  it('il repository di src/data legge cio che scrivono i casi d uso (stessa codifica JSON)', async () => {
    unwrap(await setSettings(h.deps, { 'notify.privacy': 'full', 'lock.enabled': true, 'backup.lastExportAt': '2026-10-01T10:00:00.000Z' }));
    const repo = createSettingsRepository(h.db, h.clock);
    expect(await repo.get('notify.privacy')).toBe('full');
    expect(await repo.get('lock.enabled')).toBe(true);
    expect(await repo.get('backup.lastExportAt')).toBe('2026-10-01T10:00:00.000Z');
  });

  it('piu chiavi in una transazione: un solo evento; valori uguali ai correnti non scrivono ne emettono', async () => {
    unwrap(await setSettings(h.deps, { 'notify.enabled': false, 'notify.time': '07:00', 'trash.retentionDays': 14 }));
    expect(h.events).toHaveLength(1);
    h.clearEvents();
    unwrap(await setSettings(h.deps, { 'notify.enabled': false, 'notify.time': '07:00' }));
    expect(h.events).toEqual([]);
    unwrap(await setSettings(h.deps, {}));
    expect(h.events).toEqual([]);
  });

  it('un valore non valido da errore sul campo e non scrive nulla (neanche le altre chiavi)', async () => {
    const r = await setSettings(h.deps, { 'notify.enabled': false, 'notify.time': '25:00' });
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'notify.time' } });
    expect(!r.ok && 'message' in r.error && r.error.message).toContain('HH:MM');
    expect(await getSetting(h.deps, 'notify.enabled')).toBe(true);
    expect(h.events).toEqual([]);
  });

  it('device.id e chiavi sconosciute sono rifiutati', async () => {
    const before = await getDeviceId(h.deps);
    expect(await setSettings(h.deps, { 'device.id': 'x' } as never)).toMatchObject({ ok: false, error: { field: 'device.id' } });
    expect(await setSettings(h.deps, { 'foo.bar': 1 } as never)).toMatchObject({ ok: false, error: { field: 'foo.bar' } });
    expect(await getDeviceId(h.deps)).toBe(before);
    expect(await count(h.db, 'app_settings', "key = 'foo.bar'")).toBe(0);
  });

  it('intervalli e valori ammessi per ogni chiave', () => {
    const bad: [Parameters<typeof settingError>[0], unknown][] = [
      ['units.distance', 'yd'],
      ['notify.enabled', 'si'],
      ['notify.time', '9:00'],
      ['notify.privacy', 'none'],
      ['notify.maxScheduled', 65],
      ['notify.maxScheduled', 0],
      ['forecast.windowDays', 10],
      ['forecast.halfLifeDays', 400],
      ['forecast.defaultAnnualKm', 500],
      ['forecast.defaultAnnualKm', 12000.5],
      ['telemetry.rawRetentionDays', 0],
      ['telemetry.maxMb', 5000],
      ['trash.retentionDays', 0],
      ['lock.enabled', 1],
      ['lock.timeoutSeconds', 45],
      ['backup.lastExportAt', '2026-10-01'],
      ['backup.nudgeDays', 0],
      ['onboarding.done', null],
    ];
    for (const [key, value] of bad) expect(settingError(key, value), `${key}=${String(value)}`).not.toBeNull();
    const good: [Parameters<typeof settingError>[0], unknown][] = [
      ['units.distance', 'mi'],
      ['notify.time', '00:00'],
      ['notify.time', '23:59'],
      ['notify.maxScheduled', 64],
      ['lock.timeoutSeconds', 0],
      ['lock.timeoutSeconds', 900],
      ['backup.lastExportAt', null],
      ['backup.lastExportAt', '2026-10-01T10:00:00.000Z'],
    ];
    for (const [key, value] of good) expect(settingError(key, value), `${key}=${String(value)}`).toBeNull();
  });
});

describe('resetSetting', () => {
  it('riporta la chiave al predefinito ed emette l evento solo se c era un valore', async () => {
    unwrap(await setSetting(h.deps, 'trash.retentionDays', 14));
    h.clearEvents();
    unwrap(await resetSetting(h.deps, 'trash.retentionDays'));
    expect(await getSetting(h.deps, 'trash.retentionDays')).toBe(30);
    expect(h.events).toEqual([{ type: 'data-changed', scope: 'settings' }]);
    h.clearEvents();
    unwrap(await resetSetting(h.deps, 'trash.retentionDays'));
    expect(h.events).toEqual([]);
    expect(await resetSetting(h.deps, 'device.id' as never)).toMatchObject({ ok: false });
  });
});
