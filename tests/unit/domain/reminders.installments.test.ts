// Vettori V10c e V10d di data.md 3.10 (rate del premio) collegati al motore: le rate generano i promemoria "Rata n/N".
// La funzione `splitInstallments` e' del dominio assicurazioni; qui se ne verifica l'uso con `planReminderChanges`.
import { describe, expect, it } from 'vitest';
import { splitInstallments } from '@/domain/insurance';
import { planReminderChanges } from '@/domain/reminders';
import type { ReconcilePolicy } from '@/domain/reminders';

describe('vettori V10c e V10d: rate del premio', () => {
  it('V10c premio 480,00 semestrale da 2026-05-10: 240,00 il 10/05 e 240,00 il 10/11', () => {
    expect(splitInstallments(48000, 'semiannual', '2026-05-10')).toEqual([
      { installmentNo: 1, dueOn: '2026-05-10', amountCents: 24000 },
      { installmentNo: 2, dueOn: '2026-11-10', amountCents: 24000 },
    ]);
  });

  it('V10d premio 480,01 trimestrale da 2026-01-31: 120,01 (31/01), poi 120,00 il 30/04, 31/07, 31/10', () => {
    expect(splitInstallments(48001, 'quarterly', '2026-01-31')).toEqual([
      { installmentNo: 1, dueOn: '2026-01-31', amountCents: 12001 },
      { installmentNo: 2, dueOn: '2026-04-30', amountCents: 12000 },
      { installmentNo: 3, dueOn: '2026-07-31', amountCents: 12000 },
      { installmentNo: 4, dueOn: '2026-10-31', amountCents: 12000 },
    ]);
  });

  it('le rate non pagate di una polizza diventano promemoria "Rata n/N" con le scadenze delle rate', () => {
    const policy: ReconcilePolicy = {
      id: 'pol-1',
      kind: 'rca',
      company: 'Generali',
      startOn: '2026-01-31',
      endOn: '2027-01-31',
    };
    const payments = splitInstallments(48001, 'quarterly', policy.startOn).map((i) => ({
      id: `pay-${i.installmentNo}`,
      policyId: policy.id,
      installmentNo: i.installmentNo,
      dueOn: i.dueOn,
      paidOn: i.installmentNo <= 2 ? i.dueOn : null, // le prime due sono pagate
    }));
    const changes = planReminderChanges({
      today: '2026-10-07',
      computedAt: '2026-10-07T08:00:00.000Z',
      vehicle: { id: 'veh-1', status: 'active' },
      items: [],
      odometer: [],
      policies: [policy],
      payments,
      openReminders: [],
    });
    const rate = changes.create.filter((c) => c.paymentId).map((c) => [c.title, c.dueOn]);
    expect(rate).toEqual([
      ['Rata 3/4', '2026-07-31'],
      ['Rata 4/4', '2026-10-31'],
    ]);
  });
});
