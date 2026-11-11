// Normalizzazione delle risposte grezze dell'ELM327 (OBD §6-§7).
// Toglie: byte NUL e caratteri di controllo, prompt '>', eco del comando, 'SEARCHING...', righe vuote.
// Classifica le stringhe di errore. Mai eccezioni.
import { obdError, type ObdError } from './errors';

export interface NormalizedResponse {
  /** Righe di dati/testo utili, nell'ordine di arrivo (maiuscole/minuscole originali, spazi compressi). */
  lines: string[];
  /** Errori e stringhe di stato che invalidano (o possono invalidare) la risposta. */
  errors: ObdError[];
  /** Avvisi di basso consumo (ACT ALERT / LP ALERT): non sono errori. */
  alerts: ObdError[];
  /** Comparso 'SEARCHING...' (ricerca del protocollo in corso). */
  searching: boolean;
  /** Esito 'BUS INIT: OK' visto (K-line). */
  busInitOk: boolean;
  /** L'eco del comando e' stato riconosciuto e rimosso. */
  echoRemoved: boolean;
}

/** Errori 'morbidi': la risposta puo' contenere comunque righe valide delle altre centraline. */
const SOFT_ERRORS = new Set(['DATA_ERROR', 'RX_ERROR']);

export function isSoftError(e: ObdError): boolean {
  return SOFT_ERRORS.has(e.code);
}

/** Rimuove spazi e porta in maiuscolo: forma confrontabile di un comando. */
export function compactCommand(cmd: string): string {
  return cmd.replace(/\s+/g, '').toUpperCase();
}

function classify(upper: string): { error?: ObdError; alert?: ObdError; info?: 'busInitOk' } | null {
  const s = upper.replace(/^[<!]+\s*/, '').trim();
  if (s === '?' || /^\?+$/.test(s)) return { error: obdError('UNKNOWN_COMMAND') };
  if (s.startsWith('NO DATA')) return { error: obdError('NO_DATA') };
  if (s.startsWith('UNABLE TO CONNECT')) return { error: obdError('UNABLE_TO_CONNECT') };
  if (s.startsWith('BUS INIT')) {
    return s.includes('ERROR') ? { error: obdError('BUS_INIT_ERROR', s) } : { info: 'busInitOk' };
  }
  if (s.startsWith('CAN ERROR')) return { error: obdError('CAN_ERROR') };
  if (s.startsWith('BUS ERROR')) return { error: obdError('BUS_ERROR') };
  if (s.startsWith('FB ERROR')) return { error: obdError('FB_ERROR') };
  if (s.startsWith('BUS BUSY')) return { error: obdError('BUS_BUSY') };
  if (s.includes('DATA ERROR')) return { error: obdError('DATA_ERROR') };
  if (s.includes('RX ERROR')) return { error: obdError('RX_ERROR') };
  if (s.startsWith('STOPPED')) return { error: obdError('STOPPED') };
  if (s.startsWith('BUFFER FULL')) return { error: obdError('BUFFER_FULL') };
  if (s.startsWith('LV RESET')) return { error: obdError('LV_RESET') };
  if (s === 'ERR94') return { error: obdError('ERR94') };
  if (/^ERR\d+$/.test(s)) return { error: obdError('BUS_ERROR', s) };
  if (s.startsWith('ACT ALERT')) return { alert: obdError('ACT_ALERT') };
  if (s.startsWith('LP ALERT')) return { alert: obdError('LP_ALERT') };
  return null;
}

/**
 * Normalizza il testo grezzo ricevuto fino al prompt.
 * @param raw testo accumulato (puo' contenere NUL, '>', eco, righe vuote)
 * @param sentCommand comando inviato (senza CR) per riconoscere e togliere l'eco
 */
export function normalizeResponse(raw: string, sentCommand?: string): NormalizedResponse {
  const result: NormalizedResponse = {
    lines: [],
    errors: [],
    alerts: [],
    searching: false,
    busInitOk: false,
    echoRemoved: false,
  };
  if (typeof raw !== 'string' || raw.length === 0) return result;

  // Solo ASCII stampabile + CR/LF: scarta NUL e rumore.
  let cleaned = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 0x0d || c === 0x0a || (c >= 0x20 && c <= 0x7e)) cleaned += raw[i];
  }
  // Il prompt non e' una riga di dati.
  cleaned = cleaned.replace(/>/g, '');

  const target = sentCommand !== undefined ? compactCommand(sentCommand) : undefined;
  let firstContentSeen = false;

  for (const rawLine of cleaned.split(/[\r\n]+/)) {
    let line = rawLine.replace(/\s+/g, ' ').trim();
    if (line.length === 0) continue;

    // Eco: la prima riga con contenuto uguale al comando inviato.
    if (!firstContentSeen) {
      firstContentSeen = true;
      if (target !== undefined && target.length > 0 && compactCommand(line) === target) {
        result.echoRemoved = true;
        continue;
      }
    }

    // 'SEARCHING...' (eventualmente attaccato alla riga successiva)
    const up0 = line.toUpperCase();
    if (up0.startsWith('SEARCHING')) {
      result.searching = true;
      line = line.replace(/^SEARCHING\.{0,3}\s*/i, '').trim();
      if (line.length === 0) continue;
    }

    const up = line.toUpperCase();
    const c = classify(up);
    if (c) {
      if (c.error) result.errors.push(c.error);
      else if (c.alert) result.alerts.push(c.alert);
      else if (c.info === 'busInitOk') result.busInitOk = true;
      continue;
    }
    result.lines.push(line);
  }
  return result;
}

/** True se dopo la normalizzazione la risposta e' un semplice 'OK'. */
export function isOkResponse(n: NormalizedResponse): boolean {
  return n.errors.length === 0 && n.lines.some((l) => l.toUpperCase() === 'OK');
}
