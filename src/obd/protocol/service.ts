// Richieste e risposte per servizio (Mode). Puro, mai eccezioni.
import { obdError, type ObdError } from './errors';
import { byteToHex } from './hex';
import type { EcuMessage } from './frames';

/** Richiesta Mode 01 per un PID: es. 0x0C -> '010C'. */
export function request01(pid: number): string {
  return '01' + byteToHex(pid);
}

/** Richiesta multi-PID su CAN (fino a 6 PID): '01 0B 04 0C 05' senza spazi. */
export function request01Multi(pids: readonly number[]): string {
  return '01' + pids.slice(0, 6).map(byteToHex).join('');
}

/** Freeze frame (Mode 02): PID + numero di frame 00. */
export function request02(pid: number, frame = 0): string {
  return '02' + byteToHex(pid) + byteToHex(frame);
}

export const REQ_DTC_STORED = '03';
export const REQ_DTC_PENDING = '07';
export const REQ_DTC_PERMANENT = '0A';
export const REQ_VIN = '0902';
export const REQ_MODE09_SUPPORT = '0900';

/**
 * Servizi OBD di SOLA LETTURA che l'MVP puo' inviare (positive response = servizio + 0x40). E' una WHITELIST:
 * ogni altro servizio e' bloccato. 0x22/0x19 (UDS) non sono ammessi perche' nessun percorso dell'app li usa.
 */
export const READ_SERVICES: readonly number[] = [0x01, 0x02, 0x03, 0x05, 0x06, 0x07, 0x09, 0x0a];

/**
 * Servizi che modificano lo stato dell'auto (cancellazione codici, test di componenti, UDS/KWP di scrittura).
 * SOLO documentativo: il blocco non si basa su questo elenco (denylist) ma sulla whitelist READ_SERVICES, quindi
 * anche un servizio non elencato qui (es. KWP 0x30) resta bloccato.
 */
export const WRITE_SERVICES: readonly number[] = [
  0x04, 0x08, 0x10, 0x11, 0x14, 0x27, 0x28, 0x2e, 0x2f, 0x30, 0x31, 0x32, 0x34, 0x35, 0x36, 0x37, 0x3b, 0x3d, 0x85,
];

/**
 * Comandi AT/ST ammessi (WHITELIST, sul comando compatto in maiuscolo): solo configurazione e identificazione
 * dell'adattatore, quelli che l'app invia davvero (AdapterInit, VehicleService). ATPP/ATPPS (EEPROM dei parametri
 * programmabili), AT@2/AT@3, ATSH/ATCRA, ATMA, ATBD e ogni ST di scrittura NON sono qui e quindi sono bloccati.
 */
const ADAPTER_COMMANDS: readonly RegExp[] = [
  /^AT(?:Z|WS|DPN|DP|RV|I|FE|AMC|@1)$/, // reset, protocollo corrente, tensione, identificazione, ERR94
  /^AT[ELSH][01]$/, // echo, linefeed, spazi, intestazioni
  /^ATAT[012]$/, // adaptive timing
  /^AT(?:SP|TP)A?[0-9A-C]$/, // scelta del protocollo (ATSP salva solo l'ultimo protocollo dell'adattatore)
  /^STI$/, // identificazione dei chip STN
];

export type CommandClass = 'obd-read' | 'adapter-config' | 'blocked';

/**
 * Classifica un comando (senza CR) PRIMA che arrivi al trasporto. Tutto cio' che non e' riconosciuto e'
 * 'blocked'. L'ELM327 ignora gli spazi, accetta il maiuscolo/minuscolo e, per le richieste OBD, una cifra finale
 * facoltativa (numero di risposte attese): per questo spazi e maiuscole si normalizzano e, se la lunghezza
 * e' dispari, l'ultima cifra si toglie prima di leggere il servizio ('041' = Mode 04). Un comando con piu' righe
 * (CR/LF incorporati) o con caratteri fuori dall'ASCII stampabile e' bloccato.
 */
export function classifyCommand(cmd: string): CommandClass {
  const lines = cmd.split(/[\r\n]+/).filter((l) => l.trim().length > 0);
  if (lines.length !== 1) return 'blocked';
  const line = lines[0];
  if (/[^\x20-\x7e]/.test(line)) return 'blocked';
  const c = line.replace(/ /g, '').toUpperCase();
  if (c.startsWith('AT') || c.startsWith('ST')) {
    return ADAPTER_COMMANDS.some((re) => re.test(c)) ? 'adapter-config' : 'blocked';
  }
  if (!/^[0-9A-F]+$/.test(c)) return 'blocked';
  const hex = c.length % 2 === 1 ? c.slice(0, -1) : c;
  if (hex.length < 2) return 'blocked';
  return READ_SERVICES.includes(parseInt(hex.slice(0, 2), 16)) ? 'obd-read' : 'blocked';
}

/** True se il comando e' ammesso nell'MVP (richiesta di lettura OBD o configurazione dell'adattatore). */
export function isAllowedCommand(cmd: string): boolean {
  return classifyCommand(cmd) !== 'blocked';
}

/**
 * True se il comando NON e' sicuramente di sola lettura/configurazione: whitelist, non denylist. Un comando
 * vuoto non e' una scrittura (non viene inviato). Mantenuto per compatibilita' con i chiamanti esistenti.
 */
export function isWriteCommand(cmd: string): boolean {
  if (cmd.trim().length === 0) return false;
  return classifyCommand(cmd) === 'blocked';
}

export interface ServiceSplit {
  /** Messaggi di risposta positiva (primo byte = servizio + 0x40). */
  positive: EcuMessage[];
  /** Risposte negative 7F <servizio> <NRC> relative al servizio richiesto. */
  negatives: { ecu: string; error: ObdError }[];
  /** Messaggi di altri servizi (es. messaggi spontanei): ignorati. */
  other: EcuMessage[];
}

/**
 * Separa i messaggi di una risposta in positivi, negativi e altri, per il servizio richiesto.
 * NRC 0x78 = 'response pending' (RESPONSE_PENDING): l'ECU sta ancora elaborando.
 */
export function splitByService(messages: readonly EcuMessage[], requestService: number): ServiceSplit {
  const positiveByte = (requestService + 0x40) & 0xff;
  const out: ServiceSplit = { positive: [], negatives: [], other: [] };
  for (const m of messages) {
    const d = m.data;
    if (d.length === 0) continue;
    if (d[0] === positiveByte) {
      out.positive.push(m);
    } else if (d[0] === 0x7f && d.length >= 3 && d[1] === requestService) {
      const nrc = d[2];
      out.negatives.push({
        ecu: m.ecu,
        error:
          nrc === 0x78
            ? obdError('RESPONSE_PENDING', undefined, { service: requestService, nrc })
            : obdError('NEGATIVE_RESPONSE', `servizio ${byteToHex(requestService)} NRC ${byteToHex(nrc)}`, { service: requestService, nrc }),
      });
    } else {
      out.other.push(m);
    }
  }
  return out;
}

/** NRC che significano 'servizio / sotto-funzione / PID non supportato' (ISO 14229). */
export function isUnsupportedNrc(nrc: number | undefined): boolean {
  return nrc === 0x11 || nrc === 0x12 || nrc === 0x31;
}
