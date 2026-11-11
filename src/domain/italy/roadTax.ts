// Bollo auto (tassa automobilistica) - SPEC §7.3, REG §2. Dominio puro.
// L'app calcola la SCADENZA, MAI l'importo (rimanda al calcolo ufficiale ACI). Campo di inserimento: «mese di
// pagamento» (ultimo mese utile per versare), NON il «mese di scadenza» mostrato da ACI (che e' il mese prima):
// confonderli sposta la scadenza di un mese (REG §2.2, B13).
import { addMonths, daysInMonth, diffDays, endOfMonth, makeDate, parseDate, type LocalDate } from '@/domain/dates';
import { SOURCES, VERIFIED_ON } from './sources';
import { buildDeadline, buildOutcome, selectRule, type DeadlineResult, type Rule, type RuleOutcome } from './types';

/** Regione/Provincia autonoma ai fini della regola del primo pagamento. */
export type RoadTaxRegion = 'LOMBARDIA' | 'PIEMONTE' | 'TRENTO' | 'BOLZANO' | 'OTHER';

export interface FirstPaymentPre2028Params {
  /** Se l'immatricolazione cade negli ultimi N giorni del mese, si paga entro il mese successivo. */
  readonly lastDaysOfMonth: number;
  /** Regioni/Province per cui il primo pagamento e' SEMPRE entro il mese successivo. */
  readonly alwaysNextMonth: readonly RoadTaxRegion[];
  readonly leadDays: readonly number[];
}

export interface FirstPayment2028Params {
  /** Primo pagamento: ultimo giorno del mese successivo all'immatricolazione. */
  readonly monthsAfterRegistration: number;
  readonly leadDays: readonly number[];
}

export interface RenewalParams {
  readonly leadDays: readonly number[];
}

export interface Exemption2027Params {
  readonly maxPowerKw: number;
  readonly label: string;
}

export interface RoadTaxRules {
  /** Versioni del primo pagamento, scelte in base alla data di immatricolazione (validFrom/validTo). */
  readonly firstPayment: readonly [Rule<FirstPaymentPre2028Params>, Rule<FirstPayment2028Params>];
  readonly renewal: Rule<RenewalParams>;
  readonly manualMonth: Rule<RenewalParams>;
  readonly exemption2027: Rule<Exemption2027Params>;
  readonly prescription: Rule<{ readonly years: number }>;
  readonly lateRegularisation: Rule<{
    readonly dailyDivisor: number;
    readonly bands: readonly { readonly upToDays: number | null; readonly num: number; readonly den: number }[];
  }>;
}

export const ROAD_TAX_LEAD_DAYS: readonly number[] = [30, 15, 7, 0];

export const ROAD_TAX_WARNING =
  "Il bollo è una tassa regionale: la scadenza è calcolata dal mese di pagamento che hai inserito (o dal mese di immatricolazione) e può differire nella tua Regione. Per importo, periodo e stato dei pagamenti consulta il calcolo ufficiale ACI o il sito della tua Regione. Per il 2027 è prevista (D.L. 162/2026, in conversione) un'esenzione per auto a benzina o gasolio fino a 80 kW intestate a persone fisiche, per un solo veicolo e solo se assicurato: verifica i requisiti prima di non pagare.";

/** Testo guida del campo «Mese di pagamento» (SPEC §7.3). */
export const ROAD_TAX_PAYMENT_MONTH_HELP =
  'Non è il mese di «scadenza» mostrato da ACI (che è il mese prima). Se non sei sicuro, è di norma il mese di immatricolazione.';

const SOURCES_BOLLO = [SOURCES.aci_bollo_guida, SOURCES.informazione_fiscale_bollo, SOURCES.aci_calcolo_bollo] as const;

