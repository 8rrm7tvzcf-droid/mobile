// Allegati e documenti (SPEC F-04, F-05, F-47): API pubblica del modulo.
export {
  addAttachment,
  getAttachment,
  getAttachmentFilePath,
  listAttachments,
  listTrashedAttachments,
  listVehicleDocuments,
  purgeAttachment,
  purgeExpiredAttachments,
  removeAttachment,
  renameAttachment,
  restoreAttachment,
  setDocumentExpiry,
} from './attachments';
export { runPendingFileDeletions } from './pending';
export { purgeExpiredRecords, runStorageMaintenance } from './trash';
export type { StorageMaintenanceReport } from './trash';
export type { PendingDeletionResult } from './pending';
export { ATTACHMENT_PREFIX, attachmentFilePath, isSafeStoredPath } from './paths';
export { sniffMime, EXTENSION_OF_MIME } from './sniff';
export type { AllowedMime } from './sniff';
export {
  ATTACHMENT_KINDS,
  ATTACHMENT_KIND_LABELS,
  ATTACHMENT_PARENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_TITLE_LENGTH,
} from './types';
export type {
  AddAttachmentInput,
  Attachment,
  AttachmentKind,
  AttachmentParent,
  AttachmentParentType,
  ListDocumentsOptions,
  TrashedAttachment,
} from './types';
