// Allegati e documenti (F-04, F-05, F-47): copia nello storage privato, un solo genitore, validazione dei file,
// scadenza collegata, cestino di 30 giorni, eliminazione definitiva e coda dei file che sopravvive a un crash.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertRow, serviceRow, vehicleRow } from '../../../support/db';
import {
  addAttachment,
  attachmentFilePath,
  getAttachment,
  getAttachmentFilePath,
  listAttachments,
  listTrashedAttachments,
  listVehicleDocuments,
  MAX_ATTACHMENT_BYTES,
  purgeAttachment,
  purgeExpiredAttachments,
  removeAttachment,
  renameAttachment,
  restoreAttachment,
  runPendingFileDeletions,
  setDocumentExpiry,
} from '@/usecases/attachments';
import { count, errorCode, jpegBytes, makeBackupEnv, pdfBytes, pngBytes, unwrap, type BackupEnv } from '../backup/harness';

let env: BackupEnv;
let vehicleId: string;
beforeEach(async () => {
  env = await makeBackupEnv();
  vehicleId = await insertRow(env.db, 'vehicles', vehicleRow({ nickname: 'Panda di prova' }));
});
afterEach(() => env.cleanup());

const rowOf = (id: string): Promise<Record<string, unknown> | undefined> => env.db.get('SELECT * FROM attachments WHERE id = ?', [id]);

