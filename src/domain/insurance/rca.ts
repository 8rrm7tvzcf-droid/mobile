// Assicurazione RC auto - SPEC §7.4, REG §3. Dominio puro.
// REGOLE DI PRODOTTO: la scadenza e' QUELLA STAMPATA SUL CERTIFICATO (il calcolo decorrenza + 12 mesi e' solo un
// default etichettato «stimata»); il giorno di scadenza e' l'ultimo giorno coperto; la tolleranza di 15 giorni
// (art. 170-bis D.Lgs. 209/2005) NON sposta mai la data ne' i promemoria: compare solo come nota informativa.
import { addDays, addMonths, diffDays, type LocalDate } from '@/domain/dates';
import { deadlineStatus } from '@/domain/italy/calendar';
import { SOURCES, VERIFIED_ON } from '@/domain/italy/sources';
import { buildDeadline, buildOutcome, type DeadlineResult, type Rule, type RuleOutcome } from '@/domain/italy/types';

export interface RcaPrintedParams {
  readonly leadDays: readonly number[];
}

export interface RcaEstimatedParams {
  /** Durata di default della polizza (annuale). */
  readonly months: number;
  readonly leadDays: readonly number[];
}

export interface RcaGraceParams {
  /** Giorni dopo la scadenza in cui la compagnia mantiene la garanzia precedente fino all'effetto della nuova polizza. */
  readonly days: number;
}

export interface RcaRules {
  readonly printed: Rule<RcaPrintedParams>;
  readonly estimated: Rule<RcaEstimatedParams>;
  readonly grace: Rule<RcaGraceParams>;
}

/** Preavvisi dell'app (SPEC §7.4 / F-52): 30, 14, 7, 1 giorni prima e il giorno stesso. */
export const RCA_LEAD_DAYS: readonly number[] = [30, 14, 7, 1, 0];

export const RCA_WARNING =
  'La data di scadenza è quella indicata sul tuo contratto o certificato: controllala. La polizza non si rinnova automaticamente: se non ne stipuli una nuova resti senza copertura. La legge prevede che la compagnia mantenga la garanzia fino a 15 giorni dopo la scadenza solo fino all\'effetto della nuova polizza: non farci affidamento. Circolare senza assicurazione comporta una sanzione da 866 a 3.464 euro e il sequestro del veicolo.';

export const RCA_GRACE_NOTE =
  "La compagnia mantiene la garanzia precedente fino a 15 giorni dopo la scadenza solo fino all'effetto della nuova polizza: è un ponte per cambiare compagnia, non una proroga, e non vale all'estero. Non farci affidamento.";

const RCA_SOURCES = [SOURCES.ivass_rca, SOURCES.aci_art193, SOURCES.portale_rca_tacito, SOURCES.sicurauto_tolleranza_rca] as const;

export const RCA_RULES: RcaRules = {
  printed: {
    id: 'it.rca.expiry_printed',
    topic: 'rca',
    title: 'Scadenza stampata sul certificato',
    summary:
      "Contratto annuale (o «anno più frazione»), nessun tacito rinnovo; l'impresa deve avvisare con almeno 30 giorni di anticipo (art. 170-bis D.Lgs. 209/2005). Vale la data stampata sul certificato.",
    validFrom: '2013-01-01',
    validTo: null,
    sources: RCA_SOURCES,
    confidence: 'official',
    evidence: 'high',
    verifiedOn: VERIFIED_ON,
    warningText: RCA_WARNING,
    openPoints: [
      "L'ora esatta di scadenza dipende dal contratto (spesso ore 24 del giorno indicato): verifica sul certificato.",
      'Data di abolizione del tacito rinnovo (1-1-2013) non riverificata.',
    ],
    params: { leadDays: RCA_LEAD_DAYS },
  },
  estimated: {
    id: 'it.rca.expiry_estimated',
    topic: 'rca',
    title: 'Scadenza stimata (decorrenza + 12 mesi)',
    summary: "Se non conosci la data del certificato, si stima la scadenza a 12 mesi dalla decorrenza (29/02 diventa 28/02).",
    validFrom: '2013-01-01',
    validTo: null,
    sources: RCA_SOURCES,
    confidence: 'indicative',
    evidence: 'medium',
    verifiedOn: VERIFIED_ON,
    warningText: RCA_WARNING,
    openPoints: ['Polizze temporanee o di durata diversa: usare la data stampata sul certificato.'],
    params: { months: 12, leadDays: RCA_LEAD_DAYS },
  },
  grace: {
    id: 'it.rca.grace_period',
    topic: 'rca',
    title: 'Periodo di tolleranza di 15 giorni (solo informativo)',
    summary:
      "La compagnia mantiene operante la garanzia del contratto precedente non oltre il quindicesimo giorno successivo alla scadenza, fino all'effetto della nuova polizza (art. 170-bis c.1). Non sposta la scadenza né i promemoria.",
    validFrom: '2020-08-01',
    validTo: null,
    sources: RCA_SOURCES,
    confidence: 'official',
    evidence: 'high',
    verifiedOn: VERIFIED_ON,
    warningText: RCA_GRACE_NOTE,
    openPoints: [
      "Testo letto su Brocardi, non su Normattiva; dal 1-8-2020 la tolleranza è tornata a 15 giorni (era 30 durante l'emergenza Covid).",
      "Uso dell'attestato di rischio oltre i 15 giorni (dichiarazione di non circolazione): confidenza bassa, non modellato.",
    ],
    params: { days: 15 },
  },
};

