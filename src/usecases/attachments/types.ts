// Tipi pubblici di allegati e documenti (SPEC F-04, F-47, schema `attachments` della migrazione 0001).
import type { LocalDate } from '@/domain/dates';
import type { PickedFile } from '@/domain/ports';

/** Un allegato ha UN solo genitore (vincolo CHECK dello schema); `vehicle` = allegato dell'auto (es. libretto, foto). */
export type AttachmentParentType = 'vehicle' | 'service_record' | 'policy' | 'fuel_log' | 'expense' | 'fluid_check' | 'tyre_set';

export interface AttachmentParent {
  type: AttachmentParentType;
  id: string;
}

/** I valori ammessi dallo schema. Nota: «Multe» e «Bollo (ricevute)» di S-26 non hanno un valore proprio: 'other' e 'receipt'. */
export type AttachmentKind = 'photo' | 'receipt' | 'invoice' | 'policy' | 'registration_doc' | 'inspection' | 'other';

export const ATTACHMENT_KINDS: readonly AttachmentKind[] = [
  'photo',
  'receipt',
  'invoice',
  'policy',
  'registration_doc',
  'inspection',
  'other',
];

export const ATTACHMENT_PARENT_TYPES: readonly AttachmentParentType[] = [
  'vehicle',
  'service_record',
  'policy',
  'fuel_log',
  'expense',
  'fluid_check',
  'tyre_set',
];

/** Etichette italiane delle categorie (S-26). */
export const ATTACHMENT_KIND_LABELS: Readonly<Record<AttachmentKind, string>> = {
  photo: 'Foto',
  receipt: 'Ricevuta',
  invoice: 'Fattura',
  policy: 'Assicurazione',
  registration_doc: 'Libretto / Documento Unico',
  inspection: 'Revisione',
  other: 'Altro',
};

export interface Attachment {
  id: string;
  /** L'auto a cui appartiene (anche quando il genitore e' un intervento, una polizza, ...). */
  vehicleId: string;
  parent: AttachmentParent;
  kind: AttachmentKind;
  title: string | null;
  fileName: string;
  /** Percorso relativo nel database ('attachments/<ULID>.<ext>'); per aprire il file usa `attachmentFilePath`. */
  storedPath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  isCover: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Scadenza del documento (F-47) se esiste una scadenza personalizzata collegata e non eliminata. */
  expiresOn: LocalDate | null;
  /** La scadenza personalizzata collegata (per aprirla nella schermata Scadenze). */
  deadlineId: string | null;
}

export interface TrashedAttachment extends Attachment {
  /** Giorno dell'eliminazione definitiva (data di eliminazione + `trash.retentionDays`). */
  purgeOn: LocalDate;
  daysLeft: number;
}

export interface AddAttachmentInput {
  parent: AttachmentParent;
  /** Il file scelto con `d.fs.picker` (copia temporanea gia' dentro l'app). */
  file: PickedFile;
  title?: string | null;
  /** Predefinito: 'photo' per le immagini, 'other' per i PDF. */
  kind?: AttachmentKind;
  /** Scadenza del documento: se presente crea una scadenza personalizzata collegata (6.3.10 punto 3). */
  expiresOn?: LocalDate | null;
}

export interface ListDocumentsOptions {
  /** Cerca nel titolo e nel nome del file (senza distinguere maiuscole). */
  search?: string;
  kind?: AttachmentKind;
}

/** Limiti degli allegati (SPEC F-04: le foto arrivano gia' ridimensionate, lato lungo 2048 px). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_TITLE_LENGTH = 80;
