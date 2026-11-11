// Errori dei casi d'uso -> testo in italiano semplice (mai codici interni, mai messaggi di SQL).
import type { UsecaseError } from '@/usecases/context';
import { it } from '../i18n/it';

export interface UiError {
  message: string;
  /** Campo del modulo a cui riferire l'errore, se c'e'. */
  field?: string;
}

export function describeError(e: UsecaseError): UiError {
  switch (e.code) {
    case 'VALIDATION':
      return { message: e.message, field: e.field };
    case 'DUPLICATE_PLATE':
      return { message: it.errors.duplicatePlate, field: 'plate' };
    case 'ITEM_NOT_FOUND':
      return { message: it.errors.notFound };
    case 'FUTURE_DATE':
      return { message: it.errors.futureDate, field: 'date' };
    case 'ODO_NON_MONOTONIC':
      return { message: it.errors.kmNotMonotonic, field: 'km' };
    default:
      return { message: it.errors.generic };
  }
}

/** Eccezioni inattese: all'utente non si mostra mai il testo tecnico. */
export function describeThrown(_e: unknown): string {
  return it.errors.generic;
}