export type RcaBasis = 'printed_on_certificate' | 'estimated_from_start' | 'unknown';

export interface RcaInput {
  /** Scadenza stampata sul certificato: vince sempre. */
  readonly expiryOn?: LocalDate | null;
  /** Decorrenza della polizza: serve solo per la stima. */
  readonly policyStartOn?: LocalDate | null;
}

export interface RcaDue extends DeadlineResult<RcaBasis> {
  /** Ultimo giorno della tolleranza INFORMATIVA (scadenza + 15 giorni); null se la scadenza e' sconosciuta. */
  readonly graceEndsOn: LocalDate | null;
  /** True se la scadenza e' stimata (decorrenza + 12 mesi) e non letta sul certificato. */
  readonly isEstimated: boolean;
}

/** Scadenza default se l'utente non inserisce quella del certificato (vettori A1, A2). */
export function rcaDefaultExpiry(policyStartOn: LocalDate, rules: RcaRules = RCA_RULES): LocalDate {
  return addMonths(policyStartOn, rules.estimated.params.months);
}

export function rcaGraceEnd(expiryOn: LocalDate, rules: RcaRules = RCA_RULES): LocalDate {
  return addDays(expiryOn, rules.grace.params.days);
}

export function rcaDue(input: RcaInput, rules: RcaRules = RCA_RULES): RcaDue {
  if (input.expiryOn) {
    return {
      ...buildDeadline(rules.printed, input.expiryOn, 'printed_on_certificate'),
      graceEndsOn: rcaGraceEnd(input.expiryOn, rules),
      isEstimated: false,
    };
  }
  if (input.policyStartOn) {
    const expiry = rcaDefaultExpiry(input.policyStartOn, rules);
    return {
      ...buildDeadline(rules.estimated, expiry, 'estimated_from_start', {
        caveats: ['Scadenza stimata (decorrenza + 12 mesi): inserisci la data stampata sul certificato.'],
      }),
      graceEndsOn: rcaGraceEnd(expiry, rules),
      isEstimated: true,
    };
  }
  return {
    ...buildDeadline(rules.printed, null, 'unknown', { reasonCode: 'NO_EXPIRY_DATE' }),
    graceEndsOn: null,
    isEstimated: false,
  };
}

export type RcaState = 'valid' | 'due_today' | 'in_grace' | 'uncovered';

export interface RcaStatus extends RuleOutcome {
  readonly state: RcaState;
  /** Giorni alla scadenza (>= 0) se valida o in scadenza oggi; null altrimenti. */
  readonly daysLeft: number | null;
  /** Giorni di ritardo (>= 1) se oltre la scadenza; null altrimenti. */
  readonly daysOverdue: number | null;
  readonly graceEndsOn: LocalDate;
  readonly label: string;
  /** Nota informativa sulla tolleranza (solo quando `state` e' `in_grace`). */
  readonly note: string | null;
}

/**
 * Stato della copertura alla data `today` (vettori A3-A6). La tolleranza e' solo una NOTA: oltre la scadenza lo stato
 * resta «in tolleranza» fino al 15º giorno incluso, poi «scoperta».
 */
export function rcaStatus(today: LocalDate, expiryOn: LocalDate, rules: RcaRules = RCA_RULES): RcaStatus {
  const graceEndsOn = rcaGraceEnd(expiryOn, rules);
  const base = { ...buildOutcome(rules.grace), dueOn: expiryOn, graceEndsOn };
  const left = diffDays(today, expiryOn);
  if (left > 0) {
    const s = deadlineStatus(today, expiryOn);
    return { ...base, state: 'valid', daysLeft: left, daysOverdue: null, label: s.label, note: null };
  }
  if (left === 0) {
    return { ...base, state: 'due_today', daysLeft: 0, daysOverdue: null, label: 'Scade oggi', note: null };
  }
  const late = -left;
  if (today <= graceEndsOn) {
    return {
      ...base,
      state: 'in_grace',
      daysLeft: null,
      daysOverdue: late,
      label: 'In tolleranza',
      note: RCA_GRACE_NOTE,
    };
  }
  return { ...base, state: 'uncovered', daysLeft: null, daysOverdue: late, label: 'Scoperta', note: null };
}
