// Bollo: dopo il PRIMO pagamento "spostato" (ultimi 10 giorni del mese, Lombardia/Piemonte/Trento/Bolzano, regime 2028)
// il rinnovo successivo deve cadere nel MESE DI IMMATRICOLAZIONE (regs.md 2.2/2.6, `roadTaxNextDue`), non 12 mesi dopo il
// primo pagamento (un mese di ritardo). Il dominio lo calcola giusto; il percorso "Fatto" (serie di calendario) no.
import { describe, expect, it } from 'vitest';
import { completeDeadline, setupDeadlines } from '@/usecases/deadlines';
import { roadTaxNextDue } from '@/domain/italy';
import { addVehicle, makeEnv, openReminders, unwrap } from '../../integration/usecases/deadlines/helpers';

describe('bollo: rinnovo dopo il primo pagamento', () => {
  it('immatricolata il 25/9 (ultimi 10 giorni): primo pagamento 31/10/2026, rinnovo 30/9/2027', async () => {
    const env = await makeEnv('2026-10-12T07:30:00.000Z');
    const v = await addVehicle(env, { first_registration_on: '2026-09-25' });
    const res = unwrap(await setupDeadlines(env.deps, { vehicleId: v, items: [{ templateId: 'tpl_road_tax' }] })).items[0]!;
    expect(res.effectiveDueOn).toBe('2026-10-31'); // primo pagamento
    unwrap(await completeDeadline(env.deps, { itemId: res.itemId, doneOn: '2026-10-10' }));
    const open = await openReminders(env.db, v);
    const expected = roadTaxNextDue('2026-11-01', { registeredOn: '2026-09-25', region: 'OTHER' }).dueOn;
    expect(expected).toBe('2027-09-30'); // il dominio
    expect(open[0]!['due_on']).toBe('2027-09-30'); // oggi: 2027-10-31
  });

  it('Lombardia (MI), immatricolata il 5/10: primo pagamento 30/11/2026, rinnovo 31/10/2027', async () => {
    const env = await makeEnv('2026-10-12T07:30:00.000Z');
    const v = await addVehicle(env, { first_registration_on: '2026-10-05' });
    const res = unwrap(await setupDeadlines(env.deps, { vehicleId: v, items: [{ templateId: 'tpl_road_tax', provinceCode: 'MI' }] })).items[0]!;
    expect(res.effectiveDueOn).toBe('2026-11-30');
    unwrap(await completeDeadline(env.deps, { itemId: res.itemId, doneOn: '2026-10-12' }));
    const open = await openReminders(env.db, v);
    expect(open[0]!['due_on']).toBe('2027-10-31'); // oggi: 2027-11-30
  });

  it('regime 2028 (D.Lgs. 147/2026, ogni primo pagamento e al mese successivo): immatricolata il 10/2/2028, rinnovo 28/2/2029', async () => {
    const env = await makeEnv('2028-02-15T07:30:00.000Z');
    const v = await addVehicle(env, { first_registration_on: '2028-02-10' });
    const res = unwrap(await setupDeadlines(env.deps, { vehicleId: v, items: [{ templateId: 'tpl_road_tax' }] })).items[0]!;
    expect(res.effectiveDueOn).toBe('2028-03-31');
    unwrap(await completeDeadline(env.deps, { itemId: res.itemId, doneOn: '2028-02-15' }));
    const open = await openReminders(env.db, v);
    expect(roadTaxNextDue('2028-04-01', { registeredOn: '2028-02-10', region: 'OTHER' }).dueOn).toBe('2029-02-28');
    expect(open[0]!['due_on']).toBe('2029-02-28'); // oggi: 2029-03-31
  });
});
