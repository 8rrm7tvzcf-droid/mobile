// Riconoscimento del tipo di file dal CONTENUTO (non ci si fida del nome ne' del tipo MIME dichiarato dal selettore).
// Ammessi: immagini (JPEG, PNG, WebP, HEIC/HEIF) e PDF.

export type AllowedMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'application/pdf';

export const EXTENSION_OF_MIME: Readonly<Record<AllowedMime, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

const ascii = (b: Uint8Array, from: number, to: number): string => {
  let s = '';
  for (let i = from; i < to && i < b.length; i++) s += String.fromCharCode(b[i] as number);
  return s;
};

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'heif']);

/** Il tipo reale del file, o null se non e' un formato ammesso. */
export function sniffMime(b: Uint8Array): AllowedMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(b, 8, 12))) return 'image/heic';
  // PDF: l'intestazione puo' essere preceduta da qualche byte (la specifica ammette fino a 1024 byte)
  if (ascii(b, 0, 1024).includes('%PDF-')) return 'application/pdf';
  return null;
}

/** Nome del file ripulito: niente separatori di percorso, caratteri di controllo o nomi vuoti; al massimo 120 caratteri. */
export function cleanFileName(raw: string, fallbackExt: string): string {
  const base = raw.slice(Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\')) + 1);
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim();
  const name = cleaned === '' || cleaned === '.' || cleaned === '..' ? `documento.${fallbackExt}` : cleaned;
  return name.length > 120 ? name.slice(name.length - 120) : name;
}
