import { beforeEach, describe, expect, it } from 'vitest';
import { createSettingsRepository, type SettingsRepository } from '@/data/repositories/settingsRepository';
import { SETTING_DEFAULTS, type SettingsMap } from '@/data/seeds/settingsDefaults';
import { errorOf, openBootedDb, type TestDb } from '../../support/db';

let t: TestDb;
let repo: SettingsRepository;
beforeEach(async () => {
  t = await openBootedDb();
  repo = createSettingsRepository(t.db, t.clock);
});

describe('SettingsRepository', () => {
  it('get restituisce i valori predefiniti caricati dal boot', async () => {
    expect(await repo.get('units.distance')).toBe('km');
    expect(await repo.get('notify.time')).toBe('09:00');
    expect(await repo.get('notify.maxScheduled')).toBe(60);
    expect(await repo.get('backup.lastExportAt')).toBeNull();
    expect(await repo.get('onboarding.done')).toBe(false);
  });

  it('deviceId: ULID generato al primo avvio', async () => {
    expect(await repo.deviceId()).toHaveLength(26);
  });

  it('set/get: round-trip per stringhe, numeri, booleani e null', async () => {
    await repo.set('units.distance', 'mi');
    await repo.set('notify.enabled', false);
    await repo.set('notify.maxScheduled', 50);
    await repo.set('backup.lastExportAt', '2026-10-08T07:30:00.000Z');
    expect(await repo.get('units.distance')).toBe('mi');
    expect(await repo.get('notify.enabled')).toBe(false);
    expect(await repo.get('notify.maxScheduled')).toBe(50);
    expect(await repo.get('backup.lastExportAt')).toBe('2026-10-08T07:30:00.000Z');
    await repo.set('backup.lastExportAt', null);
    expect(await repo.get('backup.lastExportAt')).toBeNull();
  });

  it("set aggiorna updated_at con l'orologio iniettato", async () => {
    t.clock.set('2027-02-03T04:05:06.789Z');
    await repo.set('lock.enabled', true);
    expect(await t.db.get(`SELECT updated_at FROM app_settings WHERE key = 'lock.enabled'`)).toEqual({
      updated_at: '2027-02-03T04:05:06.789Z',
    });
  });

  it('se la riga manca get torna il predefinito; remove la elimina ma device.id e protetto', async () => {
    await repo.set('trash.retentionDays', 7);
    await repo.remove('trash.retentionDays');
    expect(await repo.get('trash.retentionDays')).toBe(SETTING_DEFAULTS['trash.retentionDays']);
    expect(await errorOf(() => repo.remove('device.id'))).toMatch(/device\.id/);
  });

  it('getRaw/setRaw per chiavi non tipizzate (es. notify.lastSync con un oggetto)', async () => {
    expect(await repo.getRaw('notify.lastSync')).toBeUndefined();
    await repo.setRaw('notify.lastSync', { at: '2026-10-08T07:30:00.000Z', ok: true, scheduled: 12 });
    expect(await repo.getRaw('notify.lastSync')).toEqual({ at: '2026-10-08T07:30:00.000Z', ok: true, scheduled: 12 });
  });

  it('setMany scrive tutto in una transazione: se una chiave non e serializzabile non cambia nulla', async () => {
    await repo.setMany({ 'units.distance': 'mi', 'notify.time': '08:15' });
    expect(await repo.get('units.distance')).toBe('mi');
    expect(await repo.get('notify.time')).toBe('08:15');
    const bad: Partial<SettingsMap> = { 'units.distance': 'km', 'notify.time': 1n as unknown as string };
    const msg = await errorOf(() => repo.setMany(bad));
    expect(msg).not.toBeNull();
    expect(await repo.get('units.distance')).toBe('mi'); // rollback
    expect(await repo.get('notify.time')).toBe('08:15');
  });

  it('un valore non serializzabile in JSON e rifiutato', async () => {
    expect(await errorOf(() => repo.setRaw('x', undefined))).toMatch(/serializzabile/);
  });

  it('getAll restituisce tutte le chiavi con i valori JSON decodificati', async () => {
    await repo.set('forecast.windowDays', 120);
    const all = await repo.getAll();
    expect(all['forecast.windowDays']).toBe(120);
    expect(all['device.id']).toBe(await repo.deviceId());
    expect(Object.keys(all)).toHaveLength(17);
  });

  it('la tabella rifiuta un valore che non e JSON valido (CHECK json_valid)', async () => {
    const msg = await errorOf(() => t.db.run(`INSERT INTO app_settings (key, value) VALUES ('x', 'non json')`));
    expect(msg).toMatch(/CHECK constraint failed/);
  });
});
