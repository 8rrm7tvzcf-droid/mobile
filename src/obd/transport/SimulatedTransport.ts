// SimulatedTransport (F-56): un adattatore ELM327 virtuale con un'auto deterministica, per l'anteprima web,
// Expo Go, i test e la modalita' demo. Spezza le risposte come le notifiche BLE (20 byte) e rispetta il
// controllo di flusso dell'ELM327: un carattere ricevuto durante una risposta la interrompe ('STOPPED').
import { chunkText, Emitter } from './chunking';
import { Elm327Emulator, type EmulatorOptions, type ReplyPart } from './simulator/elm327Emulator';
import { SCENARIOS, type ScenarioConfig, type ScenarioId } from './simulator/scenarios';
import { realTimers, type ReconnectingTransport, type Timers } from './types';

export interface SimulatedTransportOptions extends EmulatorOptions {
  scenario?: ScenarioId | ScenarioConfig;
  /** Dimensione dei chunk in caratteri (default 20, come il BLE con MTU 23); null = nessuna frammentazione. */
  chunkSize?: number | null;
  chunkDelayMs?: number;
  timers?: Timers;
  /** Se la connessione cade, ripristinarla da sola dopo `reconnectDelayMs` (come il BLE con riconnessione). */
  autoReconnect?: boolean;
  reconnectDelayMs?: number;
}

export class SimulatedTransport implements ReconnectingTransport {
  readonly kind = 'simulated' as const;
  readonly emulator: Elm327Emulator;
  /** Comandi ricevuti (senza CR), per i test. */
  readonly received: string[] = [];
  /** Quante volte una scrittura ha interrotto una risposta in corso (STOPPED): con una sessione corretta resta 0. */
  interruptions = 0;

  private readonly timers: Timers;
  private readonly chunkSize: number | null;
  private readonly chunkDelayMs: number;
  private readonly autoReconnect: boolean;
  private readonly reconnectDelayMs: number;
  private readonly data = new Emitter<[string]>();
  private readonly closeEv = new Emitter<[string | undefined]>();
  private readonly lostEv = new Emitter<[string | undefined]>();
  private readonly reconnEv = new Emitter<[]>();

  private connected = false;
  private lineBuf = '';
  /** Chunk di una risposta a un comando ancora da consegnare (> 0 = l'ELM327 sta rispondendo). */
  private replyPending = 0;
  private handles = new Set<unknown>();
  private reconnectHandle: unknown;

  constructor(opts: SimulatedTransportOptions = {}) {
    const sc = opts.scenario ?? 'petrol';
    this.emulator = new Elm327Emulator(typeof sc === 'string' ? SCENARIOS[sc] : sc, opts);
    this.timers = opts.timers ?? realTimers;
    this.chunkSize = opts.chunkSize === undefined ? 20 : opts.chunkSize;
    this.chunkDelayMs = opts.chunkDelayMs ?? 0;
    this.autoReconnect = opts.autoReconnect ?? false;
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 1000;
  }

  get scenario(): ScenarioConfig {
    return this.emulator.scenario;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    this.connected = true;
    this.lineBuf = '';
    this.replyPending = 0;
  }

  async write(data: string): Promise<void> {
    if (!this.connected) throw new Error('SimulatedTransport non connesso');
    for (const ch of data) {
      if (ch === '\n') continue;
      if (ch === '\r') {
        const line = this.lineBuf;
        this.lineBuf = '';
        if (this.replyPending > 0) this.interrupt();
        this.dispatch(line);
      } else {
        // Un carattere mentre l'ELM327 sta ancora rispondendo interrompe l'operazione.
        if (this.replyPending > 0) this.interrupt();
        this.lineBuf += ch;
      }
    }
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
    if (!this.connected && this.reconnectHandle === undefined) return;
    this.connected = false;
    this.cancelOutput();
    if (this.reconnectHandle !== undefined) {
      this.timers.clearTimeout(this.reconnectHandle);
      this.reconnectHandle = undefined;
    }
    this.closeEv.emit('closed');
  }

  // ------------------------------------------------------------------ controllo dall'esterno (test e demo)

  setIgnition(on: boolean): void {
    this.emulator.ignition = on;
  }

  /** Fa cadere il collegamento: con `autoReconnect` si ripristina da solo, altrimenti la chiusura e' definitiva. */
  dropConnection(reason = 'simulated-drop'): void {
    if (!this.connected) return;
    this.connected = false;
    this.cancelOutput();
    this.lineBuf = '';
    if (this.autoReconnect) {
      this.lostEv.emit(reason);
      this.reconnectHandle = this.timers.setTimeout(() => {
        this.reconnectHandle = undefined;
        this.emulator.powerCycle();
        this.connected = true;
        this.reconnEv.emit();
      }, this.reconnectDelayMs);
    } else {
      this.closeEv.emit(reason);
    }
  }

  /** Spedisce testo non richiesto (avvisi, 'LV RESET', rumore) come farebbe l'adattatore. */
  injectData(text: string): void {
    if (this.connected) this.data.emit(text);
  }

  // ------------------------------------------------------------------ interni

  private cancelOutput(): void {
    for (const h of Array.from(this.handles)) this.timers.clearTimeout(h);
    this.handles.clear();
    this.replyPending = 0;
  }

  private interrupt(): void {
    this.interruptions++;
    this.cancelOutput();
    this.schedule([{ text: 'STOPPED\r\n\r\n>', delayMs: 0 }]);
  }

  private dispatch(line: string): void {
    if (line.length > 0) this.received.push(line);
    const r = this.emulator.handle(line);
    if (r.drop) {
      this.dropConnection('simulated-drop');
      return;
    }
    this.schedule(r.parts);
  }

  private schedule(parts: ReplyPart[], isReply = true): void {
    const events: { text: string; at: number }[] = [];
    let t = 0;
    for (const p of parts) {
      t += p.delayMs;
      const chunks = this.chunkSize === null ? [p.text] : chunkText(p.text, this.chunkSize);
      chunks.forEach((c, i) => events.push({ text: c, at: t + i * this.chunkDelayMs }));
    }
    if (events.length === 0) return;
    if (isReply) this.replyPending += events.length;
    events.forEach((e) => {
      const h: unknown = this.timers.setTimeout(() => {
        this.handles.delete(h);
        if (isReply && this.replyPending > 0) this.replyPending--; // prima di consegnare: la sessione puo' rispondere subito
        if (!this.connected) return;
        this.data.emit(e.text);
      }, e.at);
      this.handles.add(h);
    });
  }
}