export const ROAD_TAX_RULES: RoadTaxRules = {
  firstPayment: [
    {
      id: 'it.road_tax.first_payment.until_2027',
      topic: 'road_tax',
      title: 'Primo pagamento (immatricolazioni fino al 31-12-2027)',
      summary:
        "Entro la fine del mese di immatricolazione; se l'immatricolazione cade negli ultimi 10 giorni del mese, entro il mese successivo. Lombardia, Piemonte, Trento e Bolzano: sempre il mese successivo.",
      // 1900: la regola vale «da sempre» nel perimetro dell'app (il primo pagamento riguarda auto recenti).
      validFrom: '1900-01-01',
      validTo: '2027-12-31',
      sources: SOURCES_BOLLO,
      confidence: 'practice',
      evidence: 'medium',
      verifiedOn: VERIFIED_ON,
      warningText: ROAD_TAX_WARNING,
      openPoints: [
        'Eccezioni regionali (Lombardia, Piemonte, Trento, Bolzano): confidenza media.',
        'Pagamenti quadrimestrali: possibili in alcune Regioni, non modellati.',
      ],
      params: {
        lastDaysOfMonth: 10,
        alwaysNextMonth: ['LOMBARDIA', 'PIEMONTE', 'TRENTO', 'BOLZANO'],
        leadDays: ROAD_TAX_LEAD_DAYS,
      },
    },
    {
      id: 'it.road_tax.first_payment.from_2028',
      topic: 'road_tax',
      title: 'Primo pagamento (immatricolazioni dal 1-1-2028)',
      summary:
        "D.Lgs. 147/2026: periodo di 12 mesi dal mese di immatricolazione; primo pagamento entro l'ultimo giorno del mese successivo all'immatricolazione.",
      validFrom: '2028-01-01',
      validTo: null,
      sources: [SOURCES.aci_bollo_2028, SOURCES.informazione_fiscale_bollo],
      confidence: 'practice',
      evidence: 'medium',
      verifiedOn: VERIFIED_ON,
      warningText: ROAD_TAX_WARNING,
      openPoints: [
        'Testo del D.Lgs. 147/2026 in Gazzetta non letto.',
        'Una fonte riporta una rateizzazione facoltativa dal 2028: da verificare.',
      ],
      params: { monthsAfterRegistration: 1, leadDays: ROAD_TAX_LEAD_DAYS },
    },
  ],
  renewal: {
    id: 'it.road_tax.renewal',
    topic: 'road_tax',
    title: 'Rinnovo annuale',
    summary:
      'Ogni anno entro la fine del mese di pagamento (coincide con il mese di immatricolazione per un periodo di 12 mesi). Il rinnovo si paga entro la fine del mese successivo a quello di scadenza del bollo precedente.',
    validFrom: '1900-01-01',
    validTo: null,
    sources: SOURCES_BOLLO,
    confidence: 'practice',
    evidence: 'high',
    verifiedOn: VERIFIED_ON,
    warningText: ROAD_TAX_WARNING,
    openPoints: ['Lombardia e Piemonte: rinnovi sul mese di immatricolazione (confidenza media).'],
    params: { leadDays: ROAD_TAX_LEAD_DAYS },
  },
  manualMonth: {
    id: 'it.road_tax.payment_month_manual',
    topic: 'road_tax',
    title: 'Mese di pagamento inserito',
    summary: "Mese di pagamento letto sul calcolo ACI: vince sul mese di immatricolazione.",
    validFrom: '1900-01-01',
    validTo: null,
    sources: [SOURCES.aci_calcolo_bollo],
    confidence: 'official',
    evidence: 'high',
    verifiedOn: VERIFIED_ON,
    warningText: ROAD_TAX_WARNING,
    openPoints: [],
    params: { leadDays: ROAD_TAX_LEAD_DAYS },
  },
  exemption2027: {
    id: 'it.road_tax.exemption_2027',
    topic: 'road_tax',
    title: 'Possibile esenzione 2027 (D.L. 162/2026)',
    summary:
      'Per i versamenti con scadenza ordinaria dal 1-1 al 31-12-2027: auto a benzina o gasolio (anche ibride) fino a 80 kW, persone fisiche, un solo veicolo, regolarmente assicurato. Decreto-legge da convertire entro il 2026-11-16.',
    validFrom: '2027-01-01',
    validTo: '2027-12-31',
    sources: [SOURCES.aci_addio_bollo],
    confidence: 'practice',
    evidence: 'medium',
    verifiedOn: VERIFIED_ON,
    warningText:
      "Per il 2027 è prevista (D.L. 162/2026, in conversione) un'esenzione per auto a benzina o gasolio fino a 80 kW intestate a persone fisiche, per un solo veicolo e solo se assicurato: verifica i requisiti prima di non pagare.",
    openPoints: [
      'Decreto-legge da convertire entro il 2026-11-16: possibili modifiche.',
      'Dettagli su moto e superbollo non verificati.',
      'Regioni a statuto speciale: solo previo accordo.',
    ],
    params: { maxPowerKw: 80, label: 'Possibile esenzione 2027 (D.L. 162/2026): verifica i requisiti' },
  },
  prescription: {
    id: 'it.road_tax.prescription',
    topic: 'road_tax',
    title: 'Prescrizione del bollo',
    summary:
      'Tre anni; scade il 31 dicembre del terzo anno successivo a quello in cui il pagamento andava eseguito; si interrompe con la notifica dell’accertamento.',
    validFrom: '1982-12-28',
    validTo: null,
    sources: [SOURCES.aci_bollo_guida],
    confidence: 'practice',
    evidence: 'medium',
    verifiedOn: VERIFIED_ON,
    warningText:
      'Dal 2027 gli avvisi di accertamento diventano titolo esecutivo: non contare sulla prescrizione come strategia.',
    openPoints: ['Prescrizione triennale non verificata su fonte primaria (art. 5 D.L. 953/1982).'],
    params: { years: 3 },
  },
  lateRegularisation: {
    id: 'it.road_tax.late_regularisation',
    topic: 'road_tax',
    title: 'Ravvedimento operoso (sanzione ridotta)',
    summary:
      'Violazioni dal 1-9-2024: entro 15 giorni 1/10 di 12,5% / 15 per giorno (0,0833% al giorno); 16-30 giorni 1,25%; 31-90 giorni 1,39%; 91-365 giorni 3,125%; oltre 1 anno 1/7 di 25% (3,5714%).',
    validFrom: '2024-09-01',
    validTo: null,
    sources: [SOURCES.aci_bollo_guida],
    confidence: 'practice',
    evidence: 'medium',
    verifiedOn: VERIFIED_ON,
    warningText:
      'In caso di ritardo puoi regolarizzare con il ravvedimento operoso pagando una sanzione ridotta più gli interessi. Gli importi sono indicativi: verifica sul sito della tua Regione.',
    openPoints: [
      'Oltre un anno ACI riporta 3,75% (vecchia disciplina): da verificare se le Regioni applicano regole proprie.',
      "Gli interessi legali non sono calcolati (1,60% annuo dal 1-1-2026).",
    ],
    params: {
      // percentuale = daysLate / dailyDivisor (0,0833...% al giorno = 1/12 di punto percentuale)
      dailyDivisor: 12,
      // frazioni esatte dell'importo: num/den (1,25% = 1/80; 1,39% = 1/72; 3,125% = 1/32; 3,5714% = 1/28)
      bands: [
        { upToDays: 30, num: 1, den: 80 },
        { upToDays: 90, num: 1, den: 72 },
        { upToDays: 365, num: 1, den: 32 },
        { upToDays: null, num: 1, den: 28 },
      ],
    },
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Regione / Provincia

const LOMBARDIA_PROVINCES = ['BG', 'BS', 'CO', 'CR', 'LC', 'LO', 'MB', 'MI', 'MN', 'PV', 'SO', 'VA'];
const PIEMONTE_PROVINCES = ['AL', 'AT', 'BI', 'CN', 'NO', 'TO', 'VB', 'VC'];

/** Classifica una sigla di provincia (es. 'MI') ai fini del primo pagamento; sigle sconosciute -> 'OTHER'. */
export function roadTaxRegionForProvince(provinceCode: string): RoadTaxRegion {
  const p = provinceCode.trim().toUpperCase();
  if (LOMBARDIA_PROVINCES.includes(p)) return 'LOMBARDIA';
  if (PIEMONTE_PROVINCES.includes(p)) return 'PIEMONTE';
  if (p === 'TN') return 'TRENTO';
  if (p === 'BZ') return 'BOLZANO';
  return 'OTHER';
}

// ---------------------------------------------------------------------------------------------------------------
// Scadenze

export type RoadTaxBasis = 'first_payment' | 'renewal_registration_month' | 'renewal_payment_month';

export interface RoadTaxFirstInput {
  readonly registeredOn: LocalDate;
  readonly region: RoadTaxRegion;
}

/** Primo pagamento dopo una nuova immatricolazione (vettori B2-B7, B14). */
export function roadTaxFirstDue(
  input: RoadTaxFirstInput,
  rules: RoadTaxRules = ROAD_TAX_RULES,
): DeadlineResult<'first_payment'> {
  const rule = selectRule(rules.firstPayment, input.registeredOn) ?? rules.firstPayment[0];
  const { y, m, d } = parseDate(input.registeredOn);
  const p = rule.params;
  let monthsAfter: number;
  if ('monthsAfterRegistration' in p) {
    monthsAfter = p.monthsAfterRegistration; // regime 2028: sempre il mese successivo
  } else {
    const inLastDays = d > daysInMonth(y, m) - p.lastDaysOfMonth;
    monthsAfter = inLastDays || p.alwaysNextMonth.includes(input.region) ? 1 : 0;
  }
  const due = endOfMonth(addMonths(makeDate(y, m, 1), monthsAfter));
  return buildDeadline(rule, due, 'first_payment');
}

export interface RoadTaxRenewalInput {
  readonly registeredOn: LocalDate;
  /** MESE DI PAGAMENTO (1-12) inserito dall'utente: se presente vince sul mese di immatricolazione. */
  readonly paymentMonth?: number | null;
}

function checkMonth(month: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError(`Mese non valido: ${month}`);
}

/** Rinnovo dell'anno `year`: ultimo giorno del mese di pagamento (vettori B1, B13). */
export function roadTaxRenewalDue(
  year: number,
  input: RoadTaxRenewalInput,
  rules: RoadTaxRules = ROAD_TAX_RULES,
): DeadlineResult<'renewal_registration_month' | 'renewal_payment_month'> {
  if (input.paymentMonth !== undefined && input.paymentMonth !== null) {
    checkMonth(input.paymentMonth);
    return buildDeadline(rules.manualMonth, endOfMonth(makeDate(year, input.paymentMonth, 1)), 'renewal_payment_month');
  }
  const { m } = parseDate(input.registeredOn);
  return buildDeadline(rules.renewal, endOfMonth(makeDate(year, m, 1)), 'renewal_registration_month');
}

export interface RoadTaxNextInput extends RoadTaxRenewalInput {
  readonly region: RoadTaxRegion;
}

/**
 * Prossima scadenza del bollo a partire da `from` (inclusa): il primo pagamento se non e' ancora trascorso,
 * poi i rinnovi annuali nel mese di pagamento. Con `paymentMonth` la serie e' solo quella del mese inserito.
 * Non conosce i pagamenti gia' fatti: dopo «segna pagato» il chiamante passa il giorno dopo la scadenza pagata.
 */
export function roadTaxNextDue(
  from: LocalDate,
  input: RoadTaxNextInput,
  rules: RoadTaxRules = ROAD_TAX_RULES,
): DeadlineResult<RoadTaxBasis> {
  const hasOverride = input.paymentMonth !== undefined && input.paymentMonth !== null;
  if (!hasOverride) {
    const first = roadTaxFirstDue(input, rules);
    if (first.dueOn !== null && from <= first.dueOn) return first;
  }
  const { y } = parseDate(from);
  const thisYear = roadTaxRenewalDue(y, input, rules);
  if (thisYear.dueOn !== null && thisYear.dueOn >= from) return thisYear;
  return roadTaxRenewalDue(y + 1, input, rules);
}

/**
 * Mese (1-12) su cui cade la serie dei rinnovi dopo aver pagato la scadenza `paidDueOn`.
 *
 * Il rinnovo cade nel mese di pagamento (di norma il mese di immatricolazione): se pero' `paidDueOn` e' il PRIMO pagamento di
 * `registeredOn` (spostato al mese successivo: ultimi 10 giorni del mese, Lombardia/Piemonte/Trento/Bolzano, regime dal
 * 1-1-2028) la serie NON riparte dal mese del primo pagamento ma dal mese di immatricolazione (REG 2.2/2.6). Altrimenti la
 * serie resta sul mese della scadenza appena pagata (mese di pagamento inserito, data letta sul documento).
 *
 * Il chiamante non conosce la Regione: si guardano entrambe le date possibili del primo pagamento. Limite noto: un mese di
 * pagamento inserito a mano che coincide con una di quelle date (mese successivo all'immatricolazione, entro il primo anno)
 * e' indistinguibile da un primo pagamento spostato.
 */
export function roadTaxSeriesMonth(
  paidDueOn: LocalDate,
  registeredOn: LocalDate | null | undefined,
  rules: RoadTaxRules = ROAD_TAX_RULES,
): number {
  if (registeredOn) {
    const regions: readonly RoadTaxRegion[] = ['OTHER', 'LOMBARDIA'];
    const isFirstPayment = regions.some((region) => roadTaxFirstDue({ registeredOn, region }, rules).dueOn === paidDueOn);
    if (isFirstPayment) return parseDate(registeredOn).m;
  }
  return parseDate(paidDueOn).m;
}

// ---------------------------------------------------------------------------------------------------------------
// Etichetta informativa 2027

export interface RoadTaxExemption2027Input {
  readonly dueOn: LocalDate;
  /** Potenza in kW; null se sconosciuta. */
  readonly powerKw: number | null;
  /** Vero se almeno una alimentazione e' benzina o gasolio (anche in ibrido). */
  readonly petrolOrDiesel: boolean;
}

export interface RoadTaxExemption2027Hint extends RuleOutcome {
  readonly applies: boolean;
  /** Etichetta da mostrare: il promemoria NON viene mai cancellato. */
  readonly label: string | null;
}

export function roadTaxExemption2027Hint(
  input: RoadTaxExemption2027Input,
  rules: RoadTaxRules = ROAD_TAX_RULES,
): RoadTaxExemption2027Hint {
  const rule = rules.exemption2027;
  const inWindow = input.dueOn >= rule.validFrom && rule.validTo !== null && input.dueOn <= rule.validTo;
  const applies = inWindow && input.petrolOrDiesel && input.powerKw !== null && input.powerKw <= rule.params.maxPowerKw;
  return {
    ...buildOutcome(rule),
    dueOn: input.dueOn,
    applies,
    label: applies ? rule.params.label : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Prescrizione e ravvedimento (funzioni accessorie: la UI di default non le mostra, SPEC §7.3)

/** Ultimo giorno utile dell'amministrazione: 31/12 del terzo anno successivo a quello di scadenza (vettore B12). */
export function roadTaxPrescriptionEnd(dueOn: LocalDate, rules: RoadTaxRules = ROAD_TAX_RULES): DeadlineResult<'prescription'> {
  const { y } = parseDate(dueOn);
  return buildDeadline(rules.prescription, makeDate(y + rules.prescription.params.years, 12, 31), 'prescription');
}

export function roadTaxIsPrescribed(today: LocalDate, dueOn: LocalDate, rules: RoadTaxRules = ROAD_TAX_RULES): boolean {
  const end = roadTaxPrescriptionEnd(dueOn, rules).dueOn;
  return end !== null && today > end; // senza atti interruttivi
}

/** Sanzione ridotta come frazione esatta dell'importo { num, den } (0 se non in ritardo). */
export function lateRegularisationFraction(
  daysLate: number,
  rules: RoadTaxRules = ROAD_TAX_RULES,
): { readonly num: number; readonly den: number } {
  const p = rules.lateRegularisation.params;
  if (daysLate <= 0) return { num: 0, den: 1 };
  if (daysLate <= 15) return { num: daysLate, den: p.dailyDivisor * 100 }; // daysLate/12 per cento
  const band = p.bands.find((b) => b.upToDays === null || daysLate <= b.upToDays);
  return band ? { num: band.num, den: band.den } : { num: 0, den: 1 };
}

/** Sanzione in percentuale (0,0833...% al giorno entro 15 giorni; B9: 10 giorni = 0,8333%). */
export function lateRegularisationPct(daysLate: number, rules: RoadTaxRules = ROAD_TAX_RULES): number {
  const { num, den } = lateRegularisationFraction(daysLate, rules);
  return (num / den) * 100;
}

/** Sanzione ridotta in centesimi su un importo inserito dall'utente (B9: 200 EUR a 10 giorni = 167 centesimi). Senza interessi. */
export function lateRegularisationCents(
  amountCents: number,
  daysLate: number,
  rules: RoadTaxRules = ROAD_TAX_RULES,
): number {
  const { num, den } = lateRegularisationFraction(daysLate, rules);
  return Math.round((amountCents * num) / den);
}

/** Giorni di ritardo (>= 0) di un pagamento rispetto alla scadenza. */
export function daysLateFrom(dueOn: LocalDate, paidOn: LocalDate): number {
  return Math.max(0, diffDays(dueOn, paidOn));
}
