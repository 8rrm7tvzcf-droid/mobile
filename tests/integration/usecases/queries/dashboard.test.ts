// getDashboard: stati calcolati dalla cache dei promemoria, semafori, "Da fare", banner (SPEC 6.3.4, F-13, F-24).
import { describe, expect, it } from 'vitest';
import { diffDays } from '@/domain/dates';
import { getDashboard } from '@/usecases/queries';
import { insertRow, policyRow, reminderRow } from '../../../support/db';
import { FakeScheduler } from '../notifications/fakeScheduler';
import { TODAY, addGenerated, addItem, addManual, addReading, addVehicle, setSetting, setup } from './helpers';
import type { Ctx } from './helpers';

/** Auto con 6 scadenze: una per ogni stato (e due categorie diverse). Restituisce gli id. */
async function seedStates(c: Ctx): Promise<{ v: string; r: Record<string, string> }> {
  const v = await addVehicle(c);
  await addReading(c, v, '2026-07-10', 25000);
  await addReading(c, v, '2026-10-01', 27000);
  const insp = await addItem(c, v, {
    name: 'Revisione', category: 'legal', template_id: 'tpl_inspection', interval_km: null, interval_months: 24,
  });
  const r = {
    overdue: await addGenerated(c, v, insp, 'Revisione', { category: 'legal', due_on: '2026-10-05', effective_due_on: '2026-10-05', due_trigger: 'time' }),
    today: await addManual(c, v, 'Gommista', TODAY, { category: 'check' }),
    soon: await addManual(c, v, 'Controllo luci', '2026-10-22', { category: 'maintenance' }),
    ok: await addManual(c, v, 'Rinnovo assicurazione', '2027-11-30', { category: 'insurance' }),
    km: await addManual(c, v, 'Cambio olio', null, { category: 'maintenance', due_km: 28200 }),
  };
  await addItem(c, v, { name: 'Filtro abitacolo', category: 'maintenance' }); // nessun "fatto": da configurare
  return { v, r };
}

