// Validazione di una lettura km (F-03; data.md §1.3 trigger `trg_odo_mono_ins/upd`; SPEC §6.3.6 punto 5).
// Replica in TypeScript puro la regola del trigger ODO_NON_MONOTONIC e aggiunge i controlli di plausibilita':
// cosi' la UI avvisa PRIMA di scrivere e non legge mai testi di SQLite.
import { compareDates, diffDays, isValidDate } from '@/domain/dates';
import type { DomainError, LocalDate } from '@/domain/ports';
import { formatDateIt, formatInt, isValidKm } from '@/domain/units';
import type { OdometerCandidate, OdometerReading } from './types';

export type OdometerIssueCode =
  | 'INVALID_KM'
  | 'INVALID_DATE'
  | 'FUTURE_DATE'
  | 'NON_MONOTONIC'
  | 'IMPLAUSIBLE_JUMP'
  | 'VERY_HIGH_KM';

export interface OdometerIssue {
  code: OdometerIssueCode;
  severity: 'error' | 'warning';
  /** Testo per l'utente, in italiano. */
  message: string;
  /** Letture coinvolte (per NON_MONOTONIC: quelle in conflitto). */
  related: OdometerReading[];
}

export interface OdometerValidation {
  /** `true` se non ci sono errori bloccanti (gli avvisi non bloccano). */
  ok: boolean;
  errors: OdometerIssue[];
  warnings: OdometerIssue[];
  /**
   * Letture valide che violano la monotonia (le stesse che farebbero scattare il trigger).
   * Servono alla finestra «È un errore della lettura precedente»: ignorarle risolve il conflitto.
   */
  conflicts: OdometerReading[];
  /** Lettura valida piu' vicina PRIMA della data (giorno diverso): a parita' di data la piu' alta. */
  previous: OdometerReading | null;
  /** Lettura valida piu' vicina DOPO la data (giorno diverso): a parita' di data la piu' bassa. */
  next: OdometerReading | null;
}

export interface OdometerValidationOptions {
  /** Oggi (data di calendario del dispositivo): il dominio non legge l'orologio. */
  today: LocalDate;
  /** Soglia di plausibilita': km al giorno oltre i quali si avvisa. Default 1500. */
  maxKmPerDay?: number;
  /** Oltre questi km si chiede conferma. Default 1.000.000. */
  veryHighKm?: number;
}

export const DEFAULT_MAX_KM_PER_DAY = 1500;
export const DEFAULT_VERY_HIGH_KM = 1_000_000;

const byDateKm = (a: OdometerReading, b: OdometerReading): number =>
  compareDates(a.readOn, b.readOn) || a.km - b.km || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Le sole letture che contano (`status = 'valid'`), in ordine cronologico (data, poi km). */
export function validReadings(readings: readonly OdometerReading[]): OdometerReading[] {
  return readings.filter((r) => r.status === 'valid').sort(byDateKm);
}

const quote = (r: OdometerReading): string => `${formatInt(r.km)} km il ${formatDateIt(r.readOn)}`;

/**
 * Le letture valide che romperebbero la monotonia con `cand` (stessa regola del trigger):
 * una lettura di un giorno PRECEDENTE con piu' km, o di un giorno SUCCESSIVO con meno km.
 * Nello stesso giorno nessun vincolo. Esclude la riga con lo stesso `id` (modifica).
 */
export function findMonotonicConflicts(
  cand: { id?: string; readOn: LocalDate; km: number },
  existing: readonly OdometerReading[],
): OdometerReading[] {
  return validReadings(existing).filter(
    (o) =>
      o.id !== cand.id &&
      ((compareDates(o.readOn, cand.readOn) < 0 && o.km > cand.km) ||
        (compareDates(o.readOn, cand.readOn) > 0 && o.km < cand.km)),
  );
}

/**
 * Valida una lettura km prima di scriverla.
 * Errori bloccanti: km non intero o fuori 0..2.000.000, data non valida, data futura, monotonia violata.
 * Avvisi (non bloccanti): salto implausibile rispetto alle letture vicine, km oltre il milione.
 * Una lettura `ignored` supera sempre monotonia e plausibilita' (come il trigger, che guarda solo `valid`).
 */
