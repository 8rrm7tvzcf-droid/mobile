// Allegati e documenti (SPEC F-04, F-05, F-47, 6.3.10): copia dei file nello storage privato dell'app, righe in
// `attachments` con UN solo genitore, cestino di 30 giorni, eliminazione definitiva con coda dei file.
// Il ridimensionamento delle foto (lato lungo 2048 px, JPEG ~80%) avviene nel selettore (src/platform): qui arrivano
// gia' pronte. I file non toccano mai la galleria del telefono.
import { addDays, compareDates, diffDays, isValidDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/dates';
import { fail, invalid, ok } from '../context';
import type { Deps, FileDeps, UsecaseResult } from '../context';
import { addCustomDeadline, deleteDeadline, reconcileVehicle, updateCustomDeadline } from '../deadlines';
import { readSetting } from '../settings';
import { ATTACHMENT_PREFIX, attachmentFilePath } from './paths';
import { runPendingFileDeletions } from './pending';
import { cleanFileName, EXTENSION_OF_MIME, sniffMime } from './sniff';
import {
  ATTACHMENT_COLUMNS,
  PARENT_COLUMN,
  PARENT_NOT_TRASHED,
  linkExpiry,
  loadAttachmentRow,
  loadExpiries,
  readLinkedReminder,
  resolveOwnerVehicle,
  toAttachment,
  unlinkExpiry,
} from './store';
import type { AttachmentRow } from './store';
import {
  ATTACHMENT_KINDS,
  ATTACHMENT_KIND_LABELS,
  ATTACHMENT_PARENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_TITLE_LENGTH,
} from './types';
import type {
  AddAttachmentInput,
  Attachment,
  AttachmentKind,
  AttachmentParent,
  ListDocumentsOptions,
  TrashedAttachment,
} from './types';

const TOO_BIG = `Il file è troppo grande: il massimo è ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`;

class ParentGone extends Error {
  constructor() {
    super('PARENT_GONE');
  }
}

const deadlineTitle = (title: string | null, kind: AttachmentKind): string =>
  `Scadenza: ${title?.trim() ? title.trim() : ATTACHMENT_KIND_LABELS[kind]}`.slice(0, 120);

const deadlineCategory = (kind: AttachmentKind): 'legal' | 'other' =>
  kind === 'registration_doc' || kind === 'policy' || kind === 'inspection' ? 'legal' : 'other';

async function hydrate(d: Pick<Deps, 'db'>, rows: AttachmentRow[]): Promise<Attachment[]> {
  const links = await loadExpiries(d.db, rows.map((r) => r.id));
  return rows.map((r) => toAttachment(r, links.get(r.id)));
}

// ------------------------------------------------------------------ aggiunta

/**
 * Copia il file scelto in `d.fs.dirs.attachments` con nome `<ULID>.<ext>`, ne calcola SHA-256 e dimensione e scrive la
 * riga in `attachments` (un solo genitore). Valida il contenuto (immagini e PDF, riconosciuti dai byte, non dal nome) e la
 * dimensione. Se `expiresOn` e' presente crea una scadenza personalizzata collegata al documento (F-47).
 */
export async function addAttachment(d: FileDeps, input: AddAttachmentInput): Promise<UsecaseResult<Attachment>> {
  const { parent, file } = input;
  if (!parent || !ATTACHMENT_PARENT_TYPES.includes(parent.type) || typeof parent.id !== 'string') {
    return invalid('parent', "Non so a cosa allegare il file.");
  }
  const title = input.title?.trim() ? input.title.trim() : null;
  if (title !== null && title.length > MAX_TITLE_LENGTH) return invalid('title', `Il titolo può avere al massimo ${MAX_TITLE_LENGTH} caratteri.`);
  if (input.kind !== undefined && !ATTACHMENT_KINDS.includes(input.kind)) return invalid('kind', 'La categoria del documento non è valida.');
  const expiresOn = input.expiresOn ?? null;
  if (expiresOn !== null && !isValidDate(expiresOn)) return invalid('expiresOn', 'La data di scadenza non è valida.');
  if (file.size !== null && file.size > MAX_ATTACHMENT_BYTES) return invalid('file', TOO_BIG);
  if (file.size === 0) return invalid('file', 'Il file è vuoto.');
  if ((await resolveOwnerVehicle(d.db, parent)) === null) return fail({ code: 'ITEM_NOT_FOUND' });

  let bytes: Uint8Array;
  try {
    bytes = await d.fs.files.read(file.uri);
  } catch {
    return invalid('file', 'Non riesco a leggere il file scelto. Riprova.');
  }
  if (bytes.length === 0) return invalid('file', 'Il file è vuoto.');
  if (bytes.length > MAX_ATTACHMENT_BYTES) return invalid('file', TOO_BIG);
  const mime = sniffMime(bytes);
  if (mime === null) return invalid('file', 'Formato non supportato: scegli una foto (JPEG, PNG, WebP, HEIC) o un PDF.');

  const ext = EXTENSION_OF_MIME[mime];
  const kind: AttachmentKind = input.kind ?? (mime === 'application/pdf' ? 'other' : 'photo');
  if (kind === 'photo' && mime === 'application/pdf') return invalid('kind', 'Un PDF non può essere una foto.');
  const id = d.ids.ulid();
  const storedPath = `${ATTACHMENT_PREFIX}${id}.${ext}`;
  const target = attachmentFilePath(d.fs.dirs, storedPath) as string; // il percorso e' costruito qui: e' sicuro
  const sha256 = await d.fs.hash.sha256Hex(bytes);
  const fileName = cleanFileName(file.name, ext);

  await d.fs.files.write(target, bytes);
  const removeTarget = (): Promise<void> => d.fs.files.remove(target).catch(() => undefined);
  if ((await d.fs.files.sha256(target).catch(() => '')) !== sha256) {
    await removeTarget();
    return invalid('file', 'La copia del file non è riuscita (spazio insufficiente?). Riprova.');
  }

  const now = d.clock.nowIso();
  let vehicleId: string;
  try {
    vehicleId = await d.db.transaction(async (tx) => {
      const owner = await resolveOwnerVehicle(tx, parent);
      if (owner === null) throw new ParentGone();
      const parentCol = parent.type === 'vehicle' ? null : PARENT_COLUMN[parent.type];
      await tx.run(
        `INSERT INTO attachments (id, owner_vehicle_id${parentCol ? `, ${parentCol}` : ''}, kind, title, file_name, stored_path,
           mime_type, size_bytes, sha256, created_at, updated_at)
         VALUES (?, ?${parentCol ? ', ?' : ''}, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, owner, ...(parentCol ? [parent.id] : []), kind, title, fileName, storedPath, mime, bytes.length, sha256, now, now],
      );
      return owner;
    }, 'exclusive');
  } catch (e) {
    await removeTarget();
    if (e instanceof ParentGone) return fail({ code: 'ITEM_NOT_FOUND' });
    throw e;
  }

  if (expiresOn !== null) {
    const r = await addCustomDeadline(d, {
      vehicleId,
      title: deadlineTitle(title, kind),
      dueOn: expiresOn,
      category: deadlineCategory(kind),
      notes: `Documento: ${title ?? fileName}`,
    });
    if (!r.ok) {
      // la scadenza non e' valida: il documento non resta a meta' (la riga esce, il file va in coda di cancellazione)
      await d.db.transaction((tx) => tx.run('DELETE FROM attachments WHERE id = ?', [id]), 'exclusive');
      await runPendingFileDeletions(d);
      return r;
    }
    await linkExpiry(d.db, id, r.value.reminderId, now);
  }

  await removeTempCopy(d, file.uri);
  d.events.emit({ type: 'data-changed', scope: 'vehicles', vehicleId });
  const saved = await getAttachment(d, id);
  return saved ? ok(saved) : fail({ code: 'ITEM_NOT_FOUND' });
}

/** La copia temporanea del selettore non serve piu': si toglie solo se sta nella cartella temporanea dell'app. */
async function removeTempCopy(d: FileDeps, uri: string): Promise<void> {
  const temp = d.fs.dirs.temp.replace(/[\\/]+$/, '');
  if (temp !== '' && uri.startsWith(`${temp}/`)) await d.fs.files.remove(uri).catch(() => undefined);
}

// ------------------------------------------------------------------ letture

export async function getAttachment(
  d: Pick<Deps, 'db'>,
  id: string,
  opts: { includeTrashed?: boolean } = {},
): Promise<Attachment | null> {
  const row = await loadAttachmentRow(d.db, id, opts.includeTrashed === true);
  if (!row) return null;
  return (await hydrate(d, [row]))[0] ?? null;
}

/** Gli allegati di UN genitore, dal piu' recente. Per `vehicle` solo quelli attaccati direttamente all'auto. */
export async function listAttachments(d: Pick<Deps, 'db'>, parent: AttachmentParent): Promise<Attachment[]> {
  if (!ATTACHMENT_PARENT_TYPES.includes(parent.type)) return [];
  const where =
    parent.type === 'vehicle'
      ? `owner_vehicle_id = ? AND ${Object.values(PARENT_COLUMN)
          .map((c) => `${c} IS NULL`)
          .join(' AND ')}`
      : `${PARENT_COLUMN[parent.type]} = ?`;
  const rows = await d.db.all<AttachmentRow>(
    `SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE ${where} AND deleted_at IS NULL AND ${PARENT_NOT_TRASHED} ORDER BY created_at DESC, id DESC`,
    [parent.id],
  );
  return hydrate(d, rows);
}

/**
 * Tutti i documenti di un'auto (S-26), qualunque sia il genitore, con ricerca per titolo o nome del file. Il
 * raggruppamento per categoria (`kind`) lo fa la UI.
 */
export async function listVehicleDocuments(
  d: Pick<Deps, 'db'>,
  vehicleId: string,
  opts: ListDocumentsOptions = {},
): Promise<Attachment[]> {
  const conds = ['owner_vehicle_id = ?', 'deleted_at IS NULL', PARENT_NOT_TRASHED];
  const params: (string | number)[] = [vehicleId];
  if (opts.kind !== undefined) {
    conds.push('kind = ?');
    params.push(opts.kind);
  }
  const q = opts.search?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(`(COALESCE(title, '') LIKE ? ESCAPE '\\' OR file_name LIKE ? ESCAPE '\\')`);
    params.push(like, like);
  }
  const rows = await d.db.all<AttachmentRow>(
    `SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE ${conds.join(' AND ')} ORDER BY created_at DESC, id DESC`,
    params,
  );
  return hydrate(d, rows);
}

/** Percorso reale del file di un allegato (per anteprima e condivisione con `d.fs.sharer`); null se l'allegato non esiste o il file manca. */
export async function getAttachmentFilePath(d: FileDeps, id: string): Promise<string | null> {
  const row = await loadAttachmentRow(d.db, id, true);
  if (!row) return null;
  const p = attachmentFilePath(d.fs.dirs, row.stored_path);
  return p !== null && (await d.fs.files.exists(p)) ? p : null;
}

// ------------------------------------------------------------------ modifica

/** Rinomina il documento (titolo, al massimo 80 caratteri; vuoto = nessun titolo). Aggiorna anche la scadenza collegata. */
export async function renameAttachment(d: Deps, id: string, title: string | null): Promise<UsecaseResult<Attachment>> {
  const t = title?.trim() ? title.trim() : null;
  if (t !== null && t.length > MAX_TITLE_LENGTH) return invalid('title', `Il titolo può avere al massimo ${MAX_TITLE_LENGTH} caratteri.`);
  const now = d.clock.nowIso();
  const changed = await d.db.transaction(
    async (tx) => (await tx.run('UPDATE attachments SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [t, now, id])).changes,
    'exclusive',
  );
  if (changed === 0) return fail({ code: 'ITEM_NOT_FOUND' });
  const row = (await loadAttachmentRow(d.db, id)) as AttachmentRow;
  const rem = await readLinkedReminder(d.db, id);
  if (rem && rem.deleted_at === null && rem.status === 'open') {
    await updateCustomDeadline(d, rem.id, { title: deadlineTitle(t, row.kind) }); // se non riesce il documento resta rinominato
  }
  d.events.emit({ type: 'data-changed', scope: 'vehicles', vehicleId: row.owner_vehicle_id });
  return ok((await getAttachment(d, id)) as Attachment);
}

/** Imposta, cambia o toglie (`null`) la scadenza di un documento: crea, aggiorna o elimina la scadenza personalizzata collegata. */
export async function setDocumentExpiry(d: Deps, id: string, expiresOn: LocalDate | null): Promise<UsecaseResult<Attachment>> {
  if (expiresOn !== null && !isValidDate(expiresOn)) return invalid('expiresOn', 'La data di scadenza non è valida.');
  const row = await loadAttachmentRow(d.db, id);
  if (!row) return fail({ code: 'ITEM_NOT_FOUND' });
  const rem = await readLinkedReminder(d.db, id);
  const live = rem && rem.deleted_at === null ? rem : undefined;

  if (expiresOn === null) {
    if (live && live.status === 'open') {
      const r = await deleteDeadline(d, { reminderId: live.id });
      if (!r.ok) return r;
    }
    await unlinkExpiry(d.db, id);
  } else if (live && live.status === 'open') {
    const r = await updateCustomDeadline(d, live.id, { dueOn: expiresOn });
    if (!r.ok) return r;
  } else {
    const r = await addCustomDeadline(d, {
      vehicleId: row.owner_vehicle_id,
      title: deadlineTitle(row.title, row.kind),
      dueOn: expiresOn,
      category: deadlineCategory(row.kind),
      notes: `Documento: ${row.title ?? row.file_name}`,
    });
    if (!r.ok) return r;
    await linkExpiry(d.db, id, r.value.reminderId, d.clock.nowIso());
  }
  d.events.emit({ type: 'data-changed', scope: 'vehicles', vehicleId: row.owner_vehicle_id });
  return ok((await getAttachment(d, id)) as Attachment);
}

// ------------------------------------------------------------------ cestino ed eliminazione

/**
 * Elimina un allegato. Di norma finisce nel cestino per `trash.retentionDays` giorni (il file resta, si puo' ripristinare)
 * e restituisce il giorno dell'eliminazione definitiva. Con `permanent: true` (o da `purgeAttachment`) elimina subito la riga:
 * il trigger accoda il file in `pending_file_deletions` nella stessa transazione e il file si rimuove subito dopo il commit
 * (se l'app si chiude nel mezzo, `runPendingFileDeletions` lo toglie al prossimo avvio).
 */
export async function removeAttachment(
  d: FileDeps,
  id: string,
  opts: { permanent?: boolean } = {},
): Promise<UsecaseResult<{ purgeOn: LocalDate | null }>> {
  const row = await loadAttachmentRow(d.db, id, opts.permanent === true);
  if (!row) return fail({ code: 'ITEM_NOT_FOUND' });
  const rem = await readLinkedReminder(d.db, id);
  const liveReminder = rem !== undefined && rem.deleted_at === null;

  if (opts.permanent === true) {
    await d.db.transaction(async (tx) => {
      await tx.run('DELETE FROM attachments WHERE id = ?', [id]); // trg_attachments_gc accoda i file
      await unlinkExpiry(tx, id);
    }, 'exclusive');
    if (liveReminder && rem) await deleteDeadline(d, { reminderId: rem.id });
    await runPendingFileDeletions(d);
    d.events.emit({ type: 'data-changed', scope: 'vehicles', vehicleId: row.owner_vehicle_id });
    return ok({ purgeOn: null });
  }

  const now = d.clock.nowIso();
  const retention = await readSetting(d.db, 'trash.retentionDays');
  await d.db.transaction(
    (tx) => tx.run('UPDATE attachments SET deleted_at = ?, updated_at = ?, is_cover = 0 WHERE id = ? AND deleted_at IS NULL', [now, now, id]),
    'exclusive',
  );
  if (liveReminder && rem) await deleteDeadline(d, { reminderId: rem.id }); // il legame resta: il ripristino riporta la scadenza
  d.events.emit({ type: 'data-changed', scope: 'vehicles', vehicleId: row.owner_vehicle_id });
  return ok({ purgeOn: addDays(now.slice(0, 10), retention) });
}

/** «Elimina definitivamente» un allegato (dal cestino o direttamente). */
export function purgeAttachment(d: FileDeps, id: string): Promise<UsecaseResult<{ purgeOn: LocalDate | null }>> {
  return removeAttachment(d, id, { permanent: true });
}

/** Ripristina un allegato dal cestino (e la sua scadenza, se aveva una). */
export async function restoreAttachment(d: Deps, id: string): Promise<UsecaseResult<Attachment>> {
  const row = await loadAttachmentRow(d.db, id, true);
  if (!row || row.deleted_at === null) return fail({ code: 'ITEM_NOT_FOUND' });
  const now = d.clock.nowIso();
  const rem = await readLinkedReminder(d.db, id);
  await d.db.transaction(async (tx) => {
    await tx.run('UPDATE attachments SET deleted_at = NULL, updated_at = ? WHERE id = ?', [now, id]);
    if (rem && rem.deleted_at !== null) {
      await tx.run('UPDATE reminders SET deleted_at = NULL, updated_at = ? WHERE id = ?', [now, rem.id]);
    }
  }, 'exclusive');
  if (rem && rem.deleted_at !== null) await reconcileVehicle(d, row.owner_vehicle_id);
  d.events.emit({ type: 'data-changed', scope: 'vehicles', vehicleId: row.owner_vehicle_id });
  return ok((await getAttachment(d, id)) as Attachment);
}

/** Gli allegati nel cestino, dal piu' recente, con il giorno dell'eliminazione definitiva. */
export async function listTrashedAttachments(d: Pick<Deps, 'db' | 'clock'>): Promise<TrashedAttachment[]> {
  const retention = await readSetting(d.db, 'trash.retentionDays');
  const today = d.clock.todayLocal();
  const rows = await d.db.all<AttachmentRow>(
    `SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC`,
  );
  const items = await hydrate(d, rows);
  return items.map((a) => {
    const purgeOn = addDays((a.deletedAt as string).slice(0, 10), retention);
    return { ...a, purgeOn, daysLeft: Math.max(0, diffDays(today, purgeOn)) };
  });
}

/** Elimina definitivamente gli allegati nel cestino da piu' di `trash.retentionDays` giorni. Da chiamare all'avvio. Restituisce quanti. */
export async function purgeExpiredAttachments(d: FileDeps): Promise<number> {
  const trashed = await listTrashedAttachments(d);
  const today = d.clock.todayLocal();
  const expired = trashed.filter((t) => compareDates(t.purgeOn, today) <= 0);
  if (expired.length === 0) return 0;
  await d.db.transaction(async (tx) => {
    for (const a of expired) {
      await tx.run('DELETE FROM attachments WHERE id = ? AND deleted_at IS NOT NULL', [a.id]);
      await unlinkExpiry(tx, a.id);
    }
  }, 'exclusive');
  await runPendingFileDeletions(d);
  d.events.emit({ type: 'data-changed', scope: 'vehicles' });
  return expired.length;
}
