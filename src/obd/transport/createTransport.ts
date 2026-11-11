// Factory dei trasporti (SPEC 8.8): `createTransport(kind)`. NON importa moduli nativi a livello di modulo:
// react-native-ble-manager si carica con un `require` dinamico DENTRO la factory, solo quando serve il BLE,
// cosi' l'anteprima web, Expo Go e i test su PC non toccano moduli assenti.
import type { ObdTransport } from '@/domain/ports';
import { BleTransport, type BleManagerLike, type BleTransportOptions } from './BleTransport';
import type { BleConfig, SavedBleConfig } from './bleSelect';
import { MockTransport, type MockTransportOptions, type Transcript, type TranscriptEntry } from './MockTransport';
import { SimulatedTransport, type SimulatedTransportOptions } from './SimulatedTransport';
import type { ScenarioConfig, ScenarioId } from './simulator/scenarios';

export type TransportKind = ObdTransport['kind'];

export interface CreateTransportOptions {
  /** Simulato: scenario (default 'petrol') e opzioni. */
  scenario?: ScenarioId | ScenarioConfig;
  simulated?: Omit<SimulatedTransportOptions, 'scenario'>;
  /** Mock: trascrizione da riprodurre. */
  transcript?: Transcript | TranscriptEntry[];
  mock?: MockTransportOptions;
  /** BLE: id del dispositivo (da scansione), configurazione ricordata e callback di salvataggio. */
  deviceId?: string;
  savedBleConfig?: SavedBleConfig;
  onBleConfigResolved?: (cfg: BleConfig) => void;
  ble?: Partial<Omit<BleTransportOptions, 'deviceId' | 'manager'>>;
  /** Caricatore del gestore BLE (default: require dinamico di react-native-ble-manager). Serve ai test. */
  loadBleManager?: () => BleManagerLike;
}

/** Caricamento dinamico del modulo nativo (mai a livello di modulo). */
function defaultLoadBleManager(): BleManagerLike {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('react-native-ble-manager') as { default?: BleManagerLike } & Partial<BleManagerLike>;
  const manager = (mod.default ?? mod) as BleManagerLike | undefined;
  if (!manager || typeof manager.connect !== 'function') throw new Error('react-native-ble-manager non esporta un gestore valido');
  return manager;
}

export function createTransport(kind: TransportKind, opts: CreateTransportOptions = {}): ObdTransport {
  switch (kind) {
    case 'simulated':
      return new SimulatedTransport({ ...opts.simulated, scenario: opts.scenario ?? 'petrol' });
    case 'mock':
      return new MockTransport(opts.transcript ?? [], opts.mock);
    case 'ble': {
      if (!opts.deviceId) throw new Error("createTransport('ble') richiede il deviceId dell'adattatore");
      let manager: BleManagerLike;
      try {
        manager = (opts.loadBleManager ?? defaultLoadBleManager)();
      } catch (e) {
        throw new Error(
          `BLE non disponibile su questa piattaforma o in questa build (serve una development build con react-native-ble-manager): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      return new BleTransport({
        ...opts.ble,
        deviceId: opts.deviceId,
        manager,
        savedConfig: opts.savedBleConfig ?? opts.ble?.savedConfig,
        onConfigResolved: opts.onBleConfigResolved ?? opts.ble?.onConfigResolved,
      });
    }
    case 'classic':
    case 'wifi':
      throw new Error(`Trasporto '${kind}' non disponibile in questa versione (previsto in V1)`);
  }
}

export interface TransportEnv {
  /** Platform.OS di React Native ('web', 'android', 'ios'). */
  platform: string;
  /** Eseguito in Expo Go (nessun modulo nativo extra). */
  isExpoGo?: boolean;
  /** Valore di EXPO_PUBLIC_OBD_MOCK. */
  mockFlag?: string;
}

/**
 * Trasporto da usare: simulato su web, in Expo Go e con EXPO_PUBLIC_OBD_MOCK=1; BLE altrove
 * (SPEC 8.8). Funzione pura: l'ambiente lo legge il chiamante (bootstrap).
 */
export function pickTransportKind(env: TransportEnv): 'simulated' | 'ble' {
  if (env.mockFlag === '1') return 'simulated';
  if (env.platform === 'web') return 'simulated';
  if (env.isExpoGo === true) return 'simulated';
  return 'ble';
}
