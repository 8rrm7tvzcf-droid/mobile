// getVehicleDeadlines (S-30) e getDeadlineDetail (S-31).
import { describe, expect, it } from 'vitest';
import { getDeadlineDetail, getVehicleDeadlines } from '@/usecases/queries';
import { insertRow, policyRow, reminderRow } from '../../../support/db';
import { addGenerated, addItem, addManual, addReading, addVehicle, setup } from './helpers';
import type { Ctx } from './helpers';

const addCompletion = (c: Ctx, itemId: string, doneOn: string, doneKm: number | null, o: Record<string, string | number | null> = {}): Promise<string> =>
  insertRow(c.db, 'maintenance_completions', {
    id: `01TESTCMP${doneOn.replace(/-/g, '')}${String(doneKm ?? 0).padStart(5, '0')}`.slice(0, 26).padEnd(26, '0'),
    item_id: itemId, done_on: doneOn, done_km: doneKm, source: 'manual',
    created_at: '2026-10-08T07:30:00.000Z', updated_at: '2026-10-08T07:30:00.000Z', ...o,
  });

describe('getVehicleDeadlines', () => {
  it('auto inesistente o nel cestino -> null', async () => {
    const c = await setup();
    expect(await getVehicleDeadlines(c.deps, 'non-esiste')).toBeNull();
    const trash = await addVehicle(c, { deleted_at: '2026-09-01T10:00:00.000Z' });
    expect(await getVehicleDeadlines(c.deps, trash)).toBeNull();
  });

  it('elenco per stato con conteggi e riepilogo dell\'auto', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    const other = await addVehicle(c, { nickname: 'Altra' });
    await addManual(c, v, 'Scaduta', '2026-10-01');
    await addManual(c, v, 'In arrivo', '2026-10-20');
    await addManual(c, v, 'In regola', '2027-06-01');
    await addItem(c, v, { name: 'Da configurare' });
    await addManual(c, other, 'Di un\'altra auto', '2026-10-01');
    const d = (await getVehicleDeadlines(c.deps, v))!;
    expect(d.vehicle.label).toBe('Panda');
    expect(d.counts).toEqual({ overdue: 1, soon: 1, ok: 1, unknown: 1, total: 4 });
    expect(d.rows.map((r) => r.title)).toEqual(['Scaduta', 'In arrivo', 'In regola', 'Da configurare']);
    expect(d.groups.unknown[0]!.kind).toBe('item');
    expect(d.vehicle.tone).toBe('danger');
  });

  it('auto venduta: i promemoria si fermano (nessuna riga)', async () => {
    const c = await setup();
    const v = await addVehicle(c, { status: 'sold', sold_on: '2026-09-01' });
    await addManual(c, v, 'Vecchia scadenza', '2026-10-01');
    const d = (await getVehicleDeadlines(c.deps, v))!;
    expect(d.vehicle.status).toBe('sold');
    expect(d.rows).toEqual([]);
    expect(d.counts.total).toBe(0);
  });
});

