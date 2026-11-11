import { describe, expect, it } from 'vitest';
import { evaluateRule, nextFixedDue, planCompletion, resolveLastDone } from '@/domain/maintenance';
import type { MaintenanceRule, OdometerPoint } from '@/domain/maintenance';

const bollo: MaintenanceRule = {
  scheduleType: 'interval_calendar',
  intervalMonths: 12,
  fixedDueOn: '2026-08-31',
};

describe('vettori V10: serie di calendario che non scivola con il ritardo', () => {
  it('bollo con scadenza 2026-08-31: pagato in anticipo, in ritardo o con oltre 16 mesi di ritardo', () => {
    expect(nextFixedDue(bollo, '2026-08-10')).toBe('2027-08-31');
    expect(nextFixedDue(bollo, '2026-10-02')).toBe('2027-08-31');
    expect(nextFixedDue(bollo, '2028-01-10')).toBe('2028-08-31');
  });

  it('pagato esattamente il giorno della scadenza: la prossima e fra un anno', () => {
    expect(nextFixedDue(bollo, '2026-08-31')).toBe('2027-08-31');
  });

  it('V10a bombola (fixed_date) completata: la nuova scadenza e NULL, la inserisce l utente', () => {
    const bombola: MaintenanceRule = { scheduleType: 'fixed_date', fixedDueOn: '2026-12-01' };
    expect(nextFixedDue(bombola, '2026-11-20')).toBeNull();
    const plan = planCompletion(bombola, '2026-11-20', null);
    expect(plan.prevFixedDueOn).toBe('2026-12-01');
    expect(plan.newFixedDueOn).toBeNull();
    expect(plan.fixedDueOnChanged).toBe(true);
    // dopo il completamento la regola e "da configurare"
    const ev = evaluateRule({ today: '2026-11-20', rule: { ...bombola, fixedDueOn: null }, lastDone: null });
    expect(ev.state).toBe('unknown');
    expect(ev.reasons).toEqual(['NO_FIXED_DATE']);
  });

  it('interval_last_done non tocca fixed_due_on', () => {
    const oil: MaintenanceRule = { scheduleType: 'interval_last_done', intervalKm: 15000, intervalMonths: 12 };
    expect(nextFixedDue(oil, '2026-10-01')).toBeNull();
    expect(planCompletion(oil, '2026-10-01', 55000).fixedDueOnChanged).toBe(false);
  });

  it('calendario senza data o con intervallo non valido: null, senza cicli infiniti', () => {
    expect(nextFixedDue({ scheduleType: 'interval_calendar', intervalMonths: 12 }, '2026-10-01')).toBeNull();
    expect(nextFixedDue({ scheduleType: 'interval_calendar', intervalMonths: 0, fixedDueOn: '2026-01-01' }, '2026-10-01')).toBeNull();
    expect(nextFixedDue({ scheduleType: 'interval_calendar', fixedDueOn: '2026-01-01' }, '2026-10-01')).toBeNull();
  });

  it('serie mensile ancorata alla scadenza corrente: nessun accumulo di clamp nel salto di piu cicli', () => {
    const monthly: MaintenanceRule = { scheduleType: 'interval_calendar', intervalMonths: 1, fixedDueOn: '2026-01-31' };
    expect(nextFixedDue(monthly, '2026-03-15')).toBe('2026-03-31'); // non 2026-03-28
    expect(nextFixedDue(monthly, '2026-04-30')).toBe('2026-05-31');
  });

  it('planCompletion salva il valore precedente per l annulla e usa i valori reali come nuova base', () => {
    const plan = planCompletion(bollo, '2026-10-02', 48000);
    expect(plan.prevFixedDueOn).toBe('2026-08-31');
    expect(plan.newFixedDueOn).toBe('2027-08-31');
    expect(plan.fixedDueOnChanged).toBe(true);
    expect(plan.lastDone).toEqual({ on: '2026-10-02', km: 48000 });
  });
});

describe('ricalcolo al completamento dai valori reali (data.md 3.7)', () => {
  const oil: MaintenanceRule = {
    scheduleType: 'interval_last_done',
    intervalKm: 15000,
    intervalMonths: 12,
    soonDays: 30,
    soonKm: 1500,
  };

  it('olio fatto a 13.000 km invece di 15.000: il prossimo e a 13.000 + intervallo', () => {
    const odo: OdometerPoint[] = [{ on: '2026-09-20', km: 13000 }];
    const ev = evaluateRule({ today: '2026-09-20', rule: oil, lastDone: { on: '2026-09-20', km: 13000 }, odometer: odo });
    expect(ev.dueKm).toBe(28000);
    expect(ev.dueOn).toBe('2027-09-20');
  });

  it('un completamento retrodatato non cambia la base: conta il done_on piu recente', () => {
    const last = resolveLastDone([
      { doneOn: '2026-03-01', doneKm: 40000 },
      { doneOn: '2025-02-01', doneKm: 25000 }, // retrodatato, inserito dopo
    ]);
    expect(last).toEqual({ on: '2026-03-01', km: 40000 });
  });

  it('senza completamenti si usa la baseline della voce; senza nemmeno quella, null', () => {
    expect(resolveLastDone([], { baselineOn: '2025-03-15', baselineKm: 20000 })).toEqual({ on: '2025-03-15', km: 20000 });
    expect(resolveLastDone([], { baselineOn: '2025-03-15' })).toEqual({ on: '2025-03-15', km: null });
    expect(resolveLastDone([], {})).toBeNull();
    expect(resolveLastDone([])).toBeNull();
  });

  it('un completamento batte la baseline; a parita di data vince quello con i km', () => {
    expect(resolveLastDone([{ doneOn: '2026-01-10', doneKm: null }], { baselineOn: '2025-03-15', baselineKm: 20000 })).toEqual({
      on: '2026-01-10',
      km: null,
    });
    expect(
      resolveLastDone([
        { doneOn: '2026-01-10' },
        { doneOn: '2026-01-10', doneKm: 41000 },
        { doneOn: '2026-01-10', doneKm: 40500 },
      ]),
    ).toEqual({ on: '2026-01-10', km: 41000 });
  });

  it('annulla: ripristinando prev_fixed_due_on la valutazione torna identica', () => {
    const before = evaluateRule({ today: '2026-10-07', rule: bollo, lastDone: null });
    const plan = planCompletion(bollo, '2026-10-02');
    const after = evaluateRule({
      today: '2026-10-07',
      rule: { ...bollo, fixedDueOn: plan.newFixedDueOn },
      lastDone: null,
    });
    expect(after.dueOn).toBe('2027-08-31');
    expect(after.state).toBe('ok');
    const undone = evaluateRule({ today: '2026-10-07', rule: { ...bollo, fixedDueOn: plan.prevFixedDueOn }, lastDone: null });
    expect(undone).toEqual(before);
    expect(before.state).toBe('overdue');
  });
});
