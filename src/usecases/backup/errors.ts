// Errori di backup, ripristino ed esportazione (SPEC 8.5, data.md 5.3 e 5.5).
// Hanno un tipo proprio perche' i codici (BACKUP_TOO_NEW, NOT_A_BACKUP, ...) non fanno parte di DomainError, che sta
// nel dominio e non si modifica. La UI traduce `code` in un messaggio comprensibile; `message` e' gia' in italiano.
import type { Result } from '@/domain/ports';

export type BackupErrorCode =
  /** Il file non e' un backup di MyGarage (ZIP senza manifest.json/data.json, JSON di un altro formato, file qualunque). */
  | 'NOT_A_BACKUP'
  /** Creato da una versione piu' recente: «Aggiorna MyGarage». */
  | 'BACKUP_TOO_NEW'
  | 'BAD_VERSION'
  | 'NO_UPGRADER'
  /** ZIP danneggiato o illeggibile. */
  | 'CORRUPT'
  /** Zip-slip: voce con '..', percorso assoluto, '\\' o lettera di unita'. */
  | 'UNSAFE_PATH'
  | 'TOO_BIG'
  | 'MISSING_FILE'
  | 'HASH_MISMATCH'
  /** Dati non coerenti con lo schema (colonne sconosciute, valori di tipo errato, file allegato non ammesso). */
  | 'BAD_DATA'
  | 'FK_VIOLATION'
  /** Stessa targa con ULID diverso: proporre «Sostituisci» o eliminare l'auto locale. */
  | 'PLATE_CONFLICT'
  | 'VIN_CONFLICT'
  | 'ODOMETER_CONFLICT'
  | 'CONSTRAINT_VIOLATION'
  | 'SOURCE_UNREADABLE'
  /** Copia di sicurezza non riuscita in modalita' Sostituisci: l'importazione non parte. */
  | 'SAFETY_COPY_FAILED'
  | 'IO_ERROR'
  /** L'auto indicata non esiste (esportazione CSV di una sola auto). */
  | 'ITEM_NOT_FOUND';

export interface BackupError {
  code: BackupErrorCode;
  message: string;
}

export type BackupResult<T> = Result<T, BackupError>;

/** Interrompe l'operazione (e la transazione in corso) con un errore tipizzato; i punti d'ingresso lo convertono in `fail`. */
export class BackupAbort extends Error {
  constructor(
    public readonly code: BackupErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'BackupAbort';
  }
  toError(): BackupError {
    return { code: this.code, message: this.message };
  }
}

export const bok = <T>(value: T): BackupResult<T> => ({ ok: true, value });
export const bfail = (code: BackupErrorCode, message: string): BackupResult<never> => ({ ok: false, error: { code, message } });

/** Esegue `fn`: un BackupAbort diventa `fail` con il suo codice, qualunque altro errore (disco pieno, database occupato) diventa `IO_ERROR`: la UI riceve sempre un risultato. */
export async function backupGuard<T>(fn: () => Promise<T>): Promise<BackupResult<T>> {
  try {
    return bok(await fn());
  } catch (e) {
    if (e instanceof BackupAbort) return { ok: false, error: e.toError() };
    return { ok: false, error: { code: 'IO_ERROR', message: `Operazione non riuscita (${e instanceof Error ? e.message.slice(0, 160) : 'errore sconosciuto'}).` } };
  }
}

/** Traduce gli errori di SQLite lanciati dall'importazione nei codici della UI. */
export function mapImportSqlError(e: unknown): BackupAbort | null {
  if (e instanceof BackupAbort) return e;
  const m = e instanceof Error ? e.message : String(e);
  if (m.includes('UNIQUE constraint failed: vehicles.plate')) {
    return new BackupAbort('PLATE_CONFLICT', "Una targa del backup è già usata da un'altra auto: scegli «Sostituisci» oppure elimina l'auto locale.");
  }
  if (m.includes('UNIQUE constraint failed: vehicles.vin')) {
    return new BackupAbort('VIN_CONFLICT', "Un telaio (VIN) del backup è già usato da un'altra auto: scegli «Sostituisci» oppure elimina l'auto locale.");
  }
  if (m.includes('ODO_NON_MONOTONIC')) {
    return new BackupAbort('ODOMETER_CONFLICT', 'I chilometri del backup non sono coerenti con quelli già presenti.');
  }
  if (/constraint failed|CHECK|FOREIGN KEY|NOT NULL|UNIQUE/i.test(m)) {
    return new BackupAbort('CONSTRAINT_VIOLATION', `Il backup contiene dati non validi (${m.slice(0, 160)}). Non è stato importato nulla.`);
  }
  return null;
}
