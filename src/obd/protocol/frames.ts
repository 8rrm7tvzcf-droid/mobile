// Frame grezzi dell'ELM327 e riassemblaggio ISO-TP (OBD §9). Puro, mai eccezioni.
//
// Con ATH1 l'adattatore stampa i frame CAN grezzi ('7E8 10 14 49 02 01 5A 46 41'): qui si raggruppano
// per ECU (identificatore CAN) e si riassemblano i messaggi (frame singolo, primo frame, consecutivi).
// Protocolli non CAN (1-5): ogni riga = 3 byte di intestazione + dati + checksum; l'ECU e' il 3o byte.
// Con ATH0 (ripiego): righe di lunghezza a 3 cifre ('014') e righe numerate ('0:', '1:'); le ECU non
// sono distinguibili e la risposta e' marcata `ambiguousEcu`.
import { obdError, type ObdError } from './errors';
import { isHex, parseHexBytes } from './hex';
import { protocolInfo, type ProtocolId } from './protocols';

export interface EcuMessage {
  /** Identificatore della centralina: id CAN ('7E8', '18DAF110') o byte sorgente non-CAN ('10'); '?' se ignoto (ATH0). */
  ecu: string;
  /** Payload applicativo: servizio + dati (senza PCI, senza intestazione, senza checksum). */
  data: number[];
}

export interface CanFrame {
  ecu: string;
  /** Byte del frame CAN, PCI incluso (fino a 8). */
  bytes: number[];
}

export interface IsoTpResult {
  messages: EcuMessage[];
  warnings: ObdError[];
}

export interface ParsedResponse {
  messages: EcuMessage[];
  warnings: ObdError[];
  /** True se i frame erano CAN (ATH1); undefined con ATH0, dove non si vede. */
  can?: boolean;
  /** True se (ATH0) non si puo' sapere quale ECU ha risposto. */
  ambiguousEcu: boolean;
}

export interface ParseOptions {
  /** Numero di protocollo (da ATDPN). Se assente, il formato viene dedotto dalla riga. */
  protocol?: ProtocolId;
  /** Intestazioni attive (ATH1). Default true. */
  headers?: boolean;
}

// ---------------------------------------------------------------------------
// ISO-TP (ISO 15765-2) su CAN a 8 byte
// ---------------------------------------------------------------------------

interface Cf {
  sn: number;
  bytes: number[];
}

interface Pending {
  len: number;
  data: number[];
  cfs: Cf[];
}

/**
 * Riassembla i messaggi ISO-TP. I frame di ECU diverse possono arrivare comunque mescolati; l'ordine
 * dei frame di una stessa ECU e' quello di arrivo, ma i frame consecutivi di un messaggio con al piu'
 * 15 CF vengono ordinati per numero di sequenza (cicla 0-F), e i CF arrivati prima del primo frame
 * vengono agganciati ad esso.
 */
