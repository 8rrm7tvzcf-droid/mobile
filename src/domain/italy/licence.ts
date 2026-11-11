// Patente di guida e neopatentati (V1) - SPEC §7.7, REG §6. Dominio puro.
// Durata A/B: 10 anni fino a 50 anni di eta', 5 da 50 a 70, 3 da 70 a 80, 2 oltre.
// REGOLA DEL COMPLEANNO (solo A/B con scadenza ordinaria, dal 17-9-2012): la scadenza effettiva e' il PRIMO
// compleanno successivo alla scadenza ordinaria (rinnovo + N anni), NON il compleanno dell'anno di rinnovo + N.
// Il campo 4b della patente vince sempre.
import { addMonths, daysInMonth, makeDate, parseDate, type LocalDate } from '@/domain/dates';
import { SOURCES, VERIFIED_ON } from './sources';
import { buildDeadline, selectRule, type DeadlineResult, type Rule } from './types';

export interface LicenceBand {
  /** Il rinnovo cade in questa fascia se l'eta' e' minore di `belowAge` (null = nessun limite). */
  readonly belowAge: number | null;
  readonly years: number;
}

export interface LicenceExpiryParams {
  readonly bands: readonly LicenceBand[];
  /** Data da cui vale la regola del compleanno (A/B con scadenza ordinaria). */
  readonly birthdayRuleFrom: LocalDate;
  /** Dall'eta' indicata il rinnovo passa dalla commissione medica locale (la regola del compleanno e' incerta). */
  readonly commissionFromAge: number;
  /** Soglie di eta' il cui giorno esatto e' [DA VERIFICARE] (art. 126 c.2 «ha superato» vs MIT «fino al compimento»). */
  readonly ambiguousThresholdAges: readonly number[];
  readonly leadDays: readonly number[];
}

export interface NewDriverParams {
  readonly months: number;
  /** Limite di potenza specifica (kW/t); null = non riportato nella ricerca (regime previgente). */
  readonly maxPowerKwPerTonne: number | null;
  /** Limite di potenza massima per le autovetture M1 (kW); null = non riportato. */
  readonly maxPowerKwCarM1: number | null;
}

export interface LicenceRules {
  readonly expiry: Rule<LicenceExpiryParams>;
  readonly manual: Rule<{ readonly leadDays: readonly number[] }>;
  /** Versioni dei limiti per neopatentati, scelte con la data di conseguimento (validFrom/validTo). */
  readonly newDriver: readonly [Rule<NewDriverParams>, Rule<NewDriverParams>];
}

export const LICENCE_LEAD_DAYS: readonly number[] = [120, 60, 30, 7];

export const LICENCE_WARNING =
  "La scadenza della patente è calcolata dalla data di nascita e dall'ultimo rinnovo che hai inserito (10 anni fino a 50 anni di età, 5 fino a 70, 3 fino a 80, 2 oltre) e, per le patenti A/B con scadenza ordinaria, cade nel giorno del compleanno successivo alla scadenza ordinaria. Verifica la data riportata sul documento (campo 4b). Le regole europee approvate nel 2025 (patente valida 15 anni) non sono ancora in vigore in Italia. Per i neopatentati valgono per 3 anni limiti alla potenza del veicolo.";

const SOURCES_LICENCE = [SOURCES.aci_art126, SOURCES.portale_patente_compleanno, SOURCES.mit_rinnovo_patente] as const;

