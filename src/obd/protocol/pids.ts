// Tabella dichiarativa dei PID standard SAE J1979 Mode 01 (OBD §12, SPEC 5.1 e 8.7).
// Formule ricalcolate dalla verifica indipendente (Wikipedia, CSS Electronics). Le formule sono fatti;
// la tabella e' scritta in proprio. Ogni PID dichiara la lunghezza attesa dei dati: risposte piu' corte
// vengono scartate (TOO_SHORT), quelle piu' lunghe (padding) vengono troncate. Puro, mai eccezioni.
import { fail, ok, obdError, type ObdResult } from './errors';

export type PidConfidence = 'high' | 'medium';

export interface PidDef {
  /** Numero del PID (es. 0x0C). */
  pid: number;
  /** Identificatore stabile (inglese). */
  id: string;
  /** Nome per l'utente (italiano). */
  name: string;
  /** Lunghezza attesa dei dati (byte A, B, ...). */
  bytes: number;
  unit: string;
  /** Formula in chiaro (documentazione). */
  formula: string;
  /** Decodifica; `undefined` = valore non disponibile (sentinella). */
  decode(b: readonly number[]): number | undefined;
  /** Cifre decimali suggerite per la visualizzazione. */
  decimals: number;
  /** Etichette per i PID enumerati. */
  labels?: Readonly<Record<number, string>>;
  confidence: PidConfidence;
  /** Dato adatto allo streaming live. */
  live?: boolean;
}

const A = (b: readonly number[]) => b[0];
const AB = (b: readonly number[]) => 256 * b[0] + b[1];

export const OBD_STANDARD_LABELS: Readonly<Record<number, string>> = {
  1: 'OBD-II (CARB)',
  6: 'EOBD (Europa)',
  7: 'EOBD e OBD-II',
  9: 'EOBD, OBD e OBD-II',
  11: 'JOBD e OBD-II',
};

export const FUEL_TYPE_LABELS: Readonly<Record<number, string>> = {
  1: 'Benzina',
  4: 'Diesel',
  8: 'Elettrico',
  17: 'Ibrido benzina',
  20: 'Ibrido elettrico',
};

const def = (d: PidDef): PidDef => d;

