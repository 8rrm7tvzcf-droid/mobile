// Bitmap dei PID supportati: 0100/0120/0140/0160/0180/01A0/01C0 e 0900 (OBD §10). Puro.
// Il bitmask e' un'indicazione, non una garanzia: "supportato" = dichiarato E risposto almeno una volta
// (vedi session/capability.ts).

/** Basi dei blocchi: 0x00, 0x20, ..., 0xC0. */
export const PID_SUPPORT_BASES: readonly number[] = [0x00, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0];

/**
 * Decodifica 4 byte di bitmask: bit 7 del primo byte = base+1, bit 0 dell'ultimo = base+0x20.
 * @param base 0x00, 0x20, ... (per Mode 09: 0x00)
 * @param data i 4 byte A, B, C, D (dopo '41 00')
 */
export function decodePidSupport(base: number, data: readonly number[]): number[] {
  const out: number[] = [];
  const n = Math.min(4, data.length);
  for (let i = 0; i < n; i++) {
    const byte = data[i] & 0xff;
    for (let bit = 0; bit < 8; bit++) {
      if (byte & (0x80 >> bit)) out.push(base + i * 8 + bit + 1);
    }
  }
  return out;
}

/** Codifica inversa (usata dal simulatore e nei test): lista di PID di un blocco -> 4 byte. */
export function encodePidSupport(base: number, pids: readonly number[]): number[] {
  const out = [0, 0, 0, 0];
  for (const p of pids) {
    const idx = p - base - 1;
    if (idx < 0 || idx > 31) continue;
    out[idx >> 3] |= 0x80 >> (idx & 7);
  }
  return out;
}

/** True se il bit 'puntatore' al blocco successivo (base+0x20) e' attivo. */
export function hasNextBlock(base: number, declared: readonly number[]): boolean {
  return declared.includes(base + 0x20);
}

/** Unione ordinata e senza duplicati delle maschere di piu' ECU. */
export function mergeSupport(lists: readonly (readonly number[])[]): number[] {
  const set = new Set<number>();
  for (const l of lists) for (const p of l) set.add(p);
  return Array.from(set).sort((a, b) => a - b);
}

/** I PID 'puntatore' (0x20, 0x40, ...) non sono dati: li toglie da una lista. */
export function withoutPointers(pids: readonly number[]): number[] {
  return pids.filter((p) => (p & 0x1f) !== 0);
}
