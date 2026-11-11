// Seed dei cataloghi e delle impostazioni: contenuto, idempotenza, versioni (data.md 1.5, SPEC 7.1 e Appendice C).
import { describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORIES, TEMPLATE_ROWS, TEMPLATES, templateRow } from '@/data/seeds/catalog';
import { SETTING_DEFAULTS } from '@/data/seeds/settingsDefaults';
import { seedAll, seedExpenseCategories, seedSettings, seedTemplates } from '@/data/seeds/seed';
import { errorOf, insertRow, itemRow, nextId, openBootedDb, vehicleRow } from '../../support/db';
import { ulidOf } from '../../support/fakes';

describe('catalogo: contenuto', () => {
  it('27 template e 13 categorie di sistema, tutti validi rispetto ai CHECK', async () => {
    const { db } = await openBootedDb();
    expect(TEMPLATES).toHaveLength(27);
    expect(EXPENSE_CATEGORIES).toHaveLength(13);
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM service_templates'))?.n).toBe(27);
    const cats = await db.all<{ id: string; is_system: number }>('SELECT id, is_system FROM expense_categories ORDER BY sort_order');
    expect(cats).toHaveLength(13);
    expect(cats.every((c) => c.id.startsWith('sys_') && c.is_system === 1)).toBe(true);
    expect(cats[cats.length - 1]?.id).toBe('sys_other'); // "Altro" sempre in fondo
  });

  it('i template per categoria coincidono con SPEC 7.1 (legali 3, manutenzione 17, controlli 4, gomme 3)', async () => {
    const { db } = await openBootedDb();
    const rows = await db.all<{ category: string; n: number }>(
      'SELECT category, count(*) AS n FROM service_templates GROUP BY category ORDER BY category',
    );
    expect(Object.fromEntries(rows.map((r) => [r.category, r.n]))).toEqual({ check: 4, legal: 3, maintenance: 17, tyres: 3 });
  });

  it('attivi di default e indicativi come da tabella', async () => {
    const { db } = await openBootedDb();
    const off = (await db.all<{ id: string }>('SELECT id FROM service_templates WHERE default_enabled = 0 ORDER BY id')).map((r) => r.id);
    expect(off).toEqual(
      [
        'tpl_ac_service', 'tpl_battery_replace', 'tpl_check_adblue', 'tpl_check_coolant_washer', 'tpl_gearbox_oil',
        'tpl_timing_belt', 'tpl_tyre_rotation', 'tpl_tyres_summer', 'tpl_tyres_winter',
      ].sort(),
    );
    const notIndicative = (await db.all<{ id: string }>('SELECT id FROM service_templates WHERE is_indicative = 0 ORDER BY id')).map((r) => r.id);
    expect(notIndicative).toEqual(['tpl_gas_cylinder', 'tpl_inspection', 'tpl_road_tax', 'tpl_tyres_summer', 'tpl_tyres_winter']);
  });

  it('regole di legge e gomme stagionali', async () => {
    const { db } = await openBootedDb();
    const get = (id: string) => db.get<Record<string, string | number | null>>('SELECT * FROM service_templates WHERE id = ?', [id]);
    expect(await get('tpl_inspection')).toMatchObject({
      schedule_type: 'interval_last_done', interval_km: null, interval_months: 24, period_end: 'end_of_month',
      notify_offsets_days: '[60,30,14,7,0]', applies_to: null, soon_km: 0,
    });
    expect(await get('tpl_road_tax')).toMatchObject({ schedule_type: 'interval_calendar', interval_months: 12, notify_offsets_days: '[30,15,7,0]' });
    expect(await get('tpl_gas_cylinder')).toMatchObject({ schedule_type: 'fixed_date', interval_months: null, applies_to: '["gas"]' });
    expect(await get('tpl_tyres_winter')).toMatchObject({ schedule_type: 'interval_calendar', anchor_month: 11, anchor_day: 15, interval_months: 12 });
    expect(await get('tpl_tyres_summer')).toMatchObject({ anchor_month: 4, anchor_day: 15 });
    expect(await get('tpl_service_main')).toMatchObject({ interval_km: 15000, interval_months: 12, soon_km: 1500, soon_days: 30 });
    expect(await get('tpl_check_oil_level')).toMatchObject({ category: 'check', interval_km: 1000, interval_months: 1, applies_to: '["combustion"]' });
  });

  it('JSON dei preavvisi e dei tag applicabili: valido, preavvisi decrescenti, tag noti', async () => {
    const { db } = await openBootedDb();
    const rows = await db.all<{ id: string; notify_offsets_days: string; applies_to: string | null }>(
      'SELECT id, notify_offsets_days, applies_to FROM service_templates',
    );
    const tags = new Set(['combustion', 'petrol', 'diesel', 'gas', 'bev']);
    for (const r of rows) {
      const offsets = JSON.parse(r.notify_offsets_days) as number[];
      expect(offsets.length, r.id).toBeGreaterThan(0);
      expect(offsets.every((n) => Number.isInteger(n) && n >= 0), r.id).toBe(true);
      expect([...offsets].sort((a, b) => b - a), r.id).toEqual(offsets);
      if (r.applies_to !== null) {
        for (const tag of JSON.parse(r.applies_to) as string[]) expect(tags.has(tag), `${r.id}: ${tag}`).toBe(true);
      }
    }
  });

  it('gli id dei template sono univoci e con prefisso tpl_', () => {
    const ids = TEMPLATES.map((t) => t[0]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('tpl_'))).toBe(true);
  });
});

