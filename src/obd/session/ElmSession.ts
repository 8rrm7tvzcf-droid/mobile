// ElmSession (SPEC 8.7): coda FIFO con priorita', UN SOLO comando in volo, accumulo fino al prompt '>',
// normalizzazione (NUL, eco, SEARCHING...), timeout e retry per tipo di comando, log grezzo con timestamp.
// Non lancia mai: `send` risolve sempre con un ElmResponse (anche in caso di timeout o disconnessione).
import type { ObdTransport } from '@/domain/ports';
import {
  isSoftError,
  isAllowedCommand,
  normalizeResponse,
  obdError,
  type NormalizedResponse,
  type ObdError,
} from '@/obd/protocol';
import { isReconnectingTransport, realTimers, type Timers } from '@/obd/transport/types';

export type CommandKind = 'reset' | 'config' | 'search' | 'mode01' | 'mode02' | 'mode03' | 'mode09' | 'other';
export type Priority = 'user' | 'normal' | 'poll';
export type ResponseStatus = 'ok' | 'no_data' | 'unable' | 'unknown' | 'error' | 'timeout';

export interface ElmResponse {
  command: string;
  kind: CommandKind;
  /** Testo grezzo ricevuto fino al prompt. */
  raw: string;
  /** Righe normalizzate (senza eco, SEARCHING..., errori). */
  lines: string[];
  status: ResponseStatus;
  /** Errore principale (se status != 'ok'). */
  error?: ObdError;
  /** Errori morbidi (DATA ERROR con altre righe valide). */
  warnings: ObdError[];
  /** Avvisi di basso consumo visti durante la risposta. */
  alerts: ObdError[];
  /** E' comparso 'SEARCHING...'. */
  searched: boolean;
  /** Tentativi effettuati (1 = nessun retry). */
  attempts: number;
  durationMs: number;
}

export interface SendOptions {
  kind?: CommandKind;
  priority?: Priority;
  timeoutMs?: number;
  /** Retry su timeout, DATA ERROR, STOPPED, BUS BUSY, BUFFER FULL. */
  retries?: number;
  /** Retry su NO DATA. */
  retryNoData?: number;
}

export interface KindDefaults {
  timeoutMs: number;
  retries: number;
  retryNoData: number;
}

/** Timeout e retry per tipo di comando (SPEC 8.7, OBD §7). */
export const KIND_DEFAULTS: Readonly<Record<CommandKind, KindDefaults>> = {
  reset: { timeoutMs: 5000, retries: 1, retryNoData: 0 },
  config: { timeoutMs: 1000, retries: 1, retryNoData: 0 },
  search: { timeoutMs: 15000, retries: 0, retryNoData: 0 },
  mode01: { timeoutMs: 2000, retries: 1, retryNoData: 1 },
  mode02: { timeoutMs: 2000, retries: 1, retryNoData: 0 },
  mode03: { timeoutMs: 5000, retries: 1, retryNoData: 0 },
  mode09: { timeoutMs: 5000, retries: 1, retryNoData: 1 },
  other: { timeoutMs: 5000, retries: 0, retryNoData: 0 },
};

/** Tipo di comando dedotto dal testo. */
export function commandKind(cmd: string): CommandKind {
  const c = cmd.replace(/\s+/g, '').toUpperCase();
  if (c === 'ATZ' || c === 'ATWS') return 'reset';
  if (c.startsWith('AT') || c.startsWith('ST')) return 'config';
  if (/^01/.test(c)) return 'mode01';
  if (/^02/.test(c)) return 'mode02';
  if (c === '03' || c === '07' || c === '0A') return 'mode03';
  if (/^09/.test(c)) return 'mode09';
  return 'other';
}

export type SessionEvent =
  | { type: 'alert'; code: 'ACT_ALERT' | 'LP_ALERT' }
  | { type: 'adapter-reset'; code: 'LV_RESET' | 'ERR94' }
  | { type: 'desync' }
  | { type: 'link-lost'; reason?: string }
  | { type: 'closed'; reason?: string }
  | { type: 'stray'; text: string };

