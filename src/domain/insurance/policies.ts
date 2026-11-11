// Polizze e rate - SPEC §3.4 (F-52..F-54), §8.3 riga «Polizze e rate», DAT §3.9. Dominio puro.
// Rate: n = 1, 2, 4, 12; importo base = floor(premio / n), il resto in centesimi sulla PRIMA rata; scadenze a
// `inizio + k * 12/n` mesi calcolate SEMPRE dalla data di inizio (clamp di fine mese, nessuna deriva: 31/01 -> 30/04 -> 31/07).
import { addMonths, type LocalDate } from '@/domain/dates';
import { deadlineStatus, reminderDates, type DeadlineStatus } from '@/domain/italy/calendar';
import { rcaStatus, type RcaRules, type RcaStatus, RCA_RULES } from './rca';

export type PaymentFrequency = 'single' | 'annual' | 'semiannual' | 'quarterly' | 'monthly';

/** Numero di rate per frequenza (dato, non logica). */
export const INSTALLMENTS_PER_FREQUENCY: Readonly<Record<PaymentFrequency, number>> = {
  single: 1,
  annual: 1,
  semiannual: 2,
  quarterly: 4,
  monthly: 12,
};

/** Preavvisi per le rate non pagate (SPEC §8.3): 7 e 1 giorno prima e il giorno stesso. */
export const INSTALLMENT_LEAD_DAYS: readonly number[] = [7, 1, 0];

export interface Installment {
  /** Numero della rata, da 1. */
  readonly installmentNo: number;
  readonly dueOn: LocalDate;
  readonly amountCents: number;
}

/** Divide il premio (in centesimi) nelle rate della frequenza scelta. Una polizza ha sempre almeno la rata 1. */
export function splitInstallments(
  premiumCents: number,
  frequency: PaymentFrequency,
  startOn: LocalDate,
): Installment[] {
  if (!Number.isInteger(premiumCents) || premiumCents < 0) {
    throw new RangeError(`Premio non valido (centesimi interi >= 0): ${premiumCents}`);
  }
  const n = INSTALLMENTS_PER_FREQUENCY[frequency];
  if (n === undefined) throw new RangeError(`Frequenza di pagamento non valida: ${String(frequency)}`);
  const base = Math.floor(premiumCents / n);
  const remainder = premiumCents - base * n;
  return Array.from({ length: n }, (_, i) => ({
    installmentNo: i + 1,
    dueOn: addMonths(startOn, (i * 12) / n),
    amountCents: base + (i === 0 ? remainder : 0),
  }));
}

/** Date dei promemoria di una rata non pagata (7, 1 e 0 giorni prima). */
export function installmentReminderDates(
  dueOn: LocalDate,
  leadDays: readonly number[] = INSTALLMENT_LEAD_DAYS,
): LocalDate[] {
  return reminderDates(dueOn, leadDays);
}

// ---------------------------------------------------------------------------------------------------------------

export type PolicyKind = 'rca' | 'kasko' | 'furto_incendio' | 'other';

export interface PolicyLike {
  readonly kind: PolicyKind;
  readonly startOn: LocalDate;
  readonly endOn: LocalDate;
  readonly cancelledOn?: LocalDate | null;
}

/**
 * Il promemoria nasce dalla polizza con `endOn` maggiore per tipo; le polizze precedenti dello stesso tipo sono
 * «rinnovate» (SPEC §8.3). Le polizze annullate non generano promemoria. A parita' di `endOn` vince `startOn` maggiore,
 * poi la prima nell'elenco. Mantiene l'ordine di ingresso.
 */
export function selectCurrentPolicies<T extends PolicyLike>(
  policies: readonly T[],
): { readonly current: T[]; readonly superseded: T[]; readonly cancelled: T[] } {
  const cancelled = policies.filter((p) => p.cancelledOn != null);
  const live = policies.filter((p) => p.cancelledOn == null);
  const best = new Map<PolicyKind, T>();
  for (const p of live) {
    const cur = best.get(p.kind);
    if (!cur || p.endOn > cur.endOn || (p.endOn === cur.endOn && p.startOn > cur.startOn)) best.set(p.kind, p);
  }
  const current = live.filter((p) => best.get(p.kind) === p);
  const superseded = live.filter((p) => best.get(p.kind) !== p);
  return { current, superseded, cancelled };
}

export type PolicyStatus = { readonly kind: 'rca'; readonly status: RcaStatus } | { readonly kind: 'other'; readonly status: DeadlineStatus };

/** Stato di una polizza alla data indicata: solo l'RC auto ha la nota sulla tolleranza di 15 giorni. */
export function policyExpiryStatus(
  policyKind: PolicyKind,
  today: LocalDate,
  endOn: LocalDate,
  rcaRules: RcaRules = RCA_RULES,
): PolicyStatus {
  if (policyKind === 'rca') return { kind: 'rca', status: rcaStatus(today, endOn, rcaRules) };
  return { kind: 'other', status: deadlineStatus(today, endOn) };
}
