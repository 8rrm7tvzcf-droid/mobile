// Decodifica dei codici di guasto (DTC): Mode 03 / 07 / 0A (OBD §15). Puro, mai eccezioni.
// Nessuna descrizione dei codici qui: le descrizioni italiane curate appartengono a un altro strato.
import { fail, ok, obdError, type ObdError, type ObdResult } from './errors';

const LETTERS = ['P', 'C', 'B', 'U'] as const;

/** Decodifica 2 byte in un codice: 01 33 -> 'P0133'; C1 00 -> 'U0100'; 41 23 -> 'C0123'. */
export function decodeDtc(b1: number, b2: number): string {
  const letter = LETTERS[(b1 >> 6) & 0x03];
  const d1 = (b1 >> 4) & 0x03;
  const d2 = (b1 & 0x0f).toString(16).toUpperCase();
  const rest = (b2 & 0xff).toString(16).toUpperCase().padStart(2, '0');
  return `${letter}${d1}${d2}${rest}`;
}

export type DtcSystem = 'powertrain' | 'chassis' | 'body' | 'network';

const DTC_RE = /^[PCBU][0-3][0-9A-F]{3}$/;

export function isValidDtc(code: string): boolean {
  return DTC_RE.test(code);
}

export function dtcSystem(code: string): DtcSystem | undefined {
  switch (code[0]) {
    case 'P':
      return 'powertrain';
    case 'C':
      return 'chassis';
    case 'B':
      return 'body';
    case 'U':
      return 'network';
    default:
      return undefined;
  }
}

/** Nome del sistema in italiano. */
export function dtcSystemLabel(system: DtcSystem): string {
  return { powertrain: 'Motore e cambio', chassis: 'Telaio', body: 'Carrozzeria', network: 'Rete di comunicazione' }[system];
}

export interface DtcList {
  codes: string[];
  /** Numero di codici dichiarato dalla centralina (solo CAN). */
  declaredCount?: number;
}

export type DtcMode = 0x03 | 0x07 | 0x0a;

/**
 * Decodifica la risposta di un'ECU a Mode 03/07/0A.
 * @param data payload del messaggio: '43 ...' / '47 ...' / '4A ...' (senza PCI/intestazione)
 * @param canFormat true per ISO 15765-4: dopo il servizio c'e' un byte con il numero di DTC;
 *                  false per J1850/ISO 9141/KWP: 3 slot da 2 byte completati con 00 00
 */
export function decodeDtcList(data: readonly number[], canFormat: boolean, mode: DtcMode = 0x03): ObdResult<DtcList> {
  if (!Array.isArray(data) || data.length === 0) return fail(obdError('EMPTY_RESPONSE'));
  const expected = (mode + 0x40) & 0xff;
  if (data[0] !== expected) {
    return fail(obdError('UNEXPECTED_SERVICE', `atteso ${expected.toString(16)}, ricevuto ${data[0].toString(16)}`));
  }
  const codes: string[] = [];
  const push = (b1: number, b2: number) => {
    if (b1 === 0 && b2 === 0) return; // slot vuoto
    codes.push(decodeDtc(b1, b2));
  };

  if (canFormat) {
    if (data.length < 2) return fail(obdError('TOO_SHORT', 'manca il byte con il numero di DTC'));
    const declared = data[1];
    const payload = data.slice(2);
    const pairs = Math.floor(payload.length / 2);
    const take = Math.min(declared, pairs);
    for (let i = 0; i < take; i++) push(payload[2 * i], payload[2 * i + 1]);
    // Se i codici presenti sono meno di quelli dichiarati il messaggio e' troncato: si restituiscono
    // quelli letti e `declaredCount` permette al chiamante di accorgersene.
    return ok({ codes: dedupe(codes), declaredCount: declared });
  }

  const payload = data.slice(1);
  for (let i = 0; i + 1 < payload.length; i += 2) push(payload[i], payload[i + 1]);
  return ok({ codes: dedupe(codes) });
}

function dedupe(codes: string[]): string[] {
  return Array.from(new Set(codes));
}

export interface EcuDtcs {
  ecu: string;
  codes: string[];
  declaredCount?: number;
}

/**
 * Decodifica i messaggi di piu' ECU (gia' separati per servizio) e li raggruppa per ECU.
 * Per i protocolli non CAN i messaggi della stessa ECU si fondono. Restituisce anche i problemi.
 */
export function decodeDtcMessages(
  messages: readonly { ecu: string; data: number[] }[],
  canFormat: boolean,
  mode: DtcMode,
): { byEcu: EcuDtcs[]; all: string[]; errors: ObdError[] } {
  const byEcu = new Map<string, EcuDtcs>();
  const errors: ObdError[] = [];
  for (const m of messages) {
    const r = decodeDtcList(m.data, canFormat, mode);
    if (!r.ok) {
      errors.push(r.error);
      continue;
    }
    const cur = byEcu.get(m.ecu);
    if (cur) {
      cur.codes = dedupe(cur.codes.concat(r.value.codes));
      if (r.value.declaredCount !== undefined) cur.declaredCount = (cur.declaredCount ?? 0) + r.value.declaredCount;
    } else {
      const e: EcuDtcs = { ecu: m.ecu, codes: r.value.codes };
      if (r.value.declaredCount !== undefined) e.declaredCount = r.value.declaredCount;
      byEcu.set(m.ecu, e);
    }
  }
  const list = Array.from(byEcu.values());
  return { byEcu: list, all: dedupe(list.flatMap((e) => e.codes)), errors };
}
