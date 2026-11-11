// Prova di riproduzione: «Elimina definitivamente» un'auto dal cestino lascia i FILE degli allegati su disco.
// SPEC AC-01 punto 4: «"Elimina definitivamente" cancella a cascata righe e file (coda pending_file_deletions svuotata)».
// La schermata Cestino chiama solo purgeVehicle(deps, id): la riga sparisce, il trigger accoda i file, ma nessuno li rimuove
// finche' l'app non viene riavviata (la coda si svuota solo all'avvio). Il libretto/DU e le polizze restano quindi nello
// storage dell'app nonostante il messaggio «cancellati per sempre».
/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addAttachment, attachmentFilePath } from '@/usecases/attachments';
import { removeDemoVehicle } from '@/usecases/demo';
import { deleteVehicle, purgeVehicle } from '@/usecases/vehicles';
import { insertRow, vehicleRow } from '../../support/db';
import { jpegBytes, makeBackupEnv, unwrap, type BackupEnv } from '../../integration/usecases/backup/harness';

let env: BackupEnv;
beforeEach(async () => {
  env = await makeBackupEnv();
});
afterEach(() => env.cleanup());

describe('cestino: eliminazione definitiva di un\'auto', () => {
  it('rimuove anche i file degli allegati, non solo le righe', async () => {
    const vehicleId = await insertRow(env.db, 'vehicles', vehicleRow({ plate: 'REV0002' }));
    const att = unwrap(
      await addAttachment(env.deps, {
        parent: { type: 'vehicle', id: vehicleId },
        file: await env.pick('libretto.jpg', jpegBytes(5), 'image/jpeg'),
        kind: 'registration_doc',
      }),
    );
    const path = attachmentFilePath(env.deps.fs.dirs, att.storedPath) as string;
    expect(await env.files.exists(path)).toBe(true);

    expect((await deleteVehicle(env.deps, vehicleId)).ok).toBe(true);
    // l'utente conferma «Elimina definitivamente» dal cestino: l'unica chiamata che fa la UI e' purgeVehicle
    expect((await purgeVehicle(env.deps, vehicleId)).ok).toBe(true);

    expect((await env.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attachments'))?.n).toBe(0); // la riga e' sparita
    // atteso (AC-01): anche il file e' stato rimosso e la coda e' vuota
    expect(await env.files.exists(path)).toBe(false);
    expect((await env.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM pending_file_deletions'))?.n).toBe(0);
  });
});

describe('auto demo: eliminazione definitiva', () => {
  it('removeDemoVehicle rimuove anche i file degli allegati dell\'auto demo', async () => {
    const vehicleId = await insertRow(env.db, 'vehicles', vehicleRow({ plate: 'DEMO001', is_demo: 1 }));
    const att = unwrap(
      await addAttachment(env.deps, {
        parent: { type: 'vehicle', id: vehicleId },
        file: await env.pick('libretto.jpg', jpegBytes(9), 'image/jpeg'),
        kind: 'registration_doc',
      }),
    );
    const path = attachmentFilePath(env.deps.fs.dirs, att.storedPath) as string;
    expect(await env.files.exists(path)).toBe(true);

    expect((await removeDemoVehicle(env.deps)).ok).toBe(true);
    expect(await env.files.exists(path)).toBe(false);
    expect((await env.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM pending_file_deletions'))?.n).toBe(0);
  });
});
