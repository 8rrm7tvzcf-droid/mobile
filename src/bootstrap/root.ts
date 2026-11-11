// Composition root NATIVO (Android/iOS, Expo Go e development build): l'unico punto in cui si scelgono gli adattatori
// "veri" (SPEC 8.6, tabella "Telefono"): expo-sqlite, orologio del dispositivo, ULID da expo-crypto, expo-notifications,
// expo-file-system (+ ZIP, hash, selettori e condivisione: platform/files) e il trasporto OBD scelto da pickTransportKind (BLE; simulato in Expo Go o con EXPO_PUBLIC_OBD_MOCK=1).
// La versione web e' in root.web.ts: Metro sceglie da solo il file giusto, entrambi esportano createAppRoot().
//
// Sequenza di avvio (SPEC 8.6): 1) apertura e PRAGMA, 2) migrate() con copia di sicurezza, 3) cataloghi e impostazioni
// [openDatabase]  4) manutenzione e 5) promemoria + notifiche [composeAppRoot]  6) la Home [AppProvider].
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { createVacuumBackup, openDatabase } from '@/data';
import { openExpoDatabase, type ExpoSqlDatabase } from '@/data/adapters/expoSqlite';
import { createTransport, pickTransportKind } from '@/obd/transport/createTransport';
import { createDeviceClock } from '@/platform/clock/deviceClock';
import { createUlidGenerator } from '@/platform/crypto/ulidGenerator';
import { createSimpleEventBus } from '@/platform/events/simpleEventBus';
import { createNativeFileServices } from '@/platform/files/nativeFileServices';
import { createExpoNotificationScheduler, installNotificationHandler } from '@/platform/notifications/expoNotificationScheduler';
import { composeAppRoot } from './compose';
import type { AppRoot } from './types';
import { replanPipeline } from './usecases';

const isDev = (): boolean => typeof __DEV__ !== 'undefined' && __DEV__;

export async function createAppRoot(): Promise<AppRoot> {
  const clock = createDeviceClock();
  const ids = createUlidGenerator();
  const events = createSimpleEventBus();
  const fs = await createNativeFileServices();
  const files = fs.files;
  const scheduler = createExpoNotificationScheduler();
  const log = (m: string): void => console.info(m);

  // Le notifiche si gestiscono anche con l'app aperta; i canali Android si creano subito (SPEC 8.4), il permesso NON si chiede qui.
  installNotificationHandler();
  void scheduler.ensureChannels().catch((e: unknown) => log(`[avvio] canali di notifica non creati: ${e instanceof Error ? e.message : String(e)}`));

  // passi 1-3. La copia di sicurezza pre-migrazione usa la connessione appena aperta (VACUUM INTO).
  let opened: ExpoSqlDatabase | undefined;
  const backupDir = files.resolveUri(fs.dirs.backups); // VACUUM INTO vuole un percorso assoluto
  let db: ExpoSqlDatabase;
  try {
    ({ db } = await openDatabase(async () => (opened = await openExpoDatabase()), {
      appVersion: Constants.expoConfig?.version ?? '0.0.0',
      deps: { clock, ids },
      strictChecksums: isDev(),
      backup: (from, to) => {
        if (!opened) return Promise.reject(new Error('database non aperto'));
        return createVacuumBackup(opened, { dir: backupDir, files, nowIso: () => clock.nowIso(), ensureDir: (d) => files.ensureDir(d) })(from, to);
      },
      onWarn: (m) => console.warn(`[avvio] ${m}`),
    }));
  } catch (e) {
    await opened?.close().catch(() => undefined); // la schermata di recupero non ha bisogno della connessione, e un nuovo tentativo ne aprira' una nuova
    throw e;
  }

  // Trasporto OBD (SPEC 8.8): simulato in Expo Go e con EXPO_PUBLIC_OBD_MOCK=1, BLE altrove.
  const kind = pickTransportKind({
    platform: Platform.OS,
    isExpoGo: Constants.executionEnvironment === ExecutionEnvironment.StoreClient,
    ...(process.env.EXPO_PUBLIC_OBD_MOCK !== undefined ? { mockFlag: process.env.EXPO_PUBLIC_OBD_MOCK } : {}),
  });

  return composeAppRoot({
    db,
    clock,
    ids,
    events,
    scheduler,
    fs,
    pipeline: replanPipeline,
    createTransport: (opts) => createTransport(kind, opts),
    log,
  });
}
