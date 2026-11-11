import { describe, expect, it } from 'vitest';
import { formatEuro } from '@/domain/units';
import type { InstallmentView, PolicyDetail, PolicySummary } from '@/usecases/insurance';
import {
  buildAddPolicyInput,
  buildRenewInput,
  buildUpdatePolicyInput,
  coverageText,
  formForRenewal,
  formFromPolicy,
  initialPolicyForm,
  installmentBadge,
  installmentPreview,
  nextInstallmentText,
  policiesSummaryText,
  policyBadge,
  policyErrorField,
  policyTitle,
  togglePaidNo,
  toggleCoverage,
  type PolicyFormValues,
} from '@/ui/logic/policyForm';
import { deadlineHref } from '@/ui/logic/status';

const form = (over: Partial<PolicyFormValues> = {}): PolicyFormValues => ({ ...initialPolicyForm('2026-10-09'), company: 'Generali', startOn: '15/11/2026', ...over });

describe('Polizza: anteprima delle rate', () => {
  it('4 rate: il resto dei centesimi e sulla prima, scadenze ogni tre mesi dalla decorrenza', () => {
    const rows = installmentPreview({ premium: '1.000,01', installments: 4, startOn: '15/11/2026' });
    expect(rows.map((r) => r.amountCents)).toEqual([25001, 25000, 25000, 25000]);
    expect(rows.map((r) => r.dueOn)).toEqual(['2026-11-15', '2027-02-15', '2027-05-15', '2027-08-15']);
  });

  it('annuale e mensile; senza premio o con una data illeggibile non ci sono rate', () => {
    expect(installmentPreview({ premium: '520', installments: 1, startOn: '01/01/2027' })).toHaveLength(1);
    expect(installmentPreview({ premium: '520', installments: 12, startOn: '01/01/2027' })).toHaveLength(12);
    expect(installmentPreview({ premium: '', installments: 4, startOn: '01/01/2027' })).toEqual([]);
    expect(installmentPreview({ premium: '520', installments: 4, startOn: 'boh' })).toEqual([]);
  });

  it('segna le rate gia pagate e le garanzie senza doppioni', () => {
    expect(togglePaidNo([1], 3)).toEqual([1, 3]);
    expect(togglePaidNo([1, 3], 1)).toEqual([3]);
    expect(toggleCoverage(['rca'], 'cristalli')).toEqual(['rca', 'cristalli']);
    expect(toggleCoverage(['rca', 'cristalli'], 'rca')).toEqual(['cristalli']);
  });
});

