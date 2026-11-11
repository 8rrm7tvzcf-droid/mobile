// Cestino di 30 giorni per tutti i registri e pulizia dello storage all'avvio (F-05).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addAttachment, attachmentFilePath, purgeExpiredRecords, removeAttachment, runStorageMaintenance } from '@/usecases/attachments';
import { deleteVehicle } from '@/usecases/vehicles';
import { setSetting } from '@/usecases/settings';
import { fuelLogRow, insertRow, serviceRow, vehicleRow } from '../../../support/db';
import { ulidOf } from '../../../support/fakes';
import { count, makeBackupEnv, pdfBytes, unwrap, type BackupEnv } from '../backup/harness';

let env: BackupEnv;
let vehicleId: string;
beforeEach(async () => {
  env = await makeBackupEnv(); // oggi 2026-10-08, retention 30 giorni: definitive le eliminazioni fino al 2026-09-08
  vehicleId = await insertRow(env.db, 'vehicles', vehicleRow());
});
afterEach(() => env.cleanup());

const trashed = (iso: string): { deleted_at: string } => ({ deleted_at: iso });

describe('purgeExpiredRecords', () => {
  it('elimina solo le righe nel cestino da 30 giorni o piu, a cascata, e accoda i file degli allegati', async () => {
    const oldLog = await insertRow(env.db, 'fuel_logs', fuelLogRow(vehicleId, trashed('2026-09-08T23:59:00.000Z'))); // 30 giorni esatti: scaduto
    const freshLog = await insertRow(env.db, 'fuel_logs', fuelLogRow(vehicleId, trashed('2026-09-09T00:00:00.000Z'))); // 29 giorni: resta
    const liveLog = await insertRow(env.db, 'fuel_logs', fuelLogRow(vehicleId));

    const oldService = await insertRow(env.db, 'service_records', serviceRow(vehicleId));
    await insertRow(env.db, 'service_lines', {
      id: ulidOf(401), service_record_id: oldService, position: 0, line_type: 'part', description: 'Filtro', amount_cents: 1000,
      created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-01T00:00:00.000Z',
    });
    const att = unwrap(await addAttachment(env.deps, { parent: { type: 'service_record', id: oldService }, file: await env.pick('fattura.pdf', pdfBytes(1), 'application/pdf') }));
    const file = attachmentFilePath(env.dirs, att.storedPath) as string;
    await env.db.run(`UPDATE service_records SET deleted_at = '2026-08-01T10:00:00.000Z' WHERE id = ?`, [oldService]); // ora nel cestino

    const at = '2026-03-01T00:00:00.000Z';
    // categorie dell'utente: una libera (si elimina), una usata da una spesa nel cestino (resta)
    await insertRow(env.db, 'expense_categories', { id: ulidOf(410), name_it: 'Libera', is_system: 0, created_at: at, updated_at: at, deleted_at: '2026-07-01T00:00:00.000Z' });
    await insertRow(env.db, 'expense_categories', { id: ulidOf(411), name_it: 'Usata', is_system: 0, created_at: at, updated_at: at, deleted_at: '2026-07-01T00:00:00.000Z' });
    await insertRow(env.db, 'expenses', {
      id: ulidOf(412), vehicle_id: vehicleId, spent_on: '2026-08-01', category_id: ulidOf(411), amount_cents: 500, created_at: at, updated_at: at, deleted_at: '2026-09-20T00:00:00.000Z',
    });
    await insertRow(env.db, 'workshops', { id: ulidOf(420), name: 'Vecchia officina', created_at: at, updated_at: at, deleted_at: '2026-07-01T00:00:00.000Z' });

    const r = await purgeExpiredRecords(env.deps);
    expect(r.byTable).toEqual({ fuel_logs: 1, service_records: 1, workshops: 1, expense_categories: 1 });
    expect(r.total).toBe(4);
    expect(await count(env.db, 'fuel_logs', `id = '${oldLog}'`)).toBe(0);
    expect(await count(env.db, 'fuel_logs', `id IN ('${freshLog}', '${liveLog}')`)).toBe(2);
    expect(await count(env.db, 'service_records')).toBe(0);
    expect(await count(env.db, 'service_lines')).toBe(0); // a cascata
    expect(await count(env.db, 'attachments')).toBe(0); // a cascata
    expect(await env.files.exists(file)).toBe(false); // file rimosso dalla coda
    expect(await count(env.db, 'pending_file_deletions')).toBe(0);
    expect(await count(env.db, 'expense_categories', `id = '${ulidOf(410)}'`)).toBe(0);
    expect(await count(env.db, 'expense_categories', `id = '${ulidOf(411)}'`)).toBe(1);
    expect(await count(env.db, 'expenses')).toBe(1);
    expect(env.events.some((e) => e.type === 'data-changed' && e.scope === 'fuel')).toBe(true);
    expect(env.events.some((e) => e.type === 'data-changed' && e.scope === 'service')).toBe(true);

    expect(await purgeExpiredRecords(env.deps)).toEqual({ total: 0, byTable: {} }); // idempotente
  });

  it('rispetta trash.retentionDays e toglie il legame documento -> scadenza dei promemoria eliminati', async () => {
    const doc = unwrap(
      await addAttachment(env.deps, { parent: { type: 'vehicle', id: vehicleId }, file: await env.pick('a.pdf', pdfBytes(2), 'application/pdf'), expiresOn: '2027-01-01' }),
    );
    unwrap(await removeAttachment(env.deps, doc.id)); // allegato e scadenza nel cestino
    unwrap(await setSetting(env.deps, 'trash.retentionDays', 10));
    env.clock.set('2026-10-18T07:30:00.000Z');
    expect((await purgeExpiredRecords(env.deps)).byTable).toEqual({ reminders: 1 });
    expect(await count(env.db, 'app_settings', `key LIKE 'doc.expiry.%'`)).toBe(0); // il promemoria non c'e' piu': il legame cade
    expect(await count(env.db, 'attachments', `id = '${doc.id}'`)).toBe(1); // l'allegato e' scaduto per conto suo (purgeExpiredAttachments)
  });
});

