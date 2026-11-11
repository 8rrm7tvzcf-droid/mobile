// "Cosa hai fatto?" (F-36, AC-06.2/06.3, data.md 3.7): completamenti collegati all'intervento, il prossimo parte dai valori REALI,
// nessun doppione, equivalenza con "Fatto" di `completeDeadline`, annullamento esatto.
import { describe, expect, it } from 'vitest';
import { completeDeadline } from '@/usecases/deadlines';
import { addServiceRecord, deleteServiceRecord, setServiceCompletions, suggestItemsForLines } from '@/usecases/services';
import { AIR, BOLLO, CABIN, OIL, SERVICE_MAIN, addItem, addVehicle, errorOf, expectOneOpenPerItem, garage, openReminders, rows, unwrap, visible } from './helpers';

const TAGLIANDO = { serviceOn: '2026-10-05', kind: 'scheduled' as const, title: 'Tagliando', km: 26000, totalCents: 21000 };

describe('addServiceRecord + "Cosa hai fatto?"', () => {
  it('AC-06.2: crea un completamento per voce, chiude il promemoria e il prossimo parte da data e km REALI', async () => {
    const { env, v, items } = await garage({ oil: OIL });
    const [old] = await openReminders(env.db, v);
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...TAGLIANDO, completeItemIds: [items.oil!] })); // fatto a 26.000, non ai 27.000 teorici

    expect(r.completions).toHaveLength(1);
    expect(r.completions[0]).toMatchObject({ itemId: items.oil, templateId: 'tpl_oil_change', doneOn: '2026-10-05', doneKm: 26000, isNew: true });
    expect(r.completions[0]!.next).toMatchObject({ state: 'ok', effectiveDueOn: expect.any(String) });
    // il testo del prossimo cambio olio dice "il primo dei due"
    expect(r.completions[0]!.nextText).toBe('Prossimo cambio olio motore e filtro: tra 15.000 km o il 05/10/2027, il primo dei due.');
    expect(r.record.completions).toEqual(r.completions);

    const [c] = await rows(env.db, 'SELECT * FROM maintenance_completions');
    expect(c).toMatchObject({
      id: r.completions[0]!.completionId, item_id: items.oil, done_on: '2026-10-05', done_km: 26000, prev_fixed_due_on: null,
      source: 'service', service_record_id: r.record.id, fluid_check_id: null, deleted_at: null,
    });
    const closed = (await rows(env.db, 'SELECT * FROM reminders WHERE id = ?', [old!['id'] as string]))[0]!;
    expect(closed).toMatchObject({ status: 'done', completed_on: '2026-10-05', completion_id: c!['id'] });
    const open = await openReminders(env.db, v);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ item_id: items.oil, due_on: '2027-10-05', due_km: 41000 }); // 26.000 + 15.000
    await expectOneOpenPerItem(env.db, v);
    // niente lettura "Fatto: ..." in piu': i km dell'intervento sono UNA lettura, quella collegata
    expect(await rows(env.db, `SELECT source, km FROM odometer_readings WHERE read_on = '2026-10-05'`)).toEqual([{ source: 'service', km: 26000 }]);
    expect(env.events.map((e) => (e as { scope: string }).scope).sort()).toEqual(['odometer', 'reminders', 'service']);
  });

  it('un tagliando che completa piu voci (tagliando + olio + filtro abitacolo): un completamento per voce, nessun doppione', async () => {
    const { env, v, items } = await garage({ main: SERVICE_MAIN, oil: OIL, cabin: CABIN, air: AIR });
    const r = unwrap(
      await addServiceRecord(env.deps, { vehicleId: v, ...TAGLIANDO, completeItemIds: [items.main!, items.oil!, items.cabin!, items.oil!] }), // id ripetuto
    );
    expect(r.completions.map((c) => c.templateId).sort()).toEqual(['tpl_cabin_filter', 'tpl_oil_change', 'tpl_service_main']);
    const comps = await rows(env.db, 'SELECT item_id, service_record_id FROM maintenance_completions WHERE deleted_at IS NULL');
    expect(comps).toHaveLength(3);
    expect(new Set(comps.map((c) => c['item_id'])).size).toBe(3);
    // il filtro aria non e stato toccato
    const air = await rows(env.db, 'SELECT id FROM maintenance_completions WHERE item_id = ?', [items.air!]);
    expect(air).toEqual([]);
    // costo: una riga sola in v_costs
    expect(await rows(env.db, `SELECT cents FROM v_costs WHERE source = 'service'`)).toEqual([{ cents: 21000 }]);
    await expectOneOpenPerItem(env.db, v);
  });

  it('le voci indicate riga per riga si uniscono a quelle scelte, senza doppioni', async () => {
    const { env, v, items } = await garage({ oil: OIL, cabin: CABIN });
    const r = unwrap(
      await addServiceRecord(env.deps, {
        vehicleId: v, ...TAGLIANDO, completeItemIds: [items.oil!],
        lines: [
          { lineType: 'fluid', fluidKind: 'engine_oil', description: 'Olio motore', completesItemIds: [items.oil!] },
          { lineType: 'part', description: 'Filtro abitacolo', completesItemIds: [items.cabin!, items.oil!] },
        ],
      }),
    );
    expect(r.completions.map((c) => c.itemId).sort()).toEqual([items.cabin, items.oil].sort());
    expect(await rows(env.db, 'SELECT id FROM maintenance_completions')).toHaveLength(2);
  });

  it("completeItemIds: 'suggested' usa le voci pre-selezionate dalle righe (olio e filtro -> cambio olio; filtro abitacolo)", async () => {
    const { env, v, items } = await garage({ main: SERVICE_MAIN, oil: OIL, cabin: CABIN, air: AIR });
    const r = unwrap(
      await addServiceRecord(env.deps, {
        vehicleId: v, ...TAGLIANDO, completeItemIds: 'suggested',
        lines: [
          { lineType: 'fluid', fluidKind: 'engine_oil', description: 'Olio motore 5W-30' },
          { lineType: 'part', description: 'Filtro olio' },
          { lineType: 'part', description: 'Filtro abitacolo' },
        ],
      }),
    );
    expect(r.completions.map((c) => c.templateId).sort()).toEqual(['tpl_cabin_filter', 'tpl_oil_change', 'tpl_service_main']);
    expect(r.completions.some((c) => c.itemId === items.air)).toBe(false);
  });

  it('AC-06.3: un intervento con olio incluso nel tagliando non crea doppioni: stesso giorno, la voce non e preselezionata due volte', async () => {
    const { env, v, items } = await garage({ main: SERVICE_MAIN, oil: OIL });
    unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...TAGLIANDO, completeItemIds: [items.main!, items.oil!] }));
    // l'utente registra anche "Cambio olio" lo stesso giorno: la voce risulta gia' fatta
    const sug = await suggestItemsForLines(env.deps, v, [{ lineType: 'fluid', fluidKind: 'engine_oil', description: 'Olio motore' }], {
      kind: 'scheduled', title: 'Cambio olio e filtri', serviceOn: '2026-10-05',
    });
    const oil = sug.find((s) => s.itemId === items.oil)!;
    expect(oil).toMatchObject({ matched: true, preselected: false, alreadyDoneOn: '2026-10-05' });
    expect(oil.reason).toContain('niente doppione');

    const second = unwrap(
      await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-10-05', kind: 'scheduled', title: 'Cambio olio e filtri', totalCents: 0, completeItemIds: 'suggested', lines: [{ lineType: 'fluid', fluidKind: 'engine_oil', description: 'Olio motore' }] }),
    );
    expect(second.completions).toEqual([]); // con 'suggested' la voce gia' fatta non si ricompleta
    expect(await rows(env.db, 'SELECT id FROM maintenance_completions WHERE deleted_at IS NULL')).toHaveLength(2);

    // se la si sceglie comunque a mano, parte un avviso (non un blocco)
    const forced = unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-10-05', kind: 'scheduled', title: 'Olio', completeItemIds: [items.oil!] }));
    expect(forced.warnings.map((w) => w.code)).toEqual(['DUPLICATE_COMPLETION']);
  });

  it('un intervento retrodatato (piu vecchio dell ultimo fatto) si registra ma non cambia base ne promemoria', async () => {
    const { env, v, items } = await garage({ oil: OIL });
    unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...TAGLIANDO, completeItemIds: [items.oil!] })); // fatto il 5-10 a 26.000
    const [before] = await openReminders(env.db, v);
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-09-01', kind: 'scheduled', title: 'Olio', km: 20000, completeItemIds: [items.oil!] }));
    expect(r.completions).toHaveLength(1);
    const after = await openReminders(env.db, v);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: before!['id'], due_on: '2027-10-05', due_km: 41000 });
  });

  it('senza km: nessuna lettura, done_km nullo, resta la scadenza a tempo', async () => {
    const { env, v, items } = await garage({ oil: OIL });
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-10-05', kind: 'scheduled', title: 'Olio', completeItemIds: [items.oil!] }));
    expect(r.completions[0]).toMatchObject({ doneKm: null });
    expect(r.completions[0]!.nextText).toBe('Prossimo cambio olio motore e filtro: entro il 05/10/2027.');
    expect((await openReminders(env.db, v))[0]).toMatchObject({ due_on: '2027-10-05', due_km: null });
  });

  it('con km incoerenti e "Salva senza aggiornare i km" le voci si completano senza km', async () => {
    const { env, v, items } = await garage({ oil: OIL });
    const r = unwrap(
      await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-03-02', kind: 'scheduled', title: 'Olio', km: 20000, completeItemIds: [items.oil!], onOdometerConflict: 'skip_km' }),
    );
    expect(r.kmIgnored).toBe(true);
    expect(r.completions[0]!.doneKm).toBeNull();
  });

  it('voce di un altro veicolo, disattivata o inesistente: errore e niente scritto', async () => {
    const { env, v, items } = await garage({ oil: OIL, cabin: CABIN });
    const other = await addVehicle(env, { nickname: 'Altra' });
    const foreign = await addItem(env, other, OIL);
    await env.db.run('UPDATE maintenance_items SET is_active = 0 WHERE id = ?', [items.cabin!]);
    for (const id of [foreign, items.cabin!, '01TESTID000000000000009999']) {
      expect(errorOf(await addServiceRecord(env.deps, { vehicleId: v, ...TAGLIANDO, completeItemIds: [id] }))).toMatchObject({
        code: 'VALIDATION', field: 'completeItemIds',
      });
    }
    expect(await rows(env.db, 'SELECT id FROM service_records')).toEqual([]);
    expect(await rows(env.db, 'SELECT id FROM maintenance_completions')).toEqual([]);
    expect(await rows(env.db, `SELECT id FROM odometer_readings WHERE source = 'service'`)).toEqual([]);
  });
});

