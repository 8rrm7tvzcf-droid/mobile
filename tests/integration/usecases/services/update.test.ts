// updateServiceRecord: ricalcolo dei collegamenti (annulla esatto e ricrea coi valori nuovi), lettura km collegata,
// righe, totale; niente rumore se nulla cambia.
import { describe, expect, it } from 'vitest';
import { addServiceRecord, getServiceRecord, updateServiceRecord } from '@/usecases/services';
import { isOdometerConflict } from '@/usecases/odometer';
import { CABIN, OIL, errorOf, garage, openOf, rows, unwrap, visible } from './helpers';

const TAGLIANDO = { serviceOn: '2026-10-05', kind: 'scheduled' as const, title: 'Tagliando', km: 26000, totalCents: 21000 };

async function withOil() {
  const g = await garage({ oil: OIL, cabin: CABIN });
  const r = unwrap(await addServiceRecord(g.env.deps, { vehicleId: g.v, ...TAGLIANDO, completeItemIds: [g.items.oil!] }));
  g.env.events.length = 0;
  return { ...g, r, id: r.record.id };
}

describe('updateServiceRecord: ricalcolo dei collegamenti', () => {
  it('cambiando i km il completamento si ricrea e il prossimo riparte dai km nuovi; la lettura e la stessa riga', async () => {
    const { env, items, id, r } = await withOil();
    const readingId = r.odometerReadingId;
    const u = unwrap(await updateServiceRecord(env.deps, id, { km: 25000 }));
    expect(u.record.km).toBe(25000);
    expect(u.odometerReadingId).toBe(readingId);
    expect(u.completions).toHaveLength(1);
    expect(u.completions[0]).toMatchObject({ doneKm: 25000, isNew: true });
    expect(await openOf(env.db, items.oil!)).toMatchObject({ due_km: 40000, due_on: '2027-10-05' });
    expect(await rows(env.db, 'SELECT done_km FROM maintenance_completions WHERE deleted_at IS NULL')).toEqual([{ done_km: 25000 }]);
    expect(await rows(env.db, `SELECT km FROM odometer_readings WHERE source = 'service'`)).toEqual([{ km: 25000 }]);
    expect(env.events.map((e) => (e as { scope: string }).scope).sort()).toEqual(['odometer', 'reminders', 'service']);
  });

  it('cambiando la data i completamenti ripartono dalla data nuova', async () => {
    const { env, items, id } = await withOil();
    const u = unwrap(await updateServiceRecord(env.deps, id, { serviceOn: '2026-09-20', km: 24000 }));
    expect(u.record.serviceOn).toBe('2026-09-20');
    expect(u.completions[0]).toMatchObject({ doneOn: '2026-09-20', doneKm: 24000 });
    expect(await openOf(env.db, items.oil!)).toMatchObject({ due_on: '2027-09-20', due_km: 39000 });
  });

  it('se cambiano solo titolo, note o totale i completamenti e i promemoria NON si toccano', async () => {
    const { env, v, id, r } = await withOil();
    const remindersBefore = await rows(env.db, 'SELECT id, status, completion_id, updated_at FROM reminders ORDER BY id');
    const u = unwrap(await updateServiceRecord(env.deps, id, { title: 'Tagliando completo', notes: 'ok', totalCents: 23000 }));
    expect(u.record).toMatchObject({ title: 'Tagliando completo', notes: 'ok', totalCents: 23000, km: 26000 });
    expect(u.completions).toHaveLength(1);
    expect(u.completions[0]).toMatchObject({ completionId: r.completions[0]!.completionId, isNew: false });
    expect(await rows(env.db, 'SELECT id, status, completion_id, updated_at FROM reminders ORDER BY id')).toEqual(remindersBefore);
    expect(await rows(env.db, 'SELECT id FROM maintenance_completions')).toHaveLength(1); // nessun annullato in piu'
    expect(env.events.map((e) => (e as { scope: string }).scope)).toEqual(['service']);
    await expect(rows(env.db, 'SELECT cents FROM v_costs WHERE vehicle_id = ?', [v])).resolves.toEqual([{ cents: 23000 }]);
  });

  it('sostituire le voci: la vecchia si annulla ESATTAMENTE, la nuova si completa', async () => {
    const { env, id, items } = await withOil();
    const initial = await visible(env.db);
    const u = unwrap(await updateServiceRecord(env.deps, id, { completeItemIds: [items.cabin!] }));
    expect(u.completions.map((c) => c.itemId)).toEqual([items.cabin]);
    expect(await openOf(env.db, items.oil!)).toMatchObject({ due_on: '2027-03-01', due_km: 27000 }); // l'olio e' tornato com'era prima
    expect(await openOf(env.db, items.cabin!)).toMatchObject({ due_km: 41000 });
    // e rimettendo l'olio si torna alla situazione iniziale
    unwrap(await updateServiceRecord(env.deps, id, { completeItemIds: [items.oil!] }));
    expect(await visible(env.db)).toEqual(initial);
  });

  it('completeItemIds vuoto toglie tutte le voci', async () => {
    const { env, id } = await withOil();
    const u = unwrap(await updateServiceRecord(env.deps, id, { completeItemIds: [] }));
    expect(u.completions).toEqual([]);
    expect(await rows(env.db, 'SELECT id FROM maintenance_completions WHERE deleted_at IS NULL')).toEqual([]);
  });
});

