// Completamento e ricalcolo del prossimo (data.md 3.7, SPEC 8.3). Dominio puro: la scrittura su DB e' dei casi d'uso.
import { addMonths, endOfMonth, makeDate, parseDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/dates';
import type { LastDone, MaintenanceRule } from './types';

/** Opzioni della serie di calendario (non fanno parte della regola salvata sulla voce: le ricava il caso d'uso). */
export interface SeriesOptions {
  /**
   * Mese (1-12) su cui cade la serie: le scadenze sono l'ULTIMO GIORNO di quel mese (bollo). Serve quando la scadenza
   * corrente non e' nel mese della serie (primo pagamento spostato) e a non perdere il 29/02 negli anni bisestili.
   * Vale solo per ripetizioni in anni interi (mesi multipli di 12); altrimenti si ignora.
   */
  anchorMonth?: number | null;
}

/**
 * Nuova data fissa dopo un completamento.
 *
 * - `interval_calendar` (bollo, gomme stagionali): prima data della serie DOPO la data del completamento; la serie e'
 *   ancorata alla scadenza corrente e non scivola con il ritardo (calcolo `scadenza + k x intervallo`, senza accumulare clamp).
 *   Con `anchorMonth` la serie e' invece l'ultimo giorno di quel mese di ogni anno (prima data dopo la scadenza corrente
 *   e dopo il completamento);
 * - `fixed_date`: null, la nuova scadenza la inserisce l'utente (stato `unknown`);
 * - `interval_last_done`: la data fissa non e' usata, resta com'e'.
 */
export function nextFixedDue(rule: MaintenanceRule, doneOn: LocalDate, opts: SeriesOptions = {}): LocalDate | null {
  if (rule.scheduleType === 'interval_calendar') {
    const months = rule.intervalMonths;
    if (!rule.fixedDueOn || !months || months < 1) return null;
    const anchor = opts.anchorMonth;
    if (anchor != null && Number.isInteger(anchor) && anchor >= 1 && anchor <= 12 && months % 12 === 0) {
      const step = months / 12;
      let y = parseDate(rule.fixedDueOn).y;
      let anchored = endOfMonth(makeDate(y, anchor, 1));
      while (anchored <= rule.fixedDueOn || anchored <= doneOn) {
        y += step;
        anchored = endOfMonth(makeDate(y, anchor, 1));
      }
      return anchored;
    }
    let k = 1;
    let next = addMonths(rule.fixedDueOn, k * months);
    while (next <= doneOn) {
      k++;
      next = addMonths(rule.fixedDueOn, k * months);
    }
    return next;
  }
  if (rule.scheduleType === 'fixed_date') return null;
  return rule.fixedDueOn ?? null;
}

export interface CompletionRecord {
  doneOn: LocalDate;
  doneKm?: number | null;
}

export interface BaselineRecord {
  baselineOn?: LocalDate | null;
  baselineKm?: number | null;
}

/**
 * Ultimo fatto di una voce: il completamento con `doneOn` piu' recente (un completamento retrodatato non cambia la base);
 * a parita' di data vince quello con i km (e fra due, i km piu' alti). Senza completamenti si usa la baseline della voce.
 * `completions` deve contenere solo quelli non annullati.
 */
export function resolveLastDone(
  completions: readonly CompletionRecord[],
  baseline: BaselineRecord = {},
): LastDone | null {
  let best: LastDone | null = null;
  for (const c of completions) {
    if (best == null || c.doneOn > best.on) {
      best = { on: c.doneOn, km: c.doneKm ?? null };
    } else if (c.doneOn === best.on && c.doneKm != null && (best.km == null || c.doneKm > best.km)) {
      best = { on: c.doneOn, km: c.doneKm };
    }
  }
  if (best) return best;
  if (baseline.baselineOn) return { on: baseline.baselineOn, km: baseline.baselineKm ?? null };
  return null;
}

export interface CompletionPlan {
  /** Da salvare in `maintenance_completions.prev_fixed_due_on`: l'annulla ripristina esattamente questo valore. */
  prevFixedDueOn: LocalDate | null;
  /** Nuovo `fixed_due_on` della voce (serie di calendario avanzata, oppure null per `fixed_date`). */
  newFixedDueOn: LocalDate | null;
  /** Aggiornare `fixed_due_on` solo se e' cambiato (le regole `interval_last_done` non lo toccano). */
  fixedDueOnChanged: boolean;
  /** Nuova base per il ricalcolo: i valori REALI del completamento, non quelli teorici. */
  lastDone: LastDone;
}

/** Cosa cambia sulla voce quando si segna "fatto" (data.md 3.7 passi 3-4); il resto e' compito del caso d'uso. */
export function planCompletion(
  rule: MaintenanceRule,
  doneOn: LocalDate,
  doneKm?: number | null,
  opts: SeriesOptions = {},
): CompletionPlan {
  const prevFixedDueOn = rule.fixedDueOn ?? null;
  const newFixedDueOn = nextFixedDue(rule, doneOn, opts);
  return {
    prevFixedDueOn,
    newFixedDueOn,
    fixedDueOnChanged: newFixedDueOn !== prevFixedDueOn,
    lastDone: { on: doneOn, km: doneKm ?? null },
  };
}
