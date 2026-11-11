// Revisione periodica (art. 80 CdS) - SPEC §7.2, REG §1. Dominio puro.
// Prima revisione: 4 anni dalla prima immatricolazione, a fine mese; poi ogni 2 anni dal mese dell'ULTIMA revisione
// effettivamente eseguita (anche se anticipata). `manualDueOn` (data letta sul portale/libretto) vince su tutto.
import { addMonths, endOfMonth, type LocalDate } from '@/domain/dates';
import { SOURCES, VERIFIED_ON } from './sources';
import { buildDeadline, type DeadlineResult, type Rule } from './types';

export interface InspectionIntervalParams {
  readonly afterMonths: number;
  readonly endOfMonth: boolean;
  /** Preavvisi in giorni prima della scadenza (0 = il giorno stesso): catalogo SPEC §7.1, `tpl_inspection`. */
  readonly leadDays: readonly number[];
}

export interface InspectionRepeatParams {
  /** Mesi di calendario (non 30 giorni) per rifare la revisione con esito «da ripetere». */
  readonly withinMonths: number;
}

export interface InspectionRules {
  readonly first: Rule<InspectionIntervalParams>;
  readonly next: Rule<InspectionIntervalParams>;
  readonly repeat: Rule<InspectionRepeatParams>;
  readonly suspended: Rule;
  readonly manual: Rule<{ readonly leadDays: readonly number[] }>;
}

export const INSPECTION_LEAD_DAYS: readonly number[] = [60, 30, 14, 7, 0];

export const INSPECTION_WARNING =
  "La scadenza è calcolata dalla prima immatricolazione o dall'ultima revisione che hai inserito (art. 80 del Codice della Strada: prima revisione dopo 4 anni, poi ogni 2, entro l'ultimo giorno del mese). È un promemoria: controlla la data effettiva sul Portale dell'Automobilista (servizio «Verifica revisioni effettuate»). Circolare con la revisione scaduta comporta una sanzione da circa 173 a 694 euro. Se dopo un incidente la Motorizzazione dispone una revisione singola, segui la data indicata nella sua comunicazione.";

/** Suggerimento prima di prenotare (SPEC §7.2): sinergia con il modulo OBD. */
export const INSPECTION_PRE_BOOKING_HINT =
  'Leggi i codici con MyGarage: con la spia motore accesa la revisione dà esito irregolare.';

const SOURCES_INSPECTION = [
  SOURCES.normattiva_cds,
  SOURCES.mit_revisioni,
  SOURCES.portale_revisioni,
  SOURCES.aci_art80,
  SOURCES.aci_revisione,
] as const;

