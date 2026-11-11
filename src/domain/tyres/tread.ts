// Battistrada - SPEC §7.5, REG §4.3. Dominio puro.
// Minimo di legge 1,6 mm [media: art. 237 Reg. non riletto]; 3 mm consigliati (4 mm d'inverno: soglia non verificata).
import { buildOutcome, type RuleOutcome } from '@/domain/italy/types';
import { TYRE_RULES, type TyreRules } from './rules';

export type TreadState = 'illegal' | 'replace_soon' | 'not_advised_winter' | 'ok';

export interface TreadAssessment extends RuleOutcome {
  readonly state: TreadState;
  readonly treadMm: number;
  /** Testo per l'utente. */
  readonly label: string;
}

/**
 * Valuta lo spessore del battistrada in mm. Vettori T2-T5: 1,5 -> illegal; 1,6 -> replace_soon (al limite legale);
 * 3,5 in inverno -> not_advised_winter; 4,0 in inverno -> ok. La regola riportata nel risultato e' quella che ha
 * deciso lo stato (minimo di legge o consiglio).
 */
export function treadStatus(treadMm: number, winter: boolean, rules: TyreRules = TYRE_RULES): TreadAssessment {
  if (!Number.isFinite(treadMm) || treadMm < 0) throw new RangeError(`Battistrada non valido: ${treadMm}`);
  const p = rules.treadLegal.params;
  if (treadMm < p.legalMinMm) {
    return {
      ...buildOutcome(rules.treadLegal),
      state: 'illegal',
      treadMm,
      label: 'Sotto il minimo di legge (1,6 mm): sostituisci i pneumatici',
    };
  }
  const advice = rules.treadAdvice.params;
  if (treadMm < advice.recommendedMm) {
    return {
      ...buildOutcome(rules.treadAdvice),
      state: 'replace_soon',
      treadMm,
      label: 'Da sostituire presto: sotto i 3 mm la tenuta cala',
    };
  }
  if (winter && treadMm < advice.winterRecommendedMm) {
    return {
      ...buildOutcome(rules.treadAdvice),
      state: 'not_advised_winter',
      treadMm,
      label: "Sconsigliato per l'inverno: sotto i 4 mm la tenuta su neve e bagnato cala",
    };
  }
  return { ...buildOutcome(rules.treadAdvice), state: 'ok', treadMm, label: 'Battistrada nella norma' };
}
