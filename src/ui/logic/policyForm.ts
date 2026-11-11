// Assicurazioni (S-40..S-42, F-52, F-53, F-54, F-55): valori del modulo, anteprima delle rate, dati per i casi d'uso,
// semafori e righe d'elenco. Pura: niente React Native. Le date sono "come stampate sul certificato".
import { splitInstallments, type Installment, type PaymentFrequency } from '@/domain/insurance';
import type { LocalDate } from '@/domain/dates';
import {
  formatDateIt,
  formatEuro,
  formatPercentBp,
  formatScaled,
  parseDateIt,
  parseEuroToCents,
} from '@/domain/units';
import {
  COVERAGE_CODES,
  COVERAGE_LABELS,
  INSTALLMENT_COUNTS,
  MAIN_COVERAGE,
  POLICY_KIND_LABELS,
  POLICY_KINDS,
  type AddPolicyInput,
  type CoverageCode,
  type CoverageView,
  type InstallmentCount,
  type InstallmentView,
  type PolicyDetail,
  type PolicyKind,
  type PolicySummary,
  type RenewPolicyInput,
  type UpdatePolicyInput,
} from '@/usecases/insurance';
import type { DeadlineIcon, DeadlineTone } from '@/usecases/queries';
import type { ChoiceOption } from '../components/Choices';
import { it } from '../i18n/it';

export interface PolicyFormValues {
  kind: PolicyKind;
  company: string;
  agency: string;
  number: string;
  startOn: string;
  endOn: string;
  premium: string;
  installments: InstallmentCount;
  /** Numeri delle rate gia' pagate (da 1), solo per le polizze nuove e i rinnovi. */
  paidNos: number[];
  meritClass: string;
  blackBox: boolean;
  coverages: CoverageCode[];
  limit: string;
  deductible: string;
  claimsPhone: string;
  claimsEmail: string;
  assistancePhone: string;
  agentName: string;
  agentPhone: string;
  agentEmail: string;
  notes: string;
}

export interface PolicyFormErrors {
  company?: string;
  startOn?: string;
  endOn?: string;
  premium?: string;
  meritClass?: string;
  limit?: string;
  deductible?: string;
  claimsEmail?: string;
  agentEmail?: string;
  form?: string;
}

const centsText = (cents: number): string => formatScaled(cents, 2, { grouping: false });
const FREQUENCY: Record<InstallmentCount, PaymentFrequency> = { 1: 'annual', 2: 'semiannual', 4: 'quarterly', 12: 'monthly' };

export const policyKindOptions: readonly ChoiceOption<PolicyKind>[] = POLICY_KINDS.map((value) => ({ value, label: POLICY_KIND_LABELS[value] }));

export const installmentOptions: readonly ChoiceOption<string>[] = INSTALLMENT_COUNTS.map((n) => ({
  value: String(n),
  label: n === 1 ? 'In un’unica rata' : `${n} rate`,
}));

export const coverageChoices: readonly { code: CoverageCode; label: string }[] = COVERAGE_CODES.map((code) => ({ code, label: COVERAGE_LABELS[code] }));

export function initialPolicyForm(today: LocalDate, kind: PolicyKind = 'rca'): PolicyFormValues {
  return {
    kind,
    company: '',
    agency: '',
    number: '',
    startOn: formatDateIt(today),
    endOn: '',
    premium: '',
    installments: 1,
    paidNos: [],
    meritClass: '',
    blackBox: false,
    coverages: [],
    limit: '',
    deductible: '',
    claimsPhone: '',
    claimsEmail: '',
    assistancePhone: '',
    agentName: '',
    agentPhone: '',
    agentEmail: '',
    notes: '',
  };
}

/** Valori di una polizza gia' salvata, per la modifica. */
export function formFromPolicy(p: PolicyDetail): PolicyFormValues {
  const main = p.coverages.find((c) => c.code === MAIN_COVERAGE[p.kind]);
  const count = (INSTALLMENT_COUNTS as readonly number[]).includes(p.installmentCount) ? (p.installmentCount as InstallmentCount) : 1;
  return {
    kind: p.kind,
    company: p.company,
    agency: p.agencyName ?? '',
    number: p.policyNumber ?? '',
    startOn: formatDateIt(p.startOn),
    endOn: formatDateIt(p.endOn),
    premium: p.premiumCents > 0 ? centsText(p.premiumCents) : '',
    installments: count,
    paidNos: p.installments.filter((i) => i.paidOn !== null).map((i) => i.installmentNo),
    meritClass: p.meritClass !== null ? String(p.meritClass) : '',
    blackBox: p.blackBox,
    coverages: p.coverages.map((c) => c.code),
    limit: main?.limitCents != null ? centsText(main.limitCents) : '',
    deductible: main?.deductibleCents != null ? centsText(main.deductibleCents) : '',
    claimsPhone: p.claimsPhone ?? '',
    claimsEmail: p.claimsEmail ?? '',
    assistancePhone: p.assistancePhone ?? '',
    agentName: p.agentName ?? '',
    agentPhone: p.agentPhone ?? '',
    agentEmail: p.agentEmail ?? '',
    notes: p.notes ?? '',
  };
}