export const INSPECTION_RULES: InspectionRules = {
  first: {
    id: 'it.inspection.first',
    topic: 'inspection',
    title: 'Prima revisione',
    summary:
      "Entro 4 anni dalla prima immatricolazione, entro l'ultimo giorno del mese (art. 80 c.3 CdS; «entro il mese» è prassi MIT).",
    validFrom: '1992-04-30',
    validTo: null,
    sources: SOURCES_INSPECTION,
    confidence: 'official',
    evidence: 'high',
    verifiedOn: VERIFIED_ON,
    warningText: INSPECTION_WARNING,
    openPoints: [
      'La formula «entro il mese» non è nel testo di legge ma nella comunicazione MIT («mese di rilascio della carta di circolazione»).',
      'Auto importate usate: non verificato se i 4 anni decorrano dalla prima immatricolazione estera o italiana.',
      "Veicoli storici/ultratrentennali: stessa revisione biennale? Non verificato.",
      "Pacchetto UE (revisione annuale oltre i 10 anni): non definitivo; l'intervallo è un dato configurabile.",
    ],
    params: { afterMonths: 48, endOfMonth: true, leadDays: INSPECTION_LEAD_DAYS },
  },
  next: {
    id: 'it.inspection.next',
    topic: 'inspection',
    title: 'Revisioni successive',
    summary:
      "Ogni 2 anni, entro il mese corrispondente a quello dell'ultima revisione effettivamente eseguita (anche se anticipata).",
    validFrom: '1992-04-30',
    validTo: null,
    sources: SOURCES_INSPECTION,
    confidence: 'practice',
    evidence: 'medium',
    verifiedOn: VERIFIED_ON,
    warningText: INSPECTION_WARNING,
    openPoints: [
      'Revisione eseguita molto in anticipo o in ritardo: nessuna fonte primaria; si usa il mese della revisione eseguita.',
    ],
    params: { afterMonths: 24, endOfMonth: true, leadDays: INSPECTION_LEAD_DAYS },
  },
  repeat: {
    id: 'it.inspection.repeat',
    topic: 'inspection',
    title: 'Revisione da ripetere',
    summary: 'Con esito «da ripetere» la revisione va rifatta entro un mese di calendario (non 30 giorni) dopo le riparazioni.',
    validFrom: '1992-04-30',
    validTo: null,
    sources: [SOURCES.mit_revisioni, SOURCES.portale_revisioni],
    confidence: 'official',
    evidence: 'high',
    verifiedOn: VERIFIED_ON,
    warningText:
      'Con esito «da ripetere» devi far riparare il veicolo e rifare la revisione entro un mese. Controlla la data sul verbale della revisione e, se diversa, inseriscila a mano.',
    openPoints: [],
    params: { withinMonths: 1 },
  },
  suspended: {
    id: 'it.inspection.suspended',
    topic: 'inspection',
    title: 'Revisione sospesa',
    summary: 'Con esito «sospesa» serve una nuova richiesta di revisione: non c’è una scadenza calcolabile.',
    validFrom: '1992-04-30',
    validTo: null,
    sources: [SOURCES.portale_revisioni, SOURCES.normattiva_cds],
    confidence: 'official',
    evidence: 'high',
    verifiedOn: VERIFIED_ON,
    warningText:
      "Dopo una revisione sospesa serve una nuova richiesta di revisione: leggi le indicazioni sul Portale dell'Automobilista.",
    openPoints: [],
    params: {},
  },
  manual: {
    id: 'it.inspection.manual',
    topic: 'inspection',
    title: 'Scadenza letta sul documento',
    summary: 'Data letta sul portale o sul libretto: vince sempre sul calcolo.',
    validFrom: '1992-04-30',
    validTo: null,
    sources: [SOURCES.portale_revisioni],
    confidence: 'official',
    evidence: 'high',
    verifiedOn: VERIFIED_ON,
    warningText: INSPECTION_WARNING,
    openPoints: [],
    params: { leadDays: INSPECTION_LEAD_DAYS },
  },
};

/** Esito della revisione (campo manuale, SPEC §7.2). */
export type InspectionOutcome = 'regular' | 'to_repeat' | 'suspended';

export interface InspectionInput {
  /** Data di prima immatricolazione (carta di circolazione). */
  readonly firstRegisteredOn: LocalDate;
  /** Data dell'ultima revisione effettivamente eseguita. */
  readonly lastInspectionOn?: LocalDate | null;
  /** Esito dell'ultima revisione; se assente si assume «regolare». */
  readonly lastOutcome?: InspectionOutcome | null;
  /** Scadenza letta sul portale/libretto: vince su tutto. */
  readonly manualDueOn?: LocalDate | null;
  /** Auto gia' immatricolata all'estero: la regola dei 4 anni non e' verificata (confidenza bassa). */
  readonly importedFromAbroad?: boolean;
}

export type InspectionBasis = 'manual' | 'first_registration' | 'last_inspection' | 'repeat' | 'suspended';

const IMPORTED_CAVEAT =
  "Auto importata: non è verificato se i 4 anni decorrano dalla prima immatricolazione estera o italiana. Controlla la data sulla carta di circolazione o sul Portale dell'Automobilista.";

export function inspectionDue(input: InspectionInput, rules: InspectionRules = INSPECTION_RULES): DeadlineResult<InspectionBasis> {
  if (input.manualDueOn) return buildDeadline(rules.manual, input.manualDueOn, 'manual');

  const last = input.lastInspectionOn ?? null;
  if (last !== null) {
    const outcome = input.lastOutcome ?? 'regular';
    if (outcome === 'suspended') {
      return buildDeadline(rules.suspended, null, 'suspended', { reasonCode: 'INSPECTION_SUSPENDED' });
    }
    if (outcome === 'to_repeat') {
      return buildDeadline(rules.repeat, addMonths(last, rules.repeat.params.withinMonths), 'repeat');
    }
    const p = rules.next.params;
    const due = addMonths(last, p.afterMonths);
    return buildDeadline(rules.next, p.endOfMonth ? endOfMonth(due) : due, 'last_inspection');
  }

  const p = rules.first.params;
  const due = addMonths(input.firstRegisteredOn, p.afterMonths);
  const imported = input.importedFromAbroad === true;
  return buildDeadline(rules.first, p.endOfMonth ? endOfMonth(due) : due, 'first_registration', {
    caveats: imported ? [IMPORTED_CAVEAT] : [],
    confidence: imported ? 'indicative' : undefined,
  });
}
