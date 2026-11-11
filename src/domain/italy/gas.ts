// Bombole GPL e metano - SPEC §7.6, REG §5. Dominio puro. CONFIDENZA BASSA: fonti di settore, nessun testo del DM letto.
// Decisione SPEC: nessun calcolo automatico "ufficiale". La voce e' una data fissa inserita dall'utente (da targhetta e
// libretto); quando il tipo e' noto l'app puo' proporre una data INDICATIVA etichettata «da verificare con l'officina».
import { addMonths, endOfMonth, makeDate, type LocalDate } from '@/domain/dates';
import { SOURCES, VERIFIED_ON } from './sources';
import { buildDeadline, type DeadlineResult, type Rule } from './types';

/** DGM = omologazione nazionale; R110 = ECE/ONU; R110_TYPE_IV = bombola composita (fibra di carbonio). */
export type CngType = 'DGM' | 'R110' | 'R110_TYPE_IV';

export interface GasIntervalParams {
  readonly months: number;
}

export interface CngTypeIvParams {
  readonly firstMonths: number;
  readonly nextMonths: number;
}

export interface GplTankParams {
  readonly years: number;
}

export interface GasRules {
  readonly cngDgm: Rule<GasIntervalParams>;
  readonly cngR110: Rule<GasIntervalParams>;
  readonly cngTypeIV: Rule<CngTypeIvParams>;
  readonly cngEndOfLife: Rule<GasIntervalParams>;
  readonly gplTank: Rule<GplTankParams>;
  readonly manual: Rule<{ readonly leadDays: readonly number[] }>;
  readonly unknownType: Rule;
}

/** Preavvisi del catalogo (`tpl_gas_cylinder`, SPEC §7.1). */
export const GAS_LEAD_DAYS: readonly number[] = [90, 30, 7, 0];

export const GAS_WARNING =
  'Le bombole del metano e il serbatoio del GPL hanno scadenze di sicurezza che dipendono dal tipo di omologazione e dalla data riportata su targhetta e libretto. Le date calcolate sono indicative: verificale con la tua officina autorizzata prima della scadenza. Circolare con bombole scadute è pericoloso e sanzionato.';

const GAS_SOURCES = [SOURCES.federmetano_bombole, SOURCES.sicurauto_bombole_dm] as const;

export const GAS_RULES: GasRules = {
  cngDgm: {
    id: 'it.gas.cng_dgm',
    topic: 'gas',
    title: 'Metano, omologazione nazionale (DGM)',
    summary: 'Riqualificazione ogni 5 anni.',
    validFrom: '1900-01-01',
    validTo: null,
    sources: GAS_SOURCES,
    confidence: 'indicative',
    evidence: 'medium',
    verifiedOn: VERIFIED_ON,
    warningText: GAS_WARNING,
    openPoints: ['Convenzione «fine mese o giorno esatto» non verificata: si usa la data esatta + mesi.'],
    params: { months: 60 },
  },
  cngR110: {
    id: 'it.gas.cng_r110',
    topic: 'gas',
    title: 'Metano, omologazione R110',
    summary:
      "Riqualificazione ogni 4 anni (DM 13-5-2022 n. 144, dal 14-7-2022) dalla data di immatricolazione indicata sul libretto.",
    validFrom: '2022-07-14',
    validTo: null,
    sources: GAS_SOURCES,
    confidence: 'indicative',
    evidence: 'medium',
    verifiedOn: VERIFIED_ON,
    warningText: GAS_WARNING,
    openPoints: ['Nessun testo del DM 13-5-2022 letto: fonti secondarie di settore.'],
    params: { months: 48 },
  },
  cngTypeIV: {
    id: 'it.gas.cng_r110_type_iv',
    topic: 'gas',
    title: 'Metano, R110 tipo IV (composito)',
    summary: 'Prima riqualificazione a 4 anni dalla prima immatricolazione, poi ogni 2 anni (valore prudenziale).',
    validFrom: '2022-07-14',
    validTo: null,
    sources: GAS_SOURCES,
    confidence: 'indicative',
    evidence: 'low',
    verifiedOn: VERIFIED_ON,
    warningText: GAS_WARNING,
    openPoints: [
      "Intervallo successivo alla prima riqualificazione non chiaro (2 o 4 anni): una fonte suggerisce 4 anni. Si usa 24 mesi, l'ipotesi più prudente.",
    ],
    params: { firstMonths: 48, nextMonths: 24 },
  },
  cngEndOfLife: {
    id: 'it.gas.cng_end_of_life',
    topic: 'gas',
    title: 'Vita massima della bombola metano',
    summary: "Sostituzione obbligatoria dopo 20 anni dall'installazione.",
    validFrom: '1900-01-01',
    validTo: null,
    sources: GAS_SOURCES,
    confidence: 'indicative',
    evidence: 'medium',
    verifiedOn: VERIFIED_ON,
    warningText: GAS_WARNING,
    openPoints: [],
    params: { months: 240 },
  },
  gplTank: {
    id: 'it.gas.gpl_tank',
    topic: 'gas',
    title: 'Serbatoio GPL',
    summary: '10 anni; la data di riferimento (costruzione, immatricolazione o installazione) è in conflitto tra le fonti.',
    validFrom: '1900-01-01',
    validTo: null,
    sources: [SOURCES.sicurauto_gpl],
    confidence: 'indicative',
    evidence: 'low',
    verifiedOn: VERIFIED_ON,
    warningText: GAS_WARNING,
    openPoints: [
      "I 10 anni potrebbero decorrere dall'immatricolazione (primo equipaggiamento) o dall'installazione, non dalla costruzione del serbatoio.",
      'Sostituzione o revisione dopo i 10 anni: da verificare.',
    ],
    params: { years: 10 },
  },
  unknownType: {
    id: 'it.gas.type_unknown',
    topic: 'gas',
    title: 'Tipo di omologazione sconosciuto',
    summary: 'Senza il tipo di omologazione (targhetta o libretto) non si calcola nessuna scadenza: inserisci la data a mano.',
    validFrom: '1900-01-01',
    validTo: null,
    sources: GAS_SOURCES,
    confidence: 'indicative',
    evidence: 'low',
    verifiedOn: VERIFIED_ON,
    warningText: GAS_WARNING,
    openPoints: [],
    params: {},
  },
  manual: {
    id: 'it.gas.manual',
    topic: 'gas',
    title: 'Scadenza letta su targhetta o libretto',
    summary: 'Data fissa inserita dall\'utente: vince sul calcolo.',
    validFrom: '1900-01-01',
    validTo: null,
    sources: GAS_SOURCES,
    confidence: 'official',
    evidence: 'high',
    verifiedOn: VERIFIED_ON,
    warningText: GAS_WARNING,
    openPoints: [],
    params: { leadDays: GAS_LEAD_DAYS },
  },
};

