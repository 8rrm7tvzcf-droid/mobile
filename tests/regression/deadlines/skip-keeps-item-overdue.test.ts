// Prova di riproduzione: dopo "Salta" su un promemoria scaduto di una voce "dall'ultimo fatto" la scadenza dovrebbe
// uscire dai semafori e da "Prossima scadenza" (come promesso da skipDeadline: "ciclo saltato"). Invece
// `loadDeadlineRows` rivaluta la voce senza promemoria aperto dalla regola e la mostra di nuovo come `overdue`
// (kind 'item'): il semaforo resta rosso e la scheda "Prossima scadenza" la ripropone.
import { describe, expect, it } from 'vitest';
import { reconcileVehicle, skipDeadline } from '@/usecases/deadlines';
import { getDashboard, getVehicleDeadlines } from '@/usecases/queries';
import { addItem, addOdo, addVehicle, makeEnv, openReminders, unwrap } from '../../integration/usecases/deadlines/helpers';

describe('Salta una scadenza scaduta', () => {
  it('la voce saltata non resta fra le scadute di Oggi', async () => {
    const env = await makeEnv(); // oggi = 2026-10-08
    const v = await addVehicle(env, { nickname: 'Panda' });
    await addOdo(env, v, '2026-10-01', 20000);
    await addItem(env, v, { name: 'Tagliando', baseline_on: '2025-01-10', baseline_km: 5000, interval_km: 15000, interval_months: 12 }); // scaduto da mesi
    await reconcileVehicle(env.deps, v);
    const [rem] = await openReminders(env.db, v);
    expect((await getVehicleDeadlines(env.deps, v))!.counts.overdue).toBe(1);

    unwrap(await skipDeadline(env.deps, rem!['id'] as string));

    expect(await openReminders(env.db, v)).toHaveLength(0); // nessun promemoria aperto, nessuna notifica
    const vd = await getVehicleDeadlines(env.deps, v);
    const dash = await getDashboard(env.deps, {});
    expect(vd!.counts.overdue).toBe(0); // ottenuto 1: la voce senza promemoria e' rivalutata dalla regola
    expect(dash.next).toBeNull();
  });
});
