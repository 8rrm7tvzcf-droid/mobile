// Parti comuni dei casi d'uso di interventi e officine (uso INTERNO al modulo: non fa parte dell'API pubblica).
import type { SqlDatabase } from '@/domain/ports';
import { fail, ok } from '../context';
import type { UsecaseError, UsecaseResult } from '../context';
import { mapSqlError } from '../odometer';

export type Tx = SqlDatabase;

/** Interrompe la transazione in corso con un errore tipizzato (rollback); `guard` lo converte in `fail`. */
export class Abort extends Error {
  constructor(public readonly error: UsecaseError) {
    super(`ABORT:${error.code}`);
  }
}

/** Riconosce anche l'`Abort` del modulo delle scadenze (stesso formato) senza dipendere dalla sua classe. */
function abortedError(e: unknown): UsecaseError | null {
  if (e instanceof Abort) return e.error;
  if (e instanceof Error && e.message.startsWith('ABORT:') && 'error' in e) return (e as { error: UsecaseError }).error;
  return null;
}

/** Esegue `fn` e trasforma `Abort` e gli errori SQL noti in `fail`; gli errori imprevisti si propagano. */
export async function guard<T>(fn: () => Promise<T>): Promise<UsecaseResult<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    const aborted = abortedError(e);
    if (aborted) return fail(aborted);
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

/** Testo ripulito con lunghezza massima (null se vuoto). */
export function cleanText(v: string | null | undefined, max: number): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, max);
}

/** `a, b, c` -> `?, ?, ?` per le clausole IN. */
export const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(', ');