describe('updateServiceRecord: lettura km collegata', () => {
  it('km nullo toglie la lettura (cestino) e i completamenti perdono i km; reinserirli riusa la stessa riga', async () => {
    const { env, id, r } = await withOil();
    const none = unwrap(await updateServiceRecord(env.deps, id, { km: null }));
    expect(none.record.km).toBeNull();
    expect(none.odometerReadingId).toBeNull();
    expect(none.completions[0]!.doneKm).toBeNull();
    const [tomb] = await rows(env.db, 'SELECT id, deleted_at FROM odometer_readings WHERE service_record_id = ?', [id]);
    expect(tomb!['deleted_at']).not.toBeNull();

    const again = unwrap(await updateServiceRecord(env.deps, id, { km: 26500 }));
    expect(again.record.km).toBe(26500);
    expect(again.odometerReadingId).toBe(r.odometerReadingId); // indice unico su service_record_id: la riga si riattiva
    expect(await rows(env.db, 'SELECT km, deleted_at, status FROM odometer_readings WHERE service_record_id = ?', [id])).toEqual([{ km: 26500, deleted_at: null, status: 'valid' }]);
  });

  it('aggiungere i km a un intervento che non li aveva crea la lettura', async () => {
    const { env, v } = await garage({});
    const a = unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-10-05', kind: 'repair', title: 'Freni' }));
    const u = unwrap(await updateServiceRecord(env.deps, a.record.id, { km: 26000 }));
    expect(u.record.km).toBe(26000);
    expect(await rows(env.db, `SELECT km, source FROM odometer_readings WHERE service_record_id = ?`, [a.record.id])).toEqual([{ km: 26000, source: 'service' }]);
  });

  it('km incoerenti: errore con i dettagli e NIENTE cambiato; le tre scelte funzionano come all aggiunta', async () => {
    const { env, id } = await withOil();
    const before = await visible(env.db);
    const r = await updateServiceRecord(env.deps, id, { km: 9000, title: 'Nuovo titolo' }); // 9.000 < 10.000 del 1-1
    expect(r.ok).toBe(false);
    if (!r.ok) expect(isOdometerConflict(r.error)).toBe(true);
    expect(await visible(env.db)).toEqual(before);
    expect((await getServiceRecord(env.deps, id))!.title).toBe('Tagliando');

    const skip = unwrap(await updateServiceRecord(env.deps, id, { km: 9000, title: 'Salvato', onOdometerConflict: 'skip_km' }));
    expect(skip).toMatchObject({ kmIgnored: true });
    expect(skip.record).toMatchObject({ title: 'Salvato', km: 26000 }); // il registro km non e' stato toccato
    expect(skip.completions[0]!.isNew).toBe(false);

    const ign = unwrap(await updateServiceRecord(env.deps, id, { serviceOn: '2026-02-01', km: 9000, onOdometerConflict: 'ignore_conflicting' }));
    expect(ign.record).toMatchObject({ serviceOn: '2026-02-01', km: 9000 });
    expect(ign.ignoredReadingIds.length).toBeGreaterThan(0);
  });
});

describe('updateServiceRecord: righe, officina, errori', () => {
  it('lines sostituisce tutte le righe; oilChange da solo aggiunge alle righe esistenti', async () => {
    const { env, id } = await withOil();
    unwrap(await updateServiceRecord(env.deps, id, { lines: [{ lineType: 'labor', description: 'Manodopera', amountCents: 6500 }] }));
    expect((await getServiceRecord(env.deps, id))!.lines.map((l) => l.description)).toEqual(['Manodopera']);
    const u = unwrap(await updateServiceRecord(env.deps, id, { oilChange: { spec: '5W-30', quantityMilli: 4000, filterReplaced: true } }));
    expect(u.record.lines.map((l) => l.description)).toEqual(['Manodopera', 'Olio motore 5W-30', 'Filtro olio']);
    expect(u.record.oilChange).toMatchObject({ spec: '5W-30', quantityMilli: 4000, filterReplaced: true });
    expect(await rows(env.db, 'SELECT position FROM service_lines WHERE service_record_id = ? ORDER BY position', [id])).toEqual([{ position: 0 }, { position: 1 }, { position: 2 }]);
  });

  it('officina nuova, officina esistente e officina tolta', async () => {
    const { env, id } = await withOil();
    const a = unwrap(await updateServiceRecord(env.deps, id, { newWorkshop: { name: 'Officina Bianchi' } }));
    expect(a.record.workshop?.name).toBe('Officina Bianchi');
    const b = unwrap(await updateServiceRecord(env.deps, id, { workshopId: null }));
    expect(b.record.workshop).toBeNull();
    expect(errorOf(await updateServiceRecord(env.deps, id, { workshopId: '01TESTID000000000000009999' }))).toMatchObject({ field: 'workshopId' });
  });

  it('errori: intervento inesistente, nel cestino, data futura, campi non validi', async () => {
    const { env, id } = await withOil();
    expect(errorOf(await updateServiceRecord(env.deps, '01TESTID000000000000009999', { title: 'x' }))).toEqual({ code: 'ITEM_NOT_FOUND' });
    expect(errorOf(await updateServiceRecord(env.deps, id, { serviceOn: '2026-10-09' }))).toEqual({ code: 'FUTURE_DATE' });
    expect(errorOf(await updateServiceRecord(env.deps, id, { totalCents: 1.5 }))).toMatchObject({ field: 'totalCents' });
    expect(errorOf(await updateServiceRecord(env.deps, id, { completeItemIds: ['01TESTID000000000000009999'] }))).toMatchObject({ field: 'completeItemIds' });
    await env.db.run('UPDATE service_records SET deleted_at = ? WHERE id = ?', ['2026-10-08T07:30:00.000Z', id]);
    expect(errorOf(await updateServiceRecord(env.deps, id, { title: 'x' }))).toEqual({ code: 'ITEM_NOT_FOUND' });
  });
});
