// Tipi condivisi dallo strato dati per migrazioni e apertura del database.

/** Una migrazione solo-in-avanti (SPEC 8.6). `up` e' un elenco di istruzioni SQL, ognuna eseguita con exec. */
export interface Migration {
  /** 1..N consecutive, senza buchi. */
  readonly version: number;
  readonly name: string;
  readonly up: readonly string[];
  /**
   * La migrazione ricostruisce tabelle (DROP + RENAME): il runner spegne `foreign_keys` FUORI dalla
   * transazione e prima del COMMIT esegue `PRAGMA foreign_key_check` (data.md 2.3).
   */
  readonly rebuildsTables?: boolean;
}

export interface MigrateOptions {
  appVersion: string;
  /** Funzione di hash SINCRONA per i checksum (vedi sha256Hex in ./sha256). */
  hash: (text: string) => string;
  /** Copia di sicurezza chiamata PRIMA di migrare un DB che contiene gia' dati (from > 0). */
  backup?: (from: number, to: number) => Promise<void>;
  /** In sviluppo/test una migrazione modificata dopo l'applicazione e' un errore; in produzione un avviso. */
  strictChecksums?: boolean;
  /** Dove va l'avviso quando `strictChecksums` e' falso (default: console.warn). */
  onWarn?: (message: string) => void;
}

export interface MigrateResult {
  from: number;
  to: number;
  applied: number[];
}