export const PIDS: readonly PidDef[] = [
  def({ pid: 0x04, id: 'engine_load', name: 'Carico motore', bytes: 1, unit: '%', formula: 'A*100/255', decode: (b) => (A(b) * 100) / 255, decimals: 1, confidence: 'high', live: true }),
  def({ pid: 0x05, id: 'coolant_temp', name: 'Temperatura liquido refrigerante', bytes: 1, unit: '°C', formula: 'A-40', decode: (b) => A(b) - 40, decimals: 0, confidence: 'high', live: true }),
  def({ pid: 0x06, id: 'stft_b1', name: 'Correzione carburante breve (banco 1)', bytes: 1, unit: '%', formula: 'A*100/128-100', decode: (b) => (A(b) * 100) / 128 - 100, decimals: 1, confidence: 'high' }),
  def({ pid: 0x07, id: 'ltft_b1', name: 'Correzione carburante lunga (banco 1)', bytes: 1, unit: '%', formula: 'A*100/128-100', decode: (b) => (A(b) * 100) / 128 - 100, decimals: 1, confidence: 'high' }),
  def({ pid: 0x08, id: 'stft_b2', name: 'Correzione carburante breve (banco 2)', bytes: 1, unit: '%', formula: 'A*100/128-100', decode: (b) => (A(b) * 100) / 128 - 100, decimals: 1, confidence: 'high' }),
  def({ pid: 0x09, id: 'ltft_b2', name: 'Correzione carburante lunga (banco 2)', bytes: 1, unit: '%', formula: 'A*100/128-100', decode: (b) => (A(b) * 100) / 128 - 100, decimals: 1, confidence: 'high' }),
  def({ pid: 0x0a, id: 'fuel_pressure', name: 'Pressione carburante', bytes: 1, unit: 'kPa', formula: '3*A', decode: (b) => 3 * A(b), decimals: 0, confidence: 'high' }),
  def({ pid: 0x0b, id: 'map', name: 'Pressione collettore di aspirazione', bytes: 1, unit: 'kPa', formula: 'A', decode: (b) => A(b), decimals: 0, confidence: 'high', live: true }),
  def({ pid: 0x0c, id: 'engine_rpm', name: 'Giri motore', bytes: 2, unit: 'giri/min', formula: '(256*A+B)/4', decode: (b) => AB(b) / 4, decimals: 0, confidence: 'high', live: true }),
  def({ pid: 0x0d, id: 'vehicle_speed', name: 'Velocità', bytes: 1, unit: 'km/h', formula: 'A', decode: (b) => A(b), decimals: 0, confidence: 'high', live: true }),
  def({ pid: 0x0e, id: 'timing_advance', name: 'Anticipo di accensione', bytes: 1, unit: '°', formula: 'A/2-64', decode: (b) => A(b) / 2 - 64, decimals: 1, confidence: 'high' }),
  def({ pid: 0x0f, id: 'intake_temp', name: 'Temperatura aria aspirata', bytes: 1, unit: '°C', formula: 'A-40', decode: (b) => A(b) - 40, decimals: 0, confidence: 'high', live: true }),
  def({ pid: 0x10, id: 'maf', name: 'Portata aria (MAF)', bytes: 2, unit: 'g/s', formula: '(256*A+B)/100', decode: (b) => AB(b) / 100, decimals: 2, confidence: 'high', live: true }),
  def({ pid: 0x11, id: 'throttle', name: 'Posizione farfalla', bytes: 1, unit: '%', formula: 'A*100/255', decode: (b) => (A(b) * 100) / 255, decimals: 1, confidence: 'high', live: true }),
  def({ pid: 0x1c, id: 'obd_standard', name: 'Standard OBD del veicolo', bytes: 1, unit: '', formula: 'A (codice)', decode: (b) => A(b), decimals: 0, labels: OBD_STANDARD_LABELS, confidence: 'high' }),
  def({ pid: 0x1f, id: 'run_time', name: "Tempo dall'avviamento del motore", bytes: 2, unit: 's', formula: '256*A+B', decode: (b) => AB(b), decimals: 0, confidence: 'high' }),
  def({ pid: 0x21, id: 'distance_with_mil', name: 'Distanza percorsa con la spia accesa', bytes: 2, unit: 'km', formula: '256*A+B', decode: (b) => AB(b), decimals: 0, confidence: 'high' }),
  def({ pid: 0x2f, id: 'fuel_level', name: 'Livello carburante', bytes: 1, unit: '%', formula: 'A*100/255', decode: (b) => (A(b) * 100) / 255, decimals: 0, confidence: 'medium', live: true }),
  def({ pid: 0x30, id: 'warmups_since_clear', name: 'Cicli di riscaldamento dalla cancellazione dei codici', bytes: 1, unit: '', formula: 'A', decode: (b) => A(b), decimals: 0, confidence: 'high' }),
  def({ pid: 0x31, id: 'distance_since_clear', name: 'Distanza dalla cancellazione dei codici', bytes: 2, unit: 'km', formula: '256*A+B (satura a 65535)', decode: (b) => AB(b), decimals: 0, confidence: 'high' }),
  def({ pid: 0x33, id: 'baro_pressure', name: 'Pressione barometrica', bytes: 1, unit: 'kPa', formula: 'A', decode: (b) => A(b), decimals: 0, confidence: 'high' }),
  def({ pid: 0x42, id: 'control_module_voltage', name: 'Tensione del modulo di controllo', bytes: 2, unit: 'V', formula: '(256*A+B)/1000', decode: (b) => AB(b) / 1000, decimals: 1, confidence: 'high', live: true }),
  def({ pid: 0x46, id: 'ambient_temp', name: 'Temperatura ambiente', bytes: 1, unit: '°C', formula: 'A-40', decode: (b) => A(b) - 40, decimals: 0, confidence: 'high' }),
  def({ pid: 0x4d, id: 'time_with_mil', name: 'Tempo di funzionamento con la spia accesa', bytes: 2, unit: 'min', formula: '256*A+B', decode: (b) => AB(b), decimals: 0, confidence: 'high' }),
  def({ pid: 0x4e, id: 'time_since_clear', name: 'Tempo dalla cancellazione dei codici', bytes: 2, unit: 'min', formula: '256*A+B', decode: (b) => AB(b), decimals: 0, confidence: 'high' }),
  def({ pid: 0x51, id: 'fuel_type', name: 'Tipo di carburante', bytes: 1, unit: '', formula: 'A (codice)', decode: (b) => A(b), decimals: 0, labels: FUEL_TYPE_LABELS, confidence: 'medium' }),
  def({ pid: 0x5b, id: 'hybrid_battery_life', name: 'Vita residua della batteria ibrida', bytes: 1, unit: '%', formula: 'A*100/255', decode: (b) => (A(b) * 100) / 255, decimals: 0, confidence: 'medium' }),
  def({ pid: 0x5c, id: 'oil_temp', name: 'Temperatura olio motore', bytes: 1, unit: '°C', formula: 'A-40', decode: (b) => A(b) - 40, decimals: 0, confidence: 'medium' }),
  def({ pid: 0x5e, id: 'fuel_rate', name: 'Consumo istantaneo di carburante', bytes: 2, unit: 'L/h', formula: '(256*A+B)/20', decode: (b) => AB(b) / 20, decimals: 1, confidence: 'medium' }),
  def({
    pid: 0xa6,
    id: 'odometer',
    name: 'Chilometraggio (odometro)',
    bytes: 4,
    unit: 'km',
    formula: '(A*2^24+B*2^16+C*2^8+D)/10',
    // 0xFFFFFFFF = non disponibile: convenzione attestata solo per OBFCM e [DA VERIFICARE] per 01A6,
    // ma 429496729,5 km non e' un valore fisicamente possibile, quindi lo si scarta in ogni caso.
    decode: (b) => {
      const raw = b[0] * 16777216 + b[1] * 65536 + b[2] * 256 + b[3];
      return raw === 0xffffffff ? undefined : raw / 10;
    },
    decimals: 1,
    confidence: 'medium',
  }),
];

