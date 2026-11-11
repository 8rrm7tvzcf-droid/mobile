// AdapterInit (SPEC 8.7, OBD §6): ATZ -> ATE0 -> ATL0 -> ATS0 -> ATH1 -> ATAT1 -> ATRV -> ATSP0 -> 0100
// -> ATDPN -> identificazione (ATI, AT@1, STI, sonda ATAMC). Nessun comando di scrittura.
// Politiche: i comandi di configurazione che rispondono '?' non abortiscono ('non supportato');
// UNABLE TO CONNECT si riprova al massimo ogni 2-3 s; protocollo noto per l'auto -> ATTPA<n> invece di
// ATSP<n> (non scrive in EEPROM); ERR94 -> ATFE (ATZ non basta, datasheet p.88).
import type { Result } from '@/domain/ports';
import {
  EU_FALLBACK_PROTOCOLS,
  parseProtocolNumber,
  parseSupportResponse,
  protocolInfo,
  type ObdError,
  type ProtocolId,
} from '@/obd/protocol';
import { realTimers, type Timers } from '@/obd/transport/types';
import type { ElmResponse, ElmSession } from './ElmSession';

export type InitStep = 'reset' | 'config' | 'voltage' | 'protocol' | 'search' | 'identify';

export interface InitProgress {
  step: InitStep;
  /** Messaggio per l'utente (italiano). */
  message: string;
}

export type InitFailureCode =
  | 'NO_RESPONSE'
  | 'UNABLE_TO_CONNECT'
  | 'NO_DATA'
  | 'BUS_ERROR'
  | 'ADAPTER_RESET'
  | 'BAD_RESPONSE'
  | 'DISCONNECTED';

export type InitHint = 'ignition' | 'adapter' | 'unplug' | 'retry' | 'none';

export interface InitFailure {
  code: InitFailureCode;
  step: InitStep;
  /** Messaggio per l'utente (italiano). */
  message: string;
  hint: InitHint;
  retryable: boolean;
  cause?: ObdError;
}

export type InitWarningCode =
  | 'ECHO_NOT_DISABLED'
  | 'LINEFEED_NOT_DISABLED'
  | 'SPACES_NOT_DISABLED'
  | 'HEADERS_UNSUPPORTED'
  | 'VOLTAGE_UNAVAILABLE'
  | 'VOLTAGE_VERY_LOW'
  | 'PROTOCOL_NUMBER_UNKNOWN'
  | 'SAVED_PROTOCOL_FAILED';

export type CloneReason = 'VERSION_1_5_DOES_NOT_EXIST' | 'V2_WITHOUT_ATAMC';

export interface AdapterInfo {
  /** Banner come restituito (es. 'ELM327 v1.5'). */
  banner?: string;
  /** Numero di versione dichiarato (es. '1.5'): NON e' affidabile (i cloni 'v1.5/v2.1' sono firmware 1.4). */
  versionNumber?: string;
  /** AT@1 (descrizione del dispositivo). */
  description?: string;
  /** Risposta a STI se l'adattatore e' un chip STN. */
  stn?: string;
  isStn: boolean;
  /** ATAMC risponde (firmware >= 2.0): null = non sondato. */
  amcSupported: boolean | null;
  suspectedClone: boolean;
  cloneReasons: CloneReason[];
}

export interface InitResult {
  /** Protocollo trovato (da ATDPN). */
  protocol: ProtocolId;
  protocolName: string;
  /** ATDPN 'A6' = ricerca automatica che ha scelto il 6. */
  protocolAuto: boolean;
  /** ATH1 attivo: i frame hanno l'intestazione e si riassemblano per ECU. */
  headers: boolean;
  /** Tensione al pin 16 misurata dall'adattatore (ATRV). */
  voltage?: number;
  adapter: AdapterInfo;
  /** PID dichiarati dal blocco 0100, unione delle ECU. */
  declared: number[];
  declaredByEcu: Record<string, number[]>;
  /** ECU che hanno risposto a 0100. */
  ecus: string[];
  /** Quanto e' durata la ricerca del protocollo (0100). */
  searchMs: number;
  warnings: InitWarningCode[];
}