export type GasBasis =
  | 'manual'
  | 'cng_registration'
  | 'cng_last_requalification'
  | 'cng_end_of_life'
  | 'gpl_construction'
  | 'gpl_registration'
  | 'gpl_installation'
  | 'unknown';

/** Riferimento del serbatoio GPL: mese di costruzione 'YYYY-MM' (stampato sul serbatoio) oppure data di immatricolazione/installazione. */
export type GplReference =
  | { readonly kind: 'construction'; readonly yearMonth: string }
  | { readonly kind: 'registration' | 'installation'; readonly on: LocalDate };

export type GasCylinderInput =
  | { readonly kind: 'manual'; readonly dueOn: LocalDate }
  | {
      readonly kind: 'cng';
      /** null = tipo di omologazione sconosciuto: nessun calcolo («da verificare»). */
      readonly type: CngType | null;
      /** Data di immatricolazione (primo ciclo) o dell'ultima riqualificazione. */
      readonly baseOn: LocalDate;
      readonly firstCycle: boolean;
    }
  | { readonly kind: 'cng_end_of_life'; readonly installedOn: LocalDate }
  | { readonly kind: 'gpl'; readonly reference: GplReference };

function parseYearMonth(ym: string): { y: number; m: number } {
  const mt = /^(\d{4})-(\d{2})$/.exec(ym);
  const y = mt ? Number(mt[1]) : NaN;
  const m = mt ? Number(mt[2]) : NaN;
  if (!mt || y < 1 || m < 1 || m > 12) throw new RangeError(`Mese non valido: ${ym}`);
  return { y, m };
}

/** Prossima riqualificazione delle bombole metano (vettori G1-G4). */
export function cngNextDue(
  type: CngType,
  baseOn: LocalDate,
  firstCycle: boolean,
  rules: GasRules = GAS_RULES,
): DeadlineResult<GasBasis> {
  const basis: GasBasis = firstCycle ? 'cng_registration' : 'cng_last_requalification';
  switch (type) {
    case 'DGM':
      return buildDeadline(rules.cngDgm, addMonths(baseOn, rules.cngDgm.params.months), basis);
    case 'R110':
      return buildDeadline(rules.cngR110, addMonths(baseOn, rules.cngR110.params.months), basis);
    case 'R110_TYPE_IV': {
      const p = rules.cngTypeIV.params;
      return buildDeadline(rules.cngTypeIV, addMonths(baseOn, firstCycle ? p.firstMonths : p.nextMonths), basis);
    }
  }
}

/** Fine vita della bombola metano: 20 anni dall'installazione (vettore G6). */
export function cngEndOfLife(installedOn: LocalDate, rules: GasRules = GAS_RULES): DeadlineResult<GasBasis> {
  return buildDeadline(rules.cngEndOfLife, addMonths(installedOn, rules.cngEndOfLife.params.months), 'cng_end_of_life');
}

/** Scadenza del serbatoio GPL (vettore G5: costruito 2018-09 -> 2028-09-30). */
export function gplTankDue(reference: GplReference, rules: GasRules = GAS_RULES): DeadlineResult<GasBasis> {
  const years = rules.gplTank.params.years;
  if (reference.kind === 'construction') {
    const { y, m } = parseYearMonth(reference.yearMonth);
    return buildDeadline(rules.gplTank, endOfMonth(makeDate(y + years, m, 1)), 'gpl_construction');
  }
  return buildDeadline(
    rules.gplTank,
    addMonths(reference.on, years * 12),
    reference.kind === 'registration' ? 'gpl_registration' : 'gpl_installation',
    {
      caveats: [
        "Data di riferimento diversa dalla costruzione del serbatoio: le fonti non concordano su quale usare. Verifica con l'officina.",
      ],
    },
  );
}

/** Punto d'ingresso unico per il livello superiore. */
export function gasCylinderDue(input: GasCylinderInput, rules: GasRules = GAS_RULES): DeadlineResult<GasBasis> {
  switch (input.kind) {
    case 'manual':
      return buildDeadline(rules.manual, input.dueOn, 'manual');
    case 'cng':
      if (input.type === null) {
        return buildDeadline(rules.unknownType, null, 'unknown', {
          reasonCode: 'GAS_TYPE_UNKNOWN',
          caveats: ['Il tipo di omologazione si legge sulla targhetta della bombola o sul libretto: senza il tipo non si calcola nulla.'],
        });
      }
      return cngNextDue(input.type, input.baseOn, input.firstCycle, rules);
    case 'cng_end_of_life':
      return cngEndOfLife(input.installedOn, rules);
    case 'gpl':
      return gplTankDue(input.reference, rules);
  }
}
