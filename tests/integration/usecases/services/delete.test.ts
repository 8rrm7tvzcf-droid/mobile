// deleteServiceRecord / restoreServiceRecord (AC-06.4, SPEC 6.3.6 punto 6): soft delete, completamenti annullati ESATTAMENTE nella
// stessa transazione, lettura km collegata, costi (v_costs) senza doppioni, ripristino.
import { describe, expect, it } from 'vitest';
import { addServiceRecord, deleteServiceRecord, getServiceRecord, listServiceRecords, restoreServiceRecord, updateServiceRecord } from '@/usecases/services';
import { isOdometerConflict } from '@/usecases/odometer';
import { CABIN, OIL, SERVICE_MAIN, errorOf, expectOneOpenPerItem, garage, openOf, rows, unwrap, visible } from './helpers';

const TAGLIANDO = { serviceOn: '2026-10-05', kind: 'scheduled' as const, title: 'Tagliando', km: 26000, totalCents: 21000 };

async function withService() {
  const g = await garage({ main: SERVICE_MAIN, oil: OIL, cabin: CABIN });
  const before = await visible(g.env.db);
  const r = unwrap(
    await addServiceRecord(g.env.deps, {
      vehicleId: g.v, ...TAGLIANDO, completeItemIds: [g.items.main!, g.items.oil!],
      lines: [{ lineType: 'labor', description: 'Manodopera', amountCents: 21000 }],
    }),
  );
  const after = await visible(g.env.db);
  g.env.events.length = 0;
  return { ...g, r, id: r.record.id, before, after };
}

describe('deleteServiceRecord (AC-06.4)', () => {
  it('soft delete: record, lettura km e completamenti nel cestino; i promemoria si riaprono nella stessa transazione', async () => {
    const { env, v, id, items, before } = await withService();
    const del = unwrap(await deleteServiceRecord(env.deps, id));
    expect(del.removedCompletionIds).toHaveLength(2);
    expect(del.reopenedReminderIds).toHaveLength(2);
    expect(del.removedReadingId).not.toBeNull();

    const [rec] = await rows(env.db, 'SELECT deleted_at FROM service_records WHERE id = ?', [id]);
    expect(rec!['deleted_at']).not.toBeNull();
    expect(await rows(env.db, 'SELECT id FROM maintenance_completions WHERE deleted_at IS NULL')).toEqual([]);
    expect(await rows(env.db, `SELECT id FROM odometer_readings WHERE service_record_id = ? AND deleted_at IS NULL`, [id])).toEqual([]);
    // le righe restano (servono al ripristino) ma l'intervento non compare piu' da nessuna parte
    expect(await rows(env.db, 'SELECT id FROM service_lines WHERE service_record_id = ?', [id])).toHaveLength(1);
    expect(await getServiceRecord(env.deps, id)).toBeNull();
    expect(await listServiceRecords(env.deps, v)).toEqual([]);
    expect(await rows(env.db, `SELECT cents FROM v_costs WHERE vehicle_id = ? AND source = 'service'`, [v])).toEqual([]);
    expect(await openOf(env.db, items.oil!)).toMatchObject({ due_on: '2027-03-01', due_km: 27000 });
    expect(await visible(env.db)).toEqual(before);
    expect(env.events.map((e) => (e as { scope: string }).scope).sort()).toEqual(['odometer', 'reminders', 'service']);
    await expectOneOpenPerItem(env.db, v);
  });

  it('con includeDeleted il dettaglio si legge anche dal cestino', async () => {
    const { env, id } = await withService();
    unwrap(await deleteServiceRecord(env.deps, id));
    const d = await getServiceRecord(env.deps, id, { includeDeleted: true });
    expect(d).toMatchObject({ id, title: 'Tagliando', km: null });
    expect(d!.deletedAt).not.toBeNull();
  });

  it('eliminare due volte o un id inesistente: ITEM_NOT_FOUND', async () => {
    const { env, id } = await withService();
    unwrap(await deleteServiceRecord(env.deps, id));
    expect(errorOf(await deleteServiceRecord(env.deps, id))).toEqual({ code: 'ITEM_NOT_FOUND' });
    expect(errorOf(await deleteServiceRecord(env.deps, '01TESTID000000000000009999'))).toEqual({ code: 'ITEM_NOT_FOUND' });
  });

  it('un intervento senza voci ne km si elimina senza toccare promemoria e registro km', async () => {
    const { env, v } = await garage({ oil: OIL });
    const a = unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-10-05', kind: 'repair', title: 'Freni', totalCents: 8000 }));
    const before = await visible(env.db);
    const del = unwrap(await deleteServiceRecord(env.deps, a.record.id));
    expect(del).toEqual({ removedCompletionIds: [], reopenedReminderIds: [], removedReadingId: null });
    expect(await visible(env.db)).toEqual(before);
  });

  it('se la voce nel frattempo e stata eliminata l intervento si elimina comunque', async () => {
    const { env, id, items } = await withService();
    await env.db.run('UPDATE maintenance_items SET deleted_at = ? WHERE id = ?', ['2026-10-08T07:30:00.000Z', items.oil!]);
    const del = unwrap(await deleteServiceRecord(env.deps, id));
    expect(del.removedCompletionIds).toHaveLength(2);
    expect(await rows(env.db, 'SELECT id FROM maintenance_completions WHERE deleted_at IS NULL')).toEqual([]);
  });

  it('eliminare un intervento che NON e l ultimo fatto non sposta il prossimo (resta quello dell intervento piu recente)', async () => {
    const { env, v, items } = await garage({ oil: OIL });
    const a = unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-09-01', kind: 'scheduled', title: 'Olio', km: 20000, completeItemIds: [items.oil!] }));
    unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-10-05', kind: 'scheduled', title: 'Olio', km: 26000, completeItemIds: [items.oil!] }));
    const open = await openOf(env.db, items.oil!);
    unwrap(await deleteServiceRecord(env.deps, a.record.id));
    expect(await openOf(env.db, items.oil!)).toMatchObject({ id: open['id'], due_on: '2027-10-05', due_km: 41000 });
    await expectOneOpenPerItem(env.db, v);
  });
});