export interface InitOptions {
  /** Protocollo salvato per questa auto (da un collegamento precedente). */
  savedProtocol?: ProtocolId;
  /** Timeout della ricerca del protocollo (0100 dopo ATSP0). Default 15 s. */
  searchTimeoutMs?: number;
  /** Quante volte riprovare dopo UNABLE TO CONNECT. Default 1. */
  unableRetries?: number;
  /** Pausa tra i tentativi dopo UNABLE TO CONNECT (non piu' di uno ogni 2-3 s). Default 2500 ms. */
  unableRetryDelayMs?: number;
  /** Pausa prima di riprovare dopo NO DATA su 0100 (ECU in sleep). Default 1000 ms. */
  noDataRetryDelayMs?: number;
  /** Pausa dopo ATZ. Default 100 ms (alcuni cloni la richiedono). */
  postResetDelayMs?: number;
  /** Se la ricerca automatica fallisce prova i protocolli uno a uno (ordine UE). Default false. */
  tryFallbackProtocols?: boolean;
  fallbackProtocols?: readonly ProtocolId[];
  /** Salta ATI/AT@1/STI/ATAMC. */
  skipIdentification?: boolean;
  onProgress?: (p: InitProgress) => void;
  timers?: Timers;
}

const MSG: Record<InitFailureCode, { message: string; hint: InitHint; retryable: boolean }> = {
  NO_RESPONSE: {
    message: "L'adattatore non risponde. Controlla che sia inserito bene nella presa OBD dell'auto e alimentato, poi riprova.",
    hint: 'adapter',
    retryable: true,
  },
  UNABLE_TO_CONNECT: {
    message: 'Non riesco a parlare con la centralina. Gira la chiave su accensione (quadro acceso) e riprova.',
    hint: 'ignition',
    retryable: true,
  },
  NO_DATA: {
    message: "L'auto non risponde. Accendi il quadro e riprova tra qualche secondo.",
    hint: 'ignition',
    retryable: true,
  },
  BUS_ERROR: {
    message: "Errore di comunicazione con l'auto. Controlla che l'adattatore sia inserito bene e riprova.",
    hint: 'adapter',
    retryable: true,
  },
  ADAPTER_RESET: {
    message: "L'adattatore si e' riavviato (tensione bassa o errore grave). Scollegalo, ricollegalo e riprova.",
    hint: 'unplug',
    retryable: true,
  },
  BAD_RESPONSE: {
    message: "L'auto ha risposto in modo non interpretabile. Riprova; se succede ancora potrebbe non essere compatibile.",
    hint: 'retry',
    retryable: true,
  },
  DISCONNECTED: {
    message: "Collegamento con l'adattatore perso. Avvicinati e riprova.",
    hint: 'retry',
    retryable: true,
  },
};

function failure(code: InitFailureCode, step: InitStep, cause?: ObdError): Result<InitResult, InitFailure> {
  const m = MSG[code];
  const f: InitFailure = { code, step, message: m.message, hint: m.hint, retryable: m.retryable };
  if (cause) f.cause = cause;
  return { ok: false, error: f };
}

const STEP_MESSAGES: Record<InitStep, string> = {
  reset: "Reset dell'adattatore...",
  config: "Configurazione dell'adattatore...",
  voltage: 'Controllo della tensione...',
  protocol: 'Scelta del protocollo...',
  search: "Ricerca del protocollo dell'auto (puo' richiedere qualche secondo)...",
  identify: "Riconoscimento dell'adattatore...",
};

/** Estrae il numero di versione da un banner tipo 'ELM327 v1.5'. */
export function parseElmVersion(lines: readonly string[]): { banner?: string; versionNumber?: string } {
  for (const l of lines) {
    const m = /ELM\d+\s*v?\s*([0-9]+\.[0-9]+[a-zA-Z]?)/i.exec(l);
    if (m) return { banner: l.trim(), versionNumber: m[1] };
  }
  return {};
}

