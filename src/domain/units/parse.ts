// Parsing dell'input scritto dall'utente -> interi scalati (data.md §7.3). Nessun parseFloat:
// niente virgola mobile nel percorso del denaro. Troppi decimali o testo ambiguo -> `null`
// (nessun arrotondamento silenzioso: la UI chiede conferma). Dominio puro.
import type { LocalDate } from '@/domain/ports';
import { isValidDate, makeDate } from '@/domain/dates';
import { KM_PER_MI, MAX_KM, type DistanceUnit } from './distance';

export interface ParseScaledOptions {
  /**
   * 'auto' (default): "1.234,56" e "1.234" sono migliaia all'italiana (1234 euro);
   * 'none': il punto e' sempre un separatore decimale ("1.859" = 1,859 EUR/L; "45.500" = 45,500 L).
   */
  thousands?: 'auto' | 'none';
}

/**
 * Legge un numero scritto a mano e lo restituisce come intero moltiplicato per 10^scale.
 * Accetta: "1.234,56", "1,234.56", "1234,56", "1234.56", "12", "12,5", "EUR 12,50", "12,50 €", spazi e NBSP,
 * segno meno. Rifiuta: "12,345" con scale 2, "1.2.3", "12,5,5", "abc", "", ".", "0.500" con scale 2.
 * Il separatore decimale e' l'ULTIMO tra punto e virgola quando compaiono entrambi; la virgola sola e' sempre decimale.
 */
export function parseScaled(input: string | null | undefined, scale: number, opts: ParseScaledOptions = {}): number | null {
  if (input == null) return null;
  const thousands = opts.thousands ?? 'auto';
  let s = String(input)
    .replace(/[\s  ]/g, '')
    .replace(/[€$]|euro|eur/gi, '');
  if (!/^-?[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  let intPart: string;
  let fracPart = '';
  if (dots > 0 && commas > 0) {
    // l'ultimo separatore e' il decimale, l'altro le migliaia
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const th = dec === ',' ? '.' : ',';
    const parts = s.split(dec);
    if (parts.length !== 2) return null;
    const groups = parts[0]!.split(th);
    if (groups[0]!.length < 1 || groups[0]!.length > 3) return null;
    if (groups.slice(1).some((g) => g.length !== 3)) return null;
    intPart = groups.join('');
    fracPart = parts[1]!;
  } else if (commas > 0) {
    if (commas > 1) return null;
    [intPart = '', fracPart = ''] = s.split(',');
  } else if (dots > 0) {
    if (dots > 1) {
      if (thousands === 'none' || !/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) return null;
      intPart = s.split('.').join('');
    } else if (thousands === 'auto' && /^[1-9]\d{0,2}\.\d{3}$/.test(s)) {
      intPart = s.replace('.', ''); // 1.234 -> 1234 (la cifra iniziale non e' 0: "0.500" resta decimale)
    } else {
      [intPart = '', fracPart = ''] = s.split('.');
    }
  } else {
    intPart = s;
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (fracPart.length > scale) return null;
  const v = Number(intPart || '0') * 10 ** scale + Number(fracPart.padEnd(scale, '0') || '0');
  if (!Number.isSafeInteger(v)) return null;
  return neg ? (v === 0 ? 0 : -v) : v;
}

/** Euro scritti dall'utente -> centesimi interi: "1.234,56" -> 123456; "12,345" -> null. */
export const parseEuroToCents = (s: string | null | undefined): number | null => parseScaled(s, 2, { thousands: 'auto' });

/** Prezzo unitario o quantita' -> millesimi (il punto e' sempre decimale): "1.859" -> 1859; "45.500" -> 45500. */
export const parseMilli = (s: string | null | undefined): number | null => parseScaled(s, 3, { thousands: 'none' });

/**
 * Distanza scritta dall'utente -> km interi canonici, oppure `null` se illeggibile o fuori da 0..2.000.000.
 * Accetta migliaia con punto o spazio ("12.345", "12 345") e un solo decimale ("12345,6", arrotondato al km).
 * In miglia converte UNA volta sola (`miToKm`): non risalvare mai il valore riconvertito.
 */
export function parseDistanceInput(input: string | null | undefined, unit: DistanceUnit = 'km'): number | null {
  const s = (input ?? '').replace(/km|mi/gi, '');
  const tenths = parseScaled(s, 1, { thousands: 'auto' });
  if (tenths === null || tenths < 0) return null;
  const km = unit === 'mi' ? Math.round((tenths * KM_PER_MI) / 10) : Math.round(tenths / 10);
  return km >= 0 && km <= MAX_KM ? km : null;
}

/**
 * Data scritta dall'utente -> 'YYYY-MM-DD'. Accetta "7/10/2026", "07/10/2026", "07-10-2026", "07.10.2026"
 * e anche l'ISO "2026-10-07". Anno a 4 cifre obbligatorio; data impossibile -> `null`.
 */
export function parseDateIt(input: string | null | undefined): LocalDate | null {
  const s = (input ?? '').trim();
  if (isValidDate(s)) return s;
  const mt = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s);
  if (!mt) return null;
  const d = Number(mt[1]);
  const m = Number(mt[2]);
  const y = Number(mt[3]);
  const candidate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidDate(candidate) ? makeDate(y, m, d) : null;
}
