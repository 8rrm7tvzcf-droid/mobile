// BleTransport su react-native-ble-manager (SPEC 8.7, OBD §4-§5).
//
// *** NON PROVATO SU DISPOSITIVO *** Scritto sulla documentazione e sui tipi della libreria (12.5.3) e provato
// solo con un gestore BLE finto nei test. Va validato con adattatori reali (OBDLink CX, un clone BLE, Vgate)
// nello spike SP-4. Il modulo nativo NON si importa qui: lo riceve dal costruttore (la factory lo carica con
// un require dinamico), cosi' Expo Go e il web non toccano moduli assenti.
//
// Comportamento:
//  - selezione del servizio e delle caratteristiche per PROPRIETA' (bleSelect.ts), poi verifica con ATZ
//    (nessun '>' in 3 s -> configurazione successiva);
//  - notifiche abilitate PRIMA del primo write;
//  - un solo write alla volta (catena di promesse); MTU non assunta: i comandi ELM sono < 20 caratteri e il
//    chunking della libreria e' a 20 byte (o `maxWriteBytes`);
//  - riconnessione con backoff 1/2/4 s; dopo ogni riconnessione il chiamante rifa' l'init COMPLETO.
import { Emitter } from './chunking';
import { selectBleConfigs, normalizeUuid, type BleCharacteristic, type BleConfig, type SavedBleConfig } from './bleSelect';
import { realTimers, type ReconnectingTransport, type Timers } from './types';

/** Parte della API di react-native-ble-manager che serve al trasporto (compatibile con la 12.5.x). */
export interface BleManagerLike {
  start?(options?: { showAlert?: boolean }): Promise<void>;
  isStarted?(): Promise<boolean>;
  connect(peripheralId: string, options?: { autoconnect?: boolean }): Promise<void>;
  disconnect(peripheralId: string, force?: boolean): Promise<void>;
  retrieveServices(peripheralId: string, serviceUUIDs?: string[]): Promise<{ characteristics?: BleCharacteristic[] }>;
  startNotification(peripheralId: string, serviceUUID: string, characteristicUUID: string): Promise<void>;
  stopNotification(peripheralId: string, serviceUUID: string, characteristicUUID: string): Promise<void>;
  write(peripheralId: string, serviceUUID: string, characteristicUUID: string, data: number[], maxByteSize?: number): Promise<void>;
  writeWithoutResponse(
    peripheralId: string,
    serviceUUID: string,
    characteristicUUID: string,
    data: number[],
    maxByteSize?: number,
    queueSleepTime?: number,
  ): Promise<void>;
  onDidUpdateValueForCharacteristic(cb: (e: { peripheral: string; characteristic: string; service?: string; value: number[] }) => void): { remove(): void };
  onDisconnectPeripheral(cb: (e: { peripheral: string; status?: number }) => void): { remove(): void };
}

export interface BleTransportOptions {
  deviceId: string;
  manager: BleManagerLike;
  timers?: Timers;
  /** Configurazione riuscita in una sessione precedente con questo adattatore. */
  savedConfig?: SavedBleConfig;
  /** Chiamata quando una configurazione e' verificata: il chiamante la ricorda per `deviceId`. */
  onConfigResolved?: (cfg: BleConfig) => void;
  /** Attesa del '>' dopo ATZ nella verifica (default 3000 ms). */
  verifyTimeoutMs?: number;
  /** Pausa tra connessione e scoperta dei servizi (evita 'status 133' su alcuni Android; default 400 ms). */
  discoveryDelayMs?: number;
  /** Ritardi di riconnessione (default 1, 2, 4 s). */
  backoffMs?: readonly number[];
  /** Riconnettersi da soli (default true). */
  autoReconnect?: boolean;
  /** Byte massimi per scrittura (default 20). */
  maxWriteBytes?: number;
}

export type BleErrorCode = 'NO_COMPATIBLE_SERVICE' | 'NO_RESPONSE' | 'NOT_CONNECTED';

export class BleTransportError extends Error {
  readonly code: BleErrorCode;
  constructor(code: BleErrorCode, message: string) {
    super(message);
    this.name = 'BleTransportError';
    this.code = code;
  }
}

function toBytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i) & 0xff);
  return out;
}

function toText(bytes: readonly number[]): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b & 0xff);
  return s;
}

export class BleTransport implements ReconnectingTransport {
  readonly kind = 'ble' as const;

  private readonly deviceId: string;
  private readonly manager: BleManagerLike;
  private readonly timers: Timers;
  private readonly opts: BleTransportOptions;
  private readonly backoff: readonly number[];
  private readonly data = new Emitter<[string]>();
  private readonly closeEv = new Emitter<[string | undefined]>();
  private readonly lostEv = new Emitter<[string | undefined]>();
  private readonly reconnEv = new Emitter<[]>();

