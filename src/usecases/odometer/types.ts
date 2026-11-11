// Tipi pubblici del registro chilometri (F-03).
import type { LocalDate } from '@/domain/ports';
import type { OdometerIssue, OdometerReading, OdometerSource, OdometerStatus, OdometerValidation } from '@/domain/odometer';
import type { CurrentKm } from '@/domain/odometer';
import type { RateEstimate } from '@/domain/maintenance';
import type { DomainError } from '@/domain/ports';

/** Una riga del registro km, con la provenienza in italiano (ogni km mostrato dice da dove arriva). */
export interface OdometerEntry {
  id: string;
  vehicleId: string;
  readOn: LocalDate;
  km: number;
  source: OdometerSource;
  sourceLabel: string;
  status: OdometerStatus;
  note: string | null;
  /** Id del rifornimento/intervento/controllo/sessione OBD che ha creato la lettura (null se manuale o importata). */
  linkedId: string | null;
  /** Solo le letture manuali e importate si eliminano da qui: le altre seguono il loro registro. */
  canDelete: boolean;
  createdAt: string;
}

export interface AddOdometerReadingInput {
  vehicleId: string;
  km: number;
  /** Default: oggi. */
  readOn?: LocalDate;
  /** `manual` (default) o `import`: le altre provenienze passano dal rifornimento/intervento/controllo/OBD che le crea. */
  source?: 'manual' | 'import';
  note?: string | null;
  /**
   * Scelta «È un errore della lettura precedente» (SPEC 6.3.6 punto 5): se i km sono incoerenti, le letture in conflitto
   * vengono messe da parte (`ignored`) e la nuova viene salvata, tutto nella stessa transazione.
   */
  resolveConflicts?: 'ignore-conflicting';
}

export interface AddOdometerReadingResult {
  reading: OdometerEntry;
  /** Avvisi non bloccanti (salto implausibile, km oltre il milione): la UI li mostra dopo il salvataggio. */
  warnings: OdometerIssue[];
  /** Letture messe da parte con `resolveConflicts` (vuoto altrimenti). */
  ignoredReadingIds: string[];
  /** Lettura valida piu' vicina prima / dopo la data. */
  previous: OdometerReading | null;
  next: OdometerReading | null;
}

export interface KmRange {
  min: number;
  max: number;
}

/** Esito della verifica (senza scrivere) di una lettura: la UI la usa per l'avviso di coerenza mentre si digita. */
export interface OdometerCheck extends OdometerValidation {
  /** Intervallo di km ammesso per la data scelta («tra X e Y km»). */
  allowedRange: KmRange;
}

/**
 * `ODO_NON_MONOTONIC` con i dettagli per la finestra a tre scelte (Correggi / Salva senza aggiornare i km /
 * È un errore della lettura precedente). E' un sottotipo di `DomainError`: si riconosce con `isOdometerConflict`.
 */
export type OdometerConflictError = Extract<DomainError, { code: 'ODO_NON_MONOTONIC' }> & {
  conflicts: OdometerReading[];
  previous: OdometerReading | null;
  next: OdometerReading | null;
  allowedRange: KmRange;
};

export interface ListOdometerOptions {
  /** Default true: le letture ignorate restano nel registro (barrate dalla UI). */
  includeIgnored?: boolean;
  limit?: number;
  offset?: number;
}

export interface KmForecast extends RateEstimate {
  /** Km all'anno equivalenti alla media (arrotondati). */
  kmPerYear: number;
  currentKm: CurrentKm | null;
  /**
   * Km stimati oggi se l'ultima lettura non e' di oggi (ultima lettura + media x giorni trascorsi); null se non
   * c'e' una lettura, se e' di oggi o se la media e' troppo bassa per prevedere. Mostrare sempre come «stimati».
   */
  projectedKm: number | null;
  /** `true` se non ci sono dati misurati: la media e' il valore iniziale (stima dell'utente, media dall'immatricolazione o predefinito). */
  isInitialEstimate: boolean;
}
