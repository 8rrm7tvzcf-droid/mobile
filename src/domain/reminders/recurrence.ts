// Ricorrenze dei promemoria manuali (data.md 3.8, SPEC 8.3). Dominio puro.
import { addDays, addMonths, diffDays, parseDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/dates';
import type { RepeatRule } from './types';

function assertRule(rule: RepeatRule): void {
  if (!Number.isInteger(rule.every) || rule.every < 1) {
    throw new RangeError(`Ricorrenza non valida: ogni ${rule.every}`);
  }
}

/** k-esima occorrenza (k = 0 e' l'origine), calcolata sempre dall'origine: 31 gen, 28 feb, 31 mar... senza deriva a 28. */
export function occurrenceOn(rule: RepeatRule, k: number): LocalDate {
  assertRule(rule);
  switch (rule.unit) {
    case 'year':
      return addMonths(rule.originOn, k * rule.every * 12);
    case 'month':
      return addMonths(rule.originOn, k * rule.every);
    case 'week':
      return addDays(rule.originOn, k * rule.every * 7);
    case 'day':
      return addDays(rule.originOn, k * rule.every);
  }
}

/** Indice da cui iniziare la ricerca: stima per difetto, cosi' non si scorre l'intera serie da un'origine lontana. */
function startingIndex(rule: RepeatRule, afterOn: LocalDate): number {
  if (afterOn <= rule.originOn) return 0;
  if (rule.unit === 'day' || rule.unit === 'week') {
    const step = rule.every * (rule.unit === 'week' ? 7 : 1);
    return Math.max(0, Math.floor(diffDays(rule.originOn, afterOn) / step) - 1);
  }
  const step = rule.every * (rule.unit === 'year' ? 12 : 1);
  const o = parseDate(rule.originOn);
  const a = parseDate(afterOn);
  const months = (a.y - o.y) * 12 + (a.m - o.m);
  return Math.max(0, Math.floor(months / step) - 1);
}

/** Prima occorrenza STRETTAMENTE dopo `afterOn` (se l'origine e' nel futuro rispetto a `afterOn`, e' l'origine stessa). */
export function nextOccurrence(rule: RepeatRule, afterOn: LocalDate): LocalDate {
  assertRule(rule);
  let k = startingIndex(rule, afterOn);
  while (k > 0 && occurrenceOn(rule, k) > afterOn) k--; // rete di sicurezza: la stima parte sempre da sotto
  while (occurrenceOn(rule, k) <= afterOn) k++;
  return occurrenceOn(rule, k);
}

/**
 * Alla chiusura di un promemoria manuale ricorrente: la prima occorrenza dopo max(scadenza, oggi).
 * Se l'utente e' in ritardo di tre mesi, le occorrenze perse vengono saltate (come un calendario).
 */
export function nextRecurringDue(rule: RepeatRule, dueOn: LocalDate, today: LocalDate): LocalDate {
  return nextOccurrence(rule, dueOn >= today ? dueOn : today);
}
