// Protocolli OBD-II dell'ELM327 (ATSP / ATDPN). OBD §6. Puro.

export type ProtocolId = string; // '0'..'9', 'A', 'B', 'C'

export interface ProtocolInfo {
  id: ProtocolId;
  /** Nome per l'utente (italiano). */
  name: string;
  can: boolean;
  /** Lunghezza dell'identificatore CAN, se CAN. */
  canBits?: 11 | 29;
  /** Protocolli K-line / J1850 (non CAN). */
  legacy: boolean;
}

const TABLE: Record<string, Omit<ProtocolInfo, 'id'>> = {
  '0': { name: 'Automatico', can: false, legacy: false },
  '1': { name: 'SAE J1850 PWM (41,6 kbps)', can: false, legacy: true },
  '2': { name: 'SAE J1850 VPW (10,4 kbps)', can: false, legacy: true },
  '3': { name: 'ISO 9141-2 (avvio a 5 baud)', can: false, legacy: true },
  '4': { name: 'ISO 14230-4 KWP (avvio a 5 baud)', can: false, legacy: true },
  '5': { name: 'ISO 14230-4 KWP (avvio veloce)', can: false, legacy: true },
  '6': { name: 'ISO 15765-4 CAN (11 bit, 500 kbps)', can: true, canBits: 11, legacy: false },
  '7': { name: 'ISO 15765-4 CAN (29 bit, 500 kbps)', can: true, canBits: 29, legacy: false },
  '8': { name: 'ISO 15765-4 CAN (11 bit, 250 kbps)', can: true, canBits: 11, legacy: false },
  '9': { name: 'ISO 15765-4 CAN (29 bit, 250 kbps)', can: true, canBits: 29, legacy: false },
  A: { name: 'SAE J1939 CAN (29 bit, 250 kbps)', can: true, canBits: 29, legacy: false },
  B: { name: 'CAN utente 1 (11 bit)', can: true, canBits: 11, legacy: false },
  C: { name: 'CAN utente 2 (29 bit)', can: true, canBits: 29, legacy: false },
};

export function protocolInfo(id: ProtocolId | undefined): ProtocolInfo | undefined {
  if (id === undefined) return undefined;
  const key = id.toUpperCase();
  const t = TABLE[key];
  return t ? { id: key, ...t } : undefined;
}

export function isCanProtocol(id: ProtocolId | undefined): boolean {
  return protocolInfo(id)?.can === true;
}

/** Ordine di ripiego per il mercato UE quando la ricerca automatica fallisce (OBD §6 punto 8). */
export const EU_FALLBACK_PROTOCOLS: readonly ProtocolId[] = ['6', '7', '8', '9', '5', '4', '3', '2', '1'];

/**
 * Interpreta la risposta di ATDPN: 'A6' = automatico + protocollo 6; '6' = protocollo fisso 6.
 * Restituisce undefined se la riga non e' un numero di protocollo valido.
 */
export function parseProtocolNumber(line: string): { id: ProtocolId; auto: boolean } | undefined {
  const s = line.replace(/\s+/g, '').toUpperCase();
  if (s.length === 0 || s.length > 2) return undefined;
  let auto = false;
  let id = s;
  if (s.length === 2) {
    if (s[0] !== 'A') return undefined;
    auto = true;
    id = s[1];
  }
  if (!TABLE[id]) return undefined;
  return { id, auto };
}