  private config: BleConfig | null = null;
  private connected = false;
  /** Collegamento verificato e in uso: solo allora una caduta e' una 'perdita di collegamento'. */
  private ready = false;
  private closing = false;
  private reconnecting = false;
  /** Numero dell'ultimo tentativo di connessione avviato; close() lo invalida: un tentativo superato si annulla. */
  private attempt = 0;
  private writeChain: Promise<void> = Promise.resolve();
  private subs: { remove(): void }[] = [];
  private verifying: { buffer: string; done: () => void } | null = null;

  constructor(opts: BleTransportOptions) {
    this.opts = opts;
    this.deviceId = opts.deviceId;
    this.manager = opts.manager;
    this.timers = opts.timers ?? realTimers;
    this.backoff = opts.backoffMs ?? [1000, 2000, 4000];
  }

  /** Configurazione in uso (servizio, caratteristiche, tipo di scrittura) dopo la verifica. */
  get activeConfig(): BleConfig | null {
    return this.config;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (ms <= 0) resolve();
      else this.timers.setTimeout(resolve, ms);
    });
  }

  async connect(): Promise<void> {
    this.closing = false;
    await this.establish();
  }

  /** Connessione, scoperta, selezione e verifica: usata alla prima connessione e a ogni riconnessione. */
  private async establish(): Promise<void> {
    const m = this.manager;
    const mine = ++this.attempt;
    // close() (o una chiusura definitiva) durante la connessione la annulla: appena un passo ritorna, si rilascia
    // tutto (listener, notifiche, collegamento) e si esce senza risultare connessi.
    const cancelled = (): boolean => this.closing || this.attempt !== mine;
    const abort = async (): Promise<never> => {
      this.connected = false;
      this.ready = false;
      this.verifying = null;
      const cfg = this.config;
      this.config = null;
      if (cfg) {
        try {
          await m.stopNotification(this.deviceId, cfg.service, cfg.notify);
        } catch {
          // ignorato
        }
      }
      this.detachListeners();
      await this.safeDisconnect();
      throw new BleTransportError('NOT_CONNECTED', 'Connessione annullata dalla chiusura.');
    };

    if (m.isStarted && m.start && !(await m.isStarted())) await m.start({ showAlert: false });
    if (cancelled()) return abort();

    await m.connect(this.deviceId);
    if (cancelled()) return abort();
    await this.sleep(this.opts.discoveryDelayMs ?? 400);
    if (cancelled()) return abort();
    const info = await m.retrieveServices(this.deviceId);
    if (cancelled()) return abort();
    const candidates = selectBleConfigs(info.characteristics ?? [], this.config ? this.config : this.opts.savedConfig);
    if (candidates.length === 0) {
      await this.safeDisconnect();
      throw new BleTransportError('NO_COMPATIBLE_SERVICE', "Nessun servizio compatibile ELM327 sul dispositivo (serve una caratteristica notify e una di scrittura).");
    }
    this.attachListeners();

    for (const cfg of candidates) {
      // 1) notifiche PRIMA del primo write (su OBDLink CX l'abbinamento puo' scattare alla sottoscrizione)
      try {
        await m.startNotification(this.deviceId, cfg.service, cfg.notify);
      } catch {
        if (cancelled()) return abort();
        continue;
      }
      this.config = cfg;
      if (cancelled()) return abort();
      // 2) verifica con ATZ: se non arriva '>' entro il tempo, configurazione successiva
      const verified = await this.verify(cfg);
      if (cancelled()) return abort();
      if (verified) {
        this.connected = true;
        this.ready = true;
        this.opts.onConfigResolved?.(cfg);
        return;
      }
      this.config = null;
      try {
        await m.stopNotification(this.deviceId, cfg.service, cfg.notify);
      } catch {
        // ignorato
      }
    }
    await this.safeDisconnect();
    throw new BleTransportError('NO_RESPONSE', "L'adattatore non risponde ad ATZ su nessuna configurazione BLE.");
  }

  private async verify(cfg: BleConfig): Promise<boolean> {
    const timeout = this.opts.verifyTimeoutMs ?? 3000;
    return new Promise<boolean>((resolve) => {
      let finished = false;
      let timer: unknown;
      const done = () => {
        if (finished) return;
        finished = true;
        if (timer !== undefined) this.timers.clearTimeout(timer);
        this.verifying = null;
        resolve(true);
      };
      this.verifying = { buffer: '', done };
      timer = this.timers.setTimeout(() => {
        if (finished) return;
        finished = true;
        this.verifying = null;
        resolve(false);
      }, timeout);
      this.rawWrite('ATZ\r', cfg).catch(() => {
        if (finished) return;
        finished = true;
        if (timer !== undefined) this.timers.clearTimeout(timer);
        this.verifying = null;
        resolve(false);
      });
    });
  }

  private attachListeners(): void {
    if (this.subs.length > 0) return;
    this.subs.push(
      this.manager.onDidUpdateValueForCharacteristic((e) => {
        if (e.peripheral !== this.deviceId) return;
        const cfg = this.config;
        if (!cfg || normalizeUuid(e.characteristic) !== normalizeUuid(cfg.notify)) return;
        const text = toText(e.value ?? []);
        if (this.verifying) {
          this.verifying.buffer += text;
          if (this.verifying.buffer.includes('>')) this.verifying.done();
          return;
        }
        this.data.emit(text);
      }),
    );
    this.subs.push(
      this.manager.onDisconnectPeripheral((e) => {
        if (e.peripheral !== this.deviceId) return;
        this.handleLinkLost(e.status !== undefined ? `status ${e.status}` : 'disconnected');
      }),
    );
  }

  private detachListeners(): void {
    for (const s of this.subs.splice(0)) {
      try {
        s.remove();
      } catch {
        // ignorato
      }
    }
  }

  private handleLinkLost(reason: string): void {
    // Durante la connessione o un tentativo di riconnessione una caduta fa solo fallire quel tentativo.
    if (this.closing || !this.ready) return;
    this.ready = false;
    this.connected = false;
    this.verifying = null;
    this.lostEv.emit(reason);
    if (this.opts.autoReconnect === false) {
      this.finalClose(reason);
      return;
    }
    if (!this.reconnecting) void this.reconnectLoop(reason);
  }

  private async reconnectLoop(reason: string): Promise<void> {
    this.reconnecting = true;
    try {
      for (const delay of this.backoff) {
        await this.sleep(delay);
        if (this.closing) return;
        try {
          await this.establish();
          this.reconnEv.emit();
          return;
        } catch {
          // si riprova col ritardo successivo
        }
      }
      if (!this.closing) this.finalClose(`reconnect-failed: ${reason}`);
    } finally {
      this.reconnecting = false;
    }
  }

  /**
   * Chiusura definitiva decisa dal trasporto (autoReconnect: false o backoff esaurito): prima di avvisare chi
   * ascolta libera i listener del gestore BLE, la sottoscrizione alle notifiche e il collegamento, altrimenti
   * (la sessione passa a 'closed' e non richiama piu' close()) i vecchi listener continuerebbero a ricevere i
   * dati di un nuovo collegamento allo stesso dispositivo.
   */
  private finalClose(reason: string): void {
    this.closing = true;
    this.attempt++;
    this.connected = false;
    this.ready = false;
    const cfg = this.config;
    this.config = null;
    this.detachListeners();
    void (async () => {
      if (cfg) {
        try {
          await this.manager.stopNotification(this.deviceId, cfg.service, cfg.notify);
        } catch {
          // ignorato
        }
      }
      await this.safeDisconnect();
    })();
    this.closeEv.emit(reason);
  }

  private async safeDisconnect(): Promise<void> {
    try {
      await this.manager.disconnect(this.deviceId);
    } catch {
      // ignorato
    }
  }

  private async rawWrite(text: string, cfg: BleConfig): Promise<void> {
    const bytes = toBytes(text);
    const max = this.opts.maxWriteBytes ?? 20;
    if (cfg.writeType === 'withoutResponse') {
      await this.manager.writeWithoutResponse(this.deviceId, cfg.service, cfg.write, bytes, max);
    } else {
      await this.manager.write(this.deviceId, cfg.service, cfg.write, bytes, max);
    }
  }

  async write(data: string): Promise<void> {
    const cfg = this.config;
    if (!this.connected || !cfg) throw new BleTransportError('NOT_CONNECTED', 'BLE non connesso');
    // un solo write alla volta
    const run = this.writeChain.then(() => this.rawWrite(data, cfg));
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  onData(fn: (chunk: string) => void): () => void {
    return this.data.on(fn);
  }

  onClose(fn: (reason?: string) => void): () => void {
    return this.closeEv.on(fn);
  }

  onLinkLost(fn: (reason?: string) => void): () => void {
    return this.lostEv.on(fn);
  }

  onReconnected(fn: () => void): () => void {
    return this.reconnEv.on(fn);
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.attempt++; // annulla un eventuale tentativo di (ri)connessione in corso
    const cfg = this.config;
    this.connected = false;
    this.ready = false;
    if (cfg) {
      try {
        await this.manager.stopNotification(this.deviceId, cfg.service, cfg.notify);
      } catch {
        // ignorato
      }
    }
    await this.safeDisconnect();
    this.detachListeners();
    this.config = null;
    this.closeEv.emit('closed');
  }
}
