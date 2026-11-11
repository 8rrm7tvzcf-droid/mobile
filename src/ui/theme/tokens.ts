// Token di design (SPEC 10, NFR-05/06): colori chiari e scuri con contrasto AA, spaziature, raggi, tipografia.
// File puro (nessun import di React Native): i contrasti si verificano con vitest.

export type ColorScheme = 'light' | 'dark';

/** Toni semantici: ogni tono ha testo e sfondo con contrasto >= 4,5:1. Mai usati da soli: sempre con icona e testo. */
export type ToneKey = 'danger' | 'warning' | 'ok' | 'unknown' | 'info';

export interface ToneColors {
  fg: string;
  bg: string;
}

export interface Palette {
  background: string;
  surface: string;
  surfaceAlt: string;
  /** Bordo decorativo (schede, separatori). */
  border: string;
  /** Bordo dei campi e dei controlli: contrasto >= 3:1 sulla superficie. */
  borderStrong: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  primarySoft: string;
  onPrimarySoft: string;
  danger: string;
  onDanger: string;
  overlay: string;
  tone: Record<ToneKey, ToneColors>;
}

export const light: Palette = {
  background: '#F5F6F8',
  surface: '#FFFFFF',
  surfaceAlt: '#ECEFF3',
  border: '#D3D9E1',
  borderStrong: '#7A8594',
  text: '#12161C',
  textMuted: '#4A5565',
  primary: '#0B5FC5',
  onPrimary: '#FFFFFF',
  primarySoft: '#DCEAFB',
  onPrimarySoft: '#0A4C9E',
  danger: '#B3261E',
  onDanger: '#FFFFFF',
  overlay: 'rgba(10, 14, 20, 0.5)',
  tone: {
    danger: { fg: '#B3261E', bg: '#FCE8E6' },
    warning: { fg: '#7A4B00', bg: '#FFF1CC' },
    ok: { fg: '#17673A', bg: '#E2F4E8' },
    unknown: { fg: '#4A5565', bg: '#E9ECF1' },
    info: { fg: '#0A4C9E', bg: '#E3EEFC' },
  },
};

export const dark: Palette = {
  background: '#0E1116',
  surface: '#171C24',
  surfaceAlt: '#202733',
  border: '#2D3542',
  borderStrong: '#7C8899',
  text: '#F1F4F8',
  textMuted: '#A7B1BF',
  primary: '#6CB2FF',
  onPrimary: '#04152B',
  primarySoft: '#16304F',
  onPrimarySoft: '#A9D1FF',
  danger: '#FF9A92',
  onDanger: '#2B0A08',
  overlay: 'rgba(0, 0, 0, 0.6)',
  tone: {
    danger: { fg: '#FF9A92', bg: '#3B1A18' },
    warning: { fg: '#FFC95C', bg: '#3A2C08' },
    ok: { fg: '#7FDE9F', bg: '#12301E' },
    unknown: { fg: '#B4BECC', bg: '#262E3A' },
    info: { fg: '#A9D1FF', bg: '#16304F' },
  },
};

export const palettes: Record<ColorScheme, Palette> = { light, dark };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

/** Area minima toccabile (NFR-05): 48 dp. */
export const MIN_TOUCH = 48;
/** Larghezza massima del contenuto (tablet e web). */
export const MAX_CONTENT_WIDTH = 640;

export type TextVariant = 'largeTitle' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'label' | 'caption';

export interface TextStyleSpec {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '600' | '700';
}

/** Dimensioni in dp: i font scalano con le impostazioni di sistema (allowFontScaling resta attivo). */
export const typography: Record<TextVariant, TextStyleSpec> = {
  largeTitle: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 23, fontWeight: '600' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
};

// ---- Contrasto WCAG (usato dai test) ----

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new RangeError(`Colore non valido: ${hex}`);
  const n = parseInt(m[1] as string, 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
