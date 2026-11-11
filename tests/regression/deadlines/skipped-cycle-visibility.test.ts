// "Salta" (DL-3): la voce resta visibile e utilizzabile ("Fatto"), ma come ciclo saltato: non e' scaduta, non e' la
// "prossima scadenza" e non pesa sul semaforo. Con un "Fatto" la scadenza riparte dai valori reali.
import { describe, expect, it } from 'vitest';
import { completeDeadline, reconcileVehicle, skipDeadline } from '@/usecases/deadlines';
import { getVehicleDeadlines } from '@/usecases/queries';
import { addItem, addOdo, addVehicle, makeEnv, openReminders, unwrap } from '../../integration/usecases/deadlines/helpers';

describe("ciclo saltato di una voce dall'ultimo fatto", () => {
  it('resta nell\'elenco come "da configurare" con il motivo, senza contare fra le scadute; dopo il Fatto riparte', async () => {
    const env = await makeEnv(); // oggi = 2026-10-08
    const v = await addVehicle(env, { nickname: 'Panda' });
    await addOdo(env, v, '2026-10-01', 20000);
    const item = await addItem(env, v, { name: 'Tagliando', baseline_on: '2025-01-10', baseline_km: 5000, interval_km: 15000, interval_months: 12 });
    await reconcileVehicle(env.deps, v);
    const [rem] = await openReminders(env.db, v);
    unwrap(await skipDeadline(env.deps, rem!['id'] as string));

    const skipped = await getVehicleDeadlines(env.deps, v);
    const row = skipped!.rows.find((r) => r.itemId === item)!;
    expect(row).toMatchObject({ state: 'unknown', label: 'Saltata', dueOn: null, effectiveDueOn: null });
    expect(row.reasons.map((r) => r.code)).toEqual(['CYCLE_SKIPPED']);
    expect(skipped!.counts).toMatchObject({ overdue: 0, soon: 0, unknown: 1 });
    expect(skipped!.vehicle.next).toBeNull();

    unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-08', doneKm: 20000 }));
    const after = await getVehicleDeadlines(env.deps, v);
    expect(after!.rows.find((r) => r.itemId === item)!.state).toBe('ok');
  });
});