export function validateOdometerReading(
  cand: OdometerCandidate,
  existing: readonly OdometerReading[],
  opts: OdometerValidationOptions,
): OdometerValidation {
  const errors: OdometerIssue[] = [];
  const warnings: OdometerIssue[] = [];
  const maxPerDay = opts.maxKmPerDay ?? DEFAULT_MAX_KM_PER_DAY;
  const veryHigh = opts.veryHighKm ?? DEFAULT_VERY_HIGH_KM;
  const result = (conflicts: OdometerReading[], previous: OdometerReading | null, next: OdometerReading | null) => ({
    ok: errors.length === 0,
    errors,
    warnings,
    conflicts,
    previous,
    next,
  });

  if (!isValidKm(cand.km)) {
    errors.push({
      code: 'INVALID_KM',
      severity: 'error',
      message: 'I km devono essere un numero intero tra 0 e 2.000.000.',
      related: [],
    });
  }
  const dateOk = isValidDate(cand.readOn);
  if (!dateOk) {
    errors.push({ code: 'INVALID_DATE', severity: 'error', message: 'La data non è valida.', related: [] });
  } else if (compareDates(cand.readOn, opts.today) > 0) {
    errors.push({
      code: 'FUTURE_DATE',
      severity: 'error',
      message: 'La data è nel futuro: non puoi registrare i km di un giorno che non è ancora arrivato.',
      related: [],
    });
  }
  if (errors.length > 0 || (cand.status ?? 'valid') === 'ignored') return result([], null, null);

  const date = cand.readOn;
  const others = validReadings(existing).filter((o) => o.id !== cand.id);
  const before = others.filter((o) => compareDates(o.readOn, date) < 0);
  const after = others.filter((o) => compareDates(o.readOn, date) > 0);
  const sameDay = others.filter((o) => o.readOn === date);
  const previous = before.length > 0 ? before[before.length - 1]! : null; // ordinate: ultima data, km piu' alto
  const next = after.length > 0 ? after[0]! : null; // prima data, km piu' basso

  const conflicts = findMonotonicConflicts({ id: cand.id, readOn: date, km: cand.km }, existing);
  if (conflicts.length > 0) {
    const higherBefore = conflicts.filter((o) => compareDates(o.readOn, date) < 0);
    const lowerAfter = conflicts.filter((o) => compareDates(o.readOn, date) > 0);
    // si citano solo le due letture piu' vicine alla data (le altre sono nel campo `related`)
    const nearest = [higherBefore[higherBefore.length - 1], lowerAfter[0]].filter((r): r is OdometerReading => !!r);
    const cited = nearest.map((r) => `il ${formatDateIt(r.readOn)} risultano ${formatInt(r.km)} km`);
    errors.push({
      code: 'NON_MONOTONIC',
      severity: 'error',
      message:
        `I km (${formatInt(cand.km)}) non sono coerenti con le letture vicine: ${cited.join(' e ')}. ` +
        'I km non possono diminuire col passare dei giorni.',
      related: conflicts,
    });
  }

  // plausibilita': velocita' media implicita rispetto ai vicini (solo se la monotonia regge)
  if (conflicts.length === 0) {
    const jumpOf = (a: OdometerReading, delta: number, days: number): OdometerIssue => ({
      code: 'IMPLAUSIBLE_JUMP',
      severity: 'warning',
      message:
        days <= 1
          ? `Rispetto alla lettura di ${quote(a)} ci sono ${formatInt(delta)} km di differenza in un giorno: controlla di non aver scritto una cifra di troppo.`
          : `Rispetto alla lettura di ${quote(a)} ci sono ${formatInt(delta)} km in ${formatInt(days)} giorni (oltre ${formatInt(maxPerDay)} km al giorno): controlla di non aver scritto una cifra di troppo.`,
      related: [a],
    });
    if (previous) {
      const delta = cand.km - previous.km;
      const days = Math.max(1, diffDays(previous.readOn, date));
      if (delta > days * maxPerDay) warnings.push(jumpOf(previous, delta, days));
    }
    if (next) {
      const delta = next.km - cand.km;
      const days = Math.max(1, diffDays(date, next.readOn));
      if (delta > days * maxPerDay) warnings.push(jumpOf(next, delta, days));
    }
    for (const s of sameDay) {
      const delta = Math.abs(cand.km - s.km);
      if (delta > maxPerDay) {
        warnings.push(jumpOf(s, delta, 1));
        break;
      }
    }
  }
  if (cand.km > veryHigh) {
    warnings.push({
      code: 'VERY_HIGH_KM',
      severity: 'warning',
      message: `${formatInt(cand.km)} km sono davvero tanti: è corretto?`,
      related: [],
    });
  }
  return result(conflicts, previous, next);
}

/** Traduce un errore di validazione bloccante nell'errore di dominio tipizzato (ports). `null` se non c'e' una corrispondenza. */
export function toDomainError(v: OdometerValidation): DomainError | null {
  for (const e of v.errors) {
    if (e.code === 'NON_MONOTONIC') return { code: 'ODO_NON_MONOTONIC', message: e.message };
    if (e.code === 'FUTURE_DATE') return { code: 'FUTURE_DATE' };
  }
  return null;
}