/** Rinnovo (F-53): tutto come la polizza precedente, decorrenza = scadenza precedente, scadenza e numero da copiare dal nuovo certificato. */
export function formForRenewal(p: PolicyDetail): PolicyFormValues {
  return { ...formFromPolicy(p), startOn: formatDateIt(p.endOn), endOn: '', number: '', paidNos: [] };
}

// ---------------------------------------------------------------- rate

/** Anteprima delle rate dal premio, dal numero di rate e dalla decorrenza (vuota se mancano o non tornano). */
export function installmentPreview(v: Pick<PolicyFormValues, 'premium' | 'installments' | 'startOn'>): Installment[] {
  const premium = v.premium.trim() === '' ? null : parseEuroToCents(v.premium);
  const start = parseDateIt(v.startOn);
  if (premium === null || premium <= 0 || start === null) return [];
  return splitInstallments(premium, FREQUENCY[v.installments], start);
}

export const previewRowText = (i: Installment, total: number): string => it.policy.previewRow(i.installmentNo, total, formatDateIt(i.dueOn), formatEuro(i.amountCents));

export const togglePaidNo = (nos: readonly number[], no: number): number[] => (nos.includes(no) ? nos.filter((n) => n !== no) : [...nos, no].sort((a, b) => a - b));
export const toggleCoverage = (codes: readonly CoverageCode[], code: CoverageCode): CoverageCode[] => (codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code]);

// ---------------------------------------------------------------- dal modulo ai casi d'uso

interface ParsedPolicy {
  startOn: LocalDate;
  endOn: LocalDate | null;
  premiumCents: number;
  merit: number | null;
  limitCents: number | null;
  deductibleCents: number | null;
}

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readPolicy(v: PolicyFormValues): { errors: PolicyFormErrors; parsed: ParsedPolicy | null } {
  const errors: PolicyFormErrors = {};
  if (v.company.trim() === '') errors.company = it.policy.companyRequired;

  const startOn = parseDateIt(v.startOn);
  if (startOn === null) errors.startOn = it.common.dateExample;

  let endOn: LocalDate | null = null;
  if (v.endOn.trim() !== '') {
    endOn = parseDateIt(v.endOn);
    if (endOn === null) errors.endOn = it.common.dateExample;
  }
  if (startOn !== null && endOn !== null && endOn <= startOn) errors.endOn = 'La scadenza deve essere dopo la decorrenza.';

  let premiumCents = 0;
  if (v.premium.trim() !== '') {
    const p = parseEuroToCents(v.premium);
    if (p === null || p < 0) errors.premium = it.policy.invalidPremium;
    else premiumCents = p;
  }

  let merit: number | null = null;
  if (v.meritClass.trim() !== '') {
    const m = Number(v.meritClass.trim());
    if (!Number.isInteger(m) || m < 1 || m > 18) errors.meritClass = it.policy.invalidMerit;
    else merit = m;
  }

  let limitCents: number | null = null;
  if (v.limit.trim() !== '') {
    limitCents = parseEuroToCents(v.limit);
    if (limitCents === null || limitCents < 0) {
      errors.limit = it.policy.invalidMoney;
      limitCents = null;
    }
  }
  let deductibleCents: number | null = null;
  if (v.deductible.trim() !== '') {
    deductibleCents = parseEuroToCents(v.deductible);
    if (deductibleCents === null || deductibleCents < 0) {
      errors.deductible = it.policy.invalidMoney;
      deductibleCents = null;
    }
  }
  if (v.claimsEmail.trim() !== '' && !EMAIL.test(v.claimsEmail.trim())) errors.claimsEmail = 'L’email per i sinistri non sembra valida.';
  if (v.agentEmail.trim() !== '' && !EMAIL.test(v.agentEmail.trim())) errors.agentEmail = 'L’email dell’agente non sembra valida.';

  if (Object.keys(errors).length > 0 || startOn === null) return { errors, parsed: null };
  return { errors, parsed: { startOn, endOn, premiumCents, merit, limitCents, deductibleCents } };
}

