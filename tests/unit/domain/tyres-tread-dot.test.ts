import { describe, expect, it } from 'vitest';
import { TYRE_RULES, dotProductionDate, parseDot, treadStatus, tyreAge } from '@/domain/tyres';

// Vettori T2-T5 (battistrada) e T6-T7 (DOT) di REG §4.4.
describe('battistrada', () => {
  it('T2: 1,5 mm -> illegal (sotto il minimo di legge)', () => {
    const t = treadStatus(1.5, false);
    expect(t.state).toBe('illegal');
    expect(t.ruleId).toBe('it.tyres.tread_legal');
    expect(t.confidence).toBe('practice');
    expect(t.dueOn).toBeNull();
  });

  it('T3: 1,6 mm -> replace_soon (al limite legale, non illegale)', () => {
    expect(treadStatus(1.6, false).state).toBe('replace_soon');
  });

  it('T4: 3,5 mm in inverno -> not_advised_winter', () => {
    const t = treadStatus(3.5, true);
    expect(t.state).toBe('not_advised_winter');
    expect(t.ruleId).toBe('it.tyres.tread_advice');
    expect(t.confidence).toBe('indicative');
  });

  it('T5: 4,0 mm in inverno -> ok', () => {
    expect(treadStatus(4.0, true).state).toBe('ok');
  });

  it('soglie di confine: 3,0 mm ok d estate, 2,9 mm da sostituire presto, 3,5 mm d estate ok', () => {
    expect(treadStatus(3.0, false).state).toBe('ok');
    expect(treadStatus(2.9, false).state).toBe('replace_soon');
    expect(treadStatus(3.5, false).state).toBe('ok');
    expect(treadStatus(3.9, true).state).toBe('not_advised_winter');
  });

  it('valori non validi: errore', () => {
    expect(() => treadStatus(-0.1, false)).toThrow(RangeError);
    expect(() => treadStatus(Number.NaN, false)).toThrow(RangeError);
    expect(() => treadStatus(Number.POSITIVE_INFINITY, true)).toThrow(RangeError);
  });

  it('i testi per l utente sono in italiano e prudenti', () => {
    expect(treadStatus(1.5, false).label).toContain('1,6 mm');
    expect(treadStatus(2.0, false).label).toContain('Da sostituire presto');
    expect(treadStatus(5.0, false).warningText).toContain('1,6 mm');
  });

  it('le soglie sono dati configurabili', () => {
    const strict = {
      ...TYRE_RULES,
      treadAdvice: { ...TYRE_RULES.treadAdvice, params: { ...TYRE_RULES.treadAdvice.params, recommendedMm: 4 } },
    };
    expect(treadStatus(3.5, false, strict).state).toBe('replace_soon');
  });
});

describe('codice DOT', () => {
  it('parse: 4 cifre WWYY, anche con spazi o prefisso DOT', () => {
    expect(parseDot('1219')).toEqual({ ok: true, week: 12, year: 2019 });
    expect(parseDot(' 12 19 ')).toEqual({ ok: true, week: 12, year: 2019 });
    expect(parseDot('DOT 4524')).toEqual({ ok: true, week: 45, year: 2024 });
    expect(parseDot('dot4524')).toEqual({ ok: true, week: 45, year: 2024 });
    expect(parseDot('5321')).toEqual({ ok: true, week: 53, year: 2021 });
  });

  it('parse: formato o settimana non validi', () => {
    expect(parseDot('219')).toEqual({ ok: false, reason: 'FORMAT' }); // DOT a 3 cifre non gestito
    expect(parseDot('12199')).toEqual({ ok: false, reason: 'FORMAT' });
    expect(parseDot('abcd')).toEqual({ ok: false, reason: 'FORMAT' });
    expect(parseDot('')).toEqual({ ok: false, reason: 'FORMAT' });
    expect(parseDot('0019')).toEqual({ ok: false, reason: 'WEEK' });
    expect(parseDot('5419')).toEqual({ ok: false, reason: 'WEEK' });
  });

  it('data di produzione: 1 gennaio + (settimana - 1) * 7 giorni', () => {
    expect(dotProductionDate(12, 2019)).toBe('2019-03-19');
    expect(dotProductionDate(45, 2024)).toBe('2024-11-04');
    expect(dotProductionDate(1, 2020)).toBe('2020-01-01');
    expect(dotProductionDate(53, 2021)).toBe('2021-12-31');
  });

  it('T6: DOT 1219 oggi 2026-10-07 -> produzione 2019-03-19, eta ~ 7,55 anni (>= 5: fai controllare)', () => {
    const a = tyreAge('1219', '2026-10-07');
    expect(a).not.toBeNull();
    if (!a) return;
    expect(a.productionOn).toBe('2019-03-19');
    expect(a.ageDays).toBe(2759);
    expect(a.ageYears).toBeCloseTo(7.55, 2);
    expect(a.state).toBe('check');
    expect(a.checkOn).toBe('2024-03-19');
    expect(a.replaceAdvisedOn).toBe('2029-03-19');
    expect(a.dueOn).toBe('2024-03-19');
    expect(a.confidence).toBe('indicative');
    expect(a.ruleId).toBe('it.tyres.dot_age');
    expect(a.label).toContain('5 anni');
  });

  it('T7: DOT 4524 oggi 2026-10-07 -> produzione 2024-11-04, eta ~ 1,92 anni (ok)', () => {
    const a = tyreAge('4524', '2026-10-07');
    expect(a?.productionOn).toBe('2024-11-04');
    expect(a?.ageDays).toBe(702);
    expect(a?.ageYears).toBeCloseTo(1.92, 2);
    expect(a?.state).toBe('ok');
    expect(a?.checkOn).toBe('2029-11-04');
  });

  it('oltre i 10 anni: sostituzione consigliata (consiglio, non obbligo)', () => {
    const a = tyreAge('1213', '2026-10-07'); // produzione 2013-03-19
    expect(a?.productionOn).toBe('2013-03-19');
    expect(a?.state).toBe('replace_advised');
    expect(a?.warningText).toContain('indicazione prudenziale');
  });

  it('il giorno esatto dei 5 anni scatta il controllo; il giorno prima no', () => {
    expect(tyreAge('1219', '2024-03-18')?.state).toBe('ok');
    expect(tyreAge('1219', '2024-03-19')?.state).toBe('check');
    expect(tyreAge('1219', '2029-03-18')?.state).toBe('check');
    expect(tyreAge('1219', '2029-03-19')?.state).toBe('replace_advised');
  });

  it('DOT non valido -> null; data di produzione futura -> avviso', () => {
    expect(tyreAge('99', '2026-10-07')).toBeNull();
    const future = tyreAge('4530', '2026-10-07');
    expect(future?.ageDays).toBeLessThan(0);
    expect(future?.caveats.length).toBe(1);
    expect(future?.state).toBe('ok');
  });
});
