// Tipi pubblici delle assicurazioni (F-52 polizze, F-53 rinnovo, F-54 rate, F-55 garanzie). Denaro in centesimi, date 'YYYY-MM-DD'.
import type { LocalDate } from '@/domain/dates';
import type { PaymentFrequency, PolicyKind } from '@/domain/insurance';

export type { PaymentFrequency, PolicyKind };

/** Tipi di polizza del CHECK di `insurance_policies.kind` (SPEC 6.3.7: RC auto, Kasko, Furto e incendio, Altro). */
export const POLICY_KINDS = ['rca', 'kasko', 'furto_incendio', 'other'] as const;

export const POLICY_KIND_LABELS: Readonly<Record<PolicyKind, string>> = {
  rca: 'RC auto',
  kasko: 'Kasko',
  furto_incendio: 'Furto e incendio',
  other: 'Altro',
};

/** Garanzie del CHECK di `insurance_coverages.code` (F-55). Cristalli e assistenza stanno qui: una polizza dedicata e' di tipo `other`. */
export const COVERAGE_CODES = [
  'rca',
  'kasko',
  'furto',
  'incendio',
  'cristalli',
  'eventi_naturali',
  'atti_vandalici',
  'assistenza',
  'infortuni_conducente',
  'tutela_legale',
  'altro',
] as const;
export type CoverageCode = (typeof COVERAGE_CODES)[number];

export const COVERAGE_LABELS: Readonly<Record<CoverageCode, string>> = {
  rca: 'RC auto',
  kasko: 'Kasko',
  furto: 'Furto',
  incendio: 'Incendio',
  cristalli: 'Cristalli',
  eventi_naturali: 'Eventi naturali',
  atti_vandalici: 'Atti vandalici',
  assistenza: 'Assistenza stradale',
  infortuni_conducente: 'Infortuni del conducente',
  tutela_legale: 'Tutela legale',
  altro: 'Altro',
};

/** Numero di rate ammesso: annuale, semestrale, trimestrale, mensile. */
export const INSTALLMENT_COUNTS = [1, 2, 4, 12] as const;
export type InstallmentCount = (typeof INSTALLMENT_COUNTS)[number];

/** La garanzia "principale" di ogni tipo: massimale e franchigia indicati sulla polizza si riferiscono a questa. */
export const MAIN_COVERAGE: Readonly<Record<PolicyKind, CoverageCode>> = {
  rca: 'rca',
  kasko: 'kasko',
  furto_incendio: 'furto',
  other: 'altro',
};

export interface CoverageInput {
  code: CoverageCode;
  /** Massimale in centesimi. */
  limitCents?: number | null;
  /** Franchigia fissa in centesimi. */
  deductibleCents?: number | null;
  /** Scoperto/franchigia percentuale in punti base (10% = 1000). */
  deductibleBp?: number | null;
  notes?: string | null;
}

export interface CoverageView {
  id: string;
  code: CoverageCode;
  label: string;
  limitCents: number | null;
  deductibleCents: number | null;
  deductibleBp: number | null;
  notes: string | null;
}

