// Parti comuni dei casi d'uso delle scadenze (uso INTERNO al modulo: non fa parte dell'API pubblica).
// Qui stanno: errori tipizzati, conversione ora locale <-> istante UTC, lettura dei JSON delle colonne.
import type { LocalDate } from '@/domain/dates';
import type { Clock, DomainError } from '@/domain/ports';
import { fail, ok } from '../context';
import { isoToLocal, localToIso } from '../queries/localTime';
import type { UsecaseError, UsecaseResult } from '../context';

/** Interrompe la transazione in corso con un errore tipizzato (la transazione fa rollback, `guard` lo converte in `fail`). */
export class Abort extends Error {
  constructor(public readonly error: UsecaseError) {
    super(`ABORT:${error.code}`);
  }
}

/** Traduce gli errori dei trigger/vincoli SQL in errori di dominio (la UI non legge mai testi di SQLite). */
export function mapSqlError(e: unknown): DomainError | null {
  const m = e instanceof Error ? e.message : String(e);
  if (m.includes('ODO_NON_MONOTONIC')) return { code: 'ODO_NON_MONOTONIC', message: m };
  if (m.includes('UNIQUE constraint failed: vehicles.plate')) return { code: 'DUPLICATE_PLATE' };
  return null;
}

/** Esegue `fn` e trasforma `Abort` e gli errori SQL noti in `fail`; gli errori imprevisti si propagano. */
export async function guard<T>(fn: () => Promise<T>): Promise<UsecaseResult<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof Abort) return fail(e.error);
    const mapped = mapSqlError(e);
    if (mapped) return fail(mapped);
    throw e;
  }
}

export const abortValidation = (field: string, message: string): never => {
  throw new Abort({ code: 'VALIDATION', field, message });
};
export const abortNotFound = (): never => {
  throw new Abort({ code: 'ITEM_NOT_FOUND' });
};

/** Preavvisi salvati come JSON nelle colonne `notify_offsets_days`. */
export function parseOffsets(json: string | null | undefined): number[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

/**
 * Data e ora LOCALI -> istante UTC ISO con millisecondi, con lo scarto del giorno di destinazione (cambio dell'ora legale
 * compreso, vedi `localToIso`). Con un orologio finto che non e' coerente con il fuso dichiarato vale lo scarto dell'orologio.
 */
export function localToUtcIso(local: { date: LocalDate; time: string }, clock: Clock): string {
  return localToIso(local, clock);
}

/** Inverso di `localToUtcIso`: serve a leggere `snoozed_until` in ora locale (scarto dell'istante letto). */
export function utcIsoToLocal(iso: string, clock: Clock): { date: LocalDate; time: string } {
  return isoToLocal(iso, clock);
}

export { ok, fail };