export function reassembleIsoTp(frames: readonly CanFrame[]): IsoTpResult {
  const order: string[] = [];
  const perEcu = new Map<string, number[][]>();
  for (const f of frames) {
    let list = perEcu.get(f.ecu);
    if (!list) {
      list = [];
      perEcu.set(f.ecu, list);
      order.push(f.ecu);
    }
    list.push(f.bytes);
  }

  const messages: EcuMessage[] = [];
  const warnings: ObdError[] = [];

  for (const ecu of order) {
    const list = perEcu.get(ecu) ?? [];
    let pending: Pending | null = null;
    let orphans: Cf[] = [];

    const warnTruncated = (p: Pending) => {
      warnings.push(
        obdError('TRUNCATED_MESSAGE', `ecu ${ecu}: attesi ${p.len} byte, ricevuti ${p.data.length + p.cfs.reduce((a, c) => a + c.bytes.length, 0)}`),
      );
    };

    const tryComplete = () => {
      if (!pending) return;
      const remaining = pending.len - pending.data.length;
      if (remaining <= 0) {
        messages.push({ ecu, data: pending.data.slice(0, pending.len) });
        pending = null;
        return;
      }
      const need = Math.ceil(remaining / 7);
      if (pending.cfs.length < need) return;
      let used = pending.cfs.slice(0, need);
      const extra = pending.cfs.slice(need);
      if (need <= 15) {
        // Ordine per numero di sequenza: SN 1,2,...,15 -> rango 0..14. Se i ranghi non sono una
        // permutazione di 0..need-1 si mantiene l'ordine di arrivo.
        const ranked = used.map((c) => ({ c, r: (c.sn - 1 + 16) % 16 }));
        const ranks = new Set(ranked.map((x) => x.r));
        const valid = ranks.size === need && ranked.every((x) => x.r < need);
        if (valid) {
          ranked.sort((a, b) => a.r - b.r);
          used = ranked.map((x) => x.c);
        } else {
          warnings.push(obdError('ORPHAN_FRAME', `ecu ${ecu}: numeri di sequenza incoerenti`));
        }
      }
      let data = pending.data.slice();
      for (const c of used) data = data.concat(c.bytes);
      if (data.length < pending.len) {
        warnings.push(obdError('TRUNCATED_MESSAGE', `ecu ${ecu}: attesi ${pending.len} byte, ricevuti ${data.length}`));
      } else {
        messages.push({ ecu, data: data.slice(0, pending.len) });
      }
      pending = null;
      if (extra.length > 0) orphans = orphans.concat(extra);
    };

    for (const b of list) {
      if (b.length === 0) {
        warnings.push(obdError('MALFORMED_FRAME', `ecu ${ecu}: frame vuoto`));
        continue;
      }
      const pci = b[0];
      const type = pci >> 4;
      if (type === 0) {
        const len = pci & 0x0f;
        if (len === 0 || len > b.length - 1) {
          warnings.push(obdError('MALFORMED_FRAME', `ecu ${ecu}: frame singolo con lunghezza ${len} su ${b.length} byte`));
          continue;
        }
        if (pending) {
          warnTruncated(pending);
          pending = null;
        }
        messages.push({ ecu, data: b.slice(1, 1 + len) });
      } else if (type === 1) {
        if (b.length < 3) {
          warnings.push(obdError('MALFORMED_FRAME', `ecu ${ecu}: primo frame troppo corto`));
          continue;
        }
        const len = ((pci & 0x0f) << 8) | b[1];
        if (len === 0) {
          warnings.push(obdError('MALFORMED_FRAME', `ecu ${ecu}: primo frame con lunghezza 0`));
          continue;
        }
        if (pending) warnTruncated(pending);
        pending = { len, data: b.slice(2), cfs: orphans };
        orphans = [];
        tryComplete();
      } else if (type === 2) {
        const cf: Cf = { sn: pci & 0x0f, bytes: b.slice(1) };
        if (pending) {
          pending.cfs.push(cf);
          tryComplete();
        } else {
          orphans.push(cf);
        }
      } else if (type === 3) {
        // Flow control: lo invia l'adattatore da solo, si ignora.
      } else {
        warnings.push(obdError('MALFORMED_FRAME', `ecu ${ecu}: PCI sconosciuto ${pci.toString(16)}`));
      }
    }

    if (pending) warnTruncated(pending);
    if (orphans.length > 0) warnings.push(obdError('ORPHAN_FRAME', `ecu ${ecu}: ${orphans.length} frame consecutivi senza primo frame`));
  }

  return { messages, warnings };
}

// ---------------------------------------------------------------------------
// Riga -> frame
// ---------------------------------------------------------------------------

type LineKind = { kind: 'can'; ecu: string; bytes: number[] } | { kind: 'legacy'; ecu: string; data: number[] };

function compact(line: string): string {
  return line.replace(/\s+/g, '').toUpperCase();
}

/** Deduce il formato di una riga con intestazione quando il protocollo e' ignoto. */
function inferKind(line: string): 'can11' | 'can29' | 'legacy' {
  const tokens = line.trim().split(/\s+/);
  const c = compact(line);
  if (tokens.length > 1 && tokens[0].length === 3) return 'can11';
  if (tokens.length > 1 && tokens.every((t) => t.length === 2)) {
    // 29 bit: priorita' 0x18 (o 0x1C) seguita da DA/DB/DC...; nei protocolli legacy il primo byte e' il formato.
    const b0 = parseInt(tokens[0], 16);
    const b1 = parseInt(tokens[1], 16);
    if ((b0 === 0x18 || b0 === 0x1c) && b1 >= 0xda && b1 <= 0xdf) return 'can29';
    return 'legacy';
  }
  // Senza spazi: id a 11 bit => lunghezza dispari (3 + 2n); altrimenti 29 bit o legacy.
  if (c.length % 2 === 1) return 'can11';
  if (c.startsWith('18DA') || c.startsWith('18DB') || c.startsWith('1CDA')) return 'can29';
  return 'legacy';
}

