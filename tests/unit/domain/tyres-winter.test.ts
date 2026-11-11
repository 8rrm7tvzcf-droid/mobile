import { describe, expect, it } from 'vitest';
import { reminderDates } from '@/domain/italy';
import {
  TYRE_RULES,
  nextTyreChangeDue,
  tyreChangeDue,
  winterTyreReminderDates,
  winterTyreSeason,
  winterTyreSeasonStartYearFor,
  winterTyreWindowStatus,
} from '@/domain/tyres';

// Vettore T1 di REG §4.4: winterTyreCalendar(2026) -> 2026-10-15, 2026-11-15, 2027-04-15, 2027-05-15.
describe('pneumatici invernali: calendario', () => {
  it('T1: stagione 2026/27', () => {
    const s = winterTyreSeason(2026);
    expect(s.mountAllowedFrom).toBe('2026-10-15');
    expect(s.obligationFrom).toBe('2026-11-15');
    expect(s.obligationTo).toBe('2027-04-15');
    expect(s.lowSpeedIndexUntil).toBe('2027-05-15');
    expect(s.dueOn).toBe('2026-11-15');
    expect(s.seasonStartYear).toBe(2026);
  });

  it('metadati: regola, fonte, confidenza e avvertenza «non esiste un obbligo valido ovunque»', () => {
    const s = winterTyreSeason(2026);
    expect(s.rule).toBe(TYRE_RULES.winterWindow);
    expect(s.ruleId).toBe('it.tyres.winter_window');
    expect(s.verifiedOn).toBe('2026-10-07');
    expect(s.confidence).toBe('official');
    expect(s.warningText).toContain('Non c\'è un obbligo valido ovunque');
    expect(s.rule.summary).toContain('UNI EN 16662-1:2020');
    expect(TYRE_RULES.winterWindow.params.minSpeedIndex).toBe('Q');
  });

  it('promemoria stagionali: 1/10, 8/11, 15/11, 1/4, 15/4', () => {
    expect(winterTyreReminderDates(2026)).toEqual(['2026-10-01', '2026-11-08', '2026-11-15', '2027-04-01', '2027-04-15']);
  });

  it('preavvisi del catalogo 14, 3, 0 giorni per il montaggio', () => {
    expect(reminderDates('2026-11-15', TYRE_RULES.winterWindow.params.leadDays)).toEqual(['2026-11-01', '2026-11-12', '2026-11-15']);
  });
});

describe('pneumatici invernali: stato della finestra', () => {
  it('stagione di riferimento: fino al 15 maggio vale quella iniziata l autunno prima', () => {
    expect(winterTyreSeasonStartYearFor('2027-01-01')).toBe(2026);
    expect(winterTyreSeasonStartYearFor('2027-05-15')).toBe(2026);
    expect(winterTyreSeasonStartYearFor('2027-05-16')).toBe(2027);
    expect(winterTyreSeasonStartYearFor('2026-10-07')).toBe(2026);
    expect(winterTyreSeasonStartYearFor('2026-12-31')).toBe(2026);
  });

  it('fuori stagione prima del 15 ottobre', () => {
    const s = winterTyreWindowStatus('2026-10-07');
    expect(s.state).toBe('outside');
    expect(s.season.seasonStartYear).toBe(2026);
  });

  it('dal 15 ottobre il montaggio e consentito; dal 15 novembre al 15 aprile vale il periodo degli obblighi', () => {
    expect(winterTyreWindowStatus('2026-10-15').state).toBe('mounting_allowed');
    expect(winterTyreWindowStatus('2026-11-14').state).toBe('mounting_allowed');
    expect(winterTyreWindowStatus('2026-11-15').state).toBe('obligation_period');
    expect(winterTyreWindowStatus('2027-01-01').state).toBe('obligation_period');
    expect(winterTyreWindowStatus('2027-04-15').state).toBe('obligation_period');
  });

  it('dopo il 15 aprile, fino al 15 maggio, gli invernali con indice inferiore sono ancora ammessi', () => {
    const s = winterTyreWindowStatus('2027-04-16');
    expect(s.state).toBe('after_obligation');
    expect(s.label).toContain('15 maggio');
    expect(winterTyreWindowStatus('2027-05-15').state).toBe('after_obligation');
    expect(winterTyreWindowStatus('2027-05-16').state).toBe('outside');
    expect(winterTyreWindowStatus('2027-05-16').season.seasonStartYear).toBe(2027);
  });

  it('l etichetta del periodo degli obblighi non dichiara un obbligo ovunque', () => {
    expect(winterTyreWindowStatus('2026-12-01').label).toContain('segnaletica o ordinanza');
  });
});

describe('cambio gomme stagionale', () => {
  it('montaggio invernali entro il 15/11, estive dopo il 15/4', () => {
    expect(tyreChangeDue('winter', 2026).dueOn).toBe('2026-11-15');
    expect(tyreChangeDue('summer', 2026).dueOn).toBe('2027-04-15');
    expect(tyreChangeDue('winter', 2026).basis).toBe('season_calendar');
  });

  it('prossima scadenza dalla data indicata (inclusa)', () => {
    expect(nextTyreChangeDue('winter', '2026-10-07').dueOn).toBe('2026-11-15');
    expect(nextTyreChangeDue('winter', '2026-11-15').dueOn).toBe('2026-11-15');
    expect(nextTyreChangeDue('winter', '2026-11-16').dueOn).toBe('2027-11-15');
    expect(nextTyreChangeDue('summer', '2026-10-07').dueOn).toBe('2027-04-15');
    expect(nextTyreChangeDue('summer', '2027-04-15').dueOn).toBe('2027-04-15');
    expect(nextTyreChangeDue('summer', '2027-04-16').dueOn).toBe('2028-04-15');
    expect(nextTyreChangeDue('summer', '2026-01-01').dueOn).toBe('2026-04-15');
  });

  it('le date della finestra sono dati: si possono cambiare senza toccare il codice', () => {
    const earlier = {
      ...TYRE_RULES,
      winterWindow: {
        ...TYRE_RULES.winterWindow,
        params: { ...TYRE_RULES.winterWindow.params, obligationFrom: { month: 10, day: 31, yearOffset: 0 as const } },
      },
    };
    expect(winterTyreSeason(2026, earlier).obligationFrom).toBe('2026-10-31');
  });
});