describe('addAttachment', () => {
  it('copia la foto in attachments/ con nome ULID.ext, calcola SHA-256 e dimensione e scrive la riga', async () => {
    const bytes = jpegBytes(3);
    const file = await env.pick('IMG_0001.jpg', bytes, 'image/jpeg');
    const a = unwrap(await addAttachment(env.deps, { parent: { type: 'vehicle', id: vehicleId }, file, title: 'Foto frontale' }));

    expect(a).toMatchObject({
      vehicleId,
      parent: { type: 'vehicle', id: vehicleId },
      kind: 'photo',
      title: 'Foto frontale',
      fileName: 'IMG_0001.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: bytes.length,
      deletedAt: null,
      expiresOn: null,
      deadlineId: null,
    });
    expect(a.storedPath).toBe(`attachments/${a.id}.jpg`);
    expect(a.id).toHaveLength(26);
    const real = attachmentFilePath(env.dirs, a.storedPath) as string;
    expect(real).toBe(`${env.dirs.attachments}/${a.id}.jpg`);
    expect(await env.files.exists(real)).toBe(true);
    expect(new Uint8Array(await env.files.read(real))).toEqual(bytes);
    expect(a.sha256).toBe(await env.deps.fs.hash.sha256Hex(bytes));
    expect(env.events).toContainEqual({ type: 'data-changed', scope: 'vehicles', vehicleId });
    expect(await getAttachmentFilePath(env.deps, a.id)).toBe(real);
  });

  it('un PDF e un allegato di un intervento: un solo genitore e auto proprietaria ricavata dal genitore', async () => {
    const serviceId = await insertRow(env.db, 'service_records', serviceRow(vehicleId));
    const file = await env.pick('fattura.pdf', pdfBytes(1), 'application/pdf');
    const a = unwrap(await addAttachment(env.deps, { parent: { type: 'service_record', id: serviceId }, file, kind: 'invoice' }));
    expect(a).toMatchObject({ vehicleId, parent: { type: 'service_record', id: serviceId }, kind: 'invoice', mimeType: 'application/pdf' });
    expect(a.storedPath.endsWith('.pdf')).toBe(true);
    const row = (await rowOf(a.id)) as Record<string, unknown>;
    expect(row['service_record_id']).toBe(serviceId);
    for (const col of ['policy_id', 'fuel_log_id', 'expense_id', 'fluid_check_id', 'tyre_set_id']) expect(row[col]).toBeNull();
  });

  it('un PDF senza categoria e un allegato con tipo dichiarato sbagliato: conta il contenuto, non il nome', async () => {
    const pdf = unwrap(await addAttachment(env.deps, { parent: { type: 'vehicle', id: vehicleId }, file: await env.pick('doc.bin', pdfBytes(2), 'application/octet-stream') }));
    expect(pdf).toMatchObject({ kind: 'other', mimeType: 'application/pdf', fileName: 'doc.bin' });
    expect(pdf.storedPath.endsWith('.pdf')).toBe(true);
    const png = unwrap(await addAttachment(env.deps, { parent: { type: 'vehicle', id: vehicleId }, file: await env.pick('scan.pdf', pngBytes(), 'application/pdf') }));
    expect(png).toMatchObject({ mimeType: 'image/png', kind: 'photo' });
    expect(png.storedPath.endsWith('.png')).toBe(true);
  });

  it('rifiuta contenuti non ammessi, file vuoti o troppo grandi, e non lascia file ne righe', async () => {
    const parent = { type: 'vehicle' as const, id: vehicleId };
    const text = await env.pick('virus.pdf', new TextEncoder().encode('MZ questo non e un PDF'), 'application/pdf');
    expect(await addAttachment(env.deps, { parent, file: text })).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'file' } });
    const empty = await env.pick('vuoto.jpg', new Uint8Array(0), 'image/jpeg');
    expect(await addAttachment(env.deps, { parent, file: empty })).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'file' } });
    const declaredBig = { ...(await env.pick('grande.jpg', jpegBytes(), 'image/jpeg')), size: MAX_ATTACHMENT_BYTES + 1 };
    expect(await addAttachment(env.deps, { parent, file: declaredBig })).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'file' } });
    const realBig = await env.pick('enorme.jpg', jpegBytes(1, MAX_ATTACHMENT_BYTES), 'image/jpeg');
    expect(await addAttachment(env.deps, { parent, file: { ...realBig, size: null } })).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'file' } });
    const missing = { uri: `${env.root}/nonesiste.jpg`, name: 'x.jpg', mimeType: 'image/jpeg', size: 10 };
    expect(await addAttachment(env.deps, { parent, file: missing })).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'file' } });
    expect(await count(env.db, 'attachments')).toBe(0);
    expect(await env.files.list(env.dirs.attachments)).toEqual([]);
  });

  it('valida genitore, titolo, categoria e data di scadenza', async () => {
    const file = await env.pick('a.jpg', jpegBytes(), 'image/jpeg');
    expect(errorCode(await addAttachment(env.deps, { parent: { type: 'vehicle', id: '01NONESISTENTE00000000000A' }, file }))).toBe('ITEM_NOT_FOUND');
    expect(errorCode(await addAttachment(env.deps, { parent: { type: 'service_record', id: '01NONESISTENTE00000000000A' }, file }))).toBe('ITEM_NOT_FOUND');
    const parent = { type: 'vehicle' as const, id: vehicleId };
    expect(await addAttachment(env.deps, { parent, file, title: 'x'.repeat(81) })).toMatchObject({ ok: false, error: { field: 'title' } });
    expect(await addAttachment(env.deps, { parent, file, kind: 'selfie' as never })).toMatchObject({ ok: false, error: { field: 'kind' } });
    expect(await addAttachment(env.deps, { parent, file, expiresOn: '2026-02-30' })).toMatchObject({ ok: false, error: { field: 'expiresOn' } });
    expect(await addAttachment(env.deps, { parent: { type: 'bogus' as never, id: vehicleId }, file })).toMatchObject({ ok: false, error: { field: 'parent' } });
    const pdf = await env.pick('a.pdf', pdfBytes(), 'application/pdf');
    expect(await addAttachment(env.deps, { parent, file: pdf, kind: 'photo' })).toMatchObject({ ok: false, error: { field: 'kind' } });
    expect(await count(env.db, 'attachments')).toBe(0);
    expect(await env.files.list(env.dirs.attachments)).toEqual([]);
  });

  it('un genitore nel cestino non accetta allegati', async () => {
    await env.db.run(`UPDATE vehicles SET deleted_at = '2026-10-01T00:00:00.000Z' WHERE id = ?`, [vehicleId]);
    const file = await env.pick('a.jpg', jpegBytes(), 'image/jpeg');
    expect(errorCode(await addAttachment(env.deps, { parent: { type: 'vehicle', id: vehicleId }, file }))).toBe('ITEM_NOT_FOUND');
  });

  it('ripulisce il nome del file (niente percorsi) e toglie la copia temporanea del selettore', async () => {
    const tempFile = `${env.dirs.temp}/picked.jpg`;
    await env.files.write(tempFile, jpegBytes(5));
    const a = unwrap(
      await addAttachment(env.deps, {
        parent: { type: 'vehicle', id: vehicleId },
        file: { uri: tempFile, name: '../../etc/passwd.jpg', mimeType: 'image/jpeg', size: null },
      }),
    );
    expect(a.fileName).toBe('passwd.jpg');
    expect(a.storedPath).toBe(`attachments/${a.id}.jpg`);
    expect(await env.files.exists(tempFile)).toBe(false);
  });

  it('con una scadenza crea una scadenza personalizzata collegata (F-47)', async () => {
    const file = await env.pick('libretto.pdf', pdfBytes(7), 'application/pdf');
    const a = unwrap(
      await addAttachment(env.deps, {
        parent: { type: 'vehicle', id: vehicleId },
        file,
        title: 'Assicurazione RCA',
        kind: 'policy',
        expiresOn: '2027-01-15',
      }),
    );
    expect(a.expiresOn).toBe('2027-01-15');
    expect(a.deadlineId).toHaveLength(26);
    const r = (await env.db.get<Record<string, unknown>>('SELECT * FROM reminders WHERE id = ?', [a.deadlineId as string])) as Record<string, unknown>;
    expect(r).toMatchObject({ vehicle_id: vehicleId, origin: 'manual', title: 'Scadenza: Assicurazione RCA', due_on: '2027-01-15', category: 'legal', status: 'open', deleted_at: null });
    expect(env.events.some((e) => e.type === 'data-changed' && e.scope === 'reminders')).toBe(true);
    expect((await getAttachment(env.deps, a.id))?.expiresOn).toBe('2027-01-15');
  });
});

