// ObdConnection: compone trasporto + ElmSession + init + VehicleService e rieseguendo l'init COMPLETO a ogni
// riconnessione (SPEC 8.7: lo stato dell'adattatore puo' essere stato azzerato da LV RESET o sleep) e dopo un
// reset dell'adattatore a link attivo (evento 'adapter-reset' di ElmSession: LV RESET / ERR94).
// 'closed' e' uno stato TERMINALE: nessuna transizione successiva.
import type { Clock, ObdTransport, Result } from '@/domain/ports';
import { isReconnectingTransport, realTimers, type Timers } from '@/obd/transport/types';
import { ElmSession, type ElmSessionOptions } from './ElmSession';
import { runAdapterInit, type InitFailure, type InitOptions, type InitResult } from './AdapterInit';
import { VehicleService, type VehicleServiceOptions } from './VehicleService';

export type ConnectionState = 'idle' | 'connecting' | 'initializing' | 'ready' | 'reconnecting' | 'closed' | 'failed';

export interface ObdConnectionOptions {
  transport: ObdTransport;
  session?: ElmSessionOptions;
  init?: InitOptions;
  vehicle?: VehicleServiceOptions;
  clock?: Pick<Clock, 'nowIso'>;
  timers?: Timers;
}

export class ObdConnection {
  readonly session: ElmSession;
  private readonly transport: ObdTransport;
  private readonly opts: ObdConnectionOptions;
  private readonly listeners = new Set<(s: ConnectionState, detail?: InitFailure) => void>();
  private unsubs: (() => void)[] = [];
  private _state: ConnectionState = 'idle';
  private _vehicle: VehicleService | null = null;
  private _init: InitResult | null = null;
  private _failure: InitFailure | null = null;
  /** Numero di init completati dopo una riconnessione o un reset dell'adattatore (test e diagnostica). */
  reinitCount = 0;
  /** Numero dell'ultimo init avviato: il risultato di un init superato da uno piu' recente si scarta. */
  private initSeq = 0;

  constructor(opts: ObdConnectionOptions) {
    this.opts = opts;
    this.transport = opts.transport;
    const timers = opts.timers ?? realTimers;
    // SOLA LETTURA: la connessione non permette mai di abilitare i comandi di scrittura (SPEC 5.5 / 8.7).
    this.session = new ElmSession(opts.transport, { timers, ...opts.session, allowWrite: false });
  }

  get state(): ConnectionState {
    return this._state;
  }

  /** Servizio di lettura valido finche' lo stato e' 'ready'; dopo una riconnessione ne viene creato uno nuovo. */
  get vehicle(): VehicleService | null {
    return this._vehicle;
  }

  get init(): InitResult | null {
    return this._init;
  }

  get failure(): InitFailure | null {
    return this._failure;
  }

  onState(fn: (s: ConnectionState, detail?: InitFailure) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private setState(s: ConnectionState, detail?: InitFailure): void {
    if (this._state === 'closed') return; // terminale: nessuna transizione dopo la chiusura
    if (this._state === s && !detail) return;
    this._state = s;
    for (const fn of Array.from(this.listeners)) {
      try {
        fn(s, detail);
      } catch {
        // ascoltatore difettoso
      }
    }
  }

  /** `initial`: primo init di open(); gli altri partono da una riconnessione o da un reset dell'adattatore. */
  private async runInit(initial = false): Promise<Result<InitResult, InitFailure>> {
    if (this._state === 'closed') return { ok: false, error: this.lostFailure() };
    const run = ++this.initSeq;
    this.setState('initializing');
    const r = await runAdapterInit(this.session, { timers: this.opts.timers, ...this.opts.init });
    // Chiusa nel frattempo ('closed' e' terminale) o superato da un init piu' recente: non si tocca nulla.
    if (this.isClosed() || run !== this.initSeq) return r;
    if (r.ok) {
      if (!initial) this.reinitCount++;
      this._init = r.value;
      this._failure = null;
      this._vehicle = new VehicleService(this.session, r.value, { timers: this.opts.timers, clock: this.opts.clock, ...this.opts.vehicle });
      this.setState('ready');
    } else {
      this._vehicle = null;
      // Il collegamento e' ricaduto durante questo init di recupero: lo stato segue il collegamento ('reconnecting')
      // finche' il trasporto non lo ripristina (nuovo init) o non chiude; 'failed' sarebbe fuorviante.
      if (!initial && this.isReconnecting()) return r;
      this._failure = r.error;
      this.setState('failed', r.error);
    }
    return r;
  }

  // Letture dello stato dopo un await: metodi a parte perche' TypeScript non sa che l'attesa puo' averlo cambiato.
  private isClosed(): boolean {
    return this._state === 'closed';
  }

  private isReconnecting(): boolean {
    return this._state === 'reconnecting';
  }

  private lostFailure(): InitFailure {
    return {
      code: 'DISCONNECTED',
      step: 'reset',
      message: "Collegamento con l'adattatore perso. Avvicinati e riprova.",
      hint: 'retry',
      retryable: true,
    };
  }

  /**
   * LV RESET / ERR94 a link attivo: l'adattatore e' tornato ai valori di fabbrica (eco acceso, intestazioni spente)
   * e, dopo ERR94, la ricerca CAN resta bloccata finche' non si fa ATFE: le letture in corso non hanno piu' senso.
   * Si esce da 'ready', si annullano le richieste in coda e si riesegue l'init completo (una sola volta: finche'
   * lo stato non e' 'ready' altri eventi sono ignorati; durante l'init gli errori li gestisce l'init stesso).
   */
  private onAdapterReset(): void {
    if (this._state !== 'ready') return;
    this._vehicle = null;
    this.setState('reconnecting');
    this.session.abortPending();
    void this.runInit();
  }

  /** Apre il trasporto ed esegue l'init. In caso di errore lo stato diventa 'failed'. */
  async open(): Promise<Result<InitResult, InitFailure>> {
    this.setState('connecting');
    try {
      await this.session.open();
    } catch {
      const f: InitFailure = {
        code: 'DISCONNECTED',
        step: 'reset',
        message: "Non riesco a collegarmi all'adattatore. Controlla che sia acceso e vicino, poi riprova.",
        hint: 'retry',
        retryable: true,
      };
      this._failure = f;
      this.setState('failed', f);
      return { ok: false, error: f };
    }

    this.unsubs.push(
      this.session.onEvent((e) => {
        if (e.type === 'adapter-reset') this.onAdapterReset();
      }),
    );
    if (isReconnectingTransport(this.transport)) {
      this.unsubs.push(
        this.transport.onLinkLost(() => {
          if (this._state === 'closed') return;
          this._vehicle = null;
          this.setState('reconnecting');
        }),
      );
      this.unsubs.push(
        this.transport.onReconnected(() => {
          if (this._state === 'closed') return;
          // init completo a ogni riconnessione
          void this.runInit();
        }),
      );
    }
    this.unsubs.push(
      this.transport.onClose(() => {
        if (this._state !== 'closed') {
          this._vehicle = null;
          this.setState('closed');
        }
      }),
    );
    return this.runInit(true);
  }

  /**
   * Chiude la connessione. Idempotente; anche se lo stato e' gia' 'closed' (chiusura definitiva decisa dal
   * trasporto) rilascia le sottoscrizioni e fa chiudere la sessione, che libera il trasporto.
   */
  async close(): Promise<void> {
    this.setState('closed');
    for (const u of this.unsubs.splice(0)) u();
    this._vehicle = null;
    await this.session.close();
  }
}
