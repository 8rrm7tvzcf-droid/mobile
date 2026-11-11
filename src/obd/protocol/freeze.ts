// Freeze frame (Mode 02): richiesta '02 PID 00' -> risposta '42 PID 00 dati' (OBD §15). Puro.
// Si legge PRIMA di un'eventuale cancellazione (Mode 04).
import { fail, ok, obdError, type ObdResult } from './errors';
import { decodeDtc } from './dtc';
import { decodePid, type DecodedPid } from './pids';

export interface FreezeFrameEntry {
  pid: number;
  frame: number;
  /** Per il PID 02: codice che ha generato il freeze frame; null = nessun freeze frame (0000). */
  dtc?: string | null;
  /** Per gli altri PID: valore al momento del guasto (stesse formule del Mode 01). */
  value?: DecodedPid;
}

export interface FreezeFrame {
  /** Codice che ha generato il freeze frame, o null se non c'e' un freeze frame. */
  dtc: string | null;
  values: DecodedPid[];
}

/**
 * Decodifica un messaggio Mode 02: '42 PID FRAME dati...'.
 * @param data payload del messaggio (servizio 0x42 incluso)
 */
export function decodeFreezeFrameMessage(data: readonly number[]): ObdResult<FreezeFrameEntry> {
  if (!Array.isArray(data) || data.length === 0) return fail(obdError('EMPTY_RESPONSE'));
  if (data[0] !== 0x42) return fail(obdError('UNEXPECTED_SERVICE', `atteso 42, ricevuto ${data[0].toString(16)}`));
  if (data.length < 3) return fail(obdError('TOO_SHORT', 'freeze frame senza PID'));
  const pid = data[1];
  const frame = data[2];
  const payload = data.slice(3);
  if (pid === 0x02) {
    if (payload.length < 2) return fail(obdError('TOO_SHORT', 'freeze frame 02: attesi 2 byte'));
    const [b1, b2] = payload;
    return ok({ pid, frame, dtc: b1 === 0 && b2 === 0 ? null : decodeDtc(b1, b2) });
  }
  const r = decodePid(pid, payload);
  if (!r.ok) return fail(r.error);
  return ok({ pid, frame, value: r.value });
}

/** Costruisce un FreezeFrame dalle singole voci lette. */
export function buildFreezeFrame(entries: readonly FreezeFrameEntry[]): FreezeFrame {
  let dtc: string | null = null;
  const values: DecodedPid[] = [];
  for (const e of entries) {
    if (e.pid === 0x02) dtc = e.dtc ?? null;
    else if (e.value) values.push(e.value);
  }
  return { dtc, values };
}
