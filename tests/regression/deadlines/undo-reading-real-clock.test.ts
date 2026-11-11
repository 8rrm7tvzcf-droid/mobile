// Prova di riproduzione: l'"Annulla" di un "Fatto" con km deve togliere la lettura creata dal "Fatto".
// Con un orologio REALE (i millisecondi avanzano fra una chiamata e l'altra) la lettura non si ritrova perche'
// `undoCompletionInTx` la cerca con `created_at = completion.created_at`, ma i due istanti vengono letti da
// `clock.nowIso()` in momenti diversi (complete.ts riga ~107 e registerKm in reminders.ts riga ~144).
import { describe, expect, it } from 'vitest';
import { completeDeadline, reconcileVehicle, undoCompletion, updateDeadlineRule } from '@/usecases/deadlines';
import { addItem, addOdo, addVehicle, rows, unwrap } from '../../integration/usecases/deadlines/helpers';
import { makeEnv } from '../../integration/usecases/deadlines/helpers';

/** Orologio che avanza di 1 ms a ogni lettura dell'istante (come l'orologio vero, che non e' mai fermo). */
function tickEnv(env: Awaited<ReturnType<typeof makeEnv>>) {
  let t = Date.parse('2026-10-08T07:30:00.000Z');
  const c = env.clock;
  c.nowIso = () => new Date(t++).toISOString();
  c.todayLocal = () => '2026-10-08';
  c.nowLocal = () => ({ date: '2026-10-08', time: '07:30' });
}

describe('annulla esatto con orologio reale', () => {
  it('dopo Fatto + Annulla la lettura km creata dal Fatto non deve restare', async () => {
    const env = await makeEnv();
    tickEnv(env);
    const v = await addVehicle(env, { nickname: 'Panda' });
    await addOdo(env, v, '2026-06-01', 15000);
    const item = await addItem(env, v, { name: 'Cambio olio', baseline_on: '2026-03-01', baseline_km: 12000, interval_km: 15000, interval_months: 12 });
    await reconcileVehicle(env.deps, v);

    const before = await rows(env.db, 'SELECT read_on, km FROM odometer_readings WHERE deleted_at IS NULL ORDER BY read_on');
    const r = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-05', doneKm: 62000 })); // km digitati male
    expect(r.odometerReadingId).not.toBeNull();
    const undo = unwrap(await undoCompletion(env.deps, r.completionId as string));

    const after = await rows(env.db, 'SELECT read_on, km FROM odometer_readings WHERE deleted_at IS NULL ORDER BY read_on');
    expect(after).toEqual(before); // atteso: la lettura 62.000 e' sparita
    expect(undo.removedReadingId).toBe(r.odometerReadingId);
  });

  it('stesso difetto senza dipendere dall\'orologio: se la voce viene rinominata fra Fatto e Annulla la lettura resta', async () => {
    const env = await makeEnv(); // orologio fisso: created_at coincidono, ma la nota usa il nome ATTUALE della voce
    const v = await addVehicle(env, { nickname: 'Panda' });
    await addOdo(env, v, '2026-06-01', 15000);
    const item = await addItem(env, v, { name: 'Cambio olio', baseline_on: '2026-03-01', baseline_km: 12000, interval_km: 15000, interval_months: 12 });
    await reconcileVehicle(env.deps, v);
    const r = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-05', doneKm: 62000 }));
    unwrap(await updateDeadlineRule(env.deps, item, { name: 'Olio motore' }));
    unwrap(await undoCompletion(env.deps, r.completionId as string));
    const after = await rows(env.db, 'SELECT read_on, km FROM odometer_readings WHERE deleted_at IS NULL ORDER BY read_on');
    expect(after).toEqual([{ read_on: '2026-06-01', km: 15000 }]);
  });
});