const common = (v: PolicyFormValues, p: ParsedPolicy) => ({
  company: v.company.trim(),
  agencyName: orNull(v.agency),
  policyNumber: orNull(v.number),
  startOn: p.startOn,
  premiumCents: p.premiumCents,
  installments: v.installments,
  meritClass: p.merit,
  blackBox: v.blackBox,
  claimsPhone: orNull(v.claimsPhone),
  claimsEmail: orNull(v.claimsEmail),
  assistancePhone: orNull(v.assistancePhone),
  agentName: orNull(v.agentName),
  agentPhone: orNull(v.agentPhone),
  agentEmail: orNull(v.agentEmail),
  notes: orNull(v.notes),
  coverages: v.coverages.map((code) => ({ code })),
  limitCents: p.limitCents,
  deductibleCents: p.deductibleCents,
});

export type PolicyBuildResult<T> = { ok: true; input: T } | { ok: false; errors: PolicyFormErrors };

/** I numeri delle rate gia' pagate valgono solo se ci sono rate (premio indicato) e solo fino al loro numero. */
const paidFor = (v: PolicyFormValues): number[] => (v.premium.trim() === '' ? [] : v.paidNos.filter((n) => n <= v.installments));

export function buildAddPolicyInput(vehicleId: string, v: PolicyFormValues): PolicyBuildResult<AddPolicyInput> {
  const { errors, parsed } = readPolicy(v);
  if (!parsed) return { ok: false, errors };
  const input: AddPolicyInput = { vehicleId, kind: v.kind, ...common(v, parsed), endOn: parsed.endOn, paidInstallmentNos: paidFor(v) };
  return { ok: true, input };
}

export function buildRenewInput(policyId: string, v: PolicyFormValues): PolicyBuildResult<RenewPolicyInput> {
  const { errors, parsed } = readPolicy(v);
  if (!parsed) return { ok: false, errors };
  return { ok: true, input: { policyId, ...common(v, parsed), endOn: parsed.endOn, paidInstallmentNos: paidFor(v) } };
}

/** Modifica: si mandano solo i campi cambiati (cosi' con rate gia' pagate non si tocca il piano delle rate senza volerlo). */
export function buildUpdatePolicyInput(policyId: string, v: PolicyFormValues, original: PolicyFormValues): PolicyBuildResult<UpdatePolicyInput> {
  const { errors, parsed } = readPolicy(v);
  if (!parsed) return { ok: false, errors };
  const all = { kind: v.kind, ...common(v, parsed) };
  const changed = (a: string, b: string): boolean => a.trim() !== b.trim();
  const input: UpdatePolicyInput = { policyId };
  const set = <K extends keyof UpdatePolicyInput>(key: K, value: UpdatePolicyInput[K], did: boolean): void => {
    if (did) input[key] = value;
  };
  set('kind', all.kind, v.kind !== original.kind);
  set('company', all.company, changed(v.company, original.company));
  set('agencyName', all.agencyName, changed(v.agency, original.agency));
  set('policyNumber', all.policyNumber, changed(v.number, original.number));
  set('startOn', all.startOn, changed(v.startOn, original.startOn));
  if (parsed.endOn !== null && changed(v.endOn, original.endOn)) input.endOn = parsed.endOn;
  set('premiumCents', all.premiumCents, changed(v.premium, original.premium));
  set('installments', all.installments, v.installments !== original.installments);
  set('meritClass', all.meritClass, changed(v.meritClass, original.meritClass));
  set('blackBox', all.blackBox, v.blackBox !== original.blackBox);
  set('claimsPhone', all.claimsPhone, changed(v.claimsPhone, original.claimsPhone));
  set('claimsEmail', all.claimsEmail, changed(v.claimsEmail, original.claimsEmail));
  set('assistancePhone', all.assistancePhone, changed(v.assistancePhone, original.assistancePhone));
  set('agentName', all.agentName, changed(v.agentName, original.agentName));
  set('agentPhone', all.agentPhone, changed(v.agentPhone, original.agentPhone));
  set('agentEmail', all.agentEmail, changed(v.agentEmail, original.agentEmail));
  set('notes', all.notes, changed(v.notes, original.notes));
  const coveragesChanged =
    v.coverages.length !== original.coverages.length || v.coverages.some((c) => !original.coverages.includes(c)) || changed(v.limit, original.limit) || changed(v.deductible, original.deductible);
  if (coveragesChanged) {
    input.coverages = all.coverages;
    input.limitCents = all.limitCents;
    input.deductibleCents = all.deductibleCents;
  }
  return { ok: true, input };
}

