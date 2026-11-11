// Contratti verso il mondo esterno (SPEC §8.6, data.md §8.4).
// Il dominio li dichiara, gli altri strati li implementano. Nessun import: questo file e' puro.

export type LocalDate = string; // 'YYYY-MM-DD'
export type SqlValue = string | number | null | Uint8Array;

export interface SqlDatabase {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T | undefined>;
  transaction<T>(fn: (tx: SqlDatabase) => Promise<T>, mode?: 'deferred' | 'exclusive'): Promise<T>;
}

export interface Clock {
  nowIso(): string; // istante UTC con millisecondi
  todayLocal(): LocalDate; // data di calendario del dispositivo
  nowLocal(): { date: LocalDate; time: string }; // 'HH:MM'
  timeZone(): string; // IANA, es. 'Europe/Rome'
}

export interface IdGenerator {
  ulid(): string;
}

export interface FileStore {
  write(path: string, bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(dir: string): Promise<string[]>;
  sha256(path: string): Promise<string>;
}

export type PermissionState = 'granted' | 'denied' | 'blocked' | 'undetermined';

export interface PlannedNotification {
  key: string;
  hash: string;
  date: LocalDate;
  time: string;
  channel: string;
  title: string;
  body: string;
  threadId?: string;
  route?: string;
}

export interface NotificationScheduler {
  getPermission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  listScheduled(): Promise<{ key: string; hash: string }[]>;
  schedule(items: PlannedNotification[], timeZone: string): Promise<void>;
  cancel(keys: string[]): Promise<void>;
}

export interface Authenticator {
  isAvailable(): Promise<boolean>;
  authenticate(reason: string): Promise<boolean>;
}

export interface SecureKeyStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Trasporto OBD (SPEC §8.7): un canale di byte verso l'adattatore ELM327.
 * Implementazioni: BLE, Classic (Android), Wi-Fi, Simulato, Mock con trascrizioni.
 * `write` invia il testo cosi' com'e' (il chiamante aggiunge il terminatore CR).
 * `onData` consegna i frammenti ricevuti come arrivano (puo' essere meno di una riga:
 * il buffering fino al prompt '>' e' compito di ElmSession, non del trasporto).
 */
export interface ObdTransport {
  readonly kind: 'ble' | 'classic' | 'wifi' | 'simulated' | 'mock';
  connect(): Promise<void>;
  write(data: string): Promise<void>;
  onData(fn: (chunk: string) => void): () => void;
  onClose(fn: (reason?: string) => void): () => void;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------
// Servizi per file, backup e documenti (SPEC 8.5, data.md 5). Le implementazioni vivono in src/platform;
// i casi d'uso (src/usecases) li ricevono per parametro. Nessun import: questo file resta puro.
// ---------------------------------------------------------------------------------------------------------------

export interface ZipEntry {
  /** Percorso dentro lo ZIP con '/' come separatore, senza '..' e senza percorsi assoluti. */
  name: string;
  bytes: Uint8Array;
}

export interface UnzipOptions {
  /**
   * Tetto alla somma delle dimensioni NON compresse dichiarate nell'indice dello ZIP (protezione da zip bomb, SPEC 8.5).
   * Se lo supera il codec lancia un Error con `code: 'ZIP_TOO_BIG'` PRIMA di decomprimere qualsiasi voce, cosi' la memoria
   * non si gonfia oltre il tetto. Senza tetto non c'e' nessun limite.
   */
  maxTotalBytes?: number;
}

/** Compressione ZIP (in memoria). `unzip` lancia un Error se l'archivio e' corrotto. */
export interface ZipCodec {
  zip(entries: readonly ZipEntry[]): Uint8Array;
  unzip(bytes: Uint8Array, opts?: UnzipOptions): ZipEntry[];
}

export interface HashService {
  sha256Hex(bytes: Uint8Array): Promise<string>;
}

/** Cartelle private dell'app (percorsi o URI usati da FileStore). */
export interface AppDirs {
  attachments: string;
  backups: string;
  temp: string;
}

export interface PickedFile {
  /** Percorso o URI leggibile con FileStore.read (copia temporanea gia' dentro l'app). */
  uri: string;
  name: string;
  mimeType: string | null;
  size: number | null;
}

export interface FilePicker {
  /** Selettore documenti di sistema; `types` = tipi MIME (es. ['application/pdf', 'application/zip']). null = annullato. */
  pickDocument(opts: { types: string[] }): Promise<PickedFile | null>;
  /** Galleria o fotocamera. null = annullato o permesso negato. */
  pickImage(opts: { camera: boolean }): Promise<PickedFile | null>;
}

export interface FileSharer {
  /** Apre il foglio di condivisione di sistema (o scarica il file sul web). */
  shareFile(path: string, mimeType: string, title: string): Promise<void>;
}

/** Tutti i servizi per file raggruppati, come li espone il bootstrap (AppRoot.files). */
export interface FileServices {
  files: FileStore;
  zip: ZipCodec;
  hash: HashService;
  dirs: AppDirs;
  picker: FilePicker;
  sharer: FileSharer;
}

/** Eventi di dominio emessi dai casi d'uso DOPO il commit; li ascoltano la UI (invalidazione) e la sincronizzazione notifiche. */
export type DomainEvent =
  | {
      type: 'data-changed';
      scope: 'vehicles' | 'odometer' | 'service' | 'fuel' | 'insurance' | 'reminders' | 'settings';
      vehicleId?: string;
    }
  | { type: 'backup-imported' };

export interface EventBus {
  emit(e: DomainEvent): void;
  on(fn: (e: DomainEvent) => void): () => void;
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type DomainError =
  | { code: 'ITEM_NOT_FOUND' }
  | { code: 'FUTURE_DATE' }
  | { code: 'ODO_NON_MONOTONIC'; message: string }
  | { code: 'DUPLICATE_PLATE' };