/** Campi di una polizza in ingresso (aggiunta, modifica, rinnovo). */
export interface PolicyFields {
  kind: PolicyKind;
  /** Compagnia, 1..80 caratteri. */
  company: string;
  agencyName?: string | null;
  /** Al massimo 40 caratteri. */
  policyNumber?: string | null;
  /** Decorrenza come stampata sul certificato. */
  startOn: LocalDate;
  /**
   * Scadenza STAMPATA SUL CERTIFICATO (ultimo giorno coperto). Se manca si usa decorrenza + 12 mesi e il risultato
   * dice `endIsEstimated: true` ("stimata"): la UI la etichetta cosi'. Deve essere dopo la decorrenza.
   */
  endOn?: LocalDate | null;
  /** Premio totale in centesimi. 0 o assente = "non indicato": non nascono rate (mai importi inventati). */
  premiumCents?: number;
  /** Numero di rate: 1, 2, 4 o 12 (default 1). Il premio si divide con `splitInstallments` (il resto sulla prima). */
  installments?: InstallmentCount;
  /** Alternativa a `installments`; con `single` il premio e' pagato in un'unica soluzione. Se si danno entrambi devono coincidere. */
  paymentFrequency?: PaymentFrequency;
  /** Classe di merito 1..18. */
  meritClass?: number | null;
  blackBox?: boolean;
  claimsPhone?: string | null;
  claimsEmail?: string | null;
  assistancePhone?: string | null;
  agentName?: string | null;
  agentPhone?: string | null;
  agentEmail?: string | null;
  /** Massimale della garanzia principale del tipo (RC -> 'rca', kasko -> 'kasko', furto e incendio -> 'furto', altro -> 'altro'). */
  limitCents?: number | null;
  /** Franchigia fissa della garanzia principale. */
  deductibleCents?: number | null;
  /** Franchigia/scoperto percentuale (punti base) della garanzia principale. */
  deductibleBp?: number | null;
  /** Garanzie (F-55). In modifica sostituisce l'elenco; senza questo campo le garanzie non cambiano. */
  coverages?: CoverageInput[];
  notes?: string | null;
}

export interface AddPolicyInput extends PolicyFields {
  vehicleId: string;
  /**
   * Numeri delle rate GIA' PAGATE (da 1): vengono segnate pagate con `paid_on` = min(scadenza della rata, oggi),
   * cosi' una polizza inserita a posteriori non genera promemoria per rate che hai gia' pagato. Modificabile con
   * `unmarkInstallmentPaid` / `markInstallmentPaid`.
   */
  paidInstallmentNos?: number[];
}

export type UpdatePolicyInput = { policyId: string } & Partial<Omit<PolicyFields, 'endOn'>> & {
    endOn?: LocalDate;
    /** Data di annullamento/disdetta (>= decorrenza); `null` la toglie. Una polizza annullata non genera promemoria. */
    cancelledOn?: LocalDate | null;
  };

/**
 * Rinnovo (F-53): la nuova polizza parte dalla precedente (stesso tipo, compagnia, contatti, garanzie, premio, rate...)
 * con decorrenza = scadenza precedente. Ogni campo si puo' sovrascrivere; il tipo no.
 */
export type RenewPolicyInput = { policyId: string } & Partial<Omit<PolicyFields, 'kind' | 'endOn'>> & {
    endOn?: LocalDate | null;
    paidInstallmentNos?: number[];
  };

export type PolicyStatusKind = 'active' | 'expiring' | 'expired' | 'renewed' | 'cancelled';

/** Scadenza della polizza: per l'RC auto con la nota INFORMATIVA sulla tolleranza di 15 giorni (non sposta nulla). */
export interface PolicyExpiry {
  state: 'valid' | 'due_today' | 'overdue' | 'in_grace' | 'uncovered';
  daysLeft: number | null;
  daysOverdue: number | null;
  /** "Scade tra 5 giorni", "Scade oggi", "Scaduta da 3 giorni"; per l'RC "In tolleranza" / "Scoperta". */
  label: string;
  /** Solo RC auto in tolleranza: la nota informativa. */
  note: string | null;
  /** Solo RC auto: ultimo giorno della tolleranza informativa (scadenza + 15 giorni). */
  graceEndsOn: LocalDate | null;
}

export type InstallmentState = 'paid' | 'upcoming' | 'due_today' | 'overdue';

export interface InstallmentView {
  id: string;
  policyId: string;
  installmentNo: number;
  /** Quante rate ha la polizza (per "Rata 2/4"). */
  installmentCount: number;
  dueOn: LocalDate;
  amountCents: number;
  paidOn: LocalDate | null;
  state: InstallmentState;
  /** "Pagata il 08/10/2026", "Scade tra 5 giorni", "Scade oggi", "Scaduta da 3 giorni". */
  label: string;
  daysLeft: number | null;
  daysOverdue: number | null;
}

