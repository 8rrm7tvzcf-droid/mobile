import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  addYears,
  compareDates,
  daysInMonth,
  diffDays,
  endOfMonth,
  fromEpochDay,
  isValidDate,
  toEpochDay,
  weekday,
} from '@/domain/dates';

describe('dates', () => {
  it('valida le date di calendario', () => {
    expect(isValidDate('2026-10-07')).toBe(true);
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2025-02-29')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-1-01')).toBe(false);
    expect(isValidDate('')).toBe(false);
  });

  it('giorni per mese e anni bisestili (1900 non lo e, 2000 si)', () => {
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('epoch day e ritorno, anche prima del 1970', () => {
    expect(toEpochDay('1970-01-01')).toBe(0);
    expect(toEpochDay('2000-03-01')).toBe(11017);
    expect(fromEpochDay(0)).toBe('1970-01-01');
    for (const s of ['1969-12-31', '1900-03-01', '2024-02-29', '2026-10-25', '2100-12-31']) {
      expect(fromEpochDay(toEpochDay(s))).toBe(s);
    }
  });

  it('addDays attraversa mesi, anni e il 29 febbraio', () => {
    expect(addDays('2026-10-07', 25)).toBe('2026-11-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('addMonths fa clamp a fine mese e non scivola', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-10-07', 14)).toBe('2027-12-07');
    expect(addMonths('2026-10-07', -10)).toBe('2025-12-07');
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
    expect(addYears('2024-02-29', 4)).toBe('2028-02-29');
  });

  it('endOfMonth', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(endOfMonth('2026-11-30')).toBe('2026-11-30');
  });

  it('diffDays e compareDates', () => {
    expect(diffDays('2026-10-07', '2026-10-21')).toBe(14);
    expect(diffDays('2026-10-21', '2026-10-07')).toBe(-14);
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2); // notte del cambio ora: nessuna deriva
    expect(compareDates('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDates('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('giorno della settimana', () => {
    expect(weekday('1970-01-01')).toBe(4); // giovedi
    expect(weekday('2026-10-07')).toBe(3); // mercoledi
  });
});
