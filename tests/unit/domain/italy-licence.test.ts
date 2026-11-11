import { describe, expect, it } from 'vitest';
import {
  LICENCE_LEAD_DAYS,
  LICENCE_RULES,
  ageOn,
  licenceExpiry,
  licenceValidityYears,
  newDriverUntil,
  reminderDates,
} from '@/domain/italy';

// Vettori P1-P10 di REG §6.3 / SPEC §7.7 con la regola CORRETTA: scadenza = primo compleanno successivo alla
// scadenza ordinaria (rinnovo + N anni).
describe('patente: eta e fasce di validita', () => {
  it('eta compiuta alla data', () => {
    expect(ageOn('1985-04-12', '2026-03-01')).toBe(40);
    expect(ageOn('1985-04-12', '2026-04-12')).toBe(41);
    expect(ageOn('1985-04-12', '2026-04-11')).toBe(40);
    expect(ageOn('1988-02-29', '2027-02-28')).toBe(38);
    expect(ageOn('1988-02-29', '2027-03-01')).toBe(39);
  });

  it('10 anni fino a 50, 5 da 50 a 70, 3 da 70 a 80, 2 oltre', () => {
    expect(licenceValidityYears(18)).toBe(10);
    expect(licenceValidityYears(49)).toBe(10);
    expect(licenceValidityYears(50)).toBe(5);
    expect(licenceValidityYears(69)).toBe(5);
    expect(licenceValidityYears(70)).toBe(3);
    expect(licenceValidityYears(79)).toBe(3);
    expect(licenceValidityYears(80)).toBe(2);
    expect(licenceValidityYears(95)).toBe(2);
  });
});