export const LICENCE_RULES: LicenceRules = {
  expiry: {
    id: 'it.licence.expiry',
    topic: 'licence',
    title: 'Scadenza della patente A/B',
    summary:
      '10 anni fino a 50 anni di età, 5 da 50 a 70, 3 da 70 a 80, 2 oltre; la scadenza effettiva è il primo compleanno successivo alla scadenza ordinaria (rinnovo + N anni).',
    validFrom: '2012-09-17',
    validTo: null,
    sources: SOURCES_LICENCE,
    confidence: 'official',
    evidence: 'high',
    verifiedOn: VERIFIED_ON,
    warningText: LICENCE_WARNING,
    openPoints: [
      'Soglie esatte a 50 e 70 anni nel giorno del compleanno: art. 126 c.2 «ha superato» vs MIT «fino al compimento».',
      'Rinnovo degli ultraottantenni via commissione medica locale: la regola del compleanno può non valere.',
      'Coincidenza fra compleanno e scadenza ordinaria; clamp del 29 febbraio al 28 (scelta di implementazione).',
      'Direttiva (UE) 2025/2205 (patente 15 anni): non in vigore in Italia fino al recepimento.',
    ],
    params: {
      bands: [
        { belowAge: 50, years: 10 },
        { belowAge: 70, years: 5 },
        { belowAge: 80, years: 3 },
        { belowAge: null, years: 2 },
      ],
      birthdayRuleFrom: '2012-09-17',
      commissionFromAge: 80,
      ambiguousThresholdAges: [50, 70],
      leadDays: LICENCE_LEAD_DAYS,
    },
  },
  manual: {
    id: 'it.licence.expiry_manual',
    topic: 'licence',
    title: 'Scadenza letta sulla patente (campo 4b)',
    summary: 'Data riportata sul documento: vince sempre sul calcolo.',
    validFrom: '1992-04-30',
    validTo: null,
    sources: [SOURCES.aci_art126],
    confidence: 'official',
    evidence: 'high',
    verifiedOn: VERIFIED_ON,
    warningText: LICENCE_WARNING,
    openPoints: [],
    params: { leadDays: LICENCE_LEAD_DAYS },
  },
  newDriver: [
    {
      id: 'it.licence.new_driver.until_2024-12-13',
      topic: 'licence',
      title: 'Neopatentati (patenti conseguite fino al 13-12-2024)',
      summary: 'Regime previgente: limiti di potenza per 1 anno dal conseguimento della patente B.',
      validFrom: '1900-01-01',
      validTo: '2024-12-13',
      sources: [SOURCES.aci_legge_177, SOURCES.aci_neopatentati],
      confidence: 'practice',
      evidence: 'medium',
      verifiedOn: VERIFIED_ON,
      warningText:
        "Per i neopatentati valgono limiti alla potenza del veicolo (per le patenti conseguite fino al 13-12-2024, per 1 anno). Verifica le regole aggiornate sul Portale dell'Automobilista.",
      openPoints: ['Testo della L. 177/2024 non letto: applicabilità dal 14-12-2024 confermata da più sintesi (ACI).'],
      params: { months: 12, maxPowerKwPerTonne: null, maxPowerKwCarM1: null },
    },
    {
      id: 'it.licence.new_driver.from_2024-12-14',
      topic: 'licence',
      title: 'Neopatentati (patenti conseguite dal 14-12-2024)',
      summary:
        'L. 177/2024: per 3 anni dal conseguimento della patente B niente veicoli con potenza specifica oltre 75 kW/t e, per le M1, potenza massima 105 kW.',
      validFrom: '2024-12-14',
      validTo: null,
      sources: [SOURCES.aci_legge_177, SOURCES.aci_neopatentati],
      confidence: 'practice',
      evidence: 'medium',
      verifiedOn: VERIFIED_ON,
      warningText:
        "Per i neopatentati valgono per 3 anni limiti alla potenza del veicolo (75 kW/t; 105 kW per le autovetture M1). Verifica le regole aggiornate sul Portale dell'Automobilista.",
      openPoints: ['Testo della L. 177/2024 non letto: limiti confermati da più sintesi (ACI).'],
      params: { months: 36, maxPowerKwPerTonne: 75, maxPowerKwCarM1: 105 },
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------------

/** Eta' compiuta in `on` (compleanno non ancora raggiunto = anno in meno). */
export function ageOn(birthOn: LocalDate, on: LocalDate): number {
  const b = parseDate(birthOn);
  const o = parseDate(on);
  let age = o.y - b.y;
  if (o.m < b.m || (o.m === b.m && o.d < b.d)) age--;
  return age;
}

/** Anni di validita' per l'eta' al rinnovo (REG §6.2). */
export function licenceValidityYears(ageAtRenewal: number, rules: LicenceRules = LICENCE_RULES): number {
  for (const band of rules.expiry.params.bands) {
    if (band.belowAge === null || ageAtRenewal < band.belowAge) return band.years;
  }
  throw new RangeError('Fasce di validità della patente non valide');
}

/** Compleanno dell'anno `year` (29/02 -> 28/02 negli anni non bisestili). */
function birthdayIn(year: number, birthOn: LocalDate): LocalDate {
  const { m, d } = parseDate(birthOn);
  return makeDate(year, m, Math.min(d, daysInMonth(year, m)));
}

export type LicenceBasis = 'manual' | 'birthday_after_ordinary' | 'ordinary';

export interface LicenceInput {
  readonly birthOn: LocalDate;
  /** Data del rilascio o dell'ultimo rinnovo/conferma di validita'. */
  readonly issuedOrRenewedOn: LocalDate;
  /** Scadenza letta sul campo 4b della patente: vince sempre. */
  readonly manualExpiryOn?: LocalDate | null;
  /**
   * Falso per C/D/CQC e per le A/B rinnovate con visita medica locale o specialistica: la regola del compleanno
   * non vale e si usa la scadenza ordinaria (confidenza indicativa). Default: vero.
   */
  readonly birthdayRuleApplies?: boolean;
}

export function licenceExpiry(input: LicenceInput, rules: LicenceRules = LICENCE_RULES): DeadlineResult<LicenceBasis> {
  if (input.manualExpiryOn) return buildDeadline(rules.manual, input.manualExpiryOn, 'manual');

  const p = rules.expiry.params;
  const age = ageOn(input.birthOn, input.issuedOrRenewedOn);
  const ordinary = addMonths(input.issuedOrRenewedOn, 12 * licenceValidityYears(age, rules));

  const caveats: string[] = [];
  const b = parseDate(input.birthOn);
  const r = parseDate(input.issuedOrRenewedOn);
  if (p.ambiguousThresholdAges.includes(age) && b.m === r.m && b.d === r.d) {
    caveats.push(
      `Rinnovo nel giorno del ${age}º compleanno: la fascia di età è da verificare (la legge dice «ha superato», il MIT «fino al compimento»). Controlla il campo 4b della patente.`,
    );
  }
  if (age >= p.commissionFromAge) {
    caveats.push(
      'Oltre gli 80 anni il rinnovo avviene presso la commissione medica locale: la scadenza può essere diversa. Controlla il campo 4b della patente.',
    );
  }

  const birthdayApplies = input.birthdayRuleApplies !== false && input.issuedOrRenewedOn >= p.birthdayRuleFrom;
  if (!birthdayApplies) {
    if (input.birthdayRuleApplies === false) {
      caveats.push('Per questo tipo di rinnovo la regola del compleanno non vale: è mostrata la scadenza ordinaria.');
    }
    return buildDeadline(rules.expiry, ordinary, 'ordinary', {
      confidence: 'indicative',
      caveats,
    });
  }

  // Primo compleanno successivo alla scadenza ordinaria (se coincide con essa, vale quel giorno).
  let year = parseDate(ordinary).y;
  let candidate = birthdayIn(year, input.birthOn);
  if (candidate < ordinary) {
    year += 1;
    candidate = birthdayIn(year, input.birthOn);
  }
  return buildDeadline(rules.expiry, candidate, 'birthday_after_ordinary', {
    caveats,
    confidence: caveats.length > 0 ? 'indicative' : undefined,
  });
}

// ---------------------------------------------------------------------------------------------------------------

export interface NewDriverResult extends DeadlineResult<'new_driver'> {
  readonly limits: { readonly maxPowerKwPerTonne: number | null; readonly maxPowerKwCarM1: number | null };
}

/**
 * Fine del periodo da neopatentato: 36 mesi per le patenti conseguite dal 14-12-2024 (L. 177/2024), 12 mesi per
 * le precedenti (vettore P7: 2024-12-20 -> 2027-12-20).
 */
export function newDriverUntil(issuedOn: LocalDate, rules: LicenceRules = LICENCE_RULES): NewDriverResult {
  const rule = selectRule(rules.newDriver, issuedOn) ?? rules.newDriver[0];
  const base = buildDeadline(rule, addMonths(issuedOn, rule.params.months), 'new_driver');
  return {
    ...base,
    limits: { maxPowerKwPerTonne: rule.params.maxPowerKwPerTonne, maxPowerKwCarM1: rule.params.maxPowerKwCarM1 },
  };
}
