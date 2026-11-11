// VIN da Mode 09 PID 02 (OBD §14). Puro, mai eccezioni.
// CAN: un messaggio '49 02 01' + 17 byte ASCII. J1850/ISO 9141: 5 messaggi '49 02 0n' con 4 byte dati
// ciascuno (i primi 3 byte sono filler 00). Il VIN ha 17 caratteri dall'alfabeto senza I, O, Q; il
// check digit (posizione 9) e' obbligatorio solo in Nord America e NON si impone.
import { fail, ok, obdError, type ObdResult } from './errors';
import type { EcuMessage } from './frames';

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

export function isValidVin(vin: string): boolean {
  return VIN_RE.test(vin);
}

/**
 * Ricostruisce il VIN dai messaggi (gia' filtrati sul servizio 0x49) di una singola ECU.
 * I messaggi sono ordinati per numero progressivo (3o byte); i byte 00 di riempimento sono scartati.
 */
export function decodeVinFromMessages(messages: readonly EcuMessage[]): ObdResult<string> {
  const parts = messages
    .filter((m) => m.data.length >= 3 && m.data[0] === 0x49 && m.data[1] === 0x02)
    .map((m, arrival) => ({ idx: m.data[2], arrival, data: m.data.slice(3) }));
  if (parts.length === 0) return fail(obdError('EMPTY_RESPONSE', 'nessun messaggio 49 02'));
  parts.sort((a, b) => a.idx - b.idx || a.arrival - b.arrival);
  const bytes: number[] = [];
  for (const p of parts) for (const x of p.data) bytes.push(x);
  const text = bytes
    .filter((x) => x !== 0x00 && x >= 0x20 && x <= 0x7e)
    .map((x) => String.fromCharCode(x))
    .join('')
    .trim()
    .toUpperCase();
  // Alcune ECU aggiungono riempimento in coda: si prende il VIN piu' plausibile (ultimi 17 se di piu').
  const candidate = text.length > 17 ? text.slice(0, 17) : text;
  if (!isValidVin(candidate)) {
    return fail(obdError('INVALID_VIN', `lunghezza ${text.length}`));
  }
  return ok(candidate);
}

/** Sceglie il primo VIN valido tra piu' ECU (stesso messaggio, ECU diverse). */
export function decodeVin(messages: readonly EcuMessage[]): ObdResult<string> {
  const byEcu = new Map<string, EcuMessage[]>();
  for (const m of messages) {
    const l = byEcu.get(m.ecu);
    if (l) l.push(m);
    else byEcu.set(m.ecu, [m]);
  }
  let lastError = obdError('EMPTY_RESPONSE');
  for (const list of byEcu.values()) {
    const r = decodeVinFromMessages(list);
    if (r.ok) return r;
    lastError = r.error;
  }
  return fail(lastError);
}
