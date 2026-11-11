// Contesto condiviso dei casi d'uso (SPEC 8.6, data.md 8.5).
// I casi d'uso ricevono le dipendenze per parametro: niente singleton, niente import di Expo/SQLite.
// Nei test si passa il database node:sqlite (tests/support), un orologio fisso e un EventBus finto.
import type {
  Clock,
  DomainError,
  EventBus,
  FileServices,
  IdGenerator,
  NotificationScheduler,
  Result,
  SqlDatabase,
} from '@/domain/ports';

export interface Deps {
  db: SqlDatabase;
  clock: Clock;
  ids: IdGenerator;
  events: EventBus;
}

/** Dipendenze dei casi d'uso che pianificano notifiche locali. */
export interface NotificationDeps extends Deps {
  scheduler: NotificationScheduler;
}

/** Dipendenze dei casi d'uso che leggono o scrivono file (allegati, backup, esportazioni, cancellazione dei dati). */
export interface FileDeps extends Deps {
  fs: FileServices;
}

/** Errore di validazione dell'input (campo e messaggio in italiano, pronto per la UI). */
export interface ValidationError {
  code: 'VALIDATION';
  field: string;
  message: string;
}

export type UsecaseError = DomainError | ValidationError;
export type UsecaseResult<T> = Result<T, UsecaseError>;

export const ok = <T>(value: T): UsecaseResult<T> => ({ ok: true, value });
export const fail = (error: UsecaseError): UsecaseResult<never> => ({ ok: false, error });
export const invalid = (field: string, message: string): UsecaseResult<never> =>
  fail({ code: 'VALIDATION', field, message });