describe('seed idempotenti', () => {
  it('due esecuzioni producono le stesse righe (27 template, 13 categorie, stesse impostazioni)', async () => {
    const { db, clock, ids } = await openBootedDb();
    const dump = async () => ({
      templates: await db.all('SELECT * FROM service_templates ORDER BY id'),
      categories: await db.all('SELECT * FROM expense_categories ORDER BY id'),
      settings: await db.all('SELECT * FROM app_settings ORDER BY key'),
    });
    const before = await dump();
    clock.set('2030-01-01T00:00:00.000Z'); // l'orologio avanza: nulla deve cambiare lo stesso
    await seedAll(db, { clock, ids });
    await seedAll(db, { clock, ids });
    expect(await dump()).toEqual(before);
    expect(before.templates).toHaveLength(27);
    expect(before.categories).toHaveLength(13);
  });

  it('i template: la stessa versione non sovrascrive, una versione piu alta si, una piu bassa no', async () => {
    const { db } = await openBootedDb();
    const name = async () =>
      (await db.get<{ name_it: string; version: number }>(`SELECT name_it, version FROM service_templates WHERE id = 'tpl_service_main'`));
    const base = TEMPLATE_ROWS.find((r) => r.id === 'tpl_service_main');
    if (!base) throw new Error('template mancante');
    await db.run(`UPDATE service_templates SET name_it = 'Modificato a mano' WHERE id = 'tpl_service_main'`);
    await seedTemplates(db); // stessa versione
    expect(await name()).toEqual({ name_it: 'Modificato a mano', version: 1 });
    await seedTemplates(db, [{ ...base, version: 2, name_it: 'Tagliando (v2)', interval_km: 20000 }]);
    expect(await name()).toEqual({ name_it: 'Tagliando (v2)', version: 2 });
    expect((await db.get<{ interval_km: number }>(`SELECT interval_km FROM service_templates WHERE id = 'tpl_service_main'`))?.interval_km).toBe(20000);
    await seedTemplates(db, [{ ...base, version: 1, name_it: 'Torna indietro' }]); // versione piu bassa
    expect(await name()).toEqual({ name_it: 'Tagliando (v2)', version: 2 });
  });

  it('un nuovo template aggiunto al catalogo viene inserito; le regole gia create dagli utenti non si toccano', async () => {
    const { db } = await openBootedDb();
    const v = await insertRow(db, 'vehicles', vehicleRow());
    const item = await insertRow(
      db,
      'maintenance_items',
      itemRow(v, { template_id: 'tpl_service_main', template_version: 1, name: 'Il mio tagliando', interval_km: 12345 }),
    );
    const base = TEMPLATE_ROWS[0];
    if (!base) throw new Error('catalogo vuoto');
    await seedTemplates(db, [
      { ...templateRow(TEMPLATES[4] as (typeof TEMPLATES)[number], 4, 2), name_it: 'Tagliando v2', interval_km: 30000 },
      { ...base, id: 'tpl_nuovo', name_it: 'Nuovo', sort_order: 9999 },
    ]);
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM service_templates'))?.n).toBe(28);
    expect(await db.get('SELECT name, interval_km, template_version FROM maintenance_items WHERE id = ?', [item])).toEqual({
      name: 'Il mio tagliando', interval_km: 12345, template_version: 1,
    });
  });

  it("le categorie di sistema si aggiornano se cambiano; quelle dell'utente (id ULID) non si toccano mai", async () => {
    const { db, clock } = await openBootedDb();
    const mine = nextId();
    await insertRow(db, 'expense_categories', { id: mine, name_it: 'Mia categoria', icon: 'star', is_system: 0, sort_order: 5 });
    await seedExpenseCategories(db, { clock }, [
      ['sys_tolls', 'Pedaggi autostradali', 'road', 55],
      ['sys_other', 'Altro', 'more-horizontal', 999],
    ]);
    expect(await db.get(`SELECT name_it, sort_order FROM expense_categories WHERE id = 'sys_tolls'`)).toEqual({
      name_it: 'Pedaggi autostradali', sort_order: 55,
    });
    expect(await db.get('SELECT name_it, icon, is_system, sort_order FROM expense_categories WHERE id = ?', [mine])).toEqual({
      name_it: 'Mia categoria', icon: 'star', is_system: 0, sort_order: 5,
    });
  });

  it("un errore a meta' dei seed annulla tutto (transazione)", async () => {
    const { db, clock, ids } = await openBootedDb();
    await db.run('DELETE FROM service_templates');
    const msg = await errorOf(() =>
      db.transaction(async (tx) => {
        await seedAll(tx, { clock, ids });
        throw new Error('boom');
      }),
    );
    expect(msg).toBe('boom');
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM service_templates'))?.n).toBe(0);
    await seedAll(db, { clock, ids });
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM service_templates'))?.n).toBe(27);
  });
});