describe('runStorageMaintenance', () => {
  it('svuota il cestino scaduto (auto, registri, allegati), la coda dei file e la cartella temporanea', async () => {
    const old = await insertRow(env.db, 'vehicles', vehicleRow({ plate: 'OLD0001' }));
    const oldVehicleAtt = unwrap(await addAttachment(env.deps, { parent: { type: 'vehicle', id: old }, file: await env.pick('v.pdf', pdfBytes(3), 'application/pdf') }));
    unwrap(await deleteVehicle(env.deps, old));
    await env.db.run(`UPDATE vehicles SET deleted_at = '2026-08-01T00:00:00.000Z' WHERE id = ?`, [old]);
    const trashedAtt = unwrap(await addAttachment(env.deps, { parent: { type: 'vehicle', id: vehicleId }, file: await env.pick('t.pdf', pdfBytes(4), 'application/pdf') }));
    const keptAtt = unwrap(await addAttachment(env.deps, { parent: { type: 'vehicle', id: vehicleId }, file: await env.pick('k.pdf', pdfBytes(5), 'application/pdf') }));
    unwrap(await removeAttachment(env.deps, trashedAtt.id));
    await env.db.run(`UPDATE attachments SET deleted_at = '2026-08-02T00:00:00.000Z' WHERE id = ?`, [trashedAtt.id]);
    await insertRow(env.db, 'fuel_logs', fuelLogRow(vehicleId, trashed('2026-08-03T00:00:00.000Z')));
    await env.files.write(`${env.dirs.temp}/MyGarage-CSV-2026-10-01.zip`, new Uint8Array([1]));
    await env.db.run(`INSERT INTO pending_file_deletions (stored_path) VALUES ('attachments/gia-sparito.jpg')`);

    const report = await runStorageMaintenance(env.deps);
    expect(report).toEqual({ vehiclesPurged: 1, recordsPurged: 1, attachmentsPurged: 1, pendingFilesRemoved: expect.any(Number), tempFilesRemoved: 1, errors: [] });
    expect(await count(env.db, 'vehicles', `id = '${old}'`)).toBe(0);
    expect(await env.files.exists(attachmentFilePath(env.dirs, oldVehicleAtt.storedPath) as string)).toBe(false);
    expect(await env.files.exists(attachmentFilePath(env.dirs, trashedAtt.storedPath) as string)).toBe(false);
    expect(await env.files.exists(attachmentFilePath(env.dirs, keptAtt.storedPath) as string)).toBe(true);
    expect(await count(env.db, 'pending_file_deletions')).toBe(0);
    expect(await env.files.list(env.dirs.temp)).toEqual([]);

    expect(await runStorageMaintenance(env.deps)).toEqual({ vehiclesPurged: 0, recordsPurged: 0, attachmentsPurged: 0, pendingFilesRemoved: 0, tempFilesRemoved: 0, errors: [] });
  });

  it('un passo che fallisce non ferma gli altri e finisce in errors', async () => {
    await env.files.write(`${env.dirs.temp}/x.tmp`, new Uint8Array([1]));
    const broken = { ...env.deps, db: { ...env.db, transaction: () => Promise.reject(new Error('database bloccato')) } };
    const report = await runStorageMaintenance(broken as never);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('registri nel cestino: database bloccato');
    expect(report.tempFilesRemoved).toBe(1);
  });
});
