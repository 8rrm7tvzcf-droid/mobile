// Porta FilePicker sul web (anteprima su PC): `<input type="file">`. Il file scelto si copia nel FileStore sotto
// `<tempDir>/picked/<n>-<nome>` e l'URI restituito e' quel percorso virtuale, leggibile con FileStore.read.
// Va chiamato in risposta a un gesto dell'utente (un click): i browser bloccano il selettore altrimenti.
// Se l'utente annulla: i browser recenti emettono l'evento 'cancel' (-> null); i piu' vecchi non emettono nulla e la
// promessa resta in attesa finche' l'utente non sceglie un file in un'altra apertura.
import type { FilePicker, FileStore, PickedFile } from '@/domain/ports';
import { guessMimeType } from './paths';

export interface WebFileLike {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface FileInputLike {
  type: string;
  accept: string;
  multiple: boolean;
  files: ArrayLike<WebFileLike> | null;
  style: { display: string };
  setAttribute(name: string, value: string): void;
  addEventListener(type: 'change' | 'cancel', listener: () => void): void;
  click(): void;
  remove(): void;
}

/** Il pezzo del DOM che serve (document reale nel browser, finto nei test). */
export interface DocumentLike {
  createElement(tag: 'input'): FileInputLike;
  body?: { appendChild(node: FileInputLike): unknown } | null;
}

export interface WebFilePickerOptions {
  files: FileStore;
  /** Cartella virtuale dei file temporanei (AppDirs.temp). */
  tempDir: string;
  document?: DocumentLike;
}

function chooseFile(doc: DocumentLike, accept: string, capture: boolean): Promise<WebFileLike | null> {
  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = false;
    if (capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    let done = false;
    const finish = (file: WebFileLike | null): void => {
      if (done) return;
      done = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    // Safari non emette 'change' su un input staccato dal documento.
    doc.body?.appendChild(input);
    input.click();
  });
}

const safeName = (name: string): string => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');

export function createWebFilePicker(opts: WebFilePickerOptions): FilePicker {
  const doc = opts.document ?? (globalThis as unknown as { document: DocumentLike }).document;
  let counter = 0;

  const store = async (file: WebFileLike): Promise<PickedFile> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    counter += 1;
    const uri = `${opts.tempDir}/picked/${Date.now().toString(36)}-${counter}-${safeName(file.name)}`;
    await opts.files.write(uri, bytes);
    return {
      uri,
      name: file.name,
      mimeType: file.type || guessMimeType(file.name),
      size: Number.isFinite(file.size) ? file.size : bytes.byteLength,
    };
  };

  return {
    async pickDocument({ types }) {
      const file = await chooseFile(doc, types.join(','), false);
      return file ? store(file) : null;
    },
    async pickImage({ camera }) {
      const file = await chooseFile(doc, 'image/*', camera);
      return file ? store(file) : null;
    },
  };
}