describe('serie di calendario e annullamento esatto', () => {
  it('bollo con scadenza 2026-08-31 completato il 2-10: prossima 2027-08-31; eliminando l intervento torna ESATTAMENTE 2026-08-31', async () => {
    const { env, v, items } = await garage({ tax: BOLLO });
    const before = await visible(env.db);
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-10-02', kind: 'other', title: 'Pagamento bollo', completeItemIds: [items.tax!] }));
    const [it] = await rows(env.db, 'SELECT fixed_due_on FROM maintenance_items WHERE id = ?', [items.tax!]);
    expect(it).toEqual({ fixed_due_on: '2027-08-31' });
    expect((await rows(env.db, 'SELECT prev_fixed_due_on FROM maintenance_completions'))[0]).toEqual({ prev_fixed_due_on: '2026-08-31' });

    unwrap(await deleteServiceRecord(env.deps, r.record.id));
    expect(await visible(env.db)).toEqual(before);
  });

  it('annulla esatto: aggiungere e poi eliminare un tagliando con piu voci riporta tutto allo stato di prima', async () => {
    const { env, v, items } = await garage({ main: SERVICE_MAIN, oil: OIL, cabin: CABIN });
    const before = await visible(env.db);
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...TAGLIANDO, completeItemIds: [items.main!, items.oil!, items.cabin!] }));
    expect(await visible(env.db)).not.toEqual(before);
    const del = unwrap(await deleteServiceRecord(env.deps, r.record.id));
    expect(del.removedCompletionIds).toHaveLength(3);
    expect(del.reopenedReminderIds).toHaveLength(3);
    expect(await visible(env.db)).toEqual(before);
    await expectOneOpenPerItem(env.db, v);
  });
});