describe('getDashboard: stati e testi', () => {
  it('senza auto: stato vuoto con azione e nessun banner', async () => {
    const c = await setup();
    const dash = await getDashboard(c.deps);
    expect(dash.today).toBe(TODAY);
    expect(dash.hasVehicles).toBe(false);
    expect(dash.emptyState).toBe('no-vehicles');
    expect(dash.banners).toEqual([]);
    expect(dash.next).toBeNull();
    expect(dash.counts.total).toBe(0);
  });

  it("un'auto senza scadenze: stato vuoto 'no-deadlines'", async () => {
    const c = await setup();
    await addVehicle(c);
    const dash = await getDashboard(c.deps);
    expect(dash.hasVehicles).toBe(true);
    expect(dash.emptyState).toBe('no-deadlines');
    expect(dash.showVehicleSelector).toBe(false);
  });

  it('calcola ok / in arrivo / scade oggi / scaduto / da configurare con icona, tono e testo italiano', async () => {
    const c = await setup();
    const { r } = await seedStates(c);
    const dash = await getDashboard(c.deps);
    const by = (id: string) => [...dash.groups.overdue, ...dash.groups.soon, ...dash.groups.ok, ...dash.groups.unknown].find((x) => x.id === id)!;

    const overdue = by(r.overdue!);
    expect(overdue).toMatchObject({ state: 'overdue', group: 'overdue', tone: 'danger', icon: 'alert', label: 'Scaduto', daysLeft: -3 });
    expect(overdue.text).toBe('da 3 giorni (scadenza 05/10/2026)');
    expect(overdue.summary).toBe('Scaduto · da 3 giorni (scadenza 05/10/2026)');

    // "scade oggi": nel motore e' `soon`, la UI lo mostra rosso
    expect(by(r.today!)).toMatchObject({ state: 'soon', group: 'soon', tone: 'danger', icon: 'alert', label: 'Scade oggi', dueToday: true });

    const soon = by(r.soon!);
    expect(soon).toMatchObject({ state: 'soon', tone: 'warning', icon: 'clock', label: 'In arrivo', daysLeft: 14 });
    expect(soon.text).toBe('scade il 22/10/2026 (tra 14 giorni)');

    const ok = by(r.ok!);
    expect(ok).toMatchObject({ state: 'ok', tone: 'ok', icon: 'check', label: 'In regola' });
    expect(ok.text).toBe(`scade il 30/11/2027 (tra ${diffDays(TODAY, '2027-11-30')} giorni)`);

    const km = by(r.km!);
    expect(km).toMatchObject({ state: 'soon', tone: 'warning', trigger: 'km', estimated: true, kmLeft: 1200, currentKm: 27000 });
    expect(km.text).toBe('tra circa 1.200 km (stima)');
    expect(km.secondaryText).toMatch(/^circa il \d{2}\/\d{2}\/2026$/);

    const unknown = dash.groups.unknown[0]!;
    expect(unknown).toMatchObject({ kind: 'item', title: 'Filtro abitacolo', state: 'unknown', tone: 'unknown', icon: 'help', label: 'Da configurare' });
    expect(unknown.text).toBe("Indica quando l'hai fatto l'ultima volta.");
    expect(unknown.reasons).toEqual([{ code: 'NO_LAST_DONE', message: "Indica quando l'hai fatto l'ultima volta." }]);
  });

  it('ordina per urgenza: scadute, poi in arrivo per data, poi in regola, poi da configurare', async () => {
    const c = await setup();
    const { r } = await seedStates(c);
    const dash = await getDashboard(c.deps);
    expect(dash.groups.overdue.map((x) => x.id)).toEqual([r.overdue]);
    expect(dash.groups.soon.map((x) => x.id)).toEqual([r.today, r.soon, r.km]);
    expect(dash.groups.ok.map((x) => x.id)).toEqual([r.ok]);
    expect(dash.groups.unknown).toHaveLength(1);
    expect(dash.counts).toEqual({ overdue: 1, soon: 3, ok: 1, unknown: 1, total: 6 });
    expect(dash.next?.id).toBe(r.overdue); // "Prossima scadenza": scadute per prime
  });

  it('semafori per categoria: lo stato e\' il peggiore fra le voci, nell\'ordine della SPEC', async () => {
    const c = await setup();
    await seedStates(c);
    const dash = await getDashboard(c.deps);
    expect(dash.categories.map((x) => [x.category, x.label, x.tone])).toEqual([
      ['legal', 'Legale', 'danger'],
      ['insurance', 'Assicurazione', 'ok'],
      ['maintenance', 'Manutenzione', 'warning'],
      ['check', 'Controlli', 'danger'],
    ]);
    const maint = dash.categories.find((x) => x.category === 'maintenance')!;
    expect(maint.counts).toEqual({ overdue: 0, soon: 2, ok: 0, unknown: 1, total: 3 });
    expect(maint.icon).toBe('clock');
  });

  it('lo stato non si salva: avanzando l\'orologio la stessa riga diventa scaduta', async () => {
    const c = await setup();
    const { r } = await seedStates(c);
    c.clock.set('2026-10-25T07:30:00.000Z');
    const dash = await getDashboard(c.deps);
    const soonNow = dash.groups.overdue.find((x) => x.id === r.soon);
    expect(soonNow).toMatchObject({ state: 'overdue', label: 'Scaduto', daysLeft: -3 });
  });

  it('un promemoria a km con i km gia\' raggiunti e\' scaduto ("raggiunti i ...")', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    await addReading(c, v, '2026-10-01', 30500);
    const id = await addManual(c, v, 'Tagliando', null, { due_km: 30000 });
    const row = (await getDashboard(c.deps)).groups.overdue.find((x) => x.id === id)!;
    expect(row).toMatchObject({ state: 'overdue', kmReached: true, label: 'Scaduto' });
    expect(row.text).toBe('raggiunti i 30.000 km');
  });

  it('una scadenza a km senza nessuna lettura e\' "da configurare" con il motivo NO_ODOMETER', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    const id = await addManual(c, v, 'Tagliando', null, { due_km: 30000 });
    const row = (await getDashboard(c.deps)).groups.unknown.find((x) => x.id === id)!;
    expect(row.reasons[0]!.code).toBe('NO_ODOMETER');
    expect(row.text).toBe('Inserisci i km attuali per stimare la scadenza.');
  });

  it('un\'auto in miglia mostra le distanze nell\'unita\' del veicolo', async () => {
    const c = await setup();
    const v = await addVehicle(c, { distance_unit: 'mi' });
    await addReading(c, v, '2026-10-01', 10000);
    await addReading(c, v, '2026-09-01', 9000);
    const id = await addManual(c, v, 'Olio', null, { due_km: 11000 });
    const row = (await getDashboard(c.deps)).groups.soon.find((x) => x.id === id)!;
    expect(row.text).toMatch(/^tra circa [\d.]+ mi \(stima\)$/);
  });
});

