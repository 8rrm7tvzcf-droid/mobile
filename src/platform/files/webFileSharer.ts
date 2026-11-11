// Porta FileSharer sul web: scarica il file con un link temporaneo (Blob + <a download>), perche' il foglio di
// condivisione di sistema non e' disponibile ovunque nel browser. Il nome del file scaricato e' quello del percorso.
import type { FileSharer, FileStore } from '@/domain/ports';
import { baseName } from './paths';

export interface AnchorLike {
  href: string;
  download: string;
  rel: string;
  style: { display: string };
  click(): void;
  remove(): void;
}

export interface DownloadDocumentLike {
  createElement(tag: 'a'): AnchorLike;
  body?: { appendChild(node: AnchorLike): unknown } | null;
}

export interface UrlApiLike {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export interface WebFileSharerOptions {
  files: FileStore;
  document?: DownloadDocumentLike;
  url?: UrlApiLike;
  /** Dopo quanto si libera l'URL temporaneo (default 10 s: il download deve aver avuto il tempo di partire). */
  revokeAfterMs?: number;
}

export function createWebFileSharer(opts: WebFileSharerOptions): FileSharer {
  const doc = opts.document ?? (globalThis as unknown as { document: DownloadDocumentLike }).document;
  const urlApi = opts.url ?? (globalThis as unknown as { URL: UrlApiLike }).URL;
  return {
    async shareFile(path, mimeType) {
      const bytes = await opts.files.read(path);
      const url = urlApi.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
      const a = doc.createElement('a');
      a.href = url;
      a.download = baseName(path) || 'file';
      a.rel = 'noopener';
      a.style.display = 'none';
      doc.body?.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => urlApi.revokeObjectURL(url), opts.revokeAfterMs ?? 10_000);
    },
  };
}