export interface LogEntry {
  /** Millisecondi dall'apertura della sessione. */
  t: number;
  dir: 'tx' | 'rx' | 'evt';
  text: string;
}

/** Voce di trascrizione registrabile dal log grezzo (formato dei fixture: {cmd, rx[]}). */
export interface RecordedEntry {
  cmd: string;
  rx: string[];
}

export interface ElmSessionOptions {
  /** Orologio in ms (log e durate). Default: Date.now. */
  now?: () => number;
  timers?: Timers;
  /** Consente i comandi di scrittura (Mode 04 ecc.). NELL'MVP RESTA false. */
  allowWrite?: boolean;
  /** Massimo di voci del log grezzo. */
  maxLogEntries?: number;
  /** Attesa del prompt dopo il CR di recupero in caso di timeout. */
  recoveryMs?: number;
  /** Moltiplicatore dei timeout predefiniti per tipo di comando (default 1; < 1 solo per i test e le demo veloci). */
  timeoutScale?: number;
}

interface QueueItem {
  cmd: string;
  kind: CommandKind;
  priority: number;
  seq: number;
  timeoutMs: number;
  retries: number;
  retryNoData: number;
  resolve: (r: ElmResponse) => void;
}

interface Active {
  buffer: string;
  recovering: boolean;
  onPrompt: (raw: string) => void;
}

const PRIORITY: Record<Priority, number> = { user: 0, normal: 1, poll: 2 };

export class ElmSession {
  private readonly transport: ObdTransport;
  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly allowWrite: boolean;
  private readonly maxLog: number;
  private readonly recoveryMs: number;
  private readonly timeoutScale: number;

  private queue: QueueItem[] = [];
  private seq = 0;
  private busy = false;
  private active: Active | null = null;
  private state: 'idle' | 'open' | 'closed' = 'idle';
  private desynced = false;
  private startedAt = 0;
  private log: LogEntry[] = [];
  private listeners = new Set<(e: SessionEvent) => void>();
  private unsubs: (() => void)[] = [];
  private failActive: ((code: 'DISCONNECTED') => void) | null = null;
  private transportReleased = false;

  constructor(transport: ObdTransport, opts: ElmSessionOptions = {}) {
    this.transport = transport;
    this.now = opts.now ?? (() => Date.now());
    this.timers = opts.timers ?? realTimers;
    this.allowWrite = opts.allowWrite === true;
    this.maxLog = opts.maxLogEntries ?? 2000;
    this.recoveryMs = opts.recoveryMs ?? 1000;
    this.timeoutScale = opts.timeoutScale ?? 1;
  }

  // ------------------------------------------------------------------ ciclo di vita

  /** Collega il trasporto e inizia ad ascoltare. */
  async open(): Promise<void> {
    if (this.state === 'open') return;
    this.transportReleased = false;
    this.startedAt = this.now();
    this.unsubs.push(this.transport.onData((chunk) => this.handleData(chunk)));
    if (isReconnectingTransport(this.transport)) {
      this.unsubs.push(
        this.transport.onLinkLost((reason) => {
          this.emit({ type: 'link-lost', reason });
          this.abortAll();
        }),
      );
      this.unsubs.push(
        this.transport.onReconnected(() => {
          // Dopo una riconnessione lo stato dell'adattatore e' ignoto: si riparte da una coda pulita.
          this.desynced = false;
          this.addLog('evt', 'reconnected');
        }),
      );
    }
    this.unsubs.push(
      this.transport.onClose((reason) => {
        if (this.state === 'closed') return;
        this.state = 'closed';
        this.addLog('evt', `closed: ${reason ?? ''}`);
        this.emit({ type: 'closed', reason });
        this.abortAll();
      }),
    );
    this.state = 'open';
    await this.transport.connect();
  }

