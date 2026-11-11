// Runner delle migrazioni (data.md 2.2, eseguito e testato). Dipende solo dalla porta SqlDatabase.
//
// Principi (SPEC 8.6):
//  - solo in avanti, versioni 1..N consecutive;
//  - ogni migrazione in UNA transazione esclusiva che include anche l'inserimento in migrations_log e
//    `PRAGMA user_version = N` (transazionale: il rollback riporta indietro anche la versione);
//  - copia di sicurezza (VACUUM INTO) PRIMA di toccare lo schema di un DB che contiene gia' dati;
//  - DB piu' nuovo dell'app -> SchemaTooNewError, nessuna scrittura;
//  - checksum: una migrazione modificata dopo l'applicazione e' un errore in sviluppo, un avviso in produzione.
import type { SqlDatabase } from '@/domain/ports';
import type { MigrateOptions, MigrateResult, Migration } from './types';

export class SchemaTooNewError extends Error {
  readonly found: number;
  readonly supported: number;
  constructor(found: number, supported: number) {
    super(`DB schema v${found} piu' nuovo dell'app (supporta fino a v${supported})`);
    this.name = 'SchemaTooNewError';
    this.found = found;
    this.supported = supported;
  }
}

export class UnknownDatabaseError extends Error {
  constructor() {
    super('database non vuoto ma user_version = 0: file sconosciuto, non lo tocco');
    this.name = 'UnknownDatabaseError';
  }
}

export class MigrationChecksumError extends Error {
  readonly version: number;
  constructor(version: number, name: string) {
    super(`migrazione ${version} (${name}) modificata dopo l'applicazione`);
    this.name = 'MigrationChecksumError';
    this.version = version;
  }
}

/** Testo su cui si calcola il checksum di una migrazione. */
export function migrationSource(m: Migration): string {
  return m.up.join(';\n');
}

/** Controlla numerazione consecutiva 1..N e restituisce le migrazioni ordinate. */
export function sortMigrations(migrations: readonly Migration[]): Migration[] {
  const ms = [...migrations].sort((a, b) => a.version - b.version);
  ms.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`migrazioni non consecutive: atteso v${i + 1}, trovato v${m.version}`);
  });
  return ms;
}

export async function readUserVersion(db: SqlDatabase): Promise<number> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  return Number(row?.user_version ?? 0);
}

export async function migrate(
  db: SqlDatabase,
  migrations: readonly Migration[],
  opts: MigrateOptions,
): Promise<MigrateResult> {
  const ms = sortMigrations(migrations);
  const latest = ms.length;
  const current = await readUserVersion(db);
  if (current > latest) throw new SchemaTooNewError(current, latest);
  if (current === 0) {
    const row = await db.get<{ n: number }>(
      `SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    );
    if (Number(row?.n ?? 0) > 0) throw new UnknownDatabaseError();
  }

  const pending = ms.filter((m) => m.version > current);
  // copia di sicurezza PRIMA di toccare lo schema di un DB che contiene gia' dati
  if (pending.length > 0 && current > 0 && opts.backup) await opts.backup(current, latest);

  for (const m of pending) {
    // PRAGMA foreign_keys e' un no-op dentro una transazione: va spento FUORI e riacceso DOPO
    if (m.rebuildsTables) await db.exec('PRAGMA foreign_keys = OFF');
    try {
      await db.transaction(async (tx) => {
        for (const sql of m.up) await tx.exec(sql);
        if (m.rebuildsTables) {
          const bad = await tx.all('PRAGMA foreign_key_check');
          if (bad.length > 0) throw new Error(`FK violate dopo la migrazione ${m.version}: ${JSON.stringify(bad[0])}`);
        }
        await tx.run('INSERT INTO migrations_log (version, name, checksum, app_version) VALUES (?, ?, ?, ?)', [
          m.version,
          m.name,
          opts.hash(migrationSource(m)),
          opts.appVersion,
        ]);
        await tx.exec(`PRAGMA user_version = ${m.version}`); // transazionale: torna indietro con il rollback
      }, 'exclusive');
    } finally {
      if (m.rebuildsTables) await db.exec('PRAGMA foreign_keys = ON');
    }
  }

  // rileva migrazioni gia' applicate e poi modificate nel sorgente (errore da sviluppatore)
  if (latest > 0) {
    const applied = await db.all<{ version: number; checksum: string }>('SELECT version, checksum FROM migrations_log');
    for (const a of applied) {
      const m = ms[a.version - 1];
      if (m && opts.hash(migrationSource(m)) !== a.checksum) {
        const err = new MigrationChecksumError(a.version, m.name);
        if (opts.strictChecksums) throw err;
        (opts.onWarn ?? ((msg: string) => console.warn(msg)))(err.message);
      }
    }
  }
  return { from: current, to: latest, applied: pending.map((m) => m.version) };
}