describe('equivalenza con "Fatto" di completeDeadline (stessa logica replicata)', () => {
  const stripSource = (s: Awaited<ReturnType<typeof visible>>) => ({ ...s, odometer: s.odometer.map((o) => [o['read_on'], o['km']]) });

  const cases: [string, Record<string, unknown>, string, number | null][] = [
    ['intervallo dall ultimo fatto (olio)', OIL, '2026-10-05', 26000],
    ['intervallo senza km', OIL, '2026-10-05', null],
    ['serie di calendario (bollo)', BOLLO, '2026-10-02', null],
    ['completamento retrodatato', OIL, '2026-02-01', 11000],
    ['data fissa (bombola)', { name: 'Riqualifica bombola', template_id: 'tpl_gas_cylinder', category: 'legal', schedule_type: 'fixed_date', interval_km: null, interval_months: null, fixed_due_on: '2026-10-20', baseline_on: null, baseline_km: null, soon_km: 0 }, '2026-10-05', null],
  ];
  for (const [label, def, doneOn, doneKm] of cases) {
    it(label, async () => {
      const a = await garage({ x: def as never });
      unwrap(await completeDeadline(a.env.deps, { itemId: a.items.x!, doneOn, doneKm }));
      const b = await garage({ x: def as never });
      unwrap(await addServiceRecord(b.env.deps, { vehicleId: b.v, serviceOn: doneOn, kind: 'other', title: 'Intervento', km: doneKm, completeItemIds: [b.items.x!] }));
      expect(stripSource(await visible(b.env.db))).toEqual(stripSource(await visible(a.env.db)));
    });
  }
});

