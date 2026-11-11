// Bollo: ancora della serie dei rinnovi (ITALY-1, ITALY-2). Parte pura (`roadTaxSeriesMonth`, `nextFixedDue` con
// `anchorMonth`) e i percorsi "Salta" / "Riapri" che avanzano la stessa serie del "Fatto".
import { describe, expect, it } from 'vitest';
import { roadTaxSeriesMonth } from '@/domain/italy';
import { nextFixedDue } from '@/domain/maintenance';
import type { MaintenanceRule } from '@/domain/maintenance';
import { reopenReminder, setupDeadlines, skipDeadline } from '@/usecases/deadlines';
import { addVehicle, makeEnv, openReminders, rows, unwrap } from '../../integration/usecases/deadlines/helpers';

const rule = (fixedDueOn: string): MaintenanceRule => ({ scheduleType: 'interval_calendar', intervalMonths: 12, periodEnd: 'exact', fixedDueOn });

describe('roadTaxSeriesMonth', () => {
  it('primo pagamento spostato: la serie riparte dal mese di immatricolazione', () => {
    expect(roadTaxSeriesMonth('2026-10-31', '2026-09-25')).toBe(9); // ultimi 10 giorni del mese
    expect(roadTaxSeriesMonth('2026-11-30', '2026-10-05')).toBe(10); // Lombardia: sempre il mese dopo
    expect(roadTaxSeriesMonth('2028-03-31', '2028-02-10')).toBe(2); // regime dal 2028
    expect(roadTaxSeriesMonth('2027-01-31', '2026-12-05')).toBe(12); // a cavallo dell'anno
  });

  it("un primo pagamento non spostato, o una scadenza che non e' un primo pagamento, restano sul loro mese", () => {
    expect(roadTaxSeriesMonth('2026-10-31', '2026-10-05')).toBe(10);
    expect(roadTaxSeriesMonth('2027-03-31', '2019-02-10')).toBe(3); // mese di pagamento inserito diverso dall'immatricolazione
    expect(roadTaxSeriesMonth('2027-03-31', null)).toBe(3); // senza immatricolazione
  });
});

describe('nextFixedDue con anchorMonth', () => {
  it('ultimo giorno del mese di ancora, dopo la scadenza corrente e dopo la data del fatto', () => {
    expect(nextFixedDue(rule('2026-10-31'), '2026-10-10', { anchorMonth: 9 })).toBe('2027-09-30');
    expect(nextFixedDue(rule('2027-02-28'), '2026-10-08', { anchorMonth: 2 })).toBe('2028-02-29'); // anno bisestile
    expect(nextFixedDue(rule('2028-02-29'), '2028-02-29', { anchorMonth: 2 })).toBe('2029-02-28');
    expect(nextFixedDue(rule('2026-09-30'), '2027-01-10', { anchorMonth: 9 })).toBe('2027-09-30'); // pagato in ritardo: non si torna indietro
    expect(nextFixedDue(rule('2026-09-30'), '2027-10-10', { anchorMonth: 9 })).toBe('2028-09-30');
  });

  it('senza ancora (o con una ripetizione non annuale) resta "scadenza + intervallo"', () => {
    expect(nextFixedDue(rule('2026-11-15'), '2026-10-08')).toBe('2027-11-15');
    expect(nextFixedDue({ ...rule('2026-11-15'), intervalMonths: 6 }, '2026-10-08', { anchorMonth: 11 })).toBe('2027-05-15');
  });
});

describe('Salta e riapri sul bollo con primo pagamento spostato', () => {
  it('la serie avanza al mese di immatricolazione e la riapertura la ripristina', async () => {
    const env = await makeEnv('2026-10-12T07:30:00.000Z');
    const v = await addVehicle(env, { first_registration_on: '2026-09-25' });
    const item = unwrap(await setupDeadlines(env.deps, { vehicleId: v, items: [{ templateId: 'tpl_road_tax' }] })).items[0]!;
    const [rem] = await openReminders(env.db, v);
    expect(rem!['due_on']).toBe('2026-10-31');

    unwrap(await skipDeadline(env.deps, rem!['id'] as string));
    expect((await openReminders(env.db, v))[0]!['due_on']).toBe('2027-09-30'); // non 2027-10-31

    unwrap(await reopenReminder(env.deps, rem!['id'] as string));
    expect((await rows(env.db, 'SELECT fixed_due_on FROM maintenance_items WHERE id = ?', [item.itemId]))[0]).toEqual({ fixed_due_on: '2026-10-31' });
    expect((await openReminders(env.db, v))[0]!['due_on']).toBe('2026-10-31');
  });
});