describe('getDashboard: filtri, "Da fare" e voci escluse', () => {
  it('"Da fare": solo promemoria aperti non rimandati, per urgenza; le voci senza occorrenza non ci sono', async () => {
    const c = await setup();
    const { r } = await seedStates(c);
    await c.db.run('UPDATE reminders SET snoozed_until = ? WHERE id = ?', ['2026-10-10T09:00:00.000Z', r.soon!]);
    const dash = await getDashboard(c.deps);
    expect(dash.todo.map((x) => x.id)).toEqual([r.overdue, r.today, r.km, r.ok]);
    // il rimandato resta nelle liste ma e' marcato
    const snoozed = dash.groups.soon.find((x) => x.id === r.soon)!;
    expect(snoozed.snoozed).toBe(true);
    expect(snoozed.snoozedUntil).toBe('2026-10-10T09:00:00.000Z');
  });

  it('lo snooze scaduto non nasconde piu\' il promemoria', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    const id = await addManual(c, v, 'X', '2026-10-20');
    await c.db.run('UPDATE reminders SET snoozed_until = ? WHERE id = ?', ['2026-10-08T07:00:00.000Z', id]);
    expect((await getDashboard(c.deps)).todo.map((x) => x.id)).toEqual([id]);
  });

  it('"Da fare" si ferma a 50 promemoria', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    for (let i = 0; i < 55; i++) await addManual(c, v, `Voce ${String(i).padStart(2, '0')}`, '2026-12-01');
    const dash = await getDashboard(c.deps);
    expect(dash.todo).toHaveLength(50);
    expect(dash.counts.total).toBe(55);
  });

  it('con piu\' auto compare il selettore e il filtro limita le scadenze; un id sconosciuto equivale a "Tutte"', async () => {
    const c = await setup();
    const a = await addVehicle(c, { nickname: 'Panda' });
    const b = await addVehicle(c, { nickname: 'Golf', make: 'VW', model: 'Golf' });
    await addManual(c, a, 'Della Panda', '2026-10-10');
    await addManual(c, b, 'Della Golf', '2026-10-12');
    const all = await getDashboard(c.deps);
    expect(all.showVehicleSelector).toBe(true);
    expect(all.vehicleId).toBeNull();
    expect(all.counts.total).toBe(2);
    expect(all.vehicles.map((x) => x.label)).toEqual(['Panda', 'Golf']);
    const only = await getDashboard(c.deps, { vehicleId: b });
    expect(only.vehicleId).toBe(b);
    expect(only.groups.soon.map((x) => x.title)).toEqual(['Della Golf']);
    expect(only.vehicles).toHaveLength(2); // il selettore mostra sempre tutte le auto
    expect((await getDashboard(c.deps, { vehicleId: 'inesistente' })).counts.total).toBe(2);
  });

  it('il riepilogo per auto ha semaforo, km e prossima scadenza', async () => {
    const c = await setup();
    const { v } = await seedStates(c);
    const dash = await getDashboard(c.deps);
    const s = dash.vehicles.find((x) => x.id === v)!;
    expect(s).toMatchObject({ label: 'Panda', tone: 'danger', icon: 'alert', currentKm: 27000, currentKmText: '27.000 km', lastReadingOn: '2026-10-01' });
    expect(s.counts.total).toBe(6);
    expect(s.next?.title).toBe('Revisione');
  });

  it('ignora auto vendute o nel cestino, promemoria chiusi o cancellati e voci spente', async () => {
    const c = await setup();
    const sold = await addVehicle(c, { nickname: 'Venduta', status: 'sold', sold_on: '2026-09-01' });
    await addManual(c, sold, 'Dell\'auto venduta', '2026-10-10');
    const trash = await addVehicle(c, { nickname: 'Cestino', deleted_at: '2026-09-01T10:00:00.000Z' });
    await addManual(c, trash, 'Nel cestino', '2026-10-10');
    const v = await addVehicle(c);
    await addManual(c, v, 'Chiuso', '2026-10-10', { status: 'done', completed_on: '2026-10-01' });
    await addManual(c, v, 'Cancellato', '2026-10-10', { deleted_at: '2026-10-02T10:00:00.000Z' });
    const off = await addItem(c, v, { name: 'Voce spenta', is_active: 0 });
    await addGenerated(c, v, off, 'Voce spenta', { due_on: '2026-10-10', effective_due_on: '2026-10-10' });
    await addItem(c, v, { name: 'Spenta senza occorrenza', is_active: 0 });
    const dash = await getDashboard(c.deps);
    expect(dash.vehicles.map((x) => x.label)).toEqual(['Panda']);
    expect(dash.counts.total).toBe(0);
    expect(dash.emptyState).toBe('no-deadlines');
  });

  it('una voce con occorrenza aperta compare una volta sola (come promemoria, non come voce)', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    const item = await addItem(c, v, { name: 'Cambio olio' });
    const rem = await addGenerated(c, v, item, 'Cambio olio', { due_on: '2026-12-01', effective_due_on: '2026-12-01' });
    const dash = await getDashboard(c.deps);
    const rows = [...dash.groups.ok, ...dash.groups.soon, ...dash.groups.unknown];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: rem, kind: 'reminder', itemId: item, origin: 'rule' });
  });

  it('una voce senza occorrenza ma con l\'ultimo intervento noto viene valutata dalla regola', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    await addItem(c, v, { name: 'Cambio olio', interval_km: null, interval_months: 12, baseline_on: '2025-10-20' });
    const dash = await getDashboard(c.deps);
    const row = dash.groups.soon[0]!;
    expect(row).toMatchObject({ kind: 'item', state: 'soon', dueOn: '2026-10-20' });
    expect(row.text).toBe('scade il 20/10/2026 (tra 12 giorni)');
  });
});

