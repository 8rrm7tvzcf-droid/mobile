// getTimeline: per ora scadenze, completamenti e letture km.
import { describe, expect, it } from 'vitest';
import { getTimeline } from '@/usecases/queries';
import { insertRow } from '../../../support/db';
import { addGenerated, addItem, addManual, addReading, addVehicle, setup } from './helpers';

describe('getTimeline', () => {
  it('auto inesistente -> null', async () => {
    const c = await setup();
    expect(await getTimeline(c.deps, 'non-esiste')).toBeNull();
  });

  it('unisce letture, completamenti e scadenze aperte in ordine di data decrescente', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    await addReading(c, v, '2026-07-10', 25000);
    await addReading(c, v, '2026-10-01', 27000, { source: 'import' });
    await addReading(c, v, '2026-09-01', 99999, { status: 'ignored' }); // ignorata: non entra nella coerenza
    const item = await addItem(c, v, { name: 'Cambio olio' });
    await insertRow(c.db, 'maintenance_completions', {
      id: '01TESTCMP00000000000000001', item_id: item, done_on: '2026-03-01', done_km: 12000, source: 'manual',
      created_at: '2026-10-08T07:30:00.000Z', updated_at: '2026-10-08T07:30:00.000Z',
    });
    const rem = await addGenerated(c, v, item, 'Cambio olio', { due_on: '2026-12-15', effective_due_on: '2026-12-15', due_trigger: 'time' });
    await addItem(c, v, { name: 'Senza data' }); // da configurare: nessuna data, non compare

    const t = (await getTimeline(c.deps, v))!;
    expect(t.vehicleId).toBe(v);
    expect(t.entries.map((e) => [e.date, e.kind])).toEqual([
      ['2026-12-15', 'deadline'],
      ['2026-10-01', 'odometer'],
      ['2026-09-01', 'odometer'],
      ['2026-07-10', 'odometer'],
      ['2026-03-01', 'completion'],
    ]);
    const [deadline, last, ignored, , done] = t.entries;
    expect(deadline).toMatchObject({ id: rem, title: 'Cambio olio', upcoming: true, tone: 'ok', icon: 'check' });
    expect(deadline!.text).toBe('In regola · scade il 15/12/2026 (tra 68 giorni)');
    expect(last).toMatchObject({ title: 'Lettura km', text: '27.000 km · importata', tone: 'neutral', icon: 'gauge', ignored: false, upcoming: false });
    expect(ignored).toMatchObject({ text: '99.999 km · inserita a mano (ignorata)', ignored: true });
    expect(done).toMatchObject({ title: 'Cambio olio', text: 'Fatto a 12.000 km', icon: 'done', tone: 'ok' });
  });

  it('rispetta il limite e non mostra le scadenze di un\'auto venduta', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    for (let i = 1; i <= 5; i++) await addReading(c, v, `2026-09-0${i}`, 1000 + i);
    expect((await getTimeline(c.deps, v, { limit: 3 }))!.entries.map((e) => e.date)).toEqual(['2026-09-05', '2026-09-04', '2026-09-03']);
    const sold = await addVehicle(c, { status: 'sold', sold_on: '2026-09-01' });
    await addManual(c, sold, 'Vecchia', '2026-10-10');
    expect((await getTimeline(c.deps, sold))!.entries).toEqual([]);
  });
});