/** Tensione da ATRV: '12.4V' -> 12.4. */
export function parseVoltage(lines: readonly string[]): number | undefined {
  for (const l of lines) {
    const m = /(\d{1,2}(?:[.,]\d{1,2})?)\s*V/i.exec(l);
    if (m) {
      const v = Number(m[1].replace(',', '.'));
      if (Number.isFinite(v)) return v;
    }
  }
  return undefined;
}

/**
 * Valuta se l'adattatore e' un probabile clone (OBD §1, SPEC 5.3): la versione 1.5 non e' mai esistita e i
 * cloni 'v2.x' sono firmware 1.4 copiato (ATAMC risponde '?', mentre dal 2.0 esiste). I chip STN non sono cloni.
 */
export function assessClone(info: Pick<AdapterInfo, 'versionNumber' | 'isStn' | 'amcSupported'>): CloneReason[] {
  const reasons: CloneReason[] = [];
  if (info.isStn) return reasons;
  const v = info.versionNumber;
  if (v === '1.5') reasons.push('VERSION_1_5_DOES_NOT_EXIST');
  if (v && /^2\./.test(v) && info.amcSupported === false) reasons.push('V2_WITHOUT_ATAMC');
  return reasons;
}

function sleep(timers: Timers, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) resolve();
    else timers.setTimeout(resolve, ms);
  });
}

function isDisconnected(r: ElmResponse): boolean {
  return r.status === 'error' && (r.error?.code === 'DISCONNECTED' || r.error?.code === 'WRITE_FAILED');
}

/**
 * Esegue l'inizializzazione completa dell'adattatore. Non lancia: restituisce Result con InitFailure.
 * Va rieseguita per intero a ogni riconnessione (lo stato dell'adattatore puo' essere stato azzerato).
 */