describe('getDashboard: fonte e avvertenza legale', () => {
  it('le voci di legge e la RCA portano fonti e avvertenza; le altre no', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    const insp = await addItem(c, v, { name: 'Revisione', category: 'legal', template_id: 'tpl_inspection', interval_km: null, interval_months: 24 });
    await addGenerated(c, v, insp, 'Revisione', { category: 'legal', due_on: '2026-12-31', effective_due_on: '2026-12-31' });
    const tax = await addItem(c, v, { name: 'Bollo', category: 'legal', template_id: 'tpl_road_tax', schedule_type: 'interval_calendar', interval_km: null, interval_months: 12, fixed_due_on: '2026-11-30' });
    await addGenerated(c, v, tax, 'Bollo', { category: 'legal', due_on: '2026-11-30', effective_due_on: '2026-11-30' });
    const custom = await addItem(c, v, { name: 'Permesso ZTL', category: 'legal', interval_km: null, interval_months: 12 });
    await addGenerated(c, v, custom, 'Permesso ZTL', { category: 'legal', due_on: '2026-12-15', effective_due_on: '2026-12-15' });
    const oil = await addItem(c, v, { name: 'Cambio olio' });
    await addGenerated(c, v, oil, 'Cambio olio', { due_on: '2026-12-01', effective_due_on: '2026-12-01' });
    const pol = await insertRow(c.db, 'insurance_policies', policyRow(v, { kind: 'rca', end_on: '2026-11-20' }));
    await insertRow(c.db, 'reminders', reminderRow(v, { origin: 'generated', policy_id: pol, title: 'Assicurazione RCA', category: 'insurance', due_on: '2026-11-20', effective_due_on: '2026-11-20' }));

    const rows = (await getDashboard(c.deps)).todo;
    const of = (t: string) => rows.find((x) => x.title === t)!;
    const insp1 = of('Revisione').legal!;
    expect(insp1.ruleId).toBe('it.inspection.next');
    expect(insp1.sources.length).toBeGreaterThan(0);
    expect(insp1.sources[0]!.url).toMatch(/^https:\/\//);
    expect(insp1.warning.length).toBeGreaterThan(10);
    expect(insp1.verifiedOn).toBe('2026-10-07');
    expect(of('Bollo').legal!.ruleId).toBe('it.road_tax.renewal');
    expect(of('Assicurazione RCA').legal!.ruleId).toBe('it.rca.expiry_printed');
    // voce di legge personalizzata: solo l'avvertenza generica
    expect(of('Permesso ZTL').legal).toMatchObject({ ruleId: null, sources: [] });
    expect(of('Permesso ZTL').legal!.warning).toContain('non consulenza legale');
    expect(of('Cambio olio').legal).toBeNull();
    expect(of('Assicurazione RCA')).toMatchObject({ origin: 'policy', policyId: pol });
  });
});

