// Helper dei test dei casi d'uso di veicoli, km, impostazioni e auto demo: DB migrato in memoria, orologio fisso,
// ID sequenziali, bus di eventi che registra cio' che viene emesso.
import type { DomainEvent, EventBus, FileServices, FileStore, SqlValue } from '@/domain/ports';
import type { Deps, FileDeps, UsecaseResult } from '@/usecases/context';
import { FIXED_NOW, sequentialIds, type TestClock } from '../../../support/fakes';
import { openBootedDb } from '../../../support/db';
import type { NodeSqlDatabase } from '../../../support/nodeSqlite';

export interface Harness {
  deps: Deps;
  /** Le stesse dipendenze con un file system in memoria: per i casi d'uso che rimuovono file (purgeVehicle, removeDemoVehicle). */
  fileDeps: FileDeps;
  /** Il file system in memoria di `fileDeps` (percorso -> byte). */
  fileMap: Map<string, Uint8Array>;
  db: NodeSqlDatabase;
  clock: TestClock;
  /** Eventi emessi, in ordine. */
  events: DomainEvent[];
  /** Svuota il registro degli eventi (per controllare solo quelli dell'operazione che segue). */
  clearEvents(): void;
}

export async function makeHarness(nowIso: string = FIXED_NOW): Promise<Harness> {
  const booted = await openBootedDb();
  booted.clock.set(nowIso);
  const events: DomainEvent[] = [];
  const bus: EventBus = {
    emit: (e) => {
      events.push(e);
    },
    on: () => () => undefined,
  };
  const deps: Deps = { db: booted.db, clock: booted.clock, ids: sequentialIds(1000), events: bus };
  const fileMap = new Map<string, Uint8Array>();
  const files: FileStore = {
    write: async (path, bytes) => void fileMap.set(path, bytes),
    read: async (path) => {
      const b = fileMap.get(path);
      if (!b) throw new Error(`file assente: ${path}`);
      return b;
    },
    remove: async (path) => void fileMap.delete(path),
    exists: async (path) => fileMap.has(path),
    list: async (dir) => [...fileMap.keys()].filter((k) => k.startsWith(`${dir}/`)),
    sha256: async () => {
      throw new Error('non usato');
    },
  };
  const fs = {
    files,
    dirs: { attachments: 'files/attachments', backups: 'files/backups', temp: 'files/temp' },
  } as unknown as FileServices;
  const fileDeps: FileDeps = { ...deps, fs };
  return { deps, fileDeps, fileMap, db: booted.db, clock: booted.clock, events, clearEvents: () => void events.splice(0) };
}

/** Estrae il valore di un risultato che deve essere riuscito (altrimenti il test fallisce con l'errore). */
export function unwrap<T>(r: UsecaseResult<T>): T {
  if (!r.ok) throw new Error(`risultato inatteso: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** Il codice dell'errore di un risultato fallito. */
export function errorCode<T>(r: UsecaseResult<T>): string {
  if (r.ok) throw new Error('il risultato doveva essere un errore');
  return r.error.code;
}

export async function count(db: NodeSqlDatabase, table: string, where = '1=1', params: SqlValue[] = []): Promise<number> {
  const row = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, params);
  return row?.n ?? 0;
}

export const PANDA = { make: 'Fiat', model: 'Panda', fuelPrimary: 'petrol' } as const;
