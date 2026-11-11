// Tipi condivisi delle regole italiane delle scadenze (SPEC §7, REG §0 e §12). Dominio puro.
//
// Principi (SPEC §7):
//  - ogni regola e' un DATO (`Rule`) con validita', fonti, confidenza e data di verifica;
//  - ogni calcolo e' una funzione pura che restituisce sempre `{ dueOn, rule, ruleId, verifiedOn, confidence,
//    warningText }` (piu' `basis`, `caveats`, `reasonCode`); l'orologio e' sempre un parametro;
//  - una data letta sul documento ufficiale (override manuale) vince sempre sul calcolo.
import type { LocalDate } from '@/domain/dates';

export type { LocalDate };

/** official = testo di legge o fonte ufficiale; practice = prassi/fonti secondarie autorevoli; indicative = consiglio tecnico. */
export type Confidence = 'official' | 'practice' | 'indicative';

/** Affidabilita' della ricerca dietro la regola (REG: alta / media / bassa). */
export type Evidence = 'high' | 'medium' | 'low';

export type RuleTopic = 'inspection' | 'road_tax' | 'rca' | 'tyres' | 'gas' | 'licence' | 'transfer';

export interface RuleSource {
  readonly label: string;
  readonly url: string;
}

/** Metadati di una regola: cio' che la scheda della scadenza mostra all'utente. */
export interface RuleBase {
  /** Identificatore stabile, es. 'it.inspection.first'. */
  readonly id: string;
  readonly topic: RuleTopic;
  readonly title: string;
  /** Cosa dice la regola, in italiano. */
  readonly summary: string;
  /** Primo giorno in cui la regola si applica (alla data di riferimento indicata nella funzione). */
  readonly validFrom: LocalDate;
  /** Ultimo giorno di applicazione; null = senza scadenza nota. */
  readonly validTo: LocalDate | null;
  readonly sources: readonly RuleSource[];
  readonly confidence: Confidence;
  readonly evidence: Evidence;
  /** Data dell'ultima verifica delle fonti (rilettura manuale ogni 6 mesi e prima di ogni rilascio). */
  readonly verifiedOn: LocalDate;
  /** Avvertenza da mostrare accanto alla scadenza. */
  readonly warningText: string;
  /** Punti ancora [DA VERIFICARE] sulla regola. */
  readonly openPoints: readonly string[];
}

/** Regola con i parametri numerici che il calcolo legge (cosi' non restano costanti sparse nel codice). */
export interface Rule<P extends object = object> extends RuleBase {
  readonly params: P;
}

/** Perche' `dueOn` e' null: mai dati inventati (SPEC §8.3, invariante I3). */
export type UnknownReason = 'INSPECTION_SUSPENDED' | 'GAS_TYPE_UNKNOWN' | 'NO_EXPIRY_DATE';

/** Forma minima restituita da ogni funzione di regola. */
export interface RuleOutcome {
  /** Scadenza calcolata; null se non calcolabile (vedi `reasonCode` nei risultati di scadenza). */
  readonly dueOn: LocalDate | null;
  readonly rule: Rule;
  readonly ruleId: string;
  readonly verifiedOn: LocalDate;
  readonly confidence: Confidence;
  readonly warningText: string;
}

export interface DeadlineResult<B extends string = string> extends RuleOutcome {
  /** Da cosa e' stata calcolata ('manual', 'first_registration', ...). */
  readonly basis: B;
  /** Avvisi specifici del caso (auto importata, soglia incerta, ...). */
  readonly caveats: readonly string[];
  readonly reasonCode: UnknownReason | null;
}

export interface BuildOptions {
  readonly confidence?: Confidence;
  readonly warningText?: string;
  readonly caveats?: readonly string[];
  readonly reasonCode?: UnknownReason;
}

/** Costruisce il risultato standard a partire dalla regola applicata. */
export function buildDeadline<B extends string>(
  rule: Rule,
  dueOn: LocalDate | null,
  basis: B,
  opts: BuildOptions = {},
): DeadlineResult<B> {
  return {
    dueOn,
    rule,
    ruleId: rule.id,
    verifiedOn: rule.verifiedOn,
    confidence: opts.confidence ?? rule.confidence,
    warningText: opts.warningText ?? rule.warningText,
    basis,
    caveats: opts.caveats ?? [],
    reasonCode: opts.reasonCode ?? null,
  };
}

/** Costruisce un risultato senza data (stato, valutazione) che porta comunque i metadati della regola. */
export function buildOutcome(rule: Rule, opts: Pick<BuildOptions, 'confidence' | 'warningText'> = {}): RuleOutcome {
  return {
    dueOn: null,
    rule,
    ruleId: rule.id,
    verifiedOn: rule.verifiedOn,
    confidence: opts.confidence ?? rule.confidence,
    warningText: opts.warningText ?? rule.warningText,
  };
}

export function ruleAppliesOn(rule: RuleBase, on: LocalDate): boolean {
  return on >= rule.validFrom && (rule.validTo === null || on <= rule.validTo);
}

/** Sceglie, fra piu' versioni della stessa regola, quella valida alla data indicata. */
export function selectRule<R extends RuleBase>(rules: readonly R[], on: LocalDate): R | undefined {
  return rules.find((r) => ruleAppliesOn(r, on));
}
