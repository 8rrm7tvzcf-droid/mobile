// MockTransport: riproduce trascrizioni {cmd, rx[], atteso} registrate (o sintetiche) spezzando le
// risposte a 20 byte come farebbe il BLE, per provare il buffering di ElmSession (SPEC 8.7).
import type { ObdTransport } from '@/domain/ports';
import { chunkText, Emitter } from './chunking';
import { realTimers, type Timers } from './types';

export interface TranscriptEntry {
  /** Comando atteso (senza CR; gli spazi e le maiuscole non contano). */
  cmd: string;
  /** Chunk ricevuti dall'adattatore, nell'ordine; vuoto = l'adattatore tace (prova dei timeout). */
  rx: string[];
  /** Risultato atteso (per i test golden; il trasporto lo ignora). */
  atteso?: unknown;
  note?: string;
}

export interface Transcript {
  name?: string;
  source?: string;
  protocol?: string;
  headers?: boolean;
  entries: TranscriptEntry[];
}

export interface MockTransportOptions {
  /** Dimensione dei chunk in caratteri (default 20); null = come registrati. */
  chunkSize?: number | null;
  /** Ritardo tra un chunk e il successivo (ms, default 0). */
  chunkDelayMs?: number;
  timers?: Timers;
  /** Come rispondere a un comando fuori trascrizione: '?' (default) oppure silenzio. */
  unmatched?: 'nak' | 'silent';
  /** Un CR da solo (recupero dopo timeout) viene confermato con '>' (default true). */
  answerLoneCr?: boolean;
}

function compact(s: string): string {
  return s.replace(/\s+/g, '').toUpperCase();
}

export class MockTransport implements ObdTransport {
  readonly kind = 'mock' as const;

  /** Tutto cio' che e' stato scritto (CR inclusi). */
  readonly written: string[] = [];
  /** Comandi non presenti in trascrizione. */
  readonly unmatched: string[] = [];

  private readonly data = new Emitter<[string]>();
  private readonly closeEv = new Emitter<[string | undefined]>();
  private readonly entries: TranscriptEntry[];
  private readonly consumed: boolean[];
  private readonly chunkSize: number | null;
  private readonly chunkDelayMs: number;
  private readonly timers: Timers;
  private readonly unmatchedMode: 'nak' | 'silent';
  private readonly answerLoneCr: boolean;
  private connected = false;
  private closed = false;
  private pendingTimers: unknown[] = [];
  /** Numero massimo di comandi contemporaneamente in volo osservato (deve restare 1). */
  maxInFlight = 0;
  private inFlight = 0;

  constructor(transcript: Transcript | TranscriptEntry[], opts: MockTransportOptions = {}) {
    this.entries = Array.isArray(transcript) ? transcript : transcript.entries;
    this.consumed = this.entries.map(() => false);
    this.chunkSize = opts.chunkSize === undefined ? 20 : opts.chunkSize;
    this.chunkDelayMs = opts.chunkDelayMs ?? 0;
    this.timers = opts.timers ?? realTimers;
    this.unmatchedMode = opts.unmatched ?? 'nak';
    this.answerLoneCr = opts.answerLoneCr ?? true;
  }

  async connect(): Promise<void> {
    this.connected = true;
    this.closed = false;
  }

  async write(data: string): Promise<void> {
    if (!this.connected || this.closed) throw new Error('MockTransport non connesso');
    this.written.push(data);
    const text = data.replace(/\r/g, '').replace(/\n/g, '');
    if (text.length === 0) {
      if (this.answerLoneCr) this.deliver(['\r\n>']);
      return;
    }
    // Un carattere ricevuto mentre un comando e' in corso lo interrompe (STOPPED): si conta come anomalia.
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const key = compact(text);
    const idx = this.entries.findIndex((e, i) => !this.consumed[i] && compact(e.cmd) === key);
    if (idx < 0) {
      this.unmatched.push(text);
      this.deliver(this.unmatchedMode === 'nak' ? ['?\r\r>'] : []);
      return;
    }
    this.consumed[idx] = true;
    const rx = this.entries[idx].rx;
    this.deliver(this.chunkSize === null ? rx : chunkText(rx.join(''), this.chunkSize));
  }

  onData(fn: (chunk: string) => void): () => void {
    return this.data.on(fn);
  }

  onClose(fn: (reason?: string) => void): () => void {
    return this.closeEv.on(fn);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    for (const t of this.pendingTimers.splice(0)) this.timers.clearTimeout(t);
    this.closeEv.emit('closed');
  }

  /** Simula la caduta del collegamento. */
  simulateDisconnect(reason = 'simulated-drop'): void {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    for (const t of this.pendingTimers.splice(0)) this.timers.clearTimeout(t);
    this.closeEv.emit(reason);
  }

  /** Voci non ancora consumate (utile per verificare che la sessione abbia inviato tutto). */
  remaining(): TranscriptEntry[] {
    return this.entries.filter((_, i) => !this.consumed[i]);
  }

  private deliver(chunks: string[]): void {
    if (chunks.length === 0) {
      this.inFlight = Math.max(0, this.inFlight - 1);
      return;
    }
    chunks.forEach((c, i) => {
      const last = i === chunks.length - 1;
      const t = this.timers.setTimeout(() => {
        if (this.closed) return;
        this.data.emit(c);
        if (last) this.inFlight = Math.max(0, this.inFlight - 1);
      }, this.chunkDelayMs * (i + 1));
      this.pendingTimers.push(t);
    });
  }
}
