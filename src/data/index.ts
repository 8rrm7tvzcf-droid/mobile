// API pubblica dello strato dati (infrastruttura). Gli altri repository (veicoli, km, interventi, ...) si
// aggiungono qui accanto ai file in ./repositories.
//
// NON riesporta gli adattatori di piattaforma, per non trascinarli nel bundle sbagliato:
//   - '@/data/adapters/expoSqlite'  (openExpoDatabase / createExpoSqlDatabase) -> solo il bootstrap NATIVO;
//   - '@/data/adapters/sqlJs'       (openSqlJsDatabase / createSqlJsDatabase)   -> solo il bootstrap WEB.
// L'adattatore node:sqlite per i test sta in tests/support/nodeSqlite.ts.
//
// Uso tipico (bootstrap):
//   const { db } = await openDatabase(() => openExpoDatabase(), { appVersion, deps: { clock, ids }, backup });
//   const settings = createSettingsRepository(db, clock);

// --- porta e costruzione degli adattatori
export {
  createMultiConnectionDatabase,
  createSingleConnectionDatabase,
  DatabaseBusyError,
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_TRANSACTION_TIMEOUT_MS,
  Mutex,
  type DatabaseTimeouts,
  type MaybePromise,
  type SqlEngine,
  type SqlRow,
  type TransactionMode,
  type TransactionRunner,
} from './adapters/sqlDatabase';

// --- apertura, PRAGMA, migrazioni, avvio
export type { MigrateOptions, MigrateResult, Migration } from './db/types';
export { LATEST_SCHEMA_VERSION, MIGRATIONS } from './db/migrations';
export {
  migrate,
  migrationSource,
  MigrationChecksumError,
  readUserVersion,
  SchemaTooNewError,
  sortMigrations,
  UnknownDatabaseError,
} from './db/migrate';
export { sha256Hex } from './db/sha256';
export {
  applyPragmas,
  checkSqliteSupport,
  compareVersions,
  DEFAULT_BUSY_TIMEOUT_MS,
  MIN_SQLITE_VERSION,
  readPragmas,
  SqliteTooOldError,
  type PragmaOptions,
  type PragmaState,
} from './db/pragmas';
export { backupFileName, createVacuumBackup, toFsPath, type VacuumBackupOptions } from './db/backup';
export {
  bootDatabase,
  DatabaseBootError,
  openDatabase,
  type BootDeps,
  type BootFailureKind,
  type BootOptions,
  type BootResult,
  type BootStage,
  type ClosableDatabase,
} from './db/boot';

// --- riconoscimento degli errori SQLite
export {
  isCheckViolation,
  isConstraintError,
  isForeignKeyViolation,
  isOdoNonMonotonic,
  isSimulatorRequiresDemo,
  isUniqueViolation,
  sqlErrorMessage,
  toDomainError,
} from './db/errors';

// --- cataloghi e impostazioni predefinite
export {
  EXPENSE_CATEGORIES,
  TEMPLATE_ROWS,
  TEMPLATES,
  templateRow,
  type ExpenseCategorySeed,
  type TemplateCategory,
  type TemplateRow,
  type TemplateScheduleType,
  type TemplateSeed,
  type VehicleTag,
} from './seeds/catalog';
export {
  DEFAULTED_SETTING_KEYS,
  SETTING_DEFAULTS,
  type DefaultedSettingKey,
  type SettingKey,
  type SettingsMap,
} from './seeds/settingsDefaults';
export { seedAll, seedExpenseCategories, seedSettings, seedTemplates, type SeedDeps } from './seeds/seed';

// --- manutenzione dei dati all'avvio (passo 4)
export {
  applyTelemetryRetention,
  processPendingFileDeletions,
  purgeTrash,
  ROLLUP_BUCKET_MS,
  runDataMaintenance,
  TELEMETRY_ROW_BYTES,
  TRASH_TABLES,
  type FileDeletionResult,
  type MaintenanceDeps,
  type MaintenanceReport,
  type PurgeSummary,
  type TelemetryRetentionResult,
} from './maintenance/maintenance';

// --- repository
export { createSettingsRepository, type SettingsRepository } from './repositories/settingsRepository';
