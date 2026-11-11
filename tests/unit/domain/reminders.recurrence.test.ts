import { describe, expect, it } from 'vitest';
import { nextOccurrence, nextRecurringDue, occurrenceOn } from '@/domain/reminders';

describe('vettori V9: ricorrenze ancorate all origine', () => {
  const monthly = { originOn: '2026-01-31', every: 1, unit: 'month' } as const;

  it('V9 mensile da 2026-01-31: dopo 28/02, 20/04 e 30/04', () => {
    expect(nextOccurrence(monthly, '2026-02-28')).toBe('2026-03-31');
    expect(nextOccurrence(monthly, '2026-04-20')).toBe('2026-04-30');
    expect(nextOccurrence(monthly, '2026-04-30')).toBe('2026-05-31');
  });

  it('la serie mensile non deriva a 28: 31 gen, 28 feb, 31 mar, 30 apr, 31 mag', () => {
    expect([0, 1, 2, 3, 4].map((k) => occurrenceOn(monthly, k))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });

  it('V9b annuale da 2024-02-29: 28/02/2025, 28/02/2026, 28/02/2027, 29/02/2028', () => {
    const yearly = { originOn: '2024-02-29', every: 1, unit: 'year' } as const;
    expect(nextOccurrence(yearly, '2025-03-01')).toBe('2026-02-28');
    expect(nextOccurrence(yearly, '2027-03-01')).toBe('2028-02-29');
    expect([1, 2, 3, 4].map((k) => occurrenceOn(yearly, k))).toEqual([
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
  });

  it('V9c ogni 2 settimane da 2026-10-01, dopo 2026-10-15 -> 2026-10-29', () => {
    expect(nextOccurrence({ originOn: '2026-10-01', every: 2, unit: 'week' }, '2026-10-15')).toBe('2026-10-29');
  });

  it('ogni N giorni e ogni N mesi', () => {
    expect(nextOccurrence({ originOn: '2026-10-01', every: 10, unit: 'day' }, '2026-10-01')).toBe('2026-10-11');
    expect(nextOccurrence({ originOn: '2026-10-01', every: 3, unit: 'month' }, '2026-10-02')).toBe('2027-01-01');
  });

  it('e strettamente dopo: nel giorno stesso dell occorrenza si passa alla successiva', () => {
    expect(nextOccurrence(monthly, '2026-03-31')).toBe('2026-04-30');
  });

  it('origine nel futuro: la prima occorrenza e l origine stessa', () => {
    expect(nextOccurrence({ originOn: '2027-01-15', every: 1, unit: 'month' }, '2026-10-07')).toBe('2027-01-15');
  });

  it('da un origine lontanissima arriva comunque al risultato giusto (senza scorrere tutta la serie)', () => {
    expect(nextOccurrence({ originOn: '1990-01-01', every: 1, unit: 'day' }, '2026-10-07')).toBe('2026-10-08');
    expect(nextOccurrence({ originOn: '1990-01-31', every: 1, unit: 'month' }, '2026-10-07')).toBe('2026-10-31');
    expect(nextOccurrence({ originOn: '1990-02-28', every: 5, unit: 'year' }, '2026-10-07')).toBe('2030-02-28');
    // 1990-01-01 + 21 x k giorni: 2026-10-19 (verificato con Date.UTC fuori dal dominio)
    expect(nextOccurrence({ originOn: '1990-01-01', every: 3, unit: 'week' }, '2026-10-07')).toBe('2026-10-19');
  });

  it('ricorrenza non valida: errore esplicito invece di un ciclo infinito', () => {
    expect(() => nextOccurrence({ originOn: '2026-01-01', every: 0, unit: 'day' }, '2026-10-07')).toThrow(RangeError);
    expect(() => nextOccurrence({ originOn: '2026-01-01', every: 1.5, unit: 'day' }, '2026-10-07')).toThrow(RangeError);
  });
});

describe('alla chiusura: la prima occorrenza dopo max(scadenza, oggi)', () => {
  const monthly = { originOn: '2026-01-31', every: 1, unit: 'month' } as const;

  it('in orario: la scadenza e nel futuro -> la successiva', () => {
    expect(nextRecurringDue(monthly, '2026-10-31', '2026-10-20')).toBe('2026-11-30');
  });

  it('in ritardo di tre mesi: le occorrenze perse vengono saltate (come un calendario)', () => {
    // scadenza 31 gen, chiuso il 10 maggio: non maggio... la prima dopo oggi e il 31 maggio
    expect(nextRecurringDue(monthly, '2026-01-31', '2026-05-10')).toBe('2026-05-31');
    expect(nextRecurringDue(monthly, '2026-01-31', '2026-05-31')).toBe('2026-06-30');
  });
});