describe('scadenza del documento', () => {
  it('si imposta, si cambia e si toglie', async () => {
    const file = await env.pick('patente.jpg', jpegBytes(2), 'image/jpeg');
    const a = unwrap(await addAttachment(env.deps, { parent: { type: 'vehicle', id: vehicleId }, file, title: 'Libretto', kind: 'registration_doc' }));
    expect(a.expiresOn).toBeNull();

    const withExpiry = unwrap(await setDocumentExpiry(env.deps, a.id, '2027-03-01'));
    expect(withExpiry.expiresOn).toBe('2027-03-01');
    const rid = withExpiry.deadlineId as string;

    const moved = unwrap(await setDocumentExpiry(env.deps, a.id, '2027-06-30'));
    expect(moved.expiresOn).toBe('2027-06-30');
    expect(moved.deadlineId).toBe(rid); // la stessa scadenza, aggiornata
    expect(await count(env.db, 'reminders', `origin = 'manual' AND deleted_at IS NULL`)).toBe(1);

    const cleared = unwrap(await setDocumentExpiry(env.deps, a.id, null));
    expect(cleared).toMatchObject({ expiresOn: null, deadlineId: null });
    expect(await count(env.db, 'reminders', `id = '${rid}' AND deleted_at IS NOT NULL`)).toBe(1);
    expect(await count(env.db, 'app_settings', `key LIKE 'doc.expiry.%'`)).toBe(0);

    expect(await setDocumentExpiry(env.deps, a.id, '2027-13-01')).toMatchObject({ ok: false, error: { field: 'expiresOn' } });
    expect(errorCode(await setDocumentExpiry(env.deps, '01NONESISTENTE00000000000A', '2027-01-01'))).toBe('ITEM_NOT_FOUND');
  });

  it('rinominare il documento aggiorna il titolo della scadenza collegata', async () => {
    const file = await env.pick('a.pdf', pdfBytes(3), 'application/pdf');
    const a = unwrap(await addAttachment(env.deps, { parent: { type: 'vehicle', id: vehicleId }, file, title: 'Polizza', kind: 'policy', expiresOn: '2027-02-01' }));
    const renamed = unwrap(await renameAttachment(env.deps, a.id, '  Polizza Unipol  '));
    expect(renamed.title).toBe('Polizza Unipol');
    const r = await env.db.get<{ title: string }>('SELECT title FROM reminders WHERE id = ?', [a.deadlineId as string]);
    expect(r?.title).toBe('Scadenza: Polizza Unipol');
    expect(unwrap(await renameAttachment(env.deps, a.id, null)).title).toBeNull();
    expect(await renameAttachment(env.deps, a.id, 'x'.repeat(81))).toMatchObject({ ok: false, error: { field: 'title' } });
    expect(errorCode(await renameAttachment(env.deps, '01NONESISTENTE00000000000A', 'x'))).toBe('ITEM_NOT_FOUND');
  });
});