export interface PolicySummary {
  id: string;
  vehicleId: string;
  kind: PolicyKind;
  kindLabel: string;
  company: string;
  policyNumber: string | null;
  startOn: LocalDate;
  endOn: LocalDate;
  premiumCents: number;
  paymentFrequency: PaymentFrequency;
  /** Rate della polizza (0 se il premio non e' indicato). */
  installmentCount: number;
  paidCount: number;
  paidCents: number;
  unpaidCents: number;
  /** La prima rata non pagata (la piu' vicina nel tempo). */
  nextUnpaid: InstallmentView | null;
  /** Stato: attiva, in scadenza (entro 30 giorni), scaduta, rinnovata (esiste una polizza piu' recente dello stesso tipo), annullata. */
  status: PolicyStatusKind;
  statusLabel: string;
  expiry: PolicyExpiry;
  meritClass: number | null;
  renewedFromId: string | null;
  /** La polizza (non cancellata) che l'ha rinnovata con `renewPolicy`. */
  renewedById: string | null;
  cancelledOn: LocalDate | null;
}

export interface PolicyDetail extends PolicySummary {
  agencyName: string | null;
  blackBox: boolean;
  claimsPhone: string | null;
  claimsEmail: string | null;
  assistancePhone: string | null;
  agentName: string | null;
  agentPhone: string | null;
  agentEmail: string | null;
  notes: string | null;
  coverages: CoverageView[];
  installments: InstallmentView[];
  /** Solo RC auto: l'avvertenza di prodotto (la data e' quella del certificato, nessun rinnovo tacito, sanzioni). */
  warningIt: string | null;
  createdAt: string;
}

export interface AddPolicyResult {
  policy: PolicyDetail;
  /** La scadenza e' decorrenza + 12 mesi, non quella del certificato: la UI la etichetta "stimata". */
  endIsEstimated: boolean;
}

export interface RenewPolicyResult extends AddPolicyResult {
  /** La polizza rinnovata, ora con stato `renewed`. */
  previous: PolicySummary;
  /** Promemoria di scadenza della polizza precedente chiusi dal rinnovo. */
  closedReminderIds: string[];
}

export interface DeletePolicyResult {
  policyId: string;
  vehicleId: string;
}

export interface InstallmentResult {
  installment: InstallmentView;
  policy: PolicySummary;
  /** Promemoria della rata chiuso (pagata) o riaperto (pagamento annullato). */
  reminderId: string | null;
}

export interface ListPoliciesOptions {
  /** Default true. Con false restano solo le polizze correnti (non rinnovate ne' annullate). */
  includeInactive?: boolean;
}

export interface InstallmentsOverview {
  count: number;
  totalCents: number;
  overdueCount: number;
  overdueCents: number;
  next: (InstallmentView & { policyKind: PolicyKind; company: string }) | null;
}

export interface InsuranceSummary {
  vehicleId: string;
  /** Una polizza per tipo: la piu' recente non annullata (quella da cui nasce il promemoria). */
  current: PolicySummary[];
  /** La polizza RC auto corrente (null se non ce n'e'): serve al riquadro "Sei coperto?" dell'auto. */
  rca: PolicySummary | null;
  hasRca: boolean;
  /** La scadenza piu' vicina fra le polizze correnti (null se non ce ne sono). */
  nextExpiry: { policyId: string; kind: PolicyKind; company: string; endOn: LocalDate; expiry: PolicyExpiry } | null;
  /** Nota informativa sulla tolleranza dell'RC, solo se e' in tolleranza. */
  rcaGraceNote: string | null;
  /** Rate non pagate delle polizze non annullate (anche di quelle rinnovate: sono ancora da pagare). */
  unpaid: InstallmentsOverview;
  /** Rate pagate (entrano nei costi dell'auto): nell'anno solare di "oggi" e in tutto. */
  paidThisYearCents: number;
  paidTotalCents: number;
  /** Somma dei premi delle polizze correnti (informativa). */
  currentPremiumCents: number;
  counts: { total: number; current: number; renewed: number; expired: number; cancelled: number };
}
