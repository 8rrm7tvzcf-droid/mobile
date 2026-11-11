// Registro chilometri (F-03): `odometer_readings` e' l'UNICA fonte dei km (data.md §1.2, §1.3).
// Rifornimenti, interventi, controlli livelli e sessioni OBD creano una lettura collegata.
import type { LocalDate } from '@/domain/ports';

export const ODOMETER_SOURCES = ['manual', 'obd', 'fuel', 'service', 'fluid_check', 'import'] as const;
export type OdometerSource = (typeof ODOMETER_SOURCES)[number];

/** `ignored`: lettura errata messa da parte (resta nel registro ma non conta: nessun vincolo, nessun calcolo). */
export type OdometerStatus = 'valid' | 'ignored';

/**
 * Una riga di `odometer_readings`. Le funzioni di questo modulo si aspettano SOLO righe non cancellate
 * (`deleted_at IS NULL`): il filtro del cestino e' compito della query.
 */
export interface OdometerReading {
  id: string;
  readOn: LocalDate;
  km: number;
  source: OdometerSource;
  status: OdometerStatus;
}

/** Cio' che si sta per scrivere (nuova lettura o modifica di una esistente se `id` e' presente). */
export interface OdometerCandidate {
  id?: string;
  readOn: string;
  km: number;
  /** Default 'valid'. Una lettura `ignored` non e' soggetta a monotonia ne' plausibilita'. */
  status?: OdometerStatus;
  source?: OdometerSource;
}
