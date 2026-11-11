// Costruzione della porta SqlDatabase a partire da un "motore" minimo (exec/run/all/get).
// Condiviso dagli adattatori expo-sqlite, node:sqlite (test) e sql.js (web): la logica delle transazioni
// (coda FIFO, savepoint annidati, tx che non puo' essere usata dopo la fine) sta in un solo posto.
// Nessun import di pacchetti npm: e' TypeScript puro.
import type { SqlDatabase, SqlValue } from '@/domain/ports';

export type MaybePromise<T> = T | Promise<T>;
export type SqlRow = Record<string, SqlValue>;
export type TransactionMode = 'deferred' | 'exclusive';

/** Operazioni elementari su UNA connessione. Possono essere sincrone (node:sqlite, sql.js) o asincrone (expo-sqlite). */
export interface SqlEngine {
  exec(sql: string): MaybePromise<void>;
  /** Esegue una scrittura e restituisce il numero di righe modificate. */
  run(sql: string, params: SqlValue[]): MaybePromise<number>;
  all(sql: string, params: SqlValue[]): MaybePromise<SqlRow[]>;
  get(sql: string, params: SqlValue[]): MaybePromise<SqlRow | undefined>;
}

/**
 * Esegue `body` dentro una transazione e fa COMMIT (o ROLLBACK se `body` lancia).
 * `engine` e' la connessione su cui girano le query della transazione (puo' essere diversa da quella radice).
 */
export type TransactionRunner = <T>(mode: TransactionMode, body: (engine: SqlEngine) => Promise<T>) => Promise<T>;

export class DatabaseBusyError extends Error {
  constructor(message = "database occupato da una transazione: dentro la callback usa 'tx', non il database radice") {
    super(message);
    this.name = 'DatabaseBusyError';
  }
}

export interface DatabaseTimeouts {
  /** Quanto aspetta un'operazione fuori transazione se una transazione e' in corso (default 5000 ms, come busy_timeout). */
  lockTimeoutMs?: number;
  /**
   * Quanto aspetta una transazione il proprio turno dietro un'altra (default 30000 ms). Evita il blocco eterno se
   * dentro una callback si apre per sbaglio una transazione sul database radice invece che su `tx`.
   */
  transactionTimeoutMs?: number;
}

export const DEFAULT_LOCK_TIMEOUT_MS = 5000;
export const DEFAULT_TRANSACTION_TIMEOUT_MS = 30_000;

/** Mutex FIFO. `acquire` restituisce la funzione di rilascio. */
export class Mutex {
  private locked = false;
  private readonly waiters: Array<() => void> = [];

  async acquire(timeoutMs?: number): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return this.releaser();
    }
    return new Promise<() => void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        resolve(this.releaser()); // il lock passa a chi aspettava: `locked` resta true
      };
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new DatabaseBusyError());
        }, timeoutMs);
      }
      this.waiters.push(waiter);
    });
  }

  private releaser(): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.locked = false;
    };
  }
}

const rowsAs = <T>(rows: SqlRow[]): T[] => rows as unknown as T[];

/** Facciata SqlDatabase sopra un motore; `gate` serializza le operazioni (usato per le connessioni condivise). */
function facade(
  engine: SqlEngine,
  gate: <T>(op: () => MaybePromise<T>) => Promise<T>,
  transaction: SqlDatabase['transaction'],
): SqlDatabase {
  return {
    exec: (sql) => gate(() => engine.exec(sql)),
    run: async (sql, params = []) => ({ changes: await gate(() => engine.run(sql, params)) }),
    all: async <T>(sql: string, params: SqlValue[] = []) => rowsAs<T>(await gate(() => engine.all(sql, params))),
    get: async <T>(sql: string, params: SqlValue[] = []) =>
      (await gate(() => engine.get(sql, params))) as unknown as T | undefined,
    transaction,
  };
}

