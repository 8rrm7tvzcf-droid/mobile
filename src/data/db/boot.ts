// Sequenza di avvio del database (SPEC 8.6, data.md 2.5), passi 1-3:
//   1) PRAGMA della connessione  2) migrate() con copia di sicurezza  3) upsert di cataloghi e impostazioni.
// I passi 4 (manutenzione: cestino, coda file, retention telemetria) e 5 (reconcileReminders / planNotifications)
// restano al chiamante: runDataMaintenance() e' in ../maintenance/maintenance; il passo 5 sta nei casi d'uso.
//
// Un errore NON diventa mai un crash silenzioso: bootDatabase lancia DatabaseBootError con la fase e il tipo,
// cosi' la UI sceglie fra "Aggiorna MyGarage" (schema piu' nuovo) e la schermata di recupero.
import type { Clock, IdGenerator, SqlDatabase } from '@/domain/ports';
import { seedAll } from '../seeds/seed';
import { MIGRATIONS } from './migrations';
import { migrate, MigrationChecksumError, SchemaTooNewError, UnknownDatabaseError } from './migrate';
import { applyPragmas, checkSqliteSupport, SqliteTooOldError, type PragmaOptions } from './pragmas';
import { sha256Hex } from './sha256';
import type { MigrateResult, Migration } from './types';

export interface BootDeps {
  clock: Pick<Clock, 'nowIso'>;
  ids: Pick<IdGenerator, 'ulid'>;
}

export interface BootOptions {
  appVersion: string;
  deps: BootDeps;
  /** Copia pre-migrazione (vedi createVacuumBackup); chiamata solo se il DB contiene gia' dati e c'e' da migrare. */
  backup?: (from: number, to: number) => Promise<void>;
  /** Errore (invece di avviso) se una migrazione applicata e' stata modificata: da usare in sviluppo e nei test. */
  strictChecksums?: boolean;
  pragmas?: PragmaOptions;
  /** Sostituibili nei test; di default MIGRATIONS e sha256Hex. */
  migrations?: readonly Migration[];
  hash?: (text: string) => string;
  onWarn?: (message: string) => void;
}

export interface BootResult {
  migration: MigrateResult;
  /** Versione di SQLite della piattaforma (da registrare nei log diagnostici: SPEC SP-1). */
  sqliteVersion: string;
}

export type BootFailureKind =
  | 'schema-too-new'
  | 'unknown-database'
  | 'checksum-mismatch'
  | 'migration-failed'
  | 'seed-failed'
  | 'pragma-failed'
  | 'sqlite-too-old';
export type BootStage = 'pragmas' | 'migrate' | 'seed';

export class DatabaseBootError extends Error {
  readonly stage: BootStage;
  readonly kind: BootFailureKind;
  override readonly cause: unknown;
  /** Il database aperto (se c'e'): la schermata di recupero puo' esportarlo "grezzo". */
  db?: SqlDatabase;
  constructor(stage: BootStage, kind: BootFailureKind, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'DatabaseBootError';
    this.stage = stage;
    this.kind = kind;
    this.cause = cause;
  }
}

function classifyMigrateError(e: unknown): BootFailureKind {
  if (e instanceof SchemaTooNewError) return 'schema-too-new';
  if (e instanceof UnknownDatabaseError) return 'unknown-database';
  if (e instanceof MigrationChecksumError) return 'checksum-mismatch';
  return 'migration-failed';
}

/** Passi 1-3 su una connessione gia' aperta. */
export async function bootDatabase(db: SqlDatabase, opts: BootOptions): Promise<BootResult> {
  let sqliteVersion: string;
  try {
    await applyPragmas(db, opts.pragmas);
    sqliteVersion = await checkSqliteSupport(db);
  } catch (e) {
    const kind: BootFailureKind = e instanceof SqliteTooOldError ? 'sqlite-too-old' : 'pragma-failed';
    throw withDb(new DatabaseBootError('pragmas', kind, e), db);
  }
  let migration: MigrateResult;
  try {
    migration = await migrate(db, opts.migrations ?? MIGRATIONS, {
      appVersion: opts.appVersion,
      hash: opts.hash ?? sha256Hex,
      ...(opts.backup ? { backup: opts.backup } : {}),
      ...(opts.strictChecksums !== undefined ? { strictChecksums: opts.strictChecksums } : {}),
      ...(opts.onWarn ? { onWarn: opts.onWarn } : {}),
    });
  } catch (e) {
    throw withDb(new DatabaseBootError('migrate', classifyMigrateError(e), e), db);
  }
  try {
    await seedAll(db, opts.deps);
  } catch (e) {
    throw withDb(new DatabaseBootError('seed', 'seed-failed', e), db);
  }
  return { migration, sqliteVersion };
}

function withDb(err: DatabaseBootError, db: SqlDatabase): DatabaseBootError {
  err.db = db;
  return err;
}

/** Un database apribile e chiudibile (tutti gli adattatori reali lo sono). */
export interface ClosableDatabase extends SqlDatabase {
  close(): Promise<void>;
}

/**
 * Apre (con `open`, specifico della piattaforma: openExpoDatabase, openSqlJsDatabase...) e avvia il database.
 * In caso di errore lancia DatabaseBootError con `db` valorizzato e la connessione ancora aperta.
 */
export async function openDatabase<D extends ClosableDatabase>(
  open: () => Promise<D>,
  opts: BootOptions,
): Promise<{ db: D; boot: BootResult }> {
  const db = await open();
  const boot = await bootDatabase(db, opts);
  return { db, boot };
}