describe('getDashboard: banner e stato delle notifiche', () => {
  const kmCase = async (c: Ctx, lastReading: string, lastKm: number): Promise<string> => {
    const v = await addVehicle(c);
    await addReading(c, v, '2026-06-01', 24000);
    await addReading(c, v, lastReading, lastKm);
    await addManual(c, v, 'Tagliando', null, { due_km: 27500 });
    return v;
  };

  it('"Aggiorna i km": ultima lettura oltre 30 giorni e scadenza a km prevista entro 90', async () => {
    const c = await setup();
    const v = await kmCase(c, '2026-08-20', 26000);
    const dash = await getDashboard(c.deps);
    const b = dash.banners.find((x) => x.kind === 'update-km')!;
    expect(b).toMatchObject({ kind: 'update-km', vehicleId: v, action: { id: 'update-odometer', label: 'Aggiorna i km' } });
    expect(b.message).toContain('20/08/2026');
    expect(b.message).toContain('49 giorni fa');
  });

  it('nessun banner km se la lettura e\' recente', async () => {
    const c = await setup();
    await kmCase(c, '2026-10-05', 26000);
    expect((await getDashboard(c.deps)).banners.some((x) => x.kind === 'update-km')).toBe(false);
  });

  it('nessun banner km se la scadenza a km e\' oltre 90 giorni', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    await addReading(c, v, '2026-06-01', 24000);
    await addReading(c, v, '2026-08-20', 26000);
    await addManual(c, v, 'Cinghia', null, { due_km: 60000 });
    expect((await getDashboard(c.deps)).banners.some((x) => x.kind === 'update-km')).toBe(false);
  });

  it('senza nessuna lettura ma con una scadenza a km: chiede i km', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    await addManual(c, v, 'Tagliando', null, { due_km: 30000 });
    const b = (await getDashboard(c.deps)).banners.find((x) => x.kind === 'update-km')!;
    expect(b.vehicleId).toBe(v);
    expect(b.message).toContain('Inserisci i km di Panda');
  });

  it.each([
    ['undetermined', 'enable-notifications', 'Attiva gli avvisi'],
    ['denied', 'retry-notifications', 'Riprova'],
    ['blocked', 'open-system-settings', 'Apri impostazioni'],
  ] as const)('permesso %s: banner "avvisi spenti" con azione %s', async (permission, action, label) => {
    const c = await setup();
    await addVehicle(c);
    const dash = await getDashboard(c.depsWith(new FakeScheduler(permission)));
    expect(dash.notifications).toEqual({ enabled: true, permission, active: false });
    expect(dash.banners[0]).toMatchObject({ kind: 'notifications', action: { id: action, label } });
  });

  it('permesso concesso e avvisi accesi: nessun banner; senza scheduler il permesso e\' "unknown"', async () => {
    const c = await setup();
    await addVehicle(c);
    const granted = await getDashboard(c.depsWith(new FakeScheduler('granted')));
    expect(granted.notifications).toEqual({ enabled: true, permission: 'granted', active: true });
    expect(granted.banners).toEqual([]);
    const noSched = await getDashboard(c.deps);
    expect(noSched.notifications).toEqual({ enabled: true, permission: 'unknown', active: false });
    expect(noSched.banners).toEqual([]);
  });

  it('avvisi spenti nelle impostazioni (notify.enabled = false): banner con rimando alle impostazioni', async () => {
    const c = await setup();
    await addVehicle(c);
    await setSetting(c, 'notify.enabled', false);
    const dash = await getDashboard(c.depsWith(new FakeScheduler('granted')));
    expect(dash.notifications).toEqual({ enabled: false, permission: 'granted', active: false });
    expect(dash.banners[0]).toMatchObject({ kind: 'notifications', action: { id: 'open-notification-settings' } });
  });

  it('un errore dello scheduler non rompe la dashboard', async () => {
    const c = await setup();
    await addVehicle(c);
    const s = new FakeScheduler();
    s.failOn = 'getPermission';
    expect((await getDashboard(c.depsWith(s))).notifications.permission).toBe('unknown');
  });

  it('"Fai un backup": mai fatto o oltre 30 giorni, con almeno 5 modifiche; non se recente o con poche modifiche', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    for (const [d, km] of [['2026-09-01', 1000], ['2026-09-02', 1100], ['2026-09-03', 1200], ['2026-09-04', 1300]] as const) await addReading(c, v, d, km);
    // 1 auto + 4 letture = 5 modifiche, nessun backup mai fatto
    expect((await getDashboard(c.deps)).banners.map((x) => x.kind)).toEqual(['backup']);
    expect((await getDashboard(c.deps)).banners[0]!.message).toContain('Non hai ancora un backup');

    await setSetting(c, 'backup.lastExportAt', '2026-10-01T10:00:00.000Z'); // 7 giorni fa
    expect((await getDashboard(c.deps)).banners).toEqual([]);

    await setSetting(c, 'backup.lastExportAt', '2026-08-01T10:00:00.000Z'); // 68 giorni fa
    const old = await getDashboard(c.deps);
    expect(old.banners[0]).toMatchObject({ kind: 'backup', action: { id: 'open-backup' } });
    expect(old.banners[0]!.message).toContain('01/08/2026');

    await setSetting(c, 'backup.lastExportAt', '2026-10-08T07:00:00.000Z'); // appena fatto
    expect((await getDashboard(c.deps)).banners).toEqual([]);
  });

  it('poche modifiche dall\'ultimo backup: nessun banner', async () => {
    const c = await setup();
    await addVehicle(c);
    expect((await getDashboard(c.deps)).banners).toEqual([]);
  });

  it('al massimo due banner, in ordine: avvisi, km, backup', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    await addReading(c, v, '2026-06-01', 24000);
    await addReading(c, v, '2026-08-20', 26000);
    await addManual(c, v, 'Tagliando', null, { due_km: 27500 });
    for (const [d, km] of [['2026-05-01', 20000], ['2026-05-02', 20100], ['2026-05-03', 20200]] as const) await addReading(c, v, d, km);
    const dash = await getDashboard(c.depsWith(new FakeScheduler('denied')));
    expect(dash.banners.map((x) => x.kind)).toEqual(['notifications', 'update-km']);
  });
});