  /**
   * Chiude la sessione e il trasporto. I comandi in coda ricevono DISCONNECTED. Idempotente, ma anche se la
   * sessione e' gia' 'closed' (chiusura definitiva decisa dal trasporto) rilascia le sottoscrizioni e chiede
   * UNA volta al trasporto di liberare le proprie risorse (listener nativi, collegamento).
   */
  async close(): Promise<void> {
    const alreadyClosed = this.state === 'closed';
    this.state = 'closed';
    this.abortAll();
    for (const u of this.unsubs.splice(0)) u();
    if (!this.transportReleased) {
      this.transportReleased = true;
      try {
        await this.transport.close();
      } catch {
        // chiusura best-effort
      }
    }
    if (!alreadyClosed) this.emit({ type: 'closed' });
  }

  /**
   * Annulla il comando in volo e svuota la coda (le richieste ricevono DISCONNECTED) senza chiudere la sessione:
   * serve quando lo stato dell'adattatore e' cambiato (LV RESET / ERR94) e le richieste in coda, preparate per
   * la configurazione di prima, non hanno piu' senso.
   */
  abortPending(): void {
    this.abortAll();
  }

  get isOpen(): boolean {
    return this.state === 'open';
  }

  /** True se dopo un timeout l'adattatore non ha restituito il prompt: serve riconnettere. */
  get isDesynced(): boolean {
    return this.desynced;
  }

  get pendingCount(): number {
    return this.queue.length + (this.busy ? 1 : 0);
  }

