// Porta ZipCodec su fflate (ZIP in memoria, SPEC 8.5). Funziona uguale su telefono, web e node (test).
// `unzip` lancia un Error se l'archivio e' vuoto, troncato o corrotto; NON valida i nomi (zip-slip, percorsi assoluti,
// '\\'): lo fa il caso d'uso di importazione, che deve poterli segnalare come errore dedicato.
import { unzipSync, zipSync, type Zippable } from 'fflate';
import type { UnzipOptions, ZipCodec, ZipEntry } from '@/domain/ports';
import { isAlreadyCompressed } from './paths';

/** Lanciato da `unzip` quando la somma delle dimensioni dichiarate supera `maxTotalBytes` (riconoscibile da `code`). */
export class ZipTooBigError extends Error {
  readonly code = 'ZIP_TOO_BIG';
  constructor(readonly declaredBytes: number, readonly maxTotalBytes: number) {
    super(`Il contenuto dello ZIP supera il tetto di ${maxTotalBytes} byte`);
    this.name = 'ZipTooBigError';
  }
}

export interface ZipCodecOptions {
  /** Data scritta nelle voci dello ZIP (default: l'istante della chiamata a zip). Fissarla rende l'output ripetibile. */
  mtime?: Date | number;
  /** Livello di compressione deflate 0-9 per i file comprimibili (default 6). */
  level?: number;
}

export function createZipCodec(opts: ZipCodecOptions = {}): ZipCodec {
  const level = (opts.level ?? 6) as NonNullable<Parameters<typeof zipSync>[1]>['level'];
  return {
    zip(entries: readonly ZipEntry[]): Uint8Array {
      const data: Zippable = {};
      for (const entry of entries) {
        if (entry.name.length === 0) throw new Error('Voce ZIP senza nome');
        if (Object.prototype.hasOwnProperty.call(data, entry.name)) throw new Error(`Voce ZIP duplicata: ${entry.name}`);
        data[entry.name] = [entry.bytes, { level: isAlreadyCompressed(entry.name) ? 0 : level }];
      }
      return zipSync(data, { mtime: opts.mtime ?? Date.now() });
    },
    unzip(bytes: Uint8Array, unzipOpts?: UnzipOptions): ZipEntry[] {
      let files: Record<string, Uint8Array>;
      const max = unzipOpts?.maxTotalBytes;
      let declared = 0;
      try {
        // il filtro vede la dimensione originale scritta nell'indice PRIMA che fflate decomprima la voce (alloca `originalSize` byte):
        // una zip bomb si rifiuta senza gonfiare nulla. La dimensione dichiarata limita anche la memoria usata dalla voce.
        files = unzipSync(
          bytes,
          max === undefined
            ? undefined
            : {
                filter: (f) => {
                  declared += f.originalSize;
                  if (!(declared <= max)) throw new ZipTooBigError(declared, max);
                  return true;
                },
              },
        );
      } catch (e) {
        if (e instanceof ZipTooBigError) throw e;
        throw new Error(`Archivio ZIP non valido o danneggiato${e instanceof Error ? `: ${e.message}` : ''}`);
      }
      const names = Object.keys(files);
      if (names.length === 0) throw new Error('Archivio ZIP vuoto');
      const out: ZipEntry[] = [];
      for (const name of names) {
        if (name.endsWith('/')) continue; // voce di cartella: non porta dati
        out.push({ name, bytes: files[name] as Uint8Array });
      }
      return out;
    },
  };
}
