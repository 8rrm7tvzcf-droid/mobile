// Validazione e normalizzazione dei campi di una polizza (stessi limiti dei CHECK di `insurance_policies` e
// `insurance_coverages`), con messaggi in italiano pronti per la UI. Uso INTERNO al modulo.
import { isValidDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/dates';
import { INSTALLMENTS_PER_FREQUENCY } from '@/domain/insurance';
import type { PaymentFrequency, PolicyKind } from '@/domain/insurance';
import { rcaDefaultExpiry } from '@/domain/insurance';
import { COVERAGE_CODES, INSTALLMENT_COUNTS, MAIN_COVERAGE, POLICY_KINDS } from './types';
import type { CoverageCode, CoverageInput, InstallmentCount, PolicyFields } from './types';

export const MAX_CENTS = 100_000_000_000;
export const MAX_COMPANY_LENGTH = 80;
export const MAX_POLICY_NUMBER_LENGTH = 40;
export const MAX_NOTES_LENGTH = 2000;

export type Checked<T> = { ok: true; value: T } | { ok: false; field: string; message: string };
const bad = (field: string, message: string): { ok: false; field: string; message: string } => ({ ok: false, field, message });

/** Campi gia' completi e normalizzati, pronti per essere scritti. */
export interface NormalizedPolicy {
  kind: PolicyKind;
  company: string;
  agencyName: string | null;
  policyNumber: string | null;
  startOn: LocalDate;
  endOn: LocalDate;
  endIsEstimated: boolean;
  premiumCents: number;
  paymentFrequency: PaymentFrequency;
  installmentCount: number;
  meritClass: number | null;
  blackBox: boolean;
  claimsPhone: string | null;
  claimsEmail: string | null;
  assistancePhone: string | null;
  agentName: string | null;
  agentPhone: string | null;
  agentEmail: string | null;
  notes: string | null;
  coverages: Required<CoverageInput>[];
}

const FREQUENCY_OF: Record<InstallmentCount, PaymentFrequency> = { 1: 'annual', 2: 'semiannual', 4: 'quarterly', 12: 'monthly' };

const text = (v: string | null | undefined, max: number): string | null => {
  if (v == null) return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, max);
};

const isCents = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_CENTS;

function resolveFrequency(installments: unknown, frequency: unknown): Checked<{ frequency: PaymentFrequency; count: number }> {
  if (installments != null && !(INSTALLMENT_COUNTS as readonly unknown[]).includes(installments)) {
    return bad('installments', 'Le rate possono essere 1, 2, 4 o 12.');
  }
  if (frequency != null && !(typeof frequency === 'string' && Object.prototype.hasOwnProperty.call(INSTALLMENTS_PER_FREQUENCY, frequency))) {
    return bad('paymentFrequency', 'La frequenza di pagamento non è valida.');
  }
  const f = frequency as PaymentFrequency | null | undefined;
  const n = installments as InstallmentCount | null | undefined;
  if (f != null && n != null && INSTALLMENTS_PER_FREQUENCY[f] !== n) {
    return bad('installments', 'Il numero di rate non corrisponde alla frequenza di pagamento.');
  }
  const resolved: PaymentFrequency = f ?? (n != null ? FREQUENCY_OF[n] : 'annual');
  return { ok: true, value: { frequency: resolved, count: INSTALLMENTS_PER_FREQUENCY[resolved] } };
}

function normalizeCoverages(list: readonly CoverageInput[]): Checked<Required<CoverageInput>[]> {
  const seen = new Set<string>();
  const out: Required<CoverageInput>[] = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i] as CoverageInput;
    const f = `coverages[${i}]`;
    if (!(COVERAGE_CODES as readonly string[]).includes(c.code)) return bad(`${f}.code`, 'Garanzia non riconosciuta.');
    if (seen.has(c.code)) return bad(`${f}.code`, 'Hai indicato due volte la stessa garanzia.');
    seen.add(c.code);
    if (c.limitCents != null && !isCents(c.limitCents)) return bad(`${f}.limitCents`, 'Il massimale non è valido: indica un importo in euro.');
    if (c.deductibleCents != null && !isCents(c.deductibleCents)) {
      return bad(`${f}.deductibleCents`, 'La franchigia non è valida: indica un importo in euro.');
    }
    if (c.deductibleBp != null && !(Number.isInteger(c.deductibleBp) && c.deductibleBp >= 0 && c.deductibleBp <= 10000)) {
      return bad(`${f}.deductibleBp`, 'Lo scoperto deve essere una percentuale tra 0 e 100.');
    }
    out.push({
      code: c.code,
      limitCents: c.limitCents ?? null,
      deductibleCents: c.deductibleCents ?? null,
      deductibleBp: c.deductibleBp ?? null,
      notes: text(c.notes, MAX_NOTES_LENGTH),
    });
  }
  return { ok: true, value: out };
}

