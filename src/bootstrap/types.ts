// Tipi pubblici del composition root (SPEC 8.6). Il contratto con gli altri strati e' `AppRoot`.
import type { FileServices, ObdTransport } from '@/domain/ports';
import type { CreateTransportOptions } from '@/obd/transport/createTransport';
import type { FileDeps, NotificationDeps } from '@/usecases/context';
import type { ObdService } from './obdService';
import type { ReplanCoordinator } from './replan';

/**
 * Opzioni di `obd.createTransport`. Tutte facoltative: il simulato (web, Expo Go, EXPO_PUBLIC_OBD_MOCK=1) parte da solo;
 * il BLE vero richiede `deviceId` (l'adattatore scelto dalla scansione), altrimenti la factory lancia un errore chiaro.
 */
export type ObdTransportOptions = Pick<
  CreateTransportOptions,
  'deviceId' | 'savedBleConfig' | 'onBleConfigResolved' | 'scenario' | 'simulated'
>;

export interface AppRoot {
  /**
   * Dipendenze dei casi d'uso: database avviato (migrato e con i cataloghi), orologio, ULID, bus degli eventi,
   * scheduler notifiche (`scheduler`) e servizi per file, ZIP, hash, selettori e condivisione (`fs`).
   */
  deps: NotificationDeps & FileDeps;
  /** Gli stessi servizi di `deps.fs`, per la UI (selettori e condivisione) senza passare dai casi d'uso. */
  files: FileServices;
  obd: {
    /** Un trasporto NUOVO a ogni chiamata (BLE reale sul telefono con development build, simulato altrove). */
    createTransport(opts?: ObdTransportOptions): ObdTransport;
    /** Facciata OBD per la UI (demo con l'auto simulata, snapshot, report di capacita', dati live). Solo lettura. */
    service: ObdService;
  };
  /** Chiude il database e smette di ascoltare gli eventi. L'app non lo chiama: serve ai test e alla schermata di reset. */
  dispose(): Promise<void>;
}

/** Cio' che il composition root aggiunge oltre al contratto, per chi sta nel bootstrap (AppProvider). */
export interface ComposedRoot extends AppRoot {
  replan: ReplanCoordinator;
}

export const hasReplan = (root: AppRoot): root is ComposedRoot =>
  typeof (root as Partial<ComposedRoot>).replan?.requestForeground === 'function';

/** Azione offerta dalla schermata di recupero oltre a "Riprova" (vedi recovery.ts e recovery.web.ts). */
export interface RecoveryAction {
  id: string;
  label: string;
  /** Spiega in una frase cosa succede; viene mostrata prima di chiedere conferma. */
  warning: string;
  run(): Promise<void>;
}
