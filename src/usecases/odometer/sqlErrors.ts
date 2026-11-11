// Traduzione degli errori di SQLite in errori di dominio tipizzati: la UI non legge mai testi di SQLite.
// (Il testo del messaggio e' conservato uguale da expo-sqlite, node:sqlite e sql.js.)
import type { DomainError } from '@/domain/ports';

export function sqlMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

/** `UNIQUE constraint failed: <tabella>.<colonna>` sulla colonna indicata (es. 'vehicles.plate'). */
export function isUniqueOn(e: unknown, target: string): boolean {
  const m = sqlMessage(e);
  return /UNIQUE constraint failed/i.test(m) && m.includes(target);
}

/** Errori dei trigger/vincoli noti (ODO_NON_MONOTONIC, targa duplicata); null se non e' uno di questi. */
export function mapSqlError(e: unknown): DomainError | null {
  const m = sqlMessage(e);
  if (m.includes('ODO_NON_MONOTONIC')) {
    return { code: 'ODO_NON_MONOTONIC', message: 'I km non sono coerenti con le letture vicine: non possono diminuire col passare dei giorni.' };
  }
  if (isUniqueOn(e, 'vehicles.plate')) return { code: 'DUPLICATE_PLATE' };
  return null;
}

/** Eccezione interna per interrompere una transazione (rollback) portando fuori il risultato da restituire. */
export class AbortTx<R> extends Error {
  constructor(public readonly result: R) {
    super('AbortTx');
  }
}