describe('impostazioni predefinite (SPEC Appendice C)', () => {
  it('tutte le chiavi presenti con il valore previsto e un device.id ULID', async () => {
    const { db } = await openBootedDb();
    const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM app_settings ORDER BY key');
    const map = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
    expect(Object.keys(map).sort()).toEqual(
      [
        'backup.lastExportAt', 'backup.nudgeDays', 'device.id', 'forecast.defaultAnnualKm', 'forecast.halfLifeDays',
        'forecast.windowDays', 'lock.enabled', 'lock.timeoutSeconds', 'notify.enabled', 'notify.maxScheduled',
        'notify.privacy', 'notify.time', 'onboarding.done', 'telemetry.maxMb', 'telemetry.rawRetentionDays',
        'trash.retentionDays', 'units.distance',
      ].sort(),
    );
    expect(map).toMatchObject({
      'units.distance': 'km', 'notify.enabled': true, 'notify.time': '09:00', 'notify.privacy': 'generic',
      'notify.maxScheduled': 60, 'forecast.windowDays': 180, 'forecast.halfLifeDays': 90, 'forecast.defaultAnnualKm': 12000,
      'telemetry.rawRetentionDays': 30, 'telemetry.maxMb': 50, 'trash.retentionDays': 30, 'lock.enabled': false,
      'lock.timeoutSeconds': 60, 'backup.lastExportAt': null, 'backup.nudgeDays': 30, 'onboarding.done': false,
    });
    expect(typeof map['device.id']).toBe('string');
    expect((map['device.id'] as string).length).toBe(26);
    expect(SETTING_DEFAULTS['notify.maxScheduled']).toBeLessThan(64); // sotto il tetto iOS
  });

  it("un valore scelto dall'utente non si sovrascrive; device.id si genera una volta sola", async () => {
    const { db, clock, ids } = await openBootedDb();
    const deviceId = (await db.get<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'device.id'`))?.value;
    await db.run(`UPDATE app_settings SET value = '"mi"' WHERE key = 'units.distance'`);
    await db.run(`DELETE FROM app_settings WHERE key = 'trash.retentionDays'`);
    const nextBefore = ids.next;
    await seedSettings(db, { clock, ids });
    expect(await db.get(`SELECT value FROM app_settings WHERE key = 'units.distance'`)).toEqual({ value: '"mi"' });
    expect(await db.get(`SELECT value FROM app_settings WHERE key = 'trash.retentionDays'`)).toEqual({ value: '30' }); // ripristinato
    expect(await db.get(`SELECT value FROM app_settings WHERE key = 'device.id'`)).toEqual({ value: deviceId });
    expect(ids.next).toBe(nextBefore); // nessun ULID consumato inutilmente
  });

  it('device.id usa il generatore di ID del primo avvio', async () => {
    const { db } = await openBootedDb();
    // (openBootedDb parte da 9000: ulidOf(9000))
    const row = await db.get<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'device.id'`);
    expect(JSON.parse(row?.value ?? '""')).toBe(ulidOf(9000));
  });
});