describe('patente: scadenza con la regola del compleanno', () => {
  it('P1: nato 1985-04-12, rinnovo 2026-03-01 (40 anni) -> 2036-04-12', () => {
    const r = licenceExpiry({ birthOn: '1985-04-12', issuedOrRenewedOn: '2026-03-01' });
    expect(r.dueOn).toBe('2036-04-12');
    expect(r.basis).toBe('birthday_after_ordinary');
    expect(r.confidence).toBe('official');
    expect(r.caveats).toHaveLength(0);
  });

  it('P2: nato 1970-09-30, rinnovo 2026-05-10 (55 anni) -> 2031-09-30', () => {
    expect(licenceExpiry({ birthOn: '1970-09-30', issuedOrRenewedOn: '2026-05-10' }).dueOn).toBe('2031-09-30');
  });

  it('P3: nato 1950-01-20, rinnovo 2026-01-10 (75 anni) -> 2029-01-20', () => {
    expect(licenceExpiry({ birthOn: '1950-01-20', issuedOrRenewedOn: '2026-01-10' }).dueOn).toBe('2029-01-20');
  });

  it('P4: nato 1940-11-02, rinnovo 2026-06-01 (85 anni) -> 2028-11-02, ma con avviso (commissione medica locale)', () => {
    const r = licenceExpiry({ birthOn: '1940-11-02', issuedOrRenewedOn: '2026-06-01' });
    expect(r.dueOn).toBe('2028-11-02');
    expect(r.confidence).toBe('indicative');
    expect(r.caveats.join(' ')).toContain('commissione medica locale');
  });

  it('P5: nato 1988-02-29, rinnovo 2027-05-01 -> 2038-02-28 (primo compleanno DOPO la scadenza ordinaria 2037-05-01)', () => {
    expect(licenceExpiry({ birthOn: '1988-02-29', issuedOrRenewedOn: '2027-05-01' }).dueOn).toBe('2038-02-28');
  });

  it('P6: nato 1976-06-15, rinnovo il giorno del 50o compleanno -> 2031-06-15 (5 anni assunti), con avviso', () => {
    const r = licenceExpiry({ birthOn: '1976-06-15', issuedOrRenewedOn: '2026-06-15' });
    expect(r.dueOn).toBe('2031-06-15');
    expect(r.caveats.join(' ')).toContain('50º compleanno');
    expect(r.confidence).toBe('indicative');
  });

  it('P8: il campo 4b letto sulla patente vince sempre', () => {
    const r = licenceExpiry({ birthOn: '1985-04-12', issuedOrRenewedOn: '2026-03-01', manualExpiryOn: '2030-03-04' });
    expect(r.dueOn).toBe('2030-03-04');
    expect(r.basis).toBe('manual');
    expect(r.ruleId).toBe('it.licence.expiry_manual');
  });

  it('P9: nato 1985-04-12, rinnovo 2026-06-01 (41 anni) -> 2037-04-12 (non 2036-04-12, che precede la scadenza ordinaria)', () => {
    expect(licenceExpiry({ birthOn: '1985-04-12', issuedOrRenewedOn: '2026-06-01' }).dueOn).toBe('2037-04-12');
  });

  it('P10: nato 1960-03-10, rinnovo 2026-09-20 (66 anni) -> 2032-03-10', () => {
    expect(licenceExpiry({ birthOn: '1960-03-10', issuedOrRenewedOn: '2026-09-20' }).dueOn).toBe('2032-03-10');
  });

  it('il compleanno coincide con la scadenza ordinaria: vale quel giorno', () => {
    // nato 1985-03-01, rinnovo 2026-03-01 (41 anni): scadenza ordinaria 2036-03-01 = compleanno
    expect(licenceExpiry({ birthOn: '1985-03-01', issuedOrRenewedOn: '2026-03-01' }).dueOn).toBe('2036-03-01');
  });

  it('nato il 29 febbraio: negli anni non bisestili il compleanno e il 28', () => {
    // nato 1988-02-29, rinnovo 2026-01-10 (37 anni): ordinaria 2036-01-10 -> compleanno 2036-02-29 (bisestile)
    expect(licenceExpiry({ birthOn: '1988-02-29', issuedOrRenewedOn: '2026-01-10' }).dueOn).toBe('2036-02-29');
  });

  it('senza regola del compleanno (C/D/CQC o visita medica locale): scadenza ordinaria, confidenza bassa', () => {
    const r = licenceExpiry({ birthOn: '1985-04-12', issuedOrRenewedOn: '2026-06-01', birthdayRuleApplies: false });
    expect(r.dueOn).toBe('2036-06-01');
    expect(r.basis).toBe('ordinary');
    expect(r.confidence).toBe('indicative');
  });

  it('rinnovi prima del 17-9-2012: regola del compleanno non applicabile', () => {
    const r = licenceExpiry({ birthOn: '1970-01-01', issuedOrRenewedOn: '2010-06-01' });
    expect(r.basis).toBe('ordinary');
    expect(r.dueOn).toBe('2020-06-01');
  });

  it('preavvisi 120, 60, 30, 7 giorni prima', () => {
    expect(LICENCE_LEAD_DAYS).toEqual([120, 60, 30, 7]);
    expect(reminderDates('2036-04-12', LICENCE_LEAD_DAYS)).toEqual(['2035-12-14', '2036-02-12', '2036-03-13', '2036-04-05']);
  });

  it('avvertenza e metadati', () => {
    const r = licenceExpiry({ birthOn: '1985-04-12', issuedOrRenewedOn: '2026-03-01' });
    expect(r.warningText).toContain('campo 4b');
    expect(r.warningText).toContain('15 anni');
    expect(r.rule).toBe(LICENCE_RULES.expiry);
    expect(r.verifiedOn).toBe('2026-10-07');
  });
});

describe('patente: neopatentati', () => {
  it('P7: patente conseguita 2024-12-20 -> limiti fino al 2027-12-20 (3 anni)', () => {
    const r = newDriverUntil('2024-12-20');
    expect(r.dueOn).toBe('2027-12-20');
    expect(r.ruleId).toBe('it.licence.new_driver.from_2024-12-14');
    expect(r.limits).toEqual({ maxPowerKwPerTonne: 75, maxPowerKwCarM1: 105 });
  });

  it('esattamente il 14-12-2024 vale il nuovo regime; il giorno prima vale 1 anno', () => {
    expect(newDriverUntil('2024-12-14').dueOn).toBe('2027-12-14');
    const old = newDriverUntil('2024-12-13');
    expect(old.dueOn).toBe('2025-12-13');
    expect(old.ruleId).toBe('it.licence.new_driver.until_2024-12-13');
    // limiti del regime previgente: non riportati nella ricerca, nessun dato inventato
    expect(old.limits).toEqual({ maxPowerKwPerTonne: null, maxPowerKwCarM1: null });
  });
});
