// Accesso SQL agli allegati (SQL a mano dentro i casi d'uso) e collegamento documento -> scadenza personalizzata.
import type { LocalDate } from '@/domain/dates';
import type { SqlDatabase, SqlValue } from '@/domain/ports';
import type { Attachment, AttachmentKind, AttachmentParent, AttachmentParentType } from './types';

export interface AttachmentRow {
  id: string;
  owner_vehicle_id: string;
  service_record_id: string | null;
  policy_id: string | null;
  fuel_log_id: string | null;
  expense_id: string | null;
  fluid_check_id: string | null;
  tyre_set_id: string | null;
  kind: AttachmentKind;
  title: string | null;
  file_name: string;
  stored_path: string;
  thumb_path: string | null;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  is_cover: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const ATTACHMENT_COLUMNS =
  'id, owner_vehicle_id, service_record_id, policy_id, fuel_log_id, expense_id, fluid_check_id, tyre_set_id, kind, title, file_name, ' +
  'stored_path, thumb_path, mime_type, size_bytes, sha256, is_cover, created_at, updated_at, deleted_at';

/** Colonna di `attachments` e tabella del genitore, per ogni tipo di genitore diverso dall'auto. */
export const PARENT_COLUMN: Readonly<Record<Exclude<AttachmentParentType, 'vehicle'>, string>> = {
  service_record: 'service_record_id',
  policy: 'policy_id',
  fuel_log: 'fuel_log_id',
  expense: 'expense_id',
  fluid_check: 'fluid_check_id',
  tyre_set: 'tyre_set_id',
};

export const PARENT_TABLE: Readonly<Record<Exclude<AttachmentParentType, 'vehicle'>, string>> = {
  service_record: 'service_records',
  policy: 'insurance_policies',
  fuel_log: 'fuel_logs',
  expense: 'expenses',
  fluid_check: 'fluid_checks',
  tyre_set: 'tyre_sets',
};

/**
 * Condizione SQL (sulla tabella `attachments`): il genitore dell'allegato, se non e' l'auto, non e' nel cestino. Un documento
 * di un intervento, rifornimento, spesa o polizza eliminati non si elenca finche' il genitore non torna (come backup, CSV e
 * `resolveOwnerVehicle`, che trattano il genitore nel cestino come inesistente).
 */
export const PARENT_NOT_TRASHED = (Object.keys(PARENT_COLUMN) as (keyof typeof PARENT_COLUMN)[])
  .map(
    (type) =>
      `(attachments.${PARENT_COLUMN[type]} IS NULL OR EXISTS (SELECT 1 FROM ${PARENT_TABLE[type]} p WHERE p.id = attachments.${PARENT_COLUMN[type]} AND p.deleted_at IS NULL))`,
  )
  .join(' AND ');

export function parentOf(r: AttachmentRow): AttachmentParent {
  if (r.service_record_id) return { type: 'service_record', id: r.service_record_id };
  if (r.policy_id) return { type: 'policy', id: r.policy_id };
  if (r.fuel_log_id) return { type: 'fuel_log', id: r.fuel_log_id };
  if (r.expense_id) return { type: 'expense', id: r.expense_id };
  if (r.fluid_check_id) return { type: 'fluid_check', id: r.fluid_check_id };
  if (r.tyre_set_id) return { type: 'tyre_set', id: r.tyre_set_id };
  return { type: 'vehicle', id: r.owner_vehicle_id };
}

/** L'auto proprietaria del genitore (se il genitore esiste e non e' nel cestino), altrimenti null. */
export async function resolveOwnerVehicle(db: SqlDatabase, parent: AttachmentParent): Promise<string | null> {
  if (parent.type === 'vehicle') {
    const v = await db.get<{ id: string }>('SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [parent.id]);
    return v?.id ?? null;
  }
  const table = PARENT_TABLE[parent.type];
  const row = await db.get<{ vehicle_id: string }>(
    `SELECT t.vehicle_id AS vehicle_id FROM ${table} t JOIN vehicles v ON v.id = t.vehicle_id
     WHERE t.id = ? AND t.deleted_at IS NULL AND v.deleted_at IS NULL`,
    [parent.id],
  );
  return row?.vehicle_id ?? null;
}

export interface ExpiryLink {
  deadlineId: string;
  expiresOn: LocalDate | null;
}

export function toAttachment(r: AttachmentRow, link?: ExpiryLink): Attachment {
  return {
    id: r.id,
    vehicleId: r.owner_vehicle_id,
    parent: parentOf(r),
    kind: r.kind,
    title: r.title,
    fileName: r.file_name,
    storedPath: r.stored_path,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    isCover: r.is_cover === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    expiresOn: link?.expiresOn ?? null,
    deadlineId: link?.deadlineId ?? null,
  };
}

export function loadAttachmentRow(db: SqlDatabase, id: string, includeTrashed = false): Promise<AttachmentRow | undefined> {
  return db.get<AttachmentRow>(
    `SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE id = ?${includeTrashed ? '' : ' AND deleted_at IS NULL'}`,
    [id],
  );
}

// ------------------------------------------------------------------ collegamento documento -> scadenza
// Lo schema non ha una colonna di scadenza sugli allegati: la scadenza di un documento (F-47) e' una scadenza
// personalizzata (promemoria manuale) e il legame sta in app_settings ('doc.expiry.<ULID allegato>' = ULID promemoria).
// Il legame viaggia nei backup insieme alle impostazioni e si ripulisce se allegato o promemoria spariscono.

export const EXPIRY_KEY_PREFIX = 'doc.expiry.';
export const expiryKey = (attachmentId: string): string => `${EXPIRY_KEY_PREFIX}${attachmentId}`;

const CHUNK = 200;

/** Scadenze collegate agli allegati indicati (solo promemoria non eliminati). */
export async function loadExpiries(db: SqlDatabase, attachmentIds: readonly string[]): Promise<Map<string, ExpiryLink>> {
  const out = new Map<string, ExpiryLink>();
  for (let i = 0; i < attachmentIds.length; i += CHUNK) {
    const ids = attachmentIds.slice(i, i + CHUNK);
    const keys = ids.map(expiryKey);
    const links = await db.all<{ key: string; value: string }>(
      `SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => '?').join(',')})`,
      keys,
    );
    const byReminder = new Map<string, string>();
    for (const l of links) {
      try {
        const v: unknown = JSON.parse(l.value);
        if (typeof v === 'string') byReminder.set(v, l.key.slice(EXPIRY_KEY_PREFIX.length));
      } catch {
        // valore corrotto: si ignora
      }
    }
    if (byReminder.size === 0) continue;
    const rids = [...byReminder.keys()];
    const rows = await db.all<{ id: string; due_on: string | null }>(
      `SELECT id, due_on FROM reminders WHERE deleted_at IS NULL AND id IN (${rids.map(() => '?').join(',')})`,
      rids as SqlValue[],
    );
    for (const r of rows) {
      const attachmentId = byReminder.get(r.id);
      if (attachmentId) out.set(attachmentId, { deadlineId: r.id, expiresOn: r.due_on });
    }
  }
  return out;
}

const UPSERT_SETTING = `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;

export async function linkExpiry(db: SqlDatabase, attachmentId: string, reminderId: string, nowIso: string): Promise<void> {
  await db.run(UPSERT_SETTING, [expiryKey(attachmentId), JSON.stringify(reminderId), nowIso]);
}

export async function unlinkExpiry(db: SqlDatabase, attachmentId: string): Promise<void> {
  await db.run('DELETE FROM app_settings WHERE key = ?', [expiryKey(attachmentId)]);
}

/** Il promemoria collegato (anche se eliminato o chiuso), oppure undefined. */
export async function readLinkedReminder(
  db: SqlDatabase,
  attachmentId: string,
): Promise<{ id: string; status: 'open' | 'done' | 'skipped'; due_on: string | null; deleted_at: string | null } | undefined> {
  const link = await db.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [expiryKey(attachmentId)]);
  if (!link) return undefined;
  let rid: unknown;
  try {
    rid = JSON.parse(link.value);
  } catch {
    return undefined;
  }
  if (typeof rid !== 'string') return undefined;
  return db.get('SELECT id, status, due_on, deleted_at FROM reminders WHERE id = ?', [rid]);
}

/** Toglie i legami documento -> scadenza il cui allegato o promemoria non esiste piu' (dopo un'importazione o una pulizia del cestino). */
export async function cleanupDanglingExpiryLinks(db: SqlDatabase): Promise<void> {
  await db.exec(
    `DELETE FROM app_settings WHERE key GLOB '${EXPIRY_KEY_PREFIX}*'
       AND (substr(key, ${EXPIRY_KEY_PREFIX.length + 1}) NOT IN (SELECT id FROM attachments)
            OR NOT EXISTS (SELECT 1 FROM reminders r WHERE r.id = json_extract(app_settings.value, '$')))`,
  );
}