describe('setServiceCompletions: "Cosa hai fatto?" dopo il salvataggio', () => {
  it('aggiunge e toglie voci; togliere annulla ESATTAMENTE', async () => {
    const { env, v, items } = await garage({ oil: OIL, cabin: CABIN });
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...TAGLIANDO }));
    expect(r.completions).toEqual([]);
    const before = await visible(env.db);

    const set = unwrap(await setServiceCompletions(env.deps, r.record.id, [items.oil!, items.cabin!]));
    expect(set.completions.map((c) => c.itemName).sort()).toEqual(['Cambio olio motore e filtro', 'Filtro abitacolo']);
    expect(set.completions.every((c) => c.isNew && c.doneOn === '2026-10-05' && c.doneKm === 26000)).toBe(true);
    expect((await openReminders(env.db, v)).map((o) => o['due_km']).sort()).toEqual([41000, 41000]);

    const only = unwrap(await setServiceCompletions(env.deps, r.record.id, [items.oil!]));
    expect(only.removedCompletionIds).toHaveLength(1);
    expect(only.completions).toHaveLength(1);
    expect(only.completions[0]!.isNew).toBe(false); // quella rimasta non e stata toccata

    unwrap(await setServiceCompletions(env.deps, r.record.id, []));
    expect(await visible(env.db)).toEqual(before);
  });

  it('suggested e voce inesistente', async () => {
    const { env, v, items } = await garage({ oil: OIL });
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...TAGLIANDO, title: 'Cambio olio e filtri' }));
    const set = unwrap(await setServiceCompletions(env.deps, r.record.id, 'suggested'));
    expect(set.completions.map((c) => c.itemId)).toEqual([items.oil]);
    expect(errorOf(await setServiceCompletions(env.deps, r.record.id, ['01TESTID000000000000009999']))).toMatchObject({ field: 'completeItemIds' });
    expect(errorOf(await setServiceCompletions(env.deps, '01TESTID000000000000009999', []))).toEqual({ code: 'ITEM_NOT_FOUND' });
  });
});

describe('suggestItemsForLines', () => {
  it('propone le voci attive in base alle righe e al tipo, con il perche; le altre in coda non preselezionate', async () => {
    const { env, v, items } = await garage({ main: SERVICE_MAIN, oil: OIL, cabin: CABIN, air: AIR });
    const custom = await addItem(env, v, { name: 'Olio cambio automatico', template_id: null, baseline_on: null, baseline_km: null });
    const sug = await suggestItemsForLines(
      env.deps, v,
      [{ lineType: 'part', description: 'Filtro olio' }, { lineType: 'part', description: 'Filtro abitacolo' }, { lineType: 'fluid', fluidKind: 'gearbox_oil', description: 'Olio ATF' }],
      { kind: 'scheduled', title: 'Tagliando', serviceOn: '2026-10-05' },
    );
    const by = Object.fromEntries(sug.map((s) => [s.itemId, s]));
    expect(by[items.main!]).toMatchObject({ matched: true, preselected: true, reason: 'Tagliando' });
    expect(by[items.oil!]).toMatchObject({ matched: true, preselected: true, reason: 'Riga «Filtro olio»' });
    expect(by[items.cabin!]).toMatchObject({ matched: true, preselected: true });
    expect(by[items.air!]).toMatchObject({ matched: false, preselected: false, reason: null });
    expect(by[custom]).toMatchObject({ matched: true, preselected: true }); // voce personalizzata, riconosciuta dal nome
    expect(sug.slice(0, 4).every((s) => s.matched)).toBe(true);
    expect(sug[sug.length - 1]!.matched).toBe(false);
  });

  it('non propone voci eliminate o disattivate', async () => {
    const { env, v, items } = await garage({ oil: OIL, cabin: CABIN });
    await env.db.run('UPDATE maintenance_items SET is_active = 0 WHERE id = ?', [items.cabin!]);
    const sug = await suggestItemsForLines(env.deps, v, [{ lineType: 'part', description: 'Filtro abitacolo' }], { kind: 'scheduled' });
    expect(sug.map((s) => s.itemId)).toEqual([items.oil]);
  });
});

describe('sul veicolo non cambia nulla se tutto va storto', () => {
  it('un errore di km con voci scelte non lascia completamenti ne letture a meta', async () => {
    const { env, v, items } = await garage({ oil: OIL });
    const before = await visible(env.db);
    const r = await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-03-02', kind: 'scheduled', title: 'Olio', km: 20000, completeItemIds: [items.oil!] });
    expect(r.ok).toBe(false);
    expect(await visible(env.db)).toEqual(before);
    expect(await rows(env.db, 'SELECT id FROM service_records')).toEqual([]);
  });
});