describe('elenchi', () => {
  it('listAttachments e listVehicleDocuments: genitore esatto, tutti i documenti dell auto, ricerca e categoria', async () => {
    const serviceId = await insertRow(env.db, 'service_records', serviceRow(vehicleId));
    const other = await insertRow(env.db, 'vehicles', vehicleRow({ nickname: 'Altra' }));
    const direct = unwrap(await addAttachment(env.deps, { parent: { type: 'vehicle', id: vehicleId }, file: await env.pick('libretto.pdf', pdfBytes(1)), title: 'Libretto di circolazione', kind: 'registration_doc' }));
    env.clock.set('2026-10-09T08:00:00.000Z');
    const onService = unwrap(await addAttachment(env.deps, { parent: { type: 'service_record', id: serviceId }, file: await env.pick('fattura_100%.jpg', jpegBytes(4)), kind: 'invoice' }));
    unwrap(await addAttachment(env.deps, { parent: { type: 'vehicle', id: other }, file: await env.pick('altro.pdf', pdfBytes(9)) }));

    expect((await listAttachments(env.deps, { type: 'vehicle', id: vehicleId })).map((a) => a.id)).toEqual([direct.id]);
    expect((await listAttachments(env.deps, { type: 'service_record', id: serviceId })).map((a) => a.id)).toEqual([onService.id]);
    expect((await listVehicleDocuments(env.deps, vehicleId)).map((a) => a.id)).toEqual([onService.id, direct.id]); // dal piu' recente
    expect((await listVehicleDocuments(env.deps, vehicleId, { kind: 'invoice' })).map((a) => a.id)).toEqual([onService.id]);
    expect((await listVehicleDocuments(env.deps, vehicleId, { search: 'CIRCOLAZ' })).map((a) => a.id)).toEqual([direct.id]);
    expect((await listVehicleDocuments(env.deps, vehicleId, { search: '100%' })).map((a) => a.id)).toEqual([onService.id]); // % non e' un jolly
    expect(await listVehicleDocuments(env.deps, vehicleId, { search: 'inesistente' })).toEqual([]);
    expect(await listAttachments(env.deps, { type: 'bogus' as never, id: 'x' })).toEqual([]);
  });
});