  onEvent(fn: (e: SessionEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  // ------------------------------------------------------------------ invio

  /**
   * Accoda un comando (senza CR) e risolve con la risposta normalizzata. Un solo comando alla volta e'
   * in volo; a parita' di priorita' vale l'ordine FIFO. Non rifiuta mai la promessa.
   */
  send(cmd: string, opts: SendOptions = {}): Promise<ElmResponse> {
    const command = cmd.replace(/[\r\n]/g, '').trim();
    const kind = opts.kind ?? commandKind(command);
    if (command.length === 0) return Promise.resolve(this.failResponse(command, kind, obdError('MALFORMED_FRAME', 'comando vuoto')));
    if (!this.allowWrite && !isAllowedCommand(command)) {
      return Promise.resolve(this.failResponse(command, kind, obdError('WRITE_BLOCKED', command)));
    }
    if (this.state !== 'open') {
      return Promise.resolve(this.failResponse(command, kind, obdError('DISCONNECTED')));
    }
    const d = KIND_DEFAULTS[kind];
    return new Promise<ElmResponse>((resolve) => {
      this.queue.push({
        cmd: command,
        kind,
        priority: PRIORITY[opts.priority ?? 'normal'],
        seq: this.seq++,
        timeoutMs: opts.timeoutMs ?? Math.max(1, Math.round(d.timeoutMs * this.timeoutScale)),
        retries: opts.retries ?? d.retries,
        retryNoData: opts.retryNoData ?? d.retryNoData,
        resolve,
      });
      this.pump();
    });
  }

  // ------------------------------------------------------------------ log e trascrizioni

  getLog(): readonly LogEntry[] {
    return this.log;
  }

  clearLog(): void {
    this.log = [];
  }

  /**
   * Trasforma il log grezzo in trascrizioni {cmd, rx[]} (rx = chunk come ricevuti), riutilizzabili come
   * fixture. Il log contiene i dati dell'auto: non va inviato in automatico.
   */
  exportTranscript(): RecordedEntry[] {
    const out: RecordedEntry[] = [];
    let cur: RecordedEntry | null = null;
    for (const e of this.log) {
      if (e.dir === 'tx') {
        cur = { cmd: e.text.replace(/\r/g, ''), rx: [] };
        out.push(cur);
      } else if (e.dir === 'rx' && cur) {
        cur.rx.push(e.text);
      }
    }
    return out.filter((e) => e.cmd.length > 0);
  }

  // ------------------------------------------------------------------ interni

  private emit(e: SessionEvent): void {
    for (const fn of Array.from(this.listeners)) {
      try {
        fn(e);
      } catch {
        // un ascoltatore difettoso non deve rompere la sessione
      }
    }
  }

  private addLog(dir: LogEntry['dir'], text: string): void {
    this.log.push({ t: this.now() - this.startedAt, dir, text });
    if (this.log.length > this.maxLog) this.log.splice(0, this.log.length - this.maxLog);
  }

  private failResponse(command: string, kind: CommandKind, error: ObdError): ElmResponse {
    return {
      command,
      kind,
      raw: '',
      lines: [],
      status: 'error',
      error,
      warnings: [],
      alerts: [],
      searched: false,
      attempts: 0,
      durationMs: 0,
    };
  }

  private pump(): void {
    if (this.busy || this.queue.length === 0 || this.state !== 'open') return;
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) {
      const a = this.queue[i];
      const b = this.queue[best];
      if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
    }
    const item = this.queue.splice(best, 1)[0];
    this.busy = true;
    void this.execute(item).then((resp) => {
      this.busy = false;
      item.resolve(resp);
      this.pump();
    });
  }

  private abortAll(): void {
    if (this.failActive) this.failActive('DISCONNECTED');
    const items = this.queue.splice(0);
    for (const it of items) it.resolve(this.failResponse(it.cmd, it.kind, obdError('DISCONNECTED')));
  }

  private handleData(chunk: string): void {
    this.addLog('rx', chunk);
    const a = this.active;
    if (!a) {
      // Dati senza comando in volo: avvisi dell'adattatore o rumore.
      const n = normalizeResponse(chunk);
      for (const al of n.alerts) if (al.code === 'ACT_ALERT' || al.code === 'LP_ALERT') this.emit({ type: 'alert', code: al.code });
      for (const er of n.errors) if (er.code === 'LV_RESET' || er.code === 'ERR94') this.emit({ type: 'adapter-reset', code: er.code });
      const text = chunk.replace(/[\u0000>\r\n ]/g, '');
      if (text.length > 0 && n.alerts.length === 0 && n.errors.length === 0) this.emit({ type: 'stray', text });
      return;
    }
    a.buffer += chunk;
    const i = a.buffer.indexOf('>');
    if (i >= 0) {
      const raw = a.buffer.slice(0, i);
      const rest = a.buffer.slice(i + 1).replace(/[\u0000\r\n ]/g, '');
      if (rest.length > 0) this.emit({ type: 'stray', text: rest });
      a.onPrompt(raw);
    }
  }

  /** Una singola transazione: scrive il comando e attende il prompt (o il timeout con recupero). */
  private transact(cmd: string, timeoutMs: number): Promise<{ raw: string; timedOut: boolean; aborted: boolean; writeFailed: boolean }> {
    return new Promise((resolve) => {
      let done = false;
      let timer: unknown;
      let recoveryTimer: unknown;
      const finish = (r: { raw: string; timedOut: boolean; aborted: boolean; writeFailed: boolean }) => {
        if (done) return;
        done = true;
        if (timer !== undefined) this.timers.clearTimeout(timer);
        if (recoveryTimer !== undefined) this.timers.clearTimeout(recoveryTimer);
        this.active = null;
        this.failActive = null;
        resolve(r);
      };
      const active: Active = {
        buffer: '',
        recovering: false,
        onPrompt: (raw) => {
          this.desynced = false; // il prompt e' tornato: la sessione e' sincronizzata
          finish({ raw, timedOut: active.recovering, aborted: false, writeFailed: false });
        },
      };
      this.active = active;
      this.failActive = () => finish({ raw: active.buffer, timedOut: false, aborted: true, writeFailed: false });

      timer = this.timers.setTimeout(() => {
        if (done) return;
        // Timeout: un solo CR forza il ritorno al prompt (datasheet); se non arriva, la sessione e' sfasata.
        active.recovering = true;
        this.addLog('evt', `timeout ${cmd}`);
        this.addLog('tx', '\r');
        this.transport.write('\r').catch(() => undefined);
        recoveryTimer = this.timers.setTimeout(() => {
          if (done) return;
          this.desynced = true;
          this.addLog('evt', 'desync');
          this.emit({ type: 'desync' });
          finish({ raw: active.buffer, timedOut: true, aborted: false, writeFailed: false });
        }, this.recoveryMs);
      }, timeoutMs);

      this.addLog('tx', cmd + '\r');
      this.transport.write(cmd + '\r').catch(() => finish({ raw: '', timedOut: false, aborted: false, writeFailed: true }));
    });
  }

  private build(item: QueueItem, text: { raw: string; timedOut: boolean; aborted: boolean; writeFailed: boolean }, attempts: number, startedAt: number): ElmResponse {
    const base = {
      command: item.cmd,
      kind: item.kind,
      attempts,
      durationMs: this.now() - startedAt,
    };
    if (text.aborted) return { ...base, raw: text.raw, lines: [], status: 'error', error: obdError('DISCONNECTED'), warnings: [], alerts: [], searched: false };
    if (text.writeFailed) return { ...base, raw: '', lines: [], status: 'error', error: obdError('WRITE_FAILED'), warnings: [], alerts: [], searched: false };
    const n: NormalizedResponse = normalizeResponse(text.raw, item.cmd);
    for (const al of n.alerts) if (al.code === 'ACT_ALERT' || al.code === 'LP_ALERT') this.emit({ type: 'alert', code: al.code });
    for (const er of n.errors) if (er.code === 'LV_RESET' || er.code === 'ERR94') this.emit({ type: 'adapter-reset', code: er.code });

    if (text.timedOut) {
      return { ...base, raw: text.raw, lines: n.lines, status: 'timeout', error: obdError('TIMEOUT', item.cmd), warnings: [], alerts: n.alerts, searched: n.searching };
    }
    const hard = n.errors.filter((e) => !isSoftError(e));
    const soft = n.errors.filter(isSoftError);
    let status: ResponseStatus = 'ok';
    let error: ObdError | undefined;
    if (hard.length > 0) {
      error = hard[0];
      status = error.code === 'NO_DATA' ? 'no_data' : error.code === 'UNABLE_TO_CONNECT' ? 'unable' : error.code === 'UNKNOWN_COMMAND' ? 'unknown' : 'error';
    } else if (soft.length > 0 && n.lines.length === 0) {
      error = soft[0];
      status = 'error';
    }
    return {
      ...base,
      raw: text.raw,
      lines: n.lines,
      status,
      error,
      warnings: error ? [] : soft,
      alerts: n.alerts,
      searched: n.searching,
    };
  }

  private async execute(item: QueueItem): Promise<ElmResponse> {
    const startedAt = this.now();
    let attempts = 0;
    let retries = item.retries;
    let retryNoData = item.retryNoData;
    let last: ElmResponse | undefined;
    for (;;) {
      attempts++;
      const t = await this.transact(item.cmd, item.timeoutMs);
      last = this.build(item, t, attempts, startedAt);
      if (this.state !== 'open') break;
      let delay = -1;
      if (last.status === 'timeout' && retries > 0 && !this.desynced) {
        retries--;
        delay = 0;
      } else if (last.status === 'no_data' && retryNoData > 0) {
        retryNoData--;
        delay = 100;
      } else if (last.status === 'error' && last.error && retries > 0) {
        const code = last.error.code;
        if (code === 'DATA_ERROR' || code === 'STOPPED' || code === 'RX_ERROR') {
          retries--;
          delay = 50;
        } else if (code === 'BUS_BUSY' || code === 'BUFFER_FULL') {
          retries--;
          delay = 250; // pausa di 100-300 ms (OBD §7)
        }
      }
      if (delay < 0) break;
      if (delay > 0) await new Promise<void>((r) => this.timers.setTimeout(r, delay));
    }
    return last;
  }
}
