// Composizione comune a telefono e web, dopo che il database e' stato aperto e avviato (passi 1-3 della sequenza di
// avvio, SPEC 8.6: PRAGMA, migrazioni, cataloghi). Qui:
//   4) manutenzione dei dati (cestino oltre 30 giorni, coda dei file da cancellare, retention della telemetria)
//      e pulizia della cartella temporanea dei file (esportazioni e importazioni rimaste a meta');
//   5) riconciliazione dei promemoria + sincronizzazione delle notifiche, poi il sottoscrittore che le ripete a ogni scrittura;
//   6) l'AppRoot (la UI mostra la Home).
// Gli errori dei passi 4 e 5 NON bloccano l'avvio: si registrano e l'app parte (SPEC 8.6 e data.md 2.5).
import { runDataMaintenance, type ClosableDatabase } from '@/data';
import type { Clock, EventBus, FileServices, IdGenerator, NotificationScheduler, ObdTransport } from '@/domain/ports';
import type { FileDeps, NotificationDeps } from '@/usecases/context';
import { createObdService } from './obdService';
import { createReplanCoordinator, type ReplanPipeline } from './replan';
import type { ComposedRoot, ObdTransportOptions } from './types';

export interface ComposeInput {
  /** Database gia' avviato (migrato, con cataloghi e impostazioni). */
  db: ClosableDatabase;
  clock: Clock;
  ids: IdGenerator;
  events: EventBus;
  scheduler: NotificationScheduler;
  createTransport: (opts?: ObdTransportOptions) => ObdTransport;
  /** reconcileAll / reconcileVehicle / syncNotifications (si passano da fuori: questo file non importa i casi d'uso). */
  pipeline: ReplanPipeline;
  /**
   * Servizi per file, ZIP, hash, selettori e condivisione (telefono: expo-file-system; web: memoria + IndexedDB).
   * `fs.files` serve anche alla manutenzione, per cancellare i file degli allegati rimossi.
   */
  fs: FileServices;
  log?: (message: string) => void;
  /** Coalescenza delle scritture (default 1500 ms). */
  debounceMs?: number;
  /** Oltre questo tempo l'avvio non aspetta piu' il passo 5 (continua in coda). Default 8000 ms. */
  startupTimeoutMs?: number;
}

/** Svuota la cartella temporanea (file di esportazione/importazione rimasti da un avvio precedente): per definizione non contiene nulla da tenere. */
async function clearTempDir(fs: FileServices): Promise<void> {
  const { files, dirs } = fs;
  for (const name of await files.list(dirs.temp)) await files.remove(`${dirs.temp}/${name}`);
}

export async function composeAppRoot(input: ComposeInput): Promise<ComposedRoot> {
  const log = input.log ?? ((m: string): void => console.info(m));
  const { db, clock, ids, events, scheduler, fs } = input;

  // 4) manutenzione
  try {
    const report = await runDataMaintenance(db, { clock, files: fs.files });
    for (const e of report.errors) log(`[avvio] manutenzione: ${e}`);
  } catch (e) {
    log(`[avvio] manutenzione fallita: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    await clearTempDir(fs);
  } catch (e) {
    log(`[avvio] pulizia della cartella temporanea fallita: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 5) promemoria e notifiche, subito e a ogni scrittura
  const deps: NotificationDeps & FileDeps = { db, clock, ids, events, scheduler, fs };
  const replan = createReplanCoordinator(events, {
    deps,
    pipeline: input.pipeline,
    ...(input.debounceMs !== undefined ? { debounceMs: input.debounceMs } : {}),
    onError: (stage, error) => log(`[ripianificazione] ${stage}: ${error instanceof Error ? error.message : String(error)}`),
  });
  replan.request();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, input.startupTimeoutMs ?? 8000);
  });
  await Promise.race([replan.flush(), timeout]);
  if (timer !== undefined) clearTimeout(timer);

  let disposed = false;
  return {
    deps,
    files: fs,
    obd: { createTransport: input.createTransport, service: createObdService({ clock }) },
    replan,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await replan.dispose();
      await db.close();
    },
  };
}
