// Composition root WEB (anteprima su PC con `npx expo start --web`, SPEC 8.8 livello 2): sql.js (SQLite in WebAssembly)
// con il database salvato in IndexedDB a ogni scrittura, orologio del browser, scheduler che stampa il piano in console,
// trasporto OBD simulato, file in memoria (copiati in IndexedDB). Stesso contratto di root.ts: Metro sceglie questo file sul web.
//
// Il file wasm di sql.js lo serve Metro come asset (metro.config.js aggiunge 'wasm' agli asset): l'URL si ricava da expo-asset.
// Sul web resolve 'sql.js' in dist/sql-wasm-browser.js (condizione "browser" dei suoi exports): niente 'fs', niente 'path'.
import { Asset } from 'expo-asset';
import sqlWasm from 'sql.js/dist/sql-wasm-browser.wasm';
import { openDatabase } from '@/data';
import { openSqlJsDatabase } from '@/data/adapters/sqlJs';
import { applyPragmas } from '@/data/db/pragmas';
import { createTransport } from '@/obd/transport/createTransport';
import { createDeviceClock } from '@/platform/clock/deviceClock';
import { createUlidGenerator } from '@/platform/crypto/ulidGenerator';
import { createSimpleEventBus } from '@/platform/events/simpleEventBus';
import { createWebFileServices } from '@/platform/files/webFileServices';
import { createConsoleNotificationScheduler } from '@/platform/notifications/consoleNotificationScheduler';
import { composeAppRoot } from './compose';
import type { AppRoot } from './types';
import { replanPipeline } from './usecases';
import { createIndexedDbSnapshotStore, createPersistingDatabase, type PersistingDatabase } from './webPersistence';

const APP_VERSION = '0.0.0-web'; // sul web il database e' di anteprima: non si confronta con la versione dell'app

export async function createAppRoot(): Promise<AppRoot> {
  const clock = createDeviceClock();
  const ids = createUlidGenerator();
  const events = createSimpleEventBus();
  const scheduler = createConsoleNotificationScheduler();
  const store = createIndexedDbSnapshotStore();
  const fs = await createWebFileServices();

  // ripristina l'ultima copia salvata (un errore di lettura equivale a "nessuna copia": si riparte da un database vuoto)
  const snapshot = await store.load().catch((e: unknown) => {
    console.warn("[anteprima web] impossibile leggere il database salvato", e);
    return null;
  });
  const wasmUrl = Asset.fromModule(sqlWasm).uri;
  const sqlJs = await openSqlJsDatabase({
    locateFile: () => wasmUrl,
    ...(snapshot ? { data: snapshot } : {}),
  });
  const db: PersistingDatabase = createPersistingDatabase(sqlJs, {
    store,
    reapplyPragmas: (d) => applyPragmas(d, { journalMode: 'skip' }),
  });

  // Prima di chiudere o nascondere la scheda si salva subito, senza aspettare l'attesa di raggruppamento.
  const flushNow = (): void => {
    void db.flush();
  };
  const onVisibility = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flushNow();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', onVisibility);
  }

  try {
    // passi 1-3 (nessuna copia pre-migrazione: sul web i dati sono di anteprima)
    await openDatabase(async () => db, { appVersion: APP_VERSION, deps: { clock, ids }, strictChecksums: true, onWarn: (m) => console.warn(`[avvio] ${m}`) });
  } catch (e) {
    await db.close().catch(() => undefined);
    removeListeners();
    throw e;
  }

  function removeListeners(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('pagehide', flushNow);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  const root = await composeAppRoot({
    db,
    clock,
    ids,
    events,
    scheduler,
    fs,
    pipeline: replanPipeline,
    createTransport: (opts) => createTransport('simulated', opts),
  });
  const dispose = root.dispose;
  return {
    ...root,
    async dispose() {
      removeListeners();
      await dispose();
    },
  };
}