function parseHeaderLine(line: string, protocol: ProtocolId | undefined): LineKind | ObdError {
  const info = protocolInfo(protocol);
  const kind: 'can11' | 'can29' | 'legacy' = info
    ? info.can
      ? info.canBits === 29
        ? 'can29'
        : 'can11'
      : 'legacy'
    : inferKind(line);
  const c = compact(line);
  if (!isHex(c)) return obdError('MALFORMED_FRAME', `riga non esadecimale: ${line.slice(0, 40)}`);

  if (kind === 'can11' || kind === 'can29') {
    const idLen = kind === 'can11' ? 3 : 8;
    const rest = c.slice(idLen);
    if (c.length < idLen + 2 || rest.length % 2 !== 0 || rest.length > 16) {
      return obdError('MALFORMED_FRAME', `frame CAN non valido: ${line.slice(0, 40)}`);
    }
    const bytes = parseHexBytes(rest);
    if (!bytes) return obdError('MALFORMED_FRAME', `frame CAN non valido: ${line.slice(0, 40)}`);
    return { kind: 'can', ecu: c.slice(0, idLen), bytes };
  }

  // Protocolli non CAN: 3 byte di intestazione + dati + checksum.
  const bytes = parseHexBytes(c);
  if (!bytes || bytes.length < 5) return obdError('MALFORMED_FRAME', `messaggio non-CAN non valido: ${line.slice(0, 40)}`);
  return { kind: 'legacy', ecu: c.slice(4, 6), data: bytes.slice(3, bytes.length - 1) };
}

function isLineKindError(x: LineKind | ObdError): x is ObdError {
  return 'code' in x;
}

// ---------------------------------------------------------------------------
// ATH0: righe '014' / '0: ..' / '1: ..'
// ---------------------------------------------------------------------------

const INDEXED_RE = /^([0-9A-Fa-f]):\s*(.*)$/;

function parseNoHeaderLines(lines: readonly string[]): ParsedResponse {
  const messages: EcuMessage[] = [];
  const warnings: ObdError[] = [];
  let group: { expected: number; buf: number[] } | null = null;

  const closeGroup = () => {
    if (!group) return;
    if (group.buf.length >= group.expected) messages.push({ ecu: '?', data: group.buf.slice(0, group.expected) });
    else warnings.push(obdError('TRUNCATED_MESSAGE', `attesi ${group.expected} byte, ricevuti ${group.buf.length}`));
    group = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const c = compact(line);
    const idx = INDEXED_RE.exec(line);
    if (idx) {
      const bytes = parseHexBytes(idx[2]);
      if (!bytes) {
        warnings.push(obdError('MALFORMED_FRAME', `riga numerata non valida: ${line.slice(0, 40)}`));
        continue;
      }
      if (!group) {
        warnings.push(obdError('ORPHAN_FRAME', `riga numerata senza lunghezza: ${line.slice(0, 40)}`));
        continue;
      }
      group.buf = group.buf.concat(bytes);
      continue;
    }
    if (c.length === 3 && isHex(c)) {
      closeGroup();
      group = { expected: parseInt(c, 16), buf: [] };
      continue;
    }
    const bytes = parseHexBytes(line);
    if (!bytes) {
      warnings.push(obdError('MALFORMED_FRAME', `riga non esadecimale: ${line.slice(0, 40)}`));
      continue;
    }
    closeGroup();
    messages.push({ ecu: '?', data: bytes });
  }
  closeGroup();
  return { messages, warnings, ambiguousEcu: messages.length > 1 };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Trasforma le righe normalizzate di una risposta OBD in messaggi per ECU.
 * Non lancia mai: le righe non interpretabili diventano `warnings`.
 */
export function parseResponseLines(lines: readonly string[], opts: ParseOptions = {}): ParsedResponse {
  const headers = opts.headers !== false;
  if (!headers) return parseNoHeaderLines(lines);

  const canFrames: CanFrame[] = [];
  const legacy: EcuMessage[] = [];
  const warnings: ObdError[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const r = parseHeaderLine(line, opts.protocol);
    if (isLineKindError(r)) {
      warnings.push(r);
      continue;
    }
    if (r.kind === 'can') canFrames.push({ ecu: r.ecu, bytes: r.bytes });
    else legacy.push({ ecu: r.ecu, data: r.data });
  }

  const tp = reassembleIsoTp(canFrames);
  return { messages: legacy.concat(tp.messages), warnings: warnings.concat(tp.warnings), ambiguousEcu: false, can: canFrames.length > 0 };
}
