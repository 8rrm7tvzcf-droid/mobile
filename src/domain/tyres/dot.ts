// Eta' dei pneumatici dal codice DOT 'WWYY' (settimana + anno di produzione) - SPEC §7.5, REG §4.3. Dominio puro.
// Nessun limite di legge trovato per le auto: soglie CONSIGLIATE (controllo a 5 anni, sostituzione intorno ai 10).
// Il DOT a 3 cifre (prima del 2000) non e' gestito: input accettato solo a 4 cifre.
import { addDays, addYears, diffDays, makeDate, type LocalDate } from '@/domain/dates';
import { buildDeadline, type DeadlineResult } from '@/domain/italy/types';
import { TYRE_RULES, type TyreRules } from './rules';

export type DotParseResult =
  | { readonly ok: true; readonly week: number; readonly year: number }
  | { readonly ok: false; readonly reason: 'FORMAT' | 'WEEK' };

/** Accetta '1219', '12 19' o 'DOT 1219' (le ultime 4 cifre del codice); settimana 1-53, anno 2000-2099. */
export function parseDot(input: string): DotParseResult {
  const cleaned = input.replace(/\s+/g, '').replace(/^DOT/i, '');
  if (!/^\d{4}$/.test(cleaned)) return { ok: false, reason: 'FORMAT' };
  const week = Number(cleaned.slice(0, 2));
  const year = 2000 + Number(cleaned.slice(2, 4));
  if (week < 1 || week > 53) return { ok: false, reason: 'WEEK' };
  return { ok: true, week, year };
}

/** Data di produzione approssimata: 1 gennaio + (WW - 1) * 7 giorni (vettori T6: 1219 -> 2019-03-19; T7: 4524 -> 2024-11-04). */
export function dotProductionDate(week: number, year: number): LocalDate {
  return addDays(makeDate(year, 1, 1), (week - 1) * 7);
}

export type TyreAgeState = 'ok' | 'check' | 'replace_advised';

export interface TyreAgeAssessment extends DeadlineResult<'dot'> {
  readonly state: TyreAgeState;
  readonly productionOn: LocalDate;
  /** Eta' in giorni (negativa se il codice indica una data futura). */
  readonly ageDays: number;
  /** Eta' decimale in anni (giorni / 365,25). */
  readonly ageYears: number;
  /** Data da cui si consiglia il controllo specialistico (produzione + 5 anni): e' anche `dueOn`. */
  readonly checkOn: LocalDate;
  /** Data da cui si consiglia la sostituzione (produzione + 10 anni). */
  readonly replaceAdvisedOn: LocalDate;
  readonly label: string;
}

const LABELS: Readonly<Record<TyreAgeState, string>> = {
  ok: 'Età nella norma',
  check: 'Fai controllare i pneumatici da uno specialista (oltre 5 anni)',
  replace_advised: 'Sostituzione consigliata (circa 10 anni)',
};

/** Eta' dei pneumatici alla data `today`; `null` se il codice DOT non e' valido (vedi `parseDot`). */
export function tyreAge(dot: string, today: LocalDate, rules: TyreRules = TYRE_RULES): TyreAgeAssessment | null {
  const parsed = parseDot(dot);
  if (!parsed.ok) return null;
  const rule = rules.dotAge;
  const p = rule.params;
  const productionOn = dotProductionDate(parsed.week, parsed.year);
  const checkOn = addYears(productionOn, p.checkAfterYears);
  const replaceAdvisedOn = addYears(productionOn, p.replaceAfterYears);
  const ageDays = diffDays(productionOn, today);
  const state: TyreAgeState = today >= replaceAdvisedOn ? 'replace_advised' : today >= checkOn ? 'check' : 'ok';
  return {
    ...buildDeadline(rule, checkOn, 'dot', {
      caveats: ageDays < 0 ? ['Il codice DOT indica una data di produzione futura: controlla di averlo letto bene.'] : [],
    }),
    state,
    productionOn,
    ageDays,
    ageYears: ageDays / p.daysPerYear,
    checkOn,
    replaceAdvisedOn,
    label: LABELS[state],
  };
}
