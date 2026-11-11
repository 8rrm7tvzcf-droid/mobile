import { describe, expect, it } from 'vitest';
import {
  INSTALLMENTS_PER_FREQUENCY,
  INSTALLMENT_LEAD_DAYS,
  installmentReminderDates,
  selectCurrentPolicies,
  splitInstallments,
  type PaymentFrequency,
  type PolicyLike,
} from '@/domain/insurance';

// Vettori V10c e V10d di DAT §3.10, `splitInstallments` di SPEC §8.3.
describe('rate del premio', () => {
  it('V10c: 480,00 semestrale da 2026-05-10 -> 240,00 il 2026-05-10 e 240,00 il 2026-11-10', () => {
    expect(splitInstallments(48000, 'semiannual', '2026-05-10')).toEqual([
      { installmentNo: 1, dueOn: '2026-05-10', amountCents: 24000 },
      { installmentNo: 2, dueOn: '2026-11-10', amountCents: 24000 },
    ]);
  });

  it('V10d: 480,01 trimestrale da 2026-01-31 -> 120,01 (31/01), 120,00 (30/04), 120,00 (31/07), 120,00 (31/10)', () => {
    expect(splitInstallments(48001, 'quarterly', '2026-01-31')).toEqual([
      { installmentNo: 1, dueOn: '2026-01-31', amountCents: 12001 },
      { installmentNo: 2, dueOn: '2026-04-30', amountCents: 12000 },
      { installmentNo: 3, dueOn: '2026-07-31', amountCents: 12000 },
      { installmentNo: 4, dueOn: '2026-10-31', amountCents: 12000 },
    ]);
  });

  it('single e annuale: una sola rata con tutto il premio alla data di inizio', () => {
    for (const f of ['single', 'annual'] as const) {
      expect(splitInstallments(55055, f, '2026-03-10')).toEqual([{ installmentNo: 1, dueOn: '2026-03-10', amountCents: 55055 }]);
    }
  });

  it('mensile: 12 rate, resto sulla prima, scadenze dalla data di inizio senza deriva', () => {
    const rows = splitInstallments(100003, 'monthly', '2026-01-31'); // 8333 * 12 = 99996, resto 7
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ installmentNo: 1, dueOn: '2026-01-31', amountCents: 8340 });
    expect(rows.slice(1).every((r) => r.amountCents === 8333)).toBe(true);
    expect(rows.map((r) => r.dueOn)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
    ]);
  });

  it('la somma delle rate e sempre il premio e il resto e minore di n', () => {
    const freqs = Object.keys(INSTALLMENTS_PER_FREQUENCY) as PaymentFrequency[];
    for (const f of freqs) {
      for (const premium of [0, 1, 7, 11, 12, 13, 99999, 48001, 123457]) {
        const rows = splitInstallments(premium, f, '2026-06-15');
        expect(rows.length).toBe(INSTALLMENTS_PER_FREQUENCY[f]);
        expect(rows.reduce((a, r) => a + r.amountCents, 0)).toBe(premium);
        expect(rows.map((r) => r.installmentNo)).toEqual(rows.map((_, i) => i + 1));
        // tutte le rate dopo la prima sono uguali al valore base
        const base = Math.floor(premium / rows.length);
        expect(rows.slice(1).every((r) => r.amountCents === base)).toBe(true);
      }
    }
  });

  it('premio zero: almeno la rata 1', () => {
    expect(splitInstallments(0, 'annual', '2026-03-10')).toEqual([{ installmentNo: 1, dueOn: '2026-03-10', amountCents: 0 }]);
  });

  it('premio non valido (non intero o negativo): errore', () => {
    expect(() => splitInstallments(-1, 'annual', '2026-03-10')).toThrow(RangeError);
    expect(() => splitInstallments(10.5, 'annual', '2026-03-10')).toThrow(RangeError);
    expect(() => splitInstallments(Number.NaN, 'annual', '2026-03-10')).toThrow(RangeError);
  });

  it('frequenza sconosciuta (dato corrotto): errore, non una rata inventata', () => {
    expect(() => splitInstallments(1000, 'weekly' as PaymentFrequency, '2026-03-10')).toThrow(RangeError);
  });

  it('promemoria delle rate: 7, 1 e 0 giorni prima', () => {
    expect(INSTALLMENT_LEAD_DAYS).toEqual([7, 1, 0]);
    expect(installmentReminderDates('2026-04-30')).toEqual(['2026-04-23', '2026-04-29', '2026-04-30']);
  });
});

describe('polizza corrente per tipo', () => {
  const rcaOld: PolicyLike & { id: string } = { id: 'rca-old', kind: 'rca', startOn: '2024-03-10', endOn: '2025-03-10' };
  const rcaNew: PolicyLike & { id: string } = { id: 'rca-new', kind: 'rca', startOn: '2025-03-10', endOn: '2026-03-10' };
  const kasko: PolicyLike & { id: string } = { id: 'kasko', kind: 'kasko', startOn: '2025-06-01', endOn: '2026-06-01' };

  it('il promemoria nasce dalla polizza con endOn maggiore per tipo; le precedenti sono rinnovate', () => {
    const r = selectCurrentPolicies([rcaOld, kasko, rcaNew]);
    expect(r.current.map((p) => p.id)).toEqual(['kasko', 'rca-new']);
    expect(r.superseded.map((p) => p.id)).toEqual(['rca-old']);
    expect(r.cancelled).toEqual([]);
  });

  it('le polizze annullate non generano promemoria', () => {
    const cancelled = { ...rcaNew, id: 'rca-cancelled', cancelledOn: '2025-09-01' };
    const r = selectCurrentPolicies([rcaOld, cancelled]);
    expect(r.current.map((p) => p.id)).toEqual(['rca-old']);
    expect(r.cancelled.map((p) => p.id)).toEqual(['rca-cancelled']);
  });

  it('a parita di fine vince la decorrenza piu recente; elenco vuoto -> vuoto', () => {
    const a = { id: 'a', kind: 'other', startOn: '2025-01-01', endOn: '2026-01-01' } as const;
    const b = { id: 'b', kind: 'other', startOn: '2025-02-01', endOn: '2026-01-01' } as const;
    expect(selectCurrentPolicies([a, b]).current.map((p) => p.id)).toEqual(['b']);
    expect(selectCurrentPolicies([])).toEqual({ current: [], superseded: [], cancelled: [] });
  });
});
