import { describe, expect, it } from 'vitest';
import { reminderDates } from '@/domain/italy';
import {
  RCA_LEAD_DAYS,
  RCA_RULES,
  policyExpiryStatus,
  rcaDefaultExpiry,
  rcaDue,
  rcaGraceEnd,
  rcaStatus,
} from '@/domain/insurance';

// Vettori A1-A8 di REG §3.5 / SPEC §7.4. La tolleranza di 15 giorni e SOLO informativa.
describe('RC auto: scadenza', () => {
  it('A1: decorrenza 2025-03-10 -> scadenza stimata 2026-03-10; fine tolleranza 2026-03-25', () => {
    expect(rcaDefaultExpiry('2025-03-10')).toBe('2026-03-10');
    expect(rcaGraceEnd('2026-03-10')).toBe('2026-03-25');
    const r = rcaDue({ policyStartOn: '2025-03-10' });
    expect(r.dueOn).toBe('2026-03-10');
    expect(r.graceEndsOn).toBe('2026-03-25');
    expect(r.isEstimated).toBe(true);
    expect(r.basis).toBe('estimated_from_start');
    expect(r.ruleId).toBe('it.rca.expiry_estimated');
    expect(r.confidence).toBe('indicative');
    expect(r.caveats[0]).toContain('stampata sul certificato');
  });

  it('A2: decorrenza 2024-02-29 -> scadenza 2025-02-28; fine tolleranza 2025-03-15', () => {
    const r = rcaDue({ policyStartOn: '2024-02-29' });
    expect(r.dueOn).toBe('2025-02-28');
    expect(r.graceEndsOn).toBe('2025-03-15');
  });

  it('A7: scadenza 2025-12-25 -> fine tolleranza 2026-01-09', () => {
    expect(rcaGraceEnd('2025-12-25')).toBe('2026-01-09');
  });

  it('la data stampata sul certificato vince sulla stima e non e mai spostata dalla tolleranza', () => {
    const r = rcaDue({ expiryOn: '2026-03-10', policyStartOn: '2025-03-12' });
    expect(r.dueOn).toBe('2026-03-10');
    expect(r.basis).toBe('printed_on_certificate');
    expect(r.isEstimated).toBe(false);
    expect(r.confidence).toBe('official');
    expect(r.ruleId).toBe('it.rca.expiry_printed');
    expect(r.caveats).toHaveLength(0);
    // la fine tolleranza e solo un'informazione accanto alla data
    expect(r.dueOn).not.toBe(r.graceEndsOn);
  });

  it('senza scadenza ne decorrenza: nessun dato inventato', () => {
    const r = rcaDue({});
    expect(r.dueOn).toBeNull();
    expect(r.reasonCode).toBe('NO_EXPIRY_DATE');
    expect(r.graceEndsOn).toBeNull();
  });

  it('avvertenza: nessun rinnovo tacito, non fare affidamento sulla tolleranza, sanzione indicativa', () => {
    const r = rcaDue({ expiryOn: '2026-03-10' });
    expect(r.warningText).toContain('non si rinnova automaticamente');
    expect(r.warningText).toContain('non farci affidamento');
    expect(r.warningText).toContain('866 a 3.464');
    expect(r.verifiedOn).toBe('2026-10-07');
    expect(r.rule).toBe(RCA_RULES.printed);
  });
});

describe('RC auto: stato (A3-A6)', () => {
  const expiry = '2026-03-10';

  it('valida: giorni mancanti', () => {
    const s = rcaStatus('2026-03-05', expiry);
    expect(s.state).toBe('valid');
    expect(s.daysLeft).toBe(5);
    expect(s.label).toBe('Scade tra 5 giorni');
    expect(s.note).toBeNull();
  });

  it('A3: oggi = scadenza -> Scade oggi, 0 giorni', () => {
    const s = rcaStatus('2026-03-10', expiry);
    expect(s.state).toBe('due_today');
    expect(s.daysLeft).toBe(0);
    expect(s.label).toBe('Scade oggi');
  });

  it('A4: 10 giorni dopo -> In tolleranza (nota informativa), 10 giorni di ritardo', () => {
    const s = rcaStatus('2026-03-20', expiry);
    expect(s.state).toBe('in_grace');
    expect(s.daysOverdue).toBe(10);
    expect(s.label).toBe('In tolleranza');
    expect(s.note).toContain('Non farci affidamento');
    expect(s.dueOn).toBe(expiry); // la scadenza non si sposta
  });

  it('A5: ultimo giorno della tolleranza (15 giorni)', () => {
    const s = rcaStatus('2026-03-25', expiry);
    expect(s.state).toBe('in_grace');
    expect(s.daysOverdue).toBe(15);
    expect(s.graceEndsOn).toBe('2026-03-25');
  });

  it('A6: 16 giorni dopo -> Scoperta', () => {
    const s = rcaStatus('2026-03-26', expiry);
    expect(s.state).toBe('uncovered');
    expect(s.daysOverdue).toBe(16);
    expect(s.label).toBe('Scoperta');
    expect(s.note).toBeNull();
  });

  it('il giorno dopo la scadenza gia e «in tolleranza» (1 giorno di ritardo), mai «valida»', () => {
    const s = rcaStatus('2026-03-11', expiry);
    expect(s.state).toBe('in_grace');
    expect(s.daysOverdue).toBe(1);
  });

  it('la tolleranza e un dato (15 giorni) e si puo cambiare senza toccare il codice', () => {
    const thirty = { ...RCA_RULES, grace: { ...RCA_RULES.grace, params: { days: 30 } } };
    expect(rcaGraceEnd('2026-03-10', thirty)).toBe('2026-04-09');
    expect(rcaStatus('2026-04-01', expiry, thirty).state).toBe('in_grace');
  });

  it('solo l RC auto ha la tolleranza; le altre polizze sono semplicemente scadute', () => {
    const rca = policyExpiryStatus('rca', '2026-03-15', expiry);
    expect(rca.kind).toBe('rca');
    if (rca.kind === 'rca') expect(rca.status.state).toBe('in_grace');
    const kasko = policyExpiryStatus('kasko', '2026-03-15', expiry);
    expect(kasko.kind).toBe('other');
    if (kasko.kind === 'other') {
      expect(kasko.status.state).toBe('overdue');
      expect(kasko.status.daysOverdue).toBe(5);
    }
  });
});

describe('RC auto: promemoria', () => {
  it('A8: serie 45, 30, 15, 7, 1, 0 per scadenza 2026-03-10', () => {
    expect(reminderDates('2026-03-10', [45, 30, 15, 7, 1, 0])).toEqual([
      '2026-01-24',
      '2026-02-08',
      '2026-02-23',
      '2026-03-03',
      '2026-03-09',
      '2026-03-10',
    ]);
  });

  it('preavvisi dell app (catalogo): 30, 14, 7, 1, 0; la tolleranza non li sposta', () => {
    expect(RCA_LEAD_DAYS).toEqual([30, 14, 7, 1, 0]);
    expect(reminderDates('2026-03-10', RCA_LEAD_DAYS)).toEqual([
      '2026-02-08',
      '2026-02-24',
      '2026-03-03',
      '2026-03-09',
      '2026-03-10',
    ]);
  });
});
