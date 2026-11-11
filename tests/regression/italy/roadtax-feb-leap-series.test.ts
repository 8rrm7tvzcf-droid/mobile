// Bollo con mese di pagamento = febbraio: il termine e' l'ULTIMO giorno del mese (29/02/2028 in anno bisestile).
// Il percorso "Fatto" (serie di calendario +12 mesi con periodEnd 'exact') produce 28/02/2028: il giorno 29 risulta "scaduto".
import { describe, expect, it } from 'vitest';
import { completeDeadline, setupDeadlines } from '@/usecases/deadlines';
import { roadTaxRenewalDue } from '@/domain/italy';
import { addVehicle, makeEnv, openReminders, unwrap } from '../../integration/usecases/deadlines/helpers';

describe('bollo mese di pagamento febbraio, serie attraverso un anno bisestile', () => {
  it('dopo aver pagato il 2027, il rinnovo 2028 scade il 29/02/2028 (ultimo giorno del mese)', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env, { first_registration_on: '2019-02-10' });
    const res = unwrap(await setupDeadlines(env.deps, { vehicleId: v, items: [{ templateId: 'tpl_road_tax', paymentMonth: 2 }] })).items[0]!;
    expect(res.effectiveDueOn).toBe('2027-02-28');
    unwrap(await completeDeadline(env.deps, { itemId: res.itemId, doneOn: '2026-10-08' }));
    const open = await openReminders(env.db, v);
    expect(roadTaxRenewalDue(2028, { registeredOn: '2019-02-10', paymentMonth: 2 }).dueOn).toBe('2028-02-29');
    expect(open[0]!['due_on']).toBe('2028-02-29'); // oggi: 2028-02-28
  });
});