export async function runAdapterInit(session: ElmSession, opts: InitOptions = {}): Promise<Result<InitResult, InitFailure>> {
  const timers = opts.timers ?? realTimers;
  const warnings: InitWarningCode[] = [];
  const progress = (step: InitStep) => {
    try {
      opts.onProgress?.({ step, message: STEP_MESSAGES[step] });
    } catch {
      // la UI non deve rompere l'init
    }
  };
  const warn = (w: InitWarningCode) => {
    if (!warnings.includes(w)) warnings.push(w);
  };

  // 1) ATZ
  progress('reset');
  const z = await session.send('ATZ', { kind: 'reset', priority: 'user' });
  if (isDisconnected(z)) return failure('DISCONNECTED', 'reset', z.error);
  if (z.status === 'timeout' || (z.status !== 'ok' && z.lines.length === 0)) return failure('NO_RESPONSE', 'reset', z.error);
  const ver = parseElmVersion(z.lines);
  await sleep(timers, opts.postResetDelayMs ?? 100);

  // 2) configurazione: ATE0, ATL0, ATS0, ATH1, ATAT1
  progress('config');
  const config = async (cmd: string): Promise<ElmResponse> => session.send(cmd, { kind: 'config', priority: 'user' });
  const fatal = (r: ElmResponse): boolean => r.status === 'timeout' || isDisconnected(r);
  const failFor = (r: ElmResponse, step: InitStep): Result<InitResult, InitFailure> =>
    isDisconnected(r) ? failure('DISCONNECTED', step, r.error) : failure('NO_RESPONSE', step, r.error);

  const e0 = await config('ATE0');
  if (fatal(e0)) return failFor(e0, 'config');
  if (e0.status !== 'ok') warn('ECHO_NOT_DISABLED');

  const l0 = await config('ATL0');
  if (fatal(l0)) return failFor(l0, 'config');
  if (l0.status !== 'ok') warn('LINEFEED_NOT_DISABLED');

  const s0 = await config('ATS0');
  if (fatal(s0)) return failFor(s0, 'config');
  if (s0.status !== 'ok') warn('SPACES_NOT_DISABLED');

  const h1 = await config('ATH1');
  if (fatal(h1)) return failFor(h1, 'config');
  const headers = h1.status === 'ok';
  if (!headers) warn('HEADERS_UNSUPPORTED'); // ripiego: ATH0, ECU non distinguibili con piu' risposte

  const at1 = await config('ATAT1');
  if (fatal(at1)) return failFor(at1, 'config');

  // 3) tensione
  progress('voltage');
  const rv = await config('ATRV');
  if (isDisconnected(rv)) return failure('DISCONNECTED', 'voltage', rv.error);
  const voltage = rv.status === 'ok' ? parseVoltage(rv.lines) : undefined;
  if (voltage === undefined) warn('VOLTAGE_UNAVAILABLE');
  else if (voltage < 6) warn('VOLTAGE_VERY_LOW');

  // 4) protocollo + 0100
  const searchTimeout = opts.searchTimeoutMs ?? 15000;
  let searchMs = 0;
  const probe = async (timeoutMs = searchTimeout): Promise<ElmResponse> => {
    const r = await session.send('0100', { kind: 'search', priority: 'user', timeoutMs });
    searchMs += r.durationMs;
    return r;
  };

  const selectAuto = async (): Promise<ElmResponse> => {
    progress('protocol');
    return config('ATSP0');
  };

  let usedSaved = false;
  let setup: ElmResponse;
  const saved = opts.savedProtocol && opts.savedProtocol !== '0' && protocolInfo(opts.savedProtocol) ? opts.savedProtocol.toUpperCase() : undefined;
  progress('protocol');
  if (saved) {
    let r = await config('ATTPA' + saved);
    if (r.status === 'unknown') r = await config('ATSP' + saved); // cloni senza ATTP
    setup = r;
    usedSaved = r.status === 'ok';
    if (!usedSaved) {
      warn('SAVED_PROTOCOL_FAILED');
      setup = await selectAuto();
    }
  } else {
    setup = await selectAuto();
  }
  if (isDisconnected(setup)) return failure('DISCONNECTED', 'protocol', setup.error);
  if (setup.status === 'timeout') return failure('NO_RESPONSE', 'protocol', setup.error);

  progress('search');
  let resp = await probe();
  let unableLeft = opts.unableRetries ?? 1;
  let noDataRetried = false;
  let err94Retried = false;
  let transientRetried = false;
  let fallbackIndex = -1;
  const fallbacks = opts.tryFallbackProtocols ? Array.from(opts.fallbackProtocols ?? EU_FALLBACK_PROTOCOLS) : [];

  for (;;) {
    if (isDisconnected(resp)) return failure('DISCONNECTED', 'search', resp.error);
    if (resp.status === 'ok' && resp.lines.length > 0) break;
    if (resp.status === 'timeout') return failure('NO_RESPONSE', 'search', resp.error);
    if (resp.status === 'unknown') return failure('BAD_RESPONSE', 'search', resp.error);

    const code = resp.error?.code;
    if (resp.status === 'ok') return failure('BAD_RESPONSE', 'search', resp.error); // risposta vuota

    if (usedSaved && (resp.status === 'unable' || resp.status === 'no_data' || code === 'BUS_INIT_ERROR' || code === 'CAN_ERROR' || code === 'BUS_ERROR' || code === 'FB_ERROR')) {
      // Il protocollo memorizzato non vale piu' (altra auto?): ricerca automatica.
      usedSaved = false;
      warn('SAVED_PROTOCOL_FAILED');
      const a = await selectAuto();
      if (isDisconnected(a)) return failure('DISCONNECTED', 'protocol', a.error);
      progress('search');
      resp = await probe();
      continue;
    }
    if (code === 'ERR94') {
      if (err94Retried) return failure('ADAPTER_RESET', 'search', resp.error);
      err94Retried = true;
      await config('ATFE'); // sblocca la ricerca CAN dopo ERR94 (ATZ non basta)
      resp = await probe();
      continue;
    }
    if (code === 'LV_RESET') return failure('ADAPTER_RESET', 'search', resp.error);
    if (resp.status === 'no_data') {
      if (!noDataRetried) {
        noDataRetried = true;
        await sleep(timers, opts.noDataRetryDelayMs ?? 1000); // ECU in sleep: si riprova dopo 1 s
        resp = await probe();
        continue;
      }
      return failure('NO_DATA', 'search', resp.error);
    }
    if (resp.status === 'unable') {
      if (unableLeft > 0) {
        unableLeft--;
        await sleep(timers, opts.unableRetryDelayMs ?? 2500);
        resp = await probe();
        continue;
      }
      if (fallbackIndex + 1 < fallbacks.length) {
        fallbackIndex++;
        const p = fallbacks[fallbackIndex];
        const r = await config('ATTP' + p);
        if (isDisconnected(r)) return failure('DISCONNECTED', 'protocol', r.error);
        resp = await probe(6000);
        continue;
      }
      return failure('UNABLE_TO_CONNECT', 'search', resp.error);
    }
    // Errori transitori del bus (OBD §7): BUS BUSY / BUFFER FULL -> pausa 250 ms, DATA ERROR / STOPPED / RX ERROR ->
    // pausa breve, e UN solo ritentativo dello 0100 (la ricerca non ha retry propri) prima di dichiarare BUS_ERROR.
    if (code === 'BUS_BUSY' || code === 'BUFFER_FULL' || code === 'DATA_ERROR' || code === 'STOPPED' || code === 'RX_ERROR') {
      if (!transientRetried) {
        transientRetried = true;
        await sleep(timers, code === 'BUS_BUSY' || code === 'BUFFER_FULL' ? 250 : 50);
        resp = await probe();
        continue;
      }
      return failure('BUS_ERROR', 'search', resp.error);
    }
    // altri errori (BUS ERROR, CAN ERROR, ...)
    return failure('BUS_ERROR', 'search', resp.error);
  }

  // 5) ATDPN
  const dp = await config('ATDPN');
  if (isDisconnected(dp)) return failure('DISCONNECTED', 'protocol', dp.error);
  let protocol: ProtocolId | undefined;
  let protocolAuto = false;
  if (dp.status === 'ok') {
    for (const l of dp.lines) {
      const p = parseProtocolNumber(l);
      if (p) {
        protocol = p.id;
        protocolAuto = p.auto;
        break;
      }
    }
  }
  if (protocol === undefined) {
    warn('PROTOCOL_NUMBER_UNKNOWN');
    protocol = '0';
  }

  // 6) maschera del blocco 0100 (si interpreta ora che il protocollo e' noto)
  const parseOpts = { protocol: protocol === '0' ? undefined : protocol, headers };
  const mask = parseSupportResponse({ lines: resp.lines, errors: resp.warnings }, 0x00, 0x01, parseOpts);
  if (!mask.ok) return failure('BAD_RESPONSE', 'search', mask.error);

  // 7) identificazione
  const adapter: AdapterInfo = {
    banner: ver.banner,
    versionNumber: ver.versionNumber,
    isStn: false,
    amcSupported: null,
    suspectedClone: false,
    cloneReasons: [],
  };
  if (!opts.skipIdentification) {
    progress('identify');
    const ati = await config('ATI');
    if (isDisconnected(ati)) return failure('DISCONNECTED', 'identify', ati.error);
    if (ati.status === 'ok') {
      const v = parseElmVersion(ati.lines);
      if (v.versionNumber) {
        adapter.versionNumber = v.versionNumber;
        adapter.banner = v.banner;
      }
    }
    const at1d = await config('AT@1');
    if (at1d.status === 'ok' && at1d.lines[0]) adapter.description = at1d.lines[0];
    const sti = await config('STI');
    if (sti.status === 'ok' && sti.lines[0]) {
      adapter.isStn = true;
      adapter.stn = sti.lines[0];
    }
    const amc = await config('ATAMC');
    if (isDisconnected(amc)) return failure('DISCONNECTED', 'identify', amc.error);
    adapter.amcSupported = amc.status === 'ok' && amc.lines.length > 0;
    adapter.cloneReasons = assessClone(adapter);
    adapter.suspectedClone = adapter.cloneReasons.length > 0;
  }

  const info = protocolInfo(protocol);
  return {
    ok: true,
    value: {
      protocol,
      protocolName: info?.name ?? 'Sconosciuto',
      protocolAuto,
      headers,
      voltage,
      adapter,
      declared: mask.value.union,
      declaredByEcu: mask.value.byEcu,
      ecus: Object.keys(mask.value.byEcu),
      searchMs,
      warnings,
    },
  };
}
