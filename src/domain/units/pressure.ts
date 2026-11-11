// Pressione dei pneumatici (F-44, SPEC §8.2 M-1): nel DB sempre in MILLIBAR interi (500..6000);
// bar o psi solo in visualizzazione e in input. Dominio puro, formattazione manuale.
import { formatScaled } from './format';
import { parseScaled } from './parse';

export type PressureUnit = 'bar' | 'psi';

/** Limiti del `CHECK` di `fluid_checks.value_millibar`. */
export const MIN_TYRE_MILLIBAR = 500;
export const MAX_TYRE_MILLIBAR = 6000;

export const MILLIBAR_PER_PSI = 68.947572932;

export const psiToMillibar = (psi: number): number => Math.round(psi * MILLIBAR_PER_PSI);
export const millibarToPsi = (millibar: number): number => millibar / MILLIBAR_PER_PSI;

export const isValidTyreMillibar = (millibar: number): boolean =>
  Number.isInteger(millibar) && millibar >= MIN_TYRE_MILLIBAR && millibar <= MAX_TYRE_MILLIBAR;

/**
 * "2,2 bar", "2,25 bar" (centesimi di bar, almeno un decimale) oppure "32,0 psi" (un decimale).
 * Il simbolo dopo il numero, come per gli euro.
 */
export function formatPressure(millibar: number, unit: PressureUnit): string {
  if (!Number.isFinite(millibar)) return '–';
  if (unit === 'psi') return `${formatScaled(Math.round(millibarToPsi(millibar) * 10), 1)} psi`;
  const centi = formatScaled(Math.round(millibar / 10), 2, { grouping: false });
  return `${centi.endsWith('0') ? centi.slice(0, -1) : centi} bar`;
}

/**
 * Pressione scritta dall'utente -> millibar interi, oppure `null` se illeggibile.
 * bar: fino a 3 decimali ("2,2", "2.25", "2,2 bar"); psi: fino a 1 decimale ("32", "32,5 psi").
 * Non controlla l'intervallo: usare `isValidTyreMillibar`.
 */
export function parsePressureToMillibar(input: string, unit: PressureUnit): number | null {
  const s = input.replace(/bar|psi/gi, '');
  if (unit === 'bar') return parseScaled(s, 3, { thousands: 'none' });
  const tenths = parseScaled(s, 1, { thousands: 'none' });
  return tenths === null ? null : Math.round((tenths * MILLIBAR_PER_PSI) / 10);
}