/** Applica massimale e franchigia indicati "sulla polizza" alla garanzia principale del tipo (senza toccare le altre). */
export function applyMainCoverage(
  base: readonly CoverageInput[],
  kind: PolicyKind,
  top: { limitCents?: number | null; deductibleCents?: number | null; deductibleBp?: number | null },
): CoverageInput[] {
  if (top.limitCents === undefined && top.deductibleCents === undefined && top.deductibleBp === undefined) return [...base];
  const code: CoverageCode = MAIN_COVERAGE[kind];
  const cur = base.find((c) => c.code === code);
  const merged: CoverageInput = { ...(cur ?? { code }), code };
  if (top.limitCents !== undefined) merged.limitCents = top.limitCents;
  if (top.deductibleCents !== undefined) merged.deductibleCents = top.deductibleCents;
  if (top.deductibleBp !== undefined) merged.deductibleBp = top.deductibleBp;
  return [...base.filter((c) => c.code !== code), merged];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Valida un insieme COMPLETO di campi (per la modifica: i campi esistenti con le modifiche gia' applicate). La scadenza
 * mancante diventa decorrenza + 12 mesi con `endIsEstimated`. Le garanzie sono quelle gia' unite a massimale e franchigia.
 */
export function normalizePolicy(f: PolicyFields, coverages: readonly CoverageInput[]): Checked<NormalizedPolicy> {
  if (!(POLICY_KINDS as readonly string[]).includes(f.kind)) return bad('kind', 'Il tipo di polizza non è valido.');
  const company = text(f.company, MAX_COMPANY_LENGTH + 1);
  if (company === null || company.length > MAX_COMPANY_LENGTH) {
    return bad('company', `Indica la compagnia (da 1 a ${MAX_COMPANY_LENGTH} caratteri).`);
  }
  const policyNumber = text(f.policyNumber, MAX_POLICY_NUMBER_LENGTH + 1);
  if (policyNumber !== null && policyNumber.length > MAX_POLICY_NUMBER_LENGTH) {
    return bad('policyNumber', `Il numero di polizza può avere al massimo ${MAX_POLICY_NUMBER_LENGTH} caratteri.`);
  }
  if (typeof f.startOn !== 'string' || !isValidDate(f.startOn)) return bad('startOn', 'La decorrenza non è una data valida.');
  let endOn: LocalDate;
  let endIsEstimated = false;
  if (f.endOn == null) {
    endOn = rcaDefaultExpiry(f.startOn);
    endIsEstimated = true;
  } else {
    if (typeof f.endOn !== 'string' || !isValidDate(f.endOn)) return bad('endOn', 'La scadenza non è una data valida.');
    endOn = f.endOn;
  }
  if (endOn <= f.startOn) return bad('endOn', 'La scadenza deve essere dopo la decorrenza.');

  const premium = f.premiumCents ?? 0;
  if (!isCents(premium)) return bad('premiumCents', 'Il premio non è valido: indica un importo in euro.');
  const freq = resolveFrequency(f.installments, f.paymentFrequency);
  if (!freq.ok) return freq;

  const merit = f.meritClass ?? null;
  if (merit !== null && !(Number.isInteger(merit) && merit >= 1 && merit <= 18)) {
    return bad('meritClass', 'La classe di merito va da 1 a 18.');
  }
  const claimsEmail = text(f.claimsEmail, 120);
  if (claimsEmail !== null && !EMAIL.test(claimsEmail)) return bad('claimsEmail', "L'e-mail per i sinistri non sembra valida.");
  const agentEmail = text(f.agentEmail, 120);
  if (agentEmail !== null && !EMAIL.test(agentEmail)) return bad('agentEmail', "L'e-mail dell'agente non sembra valida.");

  const cov = normalizeCoverages(coverages);
  if (!cov.ok) return cov;

  return {
    ok: true,
    value: {
      kind: f.kind,
      company,
      agencyName: text(f.agencyName, 80),
      policyNumber,
      startOn: f.startOn,
      endOn,
      endIsEstimated,
      premiumCents: premium,
      paymentFrequency: freq.value.frequency,
      installmentCount: freq.value.count,
      meritClass: merit,
      blackBox: f.blackBox === true,
      claimsPhone: text(f.claimsPhone, 30),
      claimsEmail,
      assistancePhone: text(f.assistancePhone, 30),
      agentName: text(f.agentName, 80),
      agentPhone: text(f.agentPhone, 30),
      agentEmail,
      notes: text(f.notes, MAX_NOTES_LENGTH),
      coverages: cov.value,
    },
  };
}

/** Numeri di rata da segnare pagate: interi da 1 al numero di rate, senza doppioni. */
export function checkPaidNos(nos: readonly number[] | undefined, count: number): Checked<number[]> {
  const out = [...new Set(nos ?? [])].sort((a, b) => a - b);
  for (const n of out) {
    if (!Number.isInteger(n) || n < 1 || n > count) return bad('paidInstallmentNos', `Le rate pagate vanno da 1 a ${count}.`);
  }
  return { ok: true, value: out };
}

/** Toglie le chiavi `undefined` (una modifica "assente" non deve cancellare il valore esistente). */
export function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