/** La `tx` passata alla callback di una transazione: vale solo finche' la transazione e' aperta; nidificabile (SAVEPOINT). */
function transactionFacade(engine: SqlEngine): { tx: SqlDatabase; close: () => void } {
  let open = true;
  let savepoints = 0;
  const live = (): void => {
    if (!open) throw new Error("transazione gia' conclusa: 'tx' non si puo' usare fuori dalla callback");
  };
  const gate = async <T>(op: () => MaybePromise<T>): Promise<T> => {
    live();
    return op();
  };
  const tx: SqlDatabase = facade(engine, gate, async (fn) => {
    live();
    const name = `sp_${++savepoints}`;
    await engine.exec(`SAVEPOINT ${name}`);
    try {
      const out = await fn(tx);
      await engine.exec(`RELEASE ${name}`);
      return out;
    } catch (e) {
      try {
        await engine.exec(`ROLLBACK TO ${name}`);
        await engine.exec(`RELEASE ${name}`);
      } catch {
        // la transazione esterna e' gia' compromessa: l'errore originale e' quello che conta
      }
      throw e;
    }
  });
  return {
    tx,
    close: () => {
      open = false;
    },
  };
}

/**
 * Database con UNA connessione condivisa (node:sqlite, sql.js): le transazioni passano da una coda FIFO e le
 * operazioni "radice" aspettano la fine della transazione in corso (altrimenti finirebbero DENTRO di essa).
 */
export function createSingleConnectionDatabase(engine: SqlEngine, opts: DatabaseTimeouts = {}): SqlDatabase {
  const lock = new Mutex();
  const timeout = opts.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const txTimeout = opts.transactionTimeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS;

  const gate = async <T>(op: () => MaybePromise<T>): Promise<T> => {
    const release = await lock.acquire(timeout);
    try {
      return await op();
    } finally {
      release();
    }
  };

  const run: TransactionRunner = async (mode, body) => {
    const release = await lock.acquire(txTimeout); // le transazioni aspettano il proprio turno (con un limite)
    try {
      await engine.exec(mode === 'exclusive' ? 'BEGIN EXCLUSIVE' : 'BEGIN');
      try {
        const out = await body(engine);
        await engine.exec('COMMIT');
        return out;
      } catch (e) {
        try {
          await engine.exec('ROLLBACK');
        } catch {
          // se COMMIT e' fallito a meta' la transazione puo' essere gia' chiusa
        }
        throw e;
      }
    } finally {
      release();
    }
  };

  return facade(engine, gate, (fn, mode = 'deferred') => runWithFacade(run, mode, fn));
}

/**
 * Database con transazioni su una connessione DIVERSA da quella radice (expo-sqlite: withExclusiveTransactionAsync).
 * Le transazioni passano da una coda FIFO; le letture radice non aspettano (WAL), le scritture radice contano
 * sul busy_timeout.
 */
export function createMultiConnectionDatabase(
  rootEngine: SqlEngine,
  runTransaction: TransactionRunner,
  opts: Pick<DatabaseTimeouts, 'transactionTimeoutMs'> = {},
): SqlDatabase {
  const lock = new Mutex();
  const txTimeout = opts.transactionTimeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS;
  const run: TransactionRunner = async (mode, body) => {
    const release = await lock.acquire(txTimeout);
    try {
      return await runTransaction(mode, body);
    } finally {
      release();
    }
  };
  const passthrough = async <T>(op: () => MaybePromise<T>): Promise<T> => op();
  return facade(rootEngine, passthrough, (fn, mode = 'deferred') => runWithFacade(run, mode, fn));
}

function runWithFacade<T>(
  run: TransactionRunner,
  mode: TransactionMode,
  fn: (tx: SqlDatabase) => Promise<T>,
): Promise<T> {
  return run(mode, async (engine) => {
    const { tx, close } = transactionFacade(engine);
    try {
      return await fn(tx);
    } finally {
      close();
    }
  });
}