describe('getDeadlineDetail', () => {
  it('id sconosciuto, promemoria chiuso, cancellato o di un\'auto venduta -> ITEM_NOT_FOUND', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    const done = await addManual(c, v, 'Chiuso', '2026-10-10', { status: 'done', completed_on: '2026-10-01' });
    const gone = await addManual(c, v, 'Cancellato', '2026-10-10', { deleted_at: '2026-10-02T10:00:00.000Z' });
    const soldV = await addVehicle(c, { status: 'sold', sold_on: '2026-09-01' });
    const soldR = await addManual(c, soldV, 'Dell\'auto venduta', '2026-10-10');
    for (const id of ['non-esiste', done, gone, soldR]) {
      expect(await getDeadlineDetail(c.deps, id)).toEqual({ ok: false, error: { code: 'ITEM_NOT_FOUND' } });
    }
  });

  it('voce con regola, storico e previsione: regola, base di calcolo, storico dal piu\' recente', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    await addReading(c, v, '2026-03-01', 12000);
    await addReading(c, v, '2026-10-01', 15000);
    const item = await addItem(c, v, { name: 'Cambio olio', notes: 'Olio 5W-30', notify_offsets_days: '[14,3,0]' });
    await addCompletion(c, item, '2025-03-01', 10000);
    await addCompletion(c, item, '2026-03-01', 12000);
    const rem = await addGenerated(c, v, item, 'Cambio olio', {
      due_on: '2027-03-01', due_km: 27000, effective_due_on: '2027-03-01', due_trigger: 'time',
    });
    const res = await getDeadlineDetail(c.deps, rem);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const d = res.value;
    expect(d.row).toMatchObject({ id: rem, kind: 'reminder', itemId: item, origin: 'rule' });
    expect(d.rule).toMatchObject({ scheduleType: 'interval_last_done', intervalKm: 15000, intervalMonths: 12, notifyEnabled: true });
    expect(d.rule!.text).toBe('Ogni 15.000 km o 12 mesi (il primo dei due)');
    expect(d.basis).toEqual({
      source: 'completion', lastDoneOn: '2026-03-01', lastDoneKm: 12000, text: 'Ultimo intervento: 01/03/2026 a 12.000 km',
    });
    expect(d.history.map((h) => [h.doneOn, h.doneKm, h.source])).toEqual([['2026-03-01', 12000, 'manual'], ['2025-03-01', 10000, 'manual']]);
    expect(d.forecast).not.toBeNull();
    expect(d.forecast!.text).toContain('Circa 14 km al giorno');
    expect(d.forecast!.confidence).toBe('low');
    expect(d.notes).toBe('Olio 5W-30');
    expect(d.notifyOffsetsDays).toEqual([30, 7, 0]); // quelli del promemoria (cache), non della voce
  });

  it("si puo' aprire anche con l'id della voce (che ha un'occorrenza aperta)", async () => {
    const c = await setup();
    const v = await addVehicle(c);
    const item = await addItem(c, v, { name: 'Cambio olio' });
    const rem = await addGenerated(c, v, item, 'Cambio olio', { due_on: '2026-12-01', effective_due_on: '2026-12-01' });
    const res = await getDeadlineDetail(c.deps, item);
    expect(res.ok && res.value.row.id).toBe(rem);
  });

  it('voce senza occorrenza: base di calcolo = baseline, oppure "da configurare" con il motivo', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    const withBase = await addItem(c, v, { name: 'Con base', interval_km: null, interval_months: 12, baseline_on: '2025-10-20', notify_offsets_days: '[7,0]' });
    const empty = await addItem(c, v, { name: 'Senza base' });
    const a = await getDeadlineDetail(c.deps, withBase);
    expect(a.ok && a.value.basis).toMatchObject({ source: 'baseline', lastDoneOn: '2025-10-20', lastDoneKm: null, text: 'Base di calcolo: 20/10/2025' });
    expect(a.ok && a.value.row.kind).toBe('item');
    expect(a.ok && a.value.notifyOffsetsDays).toEqual([7, 0]); // senza occorrenza: quelli della voce
    expect(a.ok && a.value.rule!.text).toBe('Ogni 12 mesi');
    const b = await getDeadlineDetail(c.deps, empty);
    expect(b.ok && b.value.basis).toMatchObject({ source: 'none', text: "Indica quando l'hai fatto l'ultima volta." });
    expect(b.ok && b.value.row.state).toBe('unknown');
    expect(b.ok && b.value.history).toEqual([]);
  });

  it('descrive le regole di calendario e a data fissa', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    const cal = await addItem(c, v, {
      name: 'Bollo', category: 'legal', template_id: 'tpl_road_tax', schedule_type: 'interval_calendar', interval_km: null, interval_months: 12, fixed_due_on: '2026-11-30',
    });
    const fixed = await addItem(c, v, { name: 'Bombola', category: 'legal', schedule_type: 'fixed_date', interval_km: null, interval_months: null, fixed_due_on: '2030-05-01' });
    const none = await addItem(c, v, { name: 'Bombola 2', category: 'legal', schedule_type: 'fixed_date', interval_km: null, interval_months: null });
    const km = await addItem(c, v, { name: 'Solo km', interval_km: 20000, interval_months: null });
    const insp = await addItem(c, v, { name: 'Revisione', category: 'legal', interval_km: null, interval_months: 24, period_end: 'end_of_month', baseline_on: '2025-06-10' });
    const detail = async (id: string) => {
      const r = await getDeadlineDetail(c.deps, id);
      return r.ok ? r.value : null;
    };
    expect((await detail(cal))!.rule!.text).toBe('Ogni 12 mesi, con scadenza fissa al 30/11/2026');
    expect((await detail(cal))!.basis).toMatchObject({ source: 'fixed', text: 'Scadenza fissa al 30/11/2026' });
    expect((await detail(cal))!.row.legal!.ruleId).toBe('it.road_tax.renewal');
    expect((await detail(fixed))!.rule!.text).toBe('Scadenza fissa al 01/05/2030');
    expect((await detail(none))!.rule!.text).toBe('Scadenza fissa: inserisci la data');
    expect((await detail(none))!.basis.text).toBe('Inserisci la data di scadenza.');
    expect((await detail(km))!.rule!.text).toBe('Ogni 20.000 km');
    expect((await detail(insp))!.rule!.text).toBe('Ogni 24 mesi, entro fine mese');
    expect((await detail(insp))!.row.dueOn).toBe('2027-06-30'); // fine mese
  });

  it('promemoria manuale e di polizza: base di calcolo, note e preavvisi della cache', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    const man = await addManual(c, v, 'Gommista', '2026-10-22', { notes: 'Chiamare prima', notify_offsets_days: '[14,0]' });
    const pol = await insertRow(c.db, 'insurance_policies', policyRow(v, { end_on: '2026-11-20' }));
    const rem = await insertRow(c.db, 'reminders', reminderRow(v, { origin: 'generated', policy_id: pol, title: 'Assicurazione RCA', category: 'insurance', due_on: '2026-11-20', effective_due_on: '2026-11-20' }));
    const a = await getDeadlineDetail(c.deps, man);
    expect(a.ok && a.value).toMatchObject({
      basis: { source: 'manual', text: 'Scadenza inserita da te: 22/10/2026' }, notes: 'Chiamare prima', notifyOffsetsDays: [14, 0], rule: null, history: [], forecast: null,
    });
    const b = await getDeadlineDetail(c.deps, rem);
    expect(b.ok && b.value.basis).toMatchObject({ source: 'policy', text: 'Calcolata dalla scadenza della polizza.' });
    expect(b.ok && b.value.row.legal?.ruleId).toBe('it.rca.expiry_printed');
  });

  it('un preavviso non valido nella cache ripiega sul predefinito', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    const man = await addManual(c, v, 'X', '2026-10-22', { notify_offsets_days: '["a"]' });
    const r = await getDeadlineDetail(c.deps, man);
    expect(r.ok && r.value.notifyOffsetsDays).toEqual([30, 7, 0]);
  });

  it('auto ferma: la previsione a km spiega perche\' non c\'e\'', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    await addReading(c, v, '2026-06-01', 20000);
    await addReading(c, v, '2026-10-01', 20000);
    const id = await addManual(c, v, 'Tagliando', null, { due_km: 30000 });
    const r = await getDeadlineDetail(c.deps, id);
    expect(r.ok && r.value.forecast).toMatchObject({ confidence: 'none', text: "L'auto risulta ferma: nessuna previsione a chilometri." });
    expect(r.ok && r.value.row.state).toBe('unknown');
    expect(r.ok && r.value.row.reasons[0]!.code).toBe('RATE_TOO_LOW');
  });

  it('con una sola lettura la previsione e\' "stima iniziale"', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    await addReading(c, v, '2026-10-01', 20000);
    const id = await addManual(c, v, 'Tagliando', null, { due_km: 30000 });
    const r = await getDeadlineDetail(c.deps, id);
    expect(r.ok && r.value.forecast!.text).toBe('Circa 33 km al giorno (stima iniziale): affidabilità bassa.');
  });
});