/** Campo del caso d'uso -> campo del modulo. */
export function policyErrorField(field: string | undefined): keyof PolicyFormErrors {
  switch (field) {
    case 'company':
      return 'company';
    case 'startOn':
      return 'startOn';
    case 'endOn':
      return 'endOn';
    case 'premiumCents':
      return 'premium';
    case 'meritClass':
      return 'meritClass';
    case 'claimsEmail':
      return 'claimsEmail';
    case 'agentEmail':
      return 'agentEmail';
    default:
      return 'form';
  }
}

// ---------------------------------------------------------------- semafori e righe

export interface PolicyBadge {
  tone: DeadlineTone;
  icon: DeadlineIcon;
  label: string;
}

/** Semaforo di una polizza: sempre icona + testo (SPEC 6.3.4). */
export function policyBadge(p: Pick<PolicySummary, 'status' | 'statusLabel' | 'expiry'>): PolicyBadge {
  if (p.status === 'renewed') return { tone: 'ok', icon: 'check', label: it.policy.status.renewed ?? p.statusLabel };
  if (p.status === 'cancelled') return { tone: 'unknown', icon: 'help', label: it.policy.status.cancelled ?? p.statusLabel };
  switch (p.expiry.state) {
    case 'valid':
      return { tone: p.status === 'expiring' ? 'warning' : 'ok', icon: p.status === 'expiring' ? 'clock' : 'check', label: p.expiry.label };
    case 'due_today':
      return { tone: 'danger', icon: 'alert', label: p.expiry.label };
    case 'in_grace':
      return { tone: 'warning', icon: 'alert', label: p.expiry.label };
    default:
      return { tone: 'danger', icon: 'alert', label: p.expiry.label };
  }
}

export const policyTitle = (p: Pick<PolicySummary, 'kindLabel' | 'company'>): string => `${p.kindLabel} · ${p.company}`;

export function policySubtitle(p: PolicySummary): string {
  const parts: (string | null)[] = [it.policy.expiresOn(formatDateIt(p.endOn)), p.policyNumber];
  return parts.filter((x): x is string => Boolean(x)).join(' · ');
}

export function nextInstallmentText(p: Pick<PolicySummary, 'nextUnpaid'>): string | null {
  const n = p.nextUnpaid;
  return n ? it.policy.nextInstallment(n.label, formatEuro(n.amountCents)) : null;
}

export function policyA11y(p: PolicySummary): string {
  const b = policyBadge(p);
  return [policyTitle(p), b.label, policySubtitle(p), nextInstallmentText(p)].filter(Boolean).join('. ');
}

/** "Rata 2 di 4 · 12/01/2027 · 250,00 €". */
export const installmentTitle = (i: InstallmentView): string => it.policy.previewRow(i.installmentNo, i.installmentCount, formatDateIt(i.dueOn), formatEuro(i.amountCents));

export function installmentBadge(i: InstallmentView): PolicyBadge {
  switch (i.state) {
    case 'paid':
      return { tone: 'ok', icon: 'check', label: i.label };
    case 'overdue':
    case 'due_today':
      return { tone: 'danger', icon: 'alert', label: i.label };
    default:
      return { tone: 'unknown', icon: 'clock', label: i.label };
  }
}

export function coverageText(c: CoverageView): string {
  const parts: string[] = [c.label];
  if (c.limitCents !== null) parts.push(`massimale ${formatEuro(c.limitCents)}`);
  if (c.deductibleCents !== null) parts.push(`franchigia ${formatEuro(c.deductibleCents)}`);
  if (c.deductibleBp !== null) parts.push(`scoperto ${formatPercentBp(c.deductibleBp)}`);
  return parts.join(' · ');
}

/** Riga sintetica per la scheda dell'auto: "RC auto: Scade tra 20 giorni", o `null` senza polizze. */
export function policiesSummaryText(s: { rca: PolicySummary | null; current: readonly PolicySummary[] }): string | null {
  const p = s.rca ?? s.current[0] ?? null;
  return p ? it.registry.sectionPoliciesNext(p.kindLabel, policyBadge(p).label) : null;
}
