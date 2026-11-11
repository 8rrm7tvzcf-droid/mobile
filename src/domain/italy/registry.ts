// Registro di tutte le regole (italy + insurance + tyres): serve alla «scheda della scadenza» (fonte, validita',
// confidenza, data di verifica) e ai controlli di freschezza (SPEC §7, principi 2 e 5). Dominio puro.
import { addMonths, type LocalDate } from '@/domain/dates';
import { RCA_RULES } from '@/domain/insurance/rca';
import { TYRE_RULES } from '@/domain/tyres/rules';
import { GAS_RULES } from './gas';
import { INSPECTION_RULES } from './inspection';
import { LICENCE_RULES } from './licence';
import { ROAD_TAX_RULES } from './roadTax';
import { RECHECK_AFTER } from './sources';
import { TRANSFER_RULES } from './transfer';
import type { Rule } from './types';

/** Tutte le regole codificate, in ordine stabile. */
export const RULE_REGISTRY: readonly Rule[] = [
  INSPECTION_RULES.first,
  INSPECTION_RULES.next,
  INSPECTION_RULES.repeat,
  INSPECTION_RULES.suspended,
  INSPECTION_RULES.manual,
  ...ROAD_TAX_RULES.firstPayment,
  ROAD_TAX_RULES.renewal,
  ROAD_TAX_RULES.manualMonth,
  ROAD_TAX_RULES.exemption2027,
  ROAD_TAX_RULES.prescription,
  ROAD_TAX_RULES.lateRegularisation,
  RCA_RULES.printed,
  RCA_RULES.estimated,
  RCA_RULES.grace,
  TYRE_RULES.winterWindow,
  TYRE_RULES.treadLegal,
  TYRE_RULES.treadAdvice,
  TYRE_RULES.dotAge,
  GAS_RULES.cngDgm,
  GAS_RULES.cngR110,
  GAS_RULES.cngTypeIV,
  GAS_RULES.cngEndOfLife,
  GAS_RULES.gplTank,
  GAS_RULES.unknownType,
  GAS_RULES.manual,
  LICENCE_RULES.expiry,
  LICENCE_RULES.manual,
  ...LICENCE_RULES.newDriver,
  TRANSFER_RULES.deadline,
];

/** La regola con l'id indicato (per mostrare la scheda a partire da `ruleId`). */
export function getRule(ruleId: string): Rule | undefined {
  return RULE_REGISTRY.find((r) => r.id === ruleId);
}

/** Mesi dopo i quali le fonti vanno riverificate (SPEC §7: rilettura ogni 6 mesi). */
export const RECHECK_EVERY_MONTHS = 6;

/** Regole la cui ultima verifica e' piu' vecchia di 6 mesi alla data `today`. */
export function staleRules(today: LocalDate, rules: readonly Rule[] = RULE_REGISTRY): Rule[] {
  return rules.filter((r) => addMonths(r.verifiedOn, RECHECK_EVERY_MONTHS) < today);
}

/** Controlli puntuali gia' maturati (conversione del D.L. 162/2026, adeguamento ISTAT) alla data `today`. */
export function dueRechecks(today: LocalDate): readonly { readonly on: LocalDate; readonly reason: string }[] {
  return RECHECK_AFTER.filter((c) => c.on <= today);
}
