// Regole sui pneumatici (SPEC §7.5, REG §4) come DATI: finestra invernale, battistrada, eta' da codice DOT.
import { SOURCES, VERIFIED_ON } from '@/domain/italy/sources';
import type { Rule } from '@/domain/italy/types';

export interface MonthDay {
  readonly month: number;
  readonly day: number;
}

/** Data relativa a una stagione: `yearOffset` 0 = anno di inizio stagione, 1 = anno successivo. */
export interface SeasonDate extends MonthDay {
  readonly yearOffset: 0 | 1;
}

export interface WinterWindowParams {
  /** Montaggio consentito (15 ottobre). */
  readonly mountAllowedFrom: SeasonDate;
  /** Inizio periodo delle ordinanze (15 novembre). */
  readonly obligationFrom: SeasonDate;
  /** Fine periodo delle ordinanze (15 aprile). */
  readonly obligationTo: SeasonDate;
  /** Limite per invernali con indice di velocita' inferiore a quello del libretto (15 maggio; minimo Q = 160 km/h). */
  readonly lowSpeedIndexUntil: SeasonDate;
  readonly minSpeedIndex: string;
  /** Promemoria stagionali suggeriti da REG §4.3 (1/10, 8/11, 15/11, 1/4, 15/4). */
  readonly reminders: readonly SeasonDate[];
  /** Preavvisi del catalogo per il montaggio (`tpl_tyres_winter`, `tpl_tyres_summer`). */
  readonly leadDays: readonly number[];
}

export interface TreadParams {
  /** Battistrada minimo di legge (mm) nelle scanalature principali. */
  readonly legalMinMm: number;
  /** Soglia consigliata (mm): sotto, sostituire presto. */
  readonly recommendedMm: number;
  /** Soglia consigliata d'inverno (mm): soglia non verificata. */
  readonly winterRecommendedMm: number;
}

export interface DotParams {
  /** Eta' (anni) dopo la quale si consiglia un controllo specialistico. */
  readonly checkAfterYears: number;
  /** Eta' (anni) alla quale si consiglia la sostituzione. */
  readonly replaceAfterYears: number;
  /** Giorni medi per anno usati per l'eta' decimale. */
  readonly daysPerYear: number;
}

export interface TyreRules {
  readonly winterWindow: Rule<WinterWindowParams>;
  readonly treadLegal: Rule<TreadParams>;
  readonly treadAdvice: Rule<TreadParams>;
  readonly dotAge: Rule<DotParams>;
}

export const TYRES_WARNING =
  "Dal 15 novembre al 15 aprile, dove c'è l'apposita segnaletica o ordinanza, devi avere pneumatici invernali montati oppure le catene a bordo. Non c'è un obbligo valido ovunque: controlla le ordinanze del percorso. Il battistrada minimo di legge è 1,6 mm, ma sotto i 3-4 mm la sicurezza cala molto. L'età (codice DOT) è un'indicazione prudenziale.";

const TREAD_PARAMS: TreadParams = { legalMinMm: 1.6, recommendedMm: 3, winterRecommendedMm: 4 };

export const TYRE_RULES: TyreRules = {
  winterWindow: {
    id: 'it.tyres.winter_window',
    topic: 'tyres',
    title: 'Pneumatici invernali e catene',
    summary:
      "Non esiste un obbligo nazionale indistinto: dove c'è segnaletica o ordinanza, dal 15 novembre al 15 aprile servono pneumatici invernali (M+S o 3PMSF) oppure catene a bordo; montaggio consentito dal 15 ottobre; invernali con indice di velocità inferiore al libretto (minimo Q) ammessi fino al 15 maggio (circolare MIT 1049/2014). Con pneumatici estivi sono ammesse anche le «calze» conformi a UNI EN 16662-1:2020.",
    validFrom: '2013-01-16',
    validTo: null,
    sources: [SOURCES.aci_gomme_invernali, SOURCES.polizia_gomme],
    confidence: 'official',
    evidence: 'high',
    verifiedOn: VERIFIED_ON,
    warningText: TYRES_WARNING,
    openPoints: [
      'Ordinanze locali più restrittive o con date diverse (Bolzano/Trento, autostrade, strade ANAS): non modellabili.',
      'Adesivo in abitacolo per invernali con indice inferiore: confidenza bassa.',
      'Sanzioni: 87-344 EUR fuori dai centri abitati (art. 6), 42-173 EUR dentro (art. 7): indicative.',
    ],
    params: {
      mountAllowedFrom: { month: 10, day: 15, yearOffset: 0 },
      obligationFrom: { month: 11, day: 15, yearOffset: 0 },
      obligationTo: { month: 4, day: 15, yearOffset: 1 },
      lowSpeedIndexUntil: { month: 5, day: 15, yearOffset: 1 },
      minSpeedIndex: 'Q',
      reminders: [
        { month: 10, day: 1, yearOffset: 0 },
        { month: 11, day: 8, yearOffset: 0 },
        { month: 11, day: 15, yearOffset: 0 },
        { month: 4, day: 1, yearOffset: 1 },
        { month: 4, day: 15, yearOffset: 1 },
      ],
      leadDays: [14, 3, 0],
    },
  },
  treadLegal: {
    id: 'it.tyres.tread_legal',
    topic: 'tyres',
    title: 'Battistrada minimo di legge',
    summary: '1,6 mm nelle scanalature principali (art. 237 Reg. di esecuzione del CdS).',
    validFrom: '1992-12-16',
    validTo: null,
    sources: [SOURCES.aci_gomme_invernali],
    confidence: 'practice',
    evidence: 'medium',
    verifiedOn: VERIFIED_ON,
    warningText: TYRES_WARNING,
    openPoints: ["Art. 237 Reg. non riletto su fonte primaria: conoscenza consolidata, [DA VERIFICARE]."],
    params: TREAD_PARAMS,
  },
  treadAdvice: {
    id: 'it.tyres.tread_advice',
    topic: 'tyres',
    title: 'Battistrada consigliato',
    summary: 'Consigliati almeno 3 mm (4 mm in inverno): sotto la tenuta cala, soprattutto sul bagnato. Non è un obbligo.',
    validFrom: '1992-12-16',
    validTo: null,
    sources: [SOURCES.polizia_gomme],
    confidence: 'indicative',
    evidence: 'medium',
    verifiedOn: VERIFIED_ON,
    warningText: TYRES_WARNING,
    openPoints: ['Soglia invernale di 4 mm non verificata.'],
    params: TREAD_PARAMS,
  },
  dotAge: {
    id: 'it.tyres.dot_age',
    topic: 'tyres',
    title: 'Età dei pneumatici (codice DOT)',
    summary:
      'Il codice DOT (ultime 4 cifre WWYY: settimana e anno di produzione) permette di calcolare l’età. Nessun limite di legge trovato per le auto; consiglio dei costruttori: controllo dopo 5 anni, sostituzione intorno ai 10.',
    validFrom: '2000-01-01',
    validTo: null,
    sources: [SOURCES.polizia_gomme],
    confidence: 'indicative',
    evidence: 'low',
    verifiedOn: VERIFIED_ON,
    warningText:
      "L'età dei pneumatici (codice DOT) è un'indicazione prudenziale: controllali dopo 5 anni e valuta la sostituzione intorno ai 10.",
    openPoints: ['Nessuna fonte primaria letta: consiglio, non obbligo.', 'Il DOT a 3 cifre (prima del 2000) non è gestito.'],
    params: { checkAfterYears: 5, replaceAfterYears: 10, daysPerYear: 365.25 },
  },
};
