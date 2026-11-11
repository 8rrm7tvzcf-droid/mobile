// Documenti e allegati (S-26, F-47, F-04): raggruppamento per categoria, testi di riga, scadenza e campi dei moduli. Puro.
import { diffDays, type LocalDate } from '@/domain/dates';
import { formatDateIt, formatInt, parseDateIt } from '@/domain/units';
import type { Attachment, AttachmentKind, AttachmentParentType } from '@/usecases/attachments';
import type { DeadlineIcon, DeadlineTone } from '@/usecases/queries';
import { it } from '../i18n/it';

/** Ordine dei gruppi nell'elenco: prima i documenti «di legge», poi ricevute e fatture, foto e altro (S-26). */
export const DOCUMENT_KIND_ORDER: readonly AttachmentKind[] = ['registration_doc', 'policy', 'receipt', 'invoice', 'inspection', 'photo', 'other'];

export const kindGroupTitle = (kind: AttachmentKind): string => it.documents.groups[kind] ?? it.documents.groups['other'] ?? kind;
export const kindLabel = (kind: AttachmentKind): string => it.documents.kinds[kind] ?? it.documents.kinds['other'] ?? kind;

export const kindOptions: { value: AttachmentKind; label: string }[] = DOCUMENT_KIND_ORDER.map((value) => ({ value, label: kindLabel(value) }));

/** Categoria proposta per un allegato di un intervento, una polizza, una spesa o un rifornimento (vale per foto e PDF). */
export const DEFAULT_KIND_BY_PARENT: Readonly<Record<AttachmentParentType, AttachmentKind>> = {
  vehicle: 'other',
  service_record: 'invoice',
  policy: 'policy',
  fuel_log: 'receipt',
  expense: 'receipt',
  fluid_check: 'photo',
  tyre_set: 'other',
};

export interface DocumentGroup {
  kind: AttachmentKind;
  title: string;
  items: Attachment[];
}

/** Gruppi non vuoti nell'ordine di `DOCUMENT_KIND_ORDER`; dentro un gruppo si tiene l'ordine ricevuto (piu' recente prima). */
export function groupDocuments(list: readonly Attachment[]): DocumentGroup[] {
  const groups: DocumentGroup[] = [];
  for (const kind of DOCUMENT_KIND_ORDER) {
    const items = list.filter((a) => a.kind === kind);
    if (items.length > 0) groups.push({ kind, title: kindGroupTitle(kind), items });
  }
  return groups;
}

/** «340 KB», «1,2 MB»: dimensione leggibile (1 KB = 1.024 byte). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${formatInt(Math.round(bytes))} B`;
  if (bytes < 1024 * 1024) return `${formatInt(Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  const text = mb >= 100 ? formatInt(Math.round(mb)) : (Math.round(mb * 10) / 10).toFixed(1).replace('.', ',');
  return `${text} MB`;
}

export const isPdf = (mime: string): boolean => mime === 'application/pdf';
export const isImageMime = (mime: string): boolean => mime.startsWith('image/');
export const mimeLabel = (mime: string): string => (isPdf(mime) ? it.documents.typePdf : it.documents.typePhoto);

/** Il titolo scelto dall'utente, altrimenti il nome del file. */
export const documentTitle = (a: Pick<Attachment, 'title' | 'fileName'>): string => (a.title?.trim() ? a.title.trim() : a.fileName);

/** 'YYYY-MM-DD' del giorno (nel fuso del telefono) in cui e' stato creato un istante ISO UTC. */
export function localDayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** «Ricevuta · PDF · 340 KB · aggiunto il 12/03/2026». */
export function documentSubtitle(a: Attachment): string {
  return [kindLabel(a.kind), mimeLabel(a.mimeType), formatBytes(a.sizeBytes), it.documents.addedOn(formatDateIt(localDayOf(a.createdAt)))].filter(Boolean).join(' · ');
}

export interface ExpiryView {
  tone: DeadlineTone;
  icon: DeadlineIcon;
  label: string;
}

/** Stato della scadenza di un documento: sempre testo + icona, mai solo colore. `null` se il documento non ha scadenza. */
export function expiryView(a: Pick<Attachment, 'expiresOn'>, today: string): ExpiryView | null {
  if (!a.expiresOn) return null;
  const date = formatDateIt(a.expiresOn);
  const days = diffDays(today, a.expiresOn);
  if (days < 0) return { tone: 'danger', icon: 'alert', label: it.documents.expiryPast(-days, date) };
  if (days === 0) return { tone: 'danger', icon: 'alert', label: it.documents.expiryToday };
  if (days <= 30) return { tone: 'warning', icon: 'clock', label: it.documents.expirySoon(days, date) };
  return { tone: 'ok', icon: 'check', label: it.documents.expiryOn(date) };
}

/** Frase per il lettore di schermo di una riga d'elenco. */
export function documentA11y(a: Attachment, today: string): string {
  const expiry = expiryView(a, today);
  return [documentTitle(a), documentSubtitle(a), expiry?.label].filter(Boolean).join('. ');
}

export type ExpiryFieldResult = { ok: true; value: LocalDate | null } | { ok: false; error: string };

/** Il campo «Scadenza» (gg/mm/aaaa): vuoto = nessuna scadenza. */
export function parseExpiryField(text: string): ExpiryFieldResult {
  const t = text.trim();
  if (t === '') return { ok: true, value: null };
  const parsed = parseDateIt(t);
  return parsed === null ? { ok: false, error: it.common.dateExample } : { ok: true, value: parsed };
}

/** 'YYYY-MM-DD' -> 'gg/mm/aaaa' per riempire il campo. */
export const expiryFieldText = (expiresOn: string | null): string => (expiresOn ? formatDateIt(expiresOn) : '');

/** Cerca nel nome file e nel titolo: la ricerca vera la fa il caso d'uso, qui si decide solo se il testo conta. */
export const hasSearch = (text: string): boolean => text.trim() !== '';

/** Giorni rimasti nel cestino -> frase. */
export const trashDaysText = (daysLeft: number): string => it.trash.daysLeft(daysLeft);