describe('cestino ed eliminazione', () => {
  it('l eliminazione e recuperabile per 30 giorni: il file resta, la scadenza torna con il ripristino', async () => {
    const file = await env.pick('a.pdf', pdfBytes(5), 'application/pdf');
    const a = unwrap(await addAttachment(env.deps, { parent: { type: 'vehicle', id: vehicleId }, file, kind: 'policy', expiresOn: '2027-05-05' }));
    const real = attachmentFilePath(env.dirs, a.storedPath) as string;

    const removed = unwrap(await removeAttachment(env.deps, a.id));
    expect(removed.purgeOn).toBe('2026-11-07');
    expect(await getAttachment(env.deps, a.id)).toBeNull();
    expect(await listVehicleDocuments(env.deps, vehicleId)).toEqual([]);
    expect(await env.files.exists(real)).toBe(true);
    expect(await count(env.db, 'pending_file_deletions')).toBe(0);
    expect(await count(env.db, 'reminders', `id = '${a.deadlineId}' AND deleted_at IS NOT NULL`)).toBe(1);
    const trashed = await listTrashedAttachments(env.deps);
    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toMatchObject({ id: a.id, purgeOn: '2026-11-07', daysLeft: 30 });
    expect(errorCode(await removeAttachment(env.deps, a.id))).toBe('ITEM_NOT_FOUND'); // gia' nel cestino

    const back = unwrap(await restoreAttachment(env.deps, a.id));
    expect(back).toMatchObject({ id: a.id, deletedAt: null, expiresOn: '2027-05-05', deadlineId: a.deadlineId });
    expect(await count(env.db, 'reminders', `id = '${a.deadlineId}' AND deleted_at IS NULL`)).toBe(1);
    expect(errorCode(await restoreAttachment(env.deps, a.id))).toBe('ITEM_NOT_FOUND');
  });

  it('«Elimina definitivamente»: riga e file spariscono, la coda dei file e vuota, il legame con la scadenza cade', async () => {
    const file = await env.pick('a.jpg', jpegBytes(6), 'image/jpeg');
    const a = unwrap(await addAttachment(env.deps, { parent: { type: 'vehicle', id: vehicleId }, file, expiresOn: '2027-05-05' }));
    const real = attachmentFilePath(env.dirs, a.storedPath) as string;
    unwrap(await purgeAttachment(env.deps, a.id));
    expect(await rowOf(a.id)).toBeUndefined();
    expect(await env.files.exists(real)).toBe(false);
    expect(await count(env.db, 'pending_file_deletions')).toBe(0);
    expect(await count(env.db, 'app_settings', `key LIKE 'doc.expiry.%'`)).toBe(0);
    expect(await count(env.db, 'reminders', `id = '${a.deadlineId}' AND deleted_at IS NOT NULL`)).toBe(1);
    expect(errorCode(await purgeAttachment(env.deps, a.id))).toBe('ITEM_NOT_FOUND');
  });

  it('dopo 30 giorni nel cestino l allegato si elimina da solo (da chiamare all avvio)', async () => {
    const a = unwrap(await addAttachment(env.deps, { parent: { type: 'vehicle', id: vehicleId }, file: await env.pick('a.jpg', jpegBytes(7)) }));
    const keep = unwrap(await addAttachment(env.deps, { parent: { type: 'vehicle', id: vehicleId }, file: await env.pick('b.jpg', jpegBytes(8)) }));
    unwrap(await removeAttachment(env.deps, a.id));
    env.clock.set('2026-11-06T07:30:00.000Z');
    expect(await purgeExpiredAttachments(env.deps)).toBe(0); // ancora 1 giorno
    env.clock.set('2026-11-07T07:30:00.000Z');
    expect(await purgeExpiredAttachments(env.deps)).toBe(1);
    expect(await rowOf(a.id)).toBeUndefined();
    expect(await env.files.exists(attachmentFilePath(env.dirs, a.storedPath) as string)).toBe(false);
    expect(await rowOf(keep.id)).toBeDefined();
    expect(await env.files.exists(attachmentFilePath(env.dirs, keep.storedPath) as string)).toBe(true);
  });

  it('la coda dei file sopravvive a un crash: l eliminazione della riga accoda, il file si toglie al prossimo avvio', async () => {
    const a = unwrap(await addAttachment(env.deps, { parent: { type: 'vehicle', id: vehicleId }, file: await env.pick('a.jpg', jpegBytes(1)) }));
    const real = attachmentFilePath(env.dirs, a.storedPath) as string;
    // simula l'eliminazione a cascata (es. purgeVehicle) seguita da un crash prima di rimuovere i file
    await env.db.run('DELETE FROM attachments WHERE id = ?', [a.id]);
    expect(await count(env.db, 'pending_file_deletions')).toBe(1);
    expect(await env.files.exists(real)).toBe(true);

    const r = await runPendingFileDeletions(env.deps);
    expect(r).toEqual({ removed: 1, failed: 0 });
    expect(await env.files.exists(real)).toBe(false);
    expect(await count(env.db, 'pending_file_deletions')).toBe(0);
  });

  it('runPendingFileDeletions non rimuove file ancora in uso ne percorsi non sicuri, e riprova se la rimozione fallisce', async () => {
    const a = unwrap(await addAttachment(env.deps, { parent: { type: 'vehicle', id: vehicleId }, file: await env.pick('a.jpg', jpegBytes(1)) }));
    const real = attachmentFilePath(env.dirs, a.storedPath) as string;
    const outside = `${env.root}/segreto.txt`;
    await env.files.write(outside, new Uint8Array([1, 2, 3]));
    await env.db.run('INSERT INTO pending_file_deletions (stored_path) VALUES (?), (?), (?)', [a.storedPath, 'attachments/../segreto.txt', '/etc/passwd']);
    expect(await runPendingFileDeletions(env.deps)).toEqual({ removed: 0, failed: 0 });
    expect(await env.files.exists(real)).toBe(true); // ancora referenziato
    expect(await env.files.exists(outside)).toBe(true);
    expect(await count(env.db, 'pending_file_deletions')).toBe(0);

    // un errore di rimozione lascia la voce in coda
    await env.db.run('DELETE FROM attachments WHERE id = ?', [a.id]);
    const failing = { ...env.deps, fs: { ...env.deps.fs, files: { ...env.files, remove: async () => Promise.reject(new Error('disco')) } } };
    expect(await runPendingFileDeletions(failing)).toEqual({ removed: 0, failed: 1 });
    expect(await count(env.db, 'pending_file_deletions')).toBe(1);
    expect(await runPendingFileDeletions(env.deps)).toEqual({ removed: 1, failed: 0 });
  });
});
