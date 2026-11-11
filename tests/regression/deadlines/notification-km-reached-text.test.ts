// Prova di riproduzione: quando i km sono GIA' raggiunti (lettura reale, nessuna stima) la notifica non deve dire
// "probabilmente scaduto" / "stima in base ai km". Il testo si decide da `due_trigger = 'km'`, ma lo stesso valore e'
// salvato anche per `kmReached` (trigger 'km', estimated = false): la distinzione si perde nella cache.
import { describe, expect, it } from 'vitest';
import { reconcileVehicle } from '@/usecases/deadlines';
import { buildPlannedNotifications } from '@/usecases/notifications/plan';
import { addItem, addOdo, addVehicle, makeEnv, openReminders } from '../../integration/usecases/deadlines/helpers';

describe('testo delle notifiche con km raggiunti', () => {
  it('km raggiunti da una lettura reale: nessuna formula "probabilmente"', async () => {
    const env = await makeEnv(); // oggi = 2026-10-08
    const v = await addVehicle(env, { nickname: 'Panda' });
    await addOdo(env, v, '2026-10-06', 27500); // gia' oltre i 27.000 km della scadenza
    await addItem(env, v, { name: 'Cambio olio', baseline_on: '2026-03-01', baseline_km: 12000, interval_km: 15000, interval_months: 36 });
    await reconcileVehicle(env.deps, v);
    const [rem] = await openReminders(env.db, v);
    expect(rem).toMatchObject({ due_km: 27000, effective_due_on: '2026-10-06', due_trigger: 'km' }); // km raggiunti, non stima

    const plan = await buildPlannedNotifications(env.deps);
    const bodies = plan.items.map((i) => i.body);
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) expect(b).not.toMatch(/probabilmente|stima/i);
  });
});