describe('Polizza: dal modulo al caso d\'uso', () => {
  it('RC auto completa: date come sul certificato, premio, rate, garanzie, massimale e franchigia', () => {
    const built = buildAddPolicyInput(
      'v1',
      form({
        kind: 'rca', endOn: '14/11/2027', premium: '520,50', installments: 2, meritClass: '1', blackBox: true, coverages: ['rca', 'assistenza'],
        limit: '6.000.000', deductible: '250', claimsPhone: ' 800 123 456 ', paidNos: [1, 2],
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input).toMatchObject({
      vehicleId: 'v1', kind: 'rca', company: 'Generali', startOn: '2026-11-15', endOn: '2027-11-14', premiumCents: 52050, installments: 2, meritClass: 1,
      blackBox: true, limitCents: 600000000, deductibleCents: 25000, claimsPhone: '800 123 456', coverages: [{ code: 'rca' }, { code: 'assistenza' }],
      paidInstallmentNos: [1, 2],
    });
  });

  it('senza scadenza si manda null (il caso d\'uso la stima) e senza premio non ci sono rate pagate', () => {
    const built = buildAddPolicyInput('v1', form({ paidNos: [1] }));
    expect(built.ok && built.input.endOn).toBeNull();
    expect(built.ok && built.input.paidInstallmentNos).toEqual([]);
  });

  it('errori in italiano per campo', () => {
    const built = buildAddPolicyInput('v1', form({ company: ' ', startOn: 'x', premium: '5,5,5', meritClass: '30', limit: 'tanto', claimsEmail: 'no' }));
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors).toMatchObject({ company: expect.any(String), startOn: expect.any(String), premium: expect.any(String), meritClass: expect.stringContaining('1 a 18'), limit: expect.any(String), claimsEmail: expect.any(String) });
    expect(buildAddPolicyInput('v1', form({ endOn: '01/01/2026' }))).toMatchObject({ ok: false, errors: { endOn: expect.stringContaining('dopo') } });
    expect(policyErrorField('premiumCents')).toBe('premium');
    expect(policyErrorField('qualcosa')).toBe('form');
  });

  it('modifica: solo i campi cambiati (le rate pagate non si toccano senza volerlo)', () => {
    const original = form({ company: 'Generali', premium: '500', installments: 4, endOn: '14/11/2027' });
    const same = buildUpdatePolicyInput('p1', original, original);
    expect(same).toEqual({ ok: true, input: { policyId: 'p1' } });
    const edited = buildUpdatePolicyInput('p1', { ...original, company: 'Allianz', notes: 'ciao' }, original);
    expect(edited.ok && edited.input).toEqual({ policyId: 'p1', company: 'Allianz', notes: 'ciao' });
    const premium = buildUpdatePolicyInput('p1', { ...original, premium: '550' }, original);
    expect(premium.ok && premium.input).toEqual({ policyId: 'p1', premiumCents: 55000 });
  });
});

describe('Polizza: rinnovo e modifica di una salvata', () => {
  const detail = {
    id: 'p1', vehicleId: 'v1', kind: 'rca', kindLabel: 'RC auto', company: 'Generali', policyNumber: 'ABC123', startOn: '2025-11-15', endOn: '2026-11-14',
    premiumCents: 52050, paymentFrequency: 'semiannual', installmentCount: 2, agencyName: 'Agenzia Centro', blackBox: false, claimsPhone: '800', claimsEmail: null,
    assistancePhone: null, agentName: null, agentPhone: null, agentEmail: null, notes: null, meritClass: 3,
    coverages: [{ id: 'c', code: 'rca', label: 'RC auto', limitCents: 600000000, deductibleCents: null, deductibleBp: null, notes: null }],
    installments: [{ installmentNo: 1, paidOn: '2025-11-15' }, { installmentNo: 2, paidOn: null }],
  } as unknown as PolicyDetail;

  it('dalla polizza al modulo, con le rate gia pagate e il massimale', () => {
    expect(formFromPolicy(detail)).toMatchObject({
      kind: 'rca', company: 'Generali', number: 'ABC123', startOn: '15/11/2025', endOn: '14/11/2026', premium: '520,50', installments: 2, paidNos: [1], meritClass: '3',
      coverages: ['rca'], limit: '6000000,00', agency: 'Agenzia Centro',
    });
  });

  it('rinnovo: la decorrenza e la scadenza precedente, scadenza e numero da copiare dal nuovo certificato', () => {
    const v = formForRenewal(detail);
    expect(v).toMatchObject({ startOn: '14/11/2026', endOn: '', number: '', paidNos: [], company: 'Generali', premium: '520,50' });
    const built = buildRenewInput('p1', { ...v, number: 'NEW1', endOn: '13/11/2027' });
    expect(built.ok && built.input).toMatchObject({ policyId: 'p1', startOn: '2026-11-14', endOn: '2027-11-13', policyNumber: 'NEW1', premiumCents: 52050 });
    expect(built.ok && 'kind' in built.input).toBe(false);
  });
});

describe('Polizza: semafori e righe (sempre icona + testo)', () => {
  const summary = (over: Partial<PolicySummary>): PolicySummary =>
    ({ id: 'p1', kind: 'rca', kindLabel: 'RC auto', company: 'Generali', status: 'active', statusLabel: 'Attiva', expiry: { state: 'valid', label: 'Scade tra 200 giorni' }, nextUnpaid: null, ...over }) as PolicySummary;

  it('in regola, in scadenza, scaduta, in tolleranza, rinnovata, annullata', () => {
    expect(policyBadge(summary({}))).toEqual({ tone: 'ok', icon: 'check', label: 'Scade tra 200 giorni' });
    expect(policyBadge(summary({ status: 'expiring', expiry: { state: 'valid', label: 'Scade tra 10 giorni' } as PolicySummary['expiry'] }))).toEqual({ tone: 'warning', icon: 'clock', label: 'Scade tra 10 giorni' });
    expect(policyBadge(summary({ expiry: { state: 'due_today', label: 'Scade oggi' } as PolicySummary['expiry'] }))).toMatchObject({ tone: 'danger', icon: 'alert' });
    expect(policyBadge(summary({ status: 'expired', expiry: { state: 'in_grace', label: 'In tolleranza' } as PolicySummary['expiry'] }))).toEqual({ tone: 'warning', icon: 'alert', label: 'In tolleranza' });
    expect(policyBadge(summary({ status: 'expired', expiry: { state: 'uncovered', label: 'Scoperta' } as PolicySummary['expiry'] }))).toMatchObject({ tone: 'danger', icon: 'alert' });
    expect(policyBadge(summary({ status: 'renewed' }))).toEqual({ tone: 'ok', icon: 'check', label: 'Rinnovata' });
    expect(policyBadge(summary({ status: 'cancelled' }))).toEqual({ tone: 'unknown', icon: 'help', label: 'Annullata' });
  });

  it('titolo, prossima rata e riga della scheda auto', () => {
    expect(policyTitle(summary({}))).toBe('RC auto · Generali');
    expect(nextInstallmentText(summary({}))).toBeNull();
    const next = { label: 'Scade tra 5 giorni', amountCents: 26025 } as InstallmentView;
    expect(nextInstallmentText(summary({ nextUnpaid: next }))).toBe(`Prossima rata: ${formatEuro(26025)} · Scade tra 5 giorni`);
    expect(policiesSummaryText({ rca: summary({}), current: [] })).toBe('RC auto: Scade tra 200 giorni');
    expect(policiesSummaryText({ rca: null, current: [] })).toBeNull();
  });

  it('rate: pagata, in arrivo, in ritardo', () => {
    const i = (state: InstallmentView['state'], label: string): InstallmentView => ({ state, label }) as InstallmentView;
    expect(installmentBadge(i('paid', 'Pagata il 01/10/2026'))).toEqual({ tone: 'ok', icon: 'check', label: 'Pagata il 01/10/2026' });
    expect(installmentBadge(i('upcoming', 'Scade tra 5 giorni'))).toEqual({ tone: 'unknown', icon: 'clock', label: 'Scade tra 5 giorni' });
    expect(installmentBadge(i('overdue', 'Scaduta da 3 giorni'))).toEqual({ tone: 'danger', icon: 'alert', label: 'Scaduta da 3 giorni' });
  });

  it('garanzie con massimale, franchigia e scoperto', () => {
    expect(coverageText({ label: 'Kasko', limitCents: null, deductibleCents: 25000, deductibleBp: 1000 } as never)).toContain('franchigia');
    expect(coverageText({ label: 'RC auto', limitCents: null, deductibleCents: null, deductibleBp: null } as never)).toBe('RC auto');
  });

  it('dall\'Oggi la scadenza di una polizza porta alla sua scheda, le altre alla scadenza', () => {
    const row = (over: object) => ({ id: 'rem1', vehicleId: 'v1', policyId: null, origin: 'rule', ...over }) as never;
    expect(deadlineHref(row({ policyId: 'p9', origin: 'policy' }))).toBe('/auto/v1/polizza/p9');
    expect(deadlineHref(row({ policyId: 'p9', origin: 'installment' }))).toBe('/auto/v1/polizza/p9');
    expect(deadlineHref(row({}))).toBe('/scadenza/rem1');
  });
});
