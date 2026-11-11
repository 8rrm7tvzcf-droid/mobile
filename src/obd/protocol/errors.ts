// Errori tipizzati dello strato OBD (SPEC 8.7, OBD §7). Il parsing NON lancia mai eccezioni:
// restituisce Result<T, ObdError>. Questo file e' puro (nessun import a runtime).

export type ObdErrorCode =
  // stringhe dell'ELM327 (datasheet p.86-89)
  | 'NO_DATA'
  | 'UNABLE_TO_CONNECT'
  | 'BUS_INIT_ERROR'
  | 'CAN_ERROR'
  | 'BUS_ERROR'
  | 'FB_ERROR'
  | 'BUS_BUSY'
  | 'DATA_ERROR'
  | 'RX_ERROR'
  | 'STOPPED'
  | 'BUFFER_FULL'
  | 'LV_RESET'
  | 'ERR94'
  | 'UNKNOWN_COMMAND' // '?'
  // avvisi di basso consumo (non sono errori bloccanti)
  | 'ACT_ALERT'
  | 'LP_ALERT'
  // errori di sessione / trasporto
  | 'TIMEOUT'
  | 'DISCONNECTED'
  | 'WRITE_FAILED'
  | 'WRITE_BLOCKED'
  | 'DESYNC'
  // errori di parsing / decodifica
  | 'EMPTY_RESPONSE'
  | 'MALFORMED_FRAME'
  | 'TRUNCATED_MESSAGE'
  | 'ORPHAN_FRAME'
  | 'UNEXPECTED_SERVICE'
  | 'TOO_SHORT'
  | 'UNKNOWN_PID'
  | 'NOT_AVAILABLE'
  | 'INVALID_VIN'
  | 'NEGATIVE_RESPONSE'
  | 'RESPONSE_PENDING';

export interface ObdError {
  code: ObdErrorCode;
  /** Dettaglio tecnico in inglese/neutro (per log e test), non per l'utente. */
  detail?: string;
  /** Per le risposte negative 7F: servizio e NRC. */
  service?: number;
  nrc?: number;
}

export function obdError(code: ObdErrorCode, detail?: string, extra?: { service?: number; nrc?: number }): ObdError {
  const e: ObdError = { code };
  if (detail !== undefined) e.detail = detail;
  if (extra?.service !== undefined) e.service = extra.service;
  if (extra?.nrc !== undefined) e.nrc = extra.nrc;
  return e;
}

const MESSAGES_IT: Record<ObdErrorCode, string> = {
  NO_DATA: "L'auto non ha risposto a questa richiesta: il dato non e' disponibile su questo veicolo.",
  UNABLE_TO_CONNECT:
    "Non riesco a collegarmi alla centralina. Gira la chiave su accensione (quadro acceso) e riprova.",
  BUS_INIT_ERROR: "Il collegamento con la centralina non e' riuscito. Prova a spegnere e riaccendere il quadro.",
  CAN_ERROR: "Errore sul bus CAN: controlla che l'adattatore sia ben inserito nella presa OBD.",
  BUS_ERROR: "Errore sul bus dell'auto: controlla che l'adattatore sia ben inserito nella presa OBD.",
  FB_ERROR: "Errore di cablaggio sul bus dell'auto: scollega e ricollega l'adattatore.",
  BUS_BUSY: "Il bus dell'auto e' occupato: riprovo tra un istante.",
  DATA_ERROR: "La risposta dell'auto e' arrivata danneggiata.",
  RX_ERROR: "Errore in ricezione dal bus dell'auto.",
  STOPPED: "La richiesta e' stata interrotta.",
  BUFFER_FULL: "L'adattatore ha il buffer pieno: la lettura e' stata rallentata.",
  LV_RESET: "L'adattatore si e' riavviato per tensione troppo bassa. Controlla la batteria dell'auto.",
  ERR94: "Errore grave sul bus CAN. Scollega l'adattatore, ricollegalo e riprova.",
  UNKNOWN_COMMAND: "L'adattatore non supporta questo comando.",
  ACT_ALERT: "L'adattatore sta per andare in sospensione.",
  LP_ALERT: "L'adattatore sta andando in sospensione.",
  TIMEOUT: "L'adattatore non risponde (tempo scaduto).",
  DISCONNECTED: "Collegamento con l'adattatore perso.",
  WRITE_FAILED: "Non riesco a inviare il comando all'adattatore.",
  WRITE_BLOCKED: "Comando di scrittura non consentito in questa versione.",
  DESYNC: "L'adattatore non risponde piu' in modo ordinato: scollega e ricollega.",
  EMPTY_RESPONSE: "Risposta vuota dall'adattatore.",
  MALFORMED_FRAME: "Risposta dell'adattatore non interpretabile.",
  TRUNCATED_MESSAGE: "Risposta incompleta dall'auto.",
  ORPHAN_FRAME: "Frame di risposta fuori sequenza.",
  UNEXPECTED_SERVICE: "Risposta dell'auto inattesa.",
  TOO_SHORT: "Risposta dell'auto troppo corta.",
  UNKNOWN_PID: "Dato non riconosciuto.",
  NOT_AVAILABLE: "Dato non disponibile su questa auto.",
  INVALID_VIN: "Il numero di telaio (VIN) letto non e' valido.",
  NEGATIVE_RESPONSE: "L'auto ha rifiutato la richiesta.",
  RESPONSE_PENDING: "L'auto sta ancora elaborando la richiesta.",
};

/** Messaggio per l'utente, in italiano. */
export function describeObdError(e: ObdError | ObdErrorCode): string {
  const code = typeof e === 'string' ? e : e.code;
  return MESSAGES_IT[code] ?? "Errore sconosciuto nella lettura dell'auto.";
}

/** Risultato tipizzato. Struttura identica a `Result` di '@/domain/ports'. */
export type ObdResult<T> = { ok: true; value: T } | { ok: false; error: ObdError };

export function ok<T>(value: T): ObdResult<T> {
  return { ok: true, value };
}

export function fail<T = never>(error: ObdError): ObdResult<T> {
  return { ok: false, error };
}