describe('restoreServiceRecord', () => {
  it('riporta record, lettura km, completamenti e promemoria com erano dopo l aggiunta', async () => {
    const { env, v, id, after } = await withService();
    unwrap(await deleteServiceRecord(env.deps, id));
    env.events.length = 0;
    const res = unwrap(await restoreServiceRecord(env.deps, id));
    expect(res.record).toMatchObject({ id, title: 'Tagliando', km: 26000, deletedAt: null, totalCents: 21000 });
    expect(res.completions.map((c) => c.templateId).sort()).toEqual(['tpl_oil_change', 'tpl_service_main']);
    expect(res.completions.every((c) => c.isNew && c.doneKm === 26000)).toBe(true);
    expect(res.skippedItemIds).toEqual([]);
    expect(await visible(env.db)).toEqual(after);
    expect(await rows(env.db, `SELECT cents FROM v_costs WHERE vehicle_id = ? AND source = 'service'`, [v])).toEqual([{ cents: 21000 }]);
    expect(await listServiceRecords(env.deps, v)).toHaveLength(1);
    expect(env.events.map((e) => (e as { scope: string }).scope).sort()).toEqual(['odometer', 'reminders', 'service']);
    // eliminare di nuovo funziona (i vecchi completamenti annullati non danno fastidio)
    unwrap(await deleteServiceRecord(env.deps, id));
    expect(await rows(env.db, 'SELECT id FROM maintenance_completions WHERE deleted_at IS NULL')).toEqual([]);
  });

  it('ripristinare cio che non e nel cestino: ITEM_NOT_FOUND', async () => {
    const { env, id } = await withService();
    expect(errorOf(await restoreServiceRecord(env.deps, id))).toEqual({ code: 'ITEM_NOT_FOUND' });
    expect(errorOf(await restoreServiceRecord(env.deps, '01TESTID000000000000009999'))).toEqual({ code: 'ITEM_NOT_FOUND' });
  });

  it('una voce eliminata nel frattempo non si ricompleta (skippedItemIds)', async () => {
    const { env, id, items } = await withService();
    unwrap(await deleteServiceRecord(env.deps, id));
    await env.db.run('UPDATE maintenance_items SET is_active = 0 WHERE id = ?', [items.oil!]);
    const res = unwrap(await restoreServiceRecord(env.deps, id));
    expect(res.skippedItemIds).toEqual([items.oil]);
    expect(res.completions.map((c) => c.templateId)).toEqual(['tpl_service_main']);
  });

  it('km nel frattempo incoerenti: "fail" non ripristina nulla; "skip_km" ripristina senza km; "ignore_conflicting" ignora la lettura in conflitto', async () => {
    const { env, v, id } = await withService();
    unwrap(await deleteServiceRecord(env.deps, id));
    await env.db.run(
      `INSERT INTO odometer_readings (id, vehicle_id, read_on, km, source, status) VALUES ('01TESTID000000000000008888', ?, '2026-10-06', 25000, 'manual', 'valid')`,
      [v],
    );
    const failed = await restoreServiceRecord(env.deps, id);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(isOdometerConflict(failed.error)).toBe(true);
    expect(await getServiceRecord(env.deps, id)).toBeNull(); // ancora nel cestino
    expect(await rows(env.db, 'SELECT id FROM maintenance_completions WHERE deleted_at IS NULL')).toEqual([]);

    const skip = unwrap(await restoreServiceRecord(env.deps, id, { onOdometerConflict: 'skip_km' }));
    expect(skip.kmIgnored).toBe(true);
    expect(skip.record.km).toBeNull();
    expect(skip.completions.every((c) => c.doneKm === null)).toBe(true);

    unwrap(await deleteServiceRecord(env.deps, id));
    const ign = unwrap(await restoreServiceRecord(env.deps, id, { onOdometerConflict: 'ignore_conflicting' }));
    expect(ign.record.km).toBe(26000);
    expect(await rows(env.db, `SELECT status FROM odometer_readings WHERE id = '01TESTID000000000000008888'`)).toEqual([{ status: 'ignored' }]);
  });

  it('se i km erano stati tolti prima dell eliminazione, il ripristino non li reinventa', async () => {
    const { env, v } = await garage({});
    const a = unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-10-05', kind: 'repair', title: 'Freni', km: 26000 }));
    unwrap(await updateServiceRecord(env.deps, a.record.id, { km: null }));
    env.clock.set('2026-10-08T08:00:00.000Z'); // istanti diversi, come nella realta': il cestino della lettura e dell'intervento si distinguono
    unwrap(await deleteServiceRecord(env.deps, a.record.id));
    const res = unwrap(await restoreServiceRecord(env.deps, a.record.id));
    expect(res.record.km).toBeNull();
    expect(res.restoredReadingId).toBeNull();
  });
});

