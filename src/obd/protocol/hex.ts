// Utilita' esadecimali pure per il protocollo ELM327. Nessuna eccezione sull'input.

const HEX_RE = /^[0-9A-Fa-f]*$/;

/** True se la stringa e' composta solo da cifre esadecimali (anche vuota). */
export function isHex(s: string): boolean {
  return HEX_RE.test(s);
}

/**
 * Converte una riga di byte esadecimali in numeri. Accetta il formato con spazi ('41 0C 1A F8')
 * e quello senza spazi (ATS0: '410C1AF8'). Restituisce null se contiene caratteri non esadecimali
 * o un numero dispari di cifre.
 */
export function parseHexBytes(line: string): number[] | null {
  const compact = line.replace(/\s+/g, '');
  if (compact.length === 0 || compact.length % 2 !== 0 || !HEX_RE.test(compact)) return null;
  const out: number[] = new Array(compact.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(compact.substr(i * 2, 2), 16);
  return out;
}

export function byteToHex(b: number): string {
  return ((b & 0xff) | 0x100).toString(16).slice(1).toUpperCase();
}

export function bytesToHex(bytes: readonly number[], sep = ' '): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += (i > 0 ? sep : '') + byteToHex(bytes[i]);
  return s;
}

/** ASCII stampabile (0x20-0x7E); gli altri byte diventano ''. */
export function bytesToAscii(bytes: readonly number[]): string {
  let s = '';
  for (const b of bytes) if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
  return s;
}

export function asciiToBytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
  return out;
}

/** Numero (0-0xFFFF) in n cifre esadecimali maiuscole. */
export function hexN(v: number, digits: number): string {
  return (v >>> 0).toString(16).toUpperCase().padStart(digits, '0');
}
