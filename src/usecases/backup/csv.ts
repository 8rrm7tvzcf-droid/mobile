// Codifica CSV (SPEC F-08, data.md 5.4): due varianti, protezione dalla formula injection, importi con aritmetica intera.
//  - 'excel-it': separatore ';', UTF-8 con BOM, date gg/mm/aaaa, virgola decimale, si/no, etichette italiane;
//  - 'data': separatore ',', date ISO, punto decimale, 0/1, codici grezzi, senza BOM.
export type CsvVariant = 'excel-it' | 'data';

/**
 *  - text: testo (protetto dalla formula injection); `map` traduce i codici nelle etichette italiane della variante excel-it;
 *  - int: intero (mai toccato dalla protezione: i numeri negativi restano numeri);
 *  - cents: centesimi -> euro con due decimali; milli: millesimi -> 3 decimali (litri, kWh, prezzo al litro, pressione in bar);
 *  - date: 'YYYY-MM-DD' (di un istante si usa la parte data); bool: 0/1.
 */
export type CsvColumnType = 'text' | 'int' | 'cents' | 'milli' | 'date' | 'bool';

export interface CsvColumn {
  key: string;
  label: string;
  type: CsvColumnType;
  map?: Readonly<Record<string, string>>;
}

export type CsvRow = Readonly<Record<string, string | number | null | undefined>>;

/** Una cella di TESTO che inizia con = + - @ tab o a capo ricevera' un apice davanti (OWASP, CSV injection). */
export const neutralizeFormula = (s: string): string => (/^[=+\-@\t\r\n]/.test(s) ? `'${s}` : s);

/** Intero scalato (centesimi, millesimi) in decimale, senza numeri in virgola mobile. */
export function formatScaled(v: number, decimals: number, decimalSep: string): string {
  if (!Number.isInteger(v)) return String(v).replace('.', decimalSep);
  const neg = v < 0;
  const abs = Math.abs(v);
  const f = 10 ** decimals;
  const whole = Math.floor(abs / f);
  const frac = String(abs % f).padStart(decimals, '0');
  return `${neg ? '-' : ''}${whole}${decimalSep}${frac}`;
}

export function formatCsvDate(iso: string, variant: CsvVariant): string {
  const day = iso.slice(0, 10);
  if (variant === 'data') return day;
  const [y, m, d] = day.split('-');
  return y && m && d ? `${d}/${m}/${y}` : day;
}

export function toCsv(rows: readonly CsvRow[], columns: readonly CsvColumn[], variant: CsvVariant): string {
  const excel = variant === 'excel-it';
  const sep = excel ? ';' : ',';
  const decimalSep = excel ? ',' : '.';
  const quote = (s: string): string => (/[";,\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const cell = (v: CsvRow[string], c: CsvColumn): string => {
    if (v === null || v === undefined) return '';
    switch (c.type) {
      case 'cents':
        return typeof v === 'number' ? formatScaled(v, 2, decimalSep) : quote(neutralizeFormula(String(v)));
      case 'milli':
        return typeof v === 'number' ? formatScaled(v, 3, decimalSep) : quote(neutralizeFormula(String(v)));
      case 'date':
        return formatCsvDate(String(v), variant);
      case 'bool':
        return v ? (excel ? 'si' : '1') : excel ? 'no' : '0';
      case 'int':
        return typeof v === 'number' ? String(v) : quote(neutralizeFormula(String(v)));
      default: {
        const raw = String(v);
        return quote(neutralizeFormula(excel && c.map ? (c.map[raw] ?? raw) : raw));
      }
    }
  };
  const lines = [columns.map((c) => quote(c.label)).join(sep), ...rows.map((r) => columns.map((c) => cell(r[c.key], c)).join(sep))];
  return (excel ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}