describe('costi senza doppioni (AC-06, AC-07.6, v_costs)', () => {
  it('piu interventi: ogni costo una volta; modifica del totale, eliminazione e ripristino si riflettono in v_costs', async () => {
    const { env, v } = await garage({});
    const a = unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-10-05', kind: 'scheduled', title: 'Tagliando', km: 26000, totalCents: 21000, lines: [{ lineType: 'labor', description: 'M', amountCents: 21000 }] }));
    const b = unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-10-06', kind: 'repair', title: 'Freni', totalCents: 9050 }));
    const costs = async () => rows(env.db, `SELECT source_id, cents FROM v_costs WHERE vehicle_id = ? AND source = 'service' ORDER BY cents`, [v]);
    expect(await costs()).toEqual([{ source_id: b.record.id, cents: 9050 }, { source_id: a.record.id, cents: 21000 }]);
    unwrap(await updateServiceRecord(env.deps, a.record.id, { totalCents: 22000 }));
    expect((await costs()).map((c) => c.cents)).toEqual([9050, 22000]);
    unwrap(await deleteServiceRecord(env.deps, b.record.id));
    expect((await costs()).map((c) => c.cents)).toEqual([22000]);
    unwrap(await restoreServiceRecord(env.deps, b.record.id));
    expect((await costs()).map((c) => c.cents)).toEqual([9050, 22000]);
  });
});