const BY_PID = new Map<number, PidDef>(PIDS.map((p) => [p.pid, p]));
const BY_ID = new Map<string, PidDef>(PIDS.map((p) => [p.id, p]));

export function pidDef(pid: number): PidDef | undefined {
  return BY_PID.get(pid);
}

export function pidDefById(id: string): PidDef | undefined {
  return BY_ID.get(id);
}

/** Lunghezza dei dati per la scomposizione delle risposte multi-PID (comprende le maschere di supporto e 0101). */
export function pidDataLength(pid: number): number | undefined {
  if (pid === 0x01 || (pid & 0x1f) === 0 /* 00,20,40,60,80,A0,C0,E0 */) return 4;
  return BY_PID.get(pid)?.bytes;
}

export interface DecodedPid {
  pid: number;
  id: string;
  name: string;
  value: number;
  unit: string;
  decimals: number;
  /** Etichetta per i PID enumerati (es. tipo di carburante). */
  label?: string;
  /** Byte dati grezzi usati per la decodifica. */
  raw: number[];
}

/**
 * Decodifica i dati di un PID Mode 01 (byte dopo '41 PP').
 * Errori: UNKNOWN_PID, TOO_SHORT, NOT_AVAILABLE (sentinella).
 */
export function decodePid(pid: number, data: readonly number[]): ObdResult<DecodedPid> {
  const d = BY_PID.get(pid);
  if (!d) return fail(obdError('UNKNOWN_PID', `pid ${pid.toString(16)}`));
  if (!Array.isArray(data)) return fail(obdError('MALFORMED_FRAME', 'dati non validi'));
  if (data.length < d.bytes) {
    return fail(obdError('TOO_SHORT', `pid ${pid.toString(16)}: attesi ${d.bytes} byte, ricevuti ${data.length}`));
  }
  const raw = data.slice(0, d.bytes) as number[];
  for (const x of raw) {
    if (!Number.isInteger(x) || x < 0 || x > 255) return fail(obdError('MALFORMED_FRAME', 'byte fuori intervallo'));
  }
  const value = d.decode(raw);
  if (value === undefined || !Number.isFinite(value)) return fail(obdError('NOT_AVAILABLE', `pid ${pid.toString(16)}`));
  const out: DecodedPid = { pid, id: d.id, name: d.name, value, unit: d.unit, decimals: d.decimals, raw };
  if (d.labels) out.label = d.labels[value] ?? `Codice ${value}`;
  return ok(out);
}

export interface Mode01Entry {
  pid: number;
  bytes: number[];
}

/**
 * Scompone un messaggio Mode 01 (anche multi-PID su CAN: '41 0B 21 04 3F 0C 17 B8 05 44') in coppie
 * PID/byte usando la tabella delle lunghezze. L'ordine dei PID nella risposta puo' non coincidere con
 * quello richiesto: si usa sempre il PID scritto nel messaggio. Si ferma al primo PID di lunghezza ignota.
 */
export function splitMode01Payload(data: readonly number[]): { entries: Mode01Entry[]; leftover: number } {
  const entries: Mode01Entry[] = [];
  if (data.length < 2 || data[0] !== 0x41) return { entries, leftover: data.length };
  let i = 1;
  while (i < data.length) {
    const pid = data[i];
    const len = pidDataLength(pid);
    if (len === undefined) break;
    if (i + 1 + len > data.length) break;
    entries.push({ pid, bytes: data.slice(i + 1, i + 1 + len) });
    i += 1 + len;
  }
  return { entries, leftover: data.length - i };
}
