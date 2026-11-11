// Scelta e salvataggio di foto e PDF (F-04, F-47) e apertura con il foglio di condivisione. Niente SQL: solo casi d'uso e servizi per file.
// IMPORTANTE (web): il selettore va aperto nello stesso gesto del tocco, quindi prima della chiamata non ci possono essere `await`.
import type { PickedFile } from '@/domain/ports';
import { addAttachment, getAttachmentFilePath, type AddAttachmentInput, type Attachment } from '@/usecases/attachments';
import { it } from '../i18n/it';
import { describeError } from '../logic/errors';
import { documentTitle } from '../logic/documentsView';
import type { QueryDeps } from './useQuery';

export type PickSource = 'camera' | 'gallery' | 'pdf';

export const PDF_TYPES = ['application/pdf'];
/** Tipi che il ripristino accetta: ZIP (o il suo nome alternativo di alcuni telefoni) e JSON; octet-stream perche' alcune app non indicano il tipo. */
export const BACKUP_TYPES = ['application/zip', 'application/x-zip-compressed', 'application/json', 'application/octet-stream'];

/** Apre il selettore giusto. `null` = annullato (o permesso della fotocamera negato). Se il selettore non funziona la promessa e' rifiutata. */
export function pickSource(deps: QueryDeps, source: PickSource): Promise<PickedFile | null> {
  switch (source) {
    case 'camera':
      return deps.fs.picker.pickImage({ camera: true });
    case 'gallery':
      return deps.fs.picker.pickImage({ camera: false });
    default:
      return deps.fs.picker.pickDocument({ types: PDF_TYPES });
  }
}

export type PickAndAddResult =
  | { status: 'cancelled' }
  | { status: 'error'; message: string }
  | { status: 'added'; attachment: Attachment };

/** Sceglie un file e lo salva come allegato del genitore indicato. Gli errori diventano frasi in italiano. */
export async function pickAndAdd(deps: QueryDeps, source: PickSource, input: Omit<AddAttachmentInput, 'file'>): Promise<PickAndAddResult> {
  let file: PickedFile | null;
  try {
    file = await pickSource(deps, source);
  } catch {
    return { status: 'error', message: it.documents.pickFailed };
  }
  if (file === null) return { status: 'cancelled' };
  try {
    const res = await addAttachment(deps, { ...input, file });
    return res.ok ? { status: 'added', attachment: res.value } : { status: 'error', message: describeError(res.error).message };
  } catch {
    return { status: 'error', message: it.errors.generic };
  }
}

/** Apre il file con il foglio di condivisione (sul web lo scarica). Restituisce il messaggio d'errore, o `null` se e' andata bene. */
export async function openAttachment(deps: QueryDeps, a: Attachment): Promise<string | null> {
  try {
    const path = await getAttachmentFilePath(deps, a.id);
    if (path === null) return it.documents.fileMissing;
    await deps.fs.sharer.shareFile(path, a.mimeType, documentTitle(a));
    return null;
  } catch {
    return it.errors.generic;
  }
}
