// Le schermate di backup, documenti e cestino messe alla prova con i casi d'uso veri (database in memoria, file su disco):
// la logica di presentazione dice le cose giuste con i dati veri e i gesti dell'utente (scegli, aggiungi, rimuovi, ripristina) funzionano.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE_IDS } from '../../support/sampleData';
import { makeBackupEnv, pdfBytes, jpegBytes, seedGarage, type BackupEnv, type Garage } from '../../integration/usecases/backup/harness';
import { openAttachment, pickAndAdd } from '@/ui/hooks/attachments';
import type { QueryDeps } from '@/ui/hooks/useQuery';
import { it as italian } from '@/ui/i18n/it';
import {
  backupRowSubtitle,
  backupStatusView,
  canMerge,
  describeBackupError,
  exportSummary,
  importSummary,
  previewLines,
  wipeOutcome,
} from '@/ui/logic/backupView';
import { documentTitle, groupDocuments } from '@/ui/logic/documentsView';
import {
  listAttachments,
  listTrashedAttachments,
  listVehicleDocuments,
  removeAttachment,
  restoreAttachment,
} from '@/usecases/attachments';
import { exportBackup, getBackupStatus, importBackup, inspectBackup, wipeAllData } from '@/usecases/backup';
import { listTrashedVehicles, restoreVehicle } from '@/usecases/vehicles';

let env: BackupEnv;
let g: Garage;
const ui = (): QueryDeps => ({ ...env.deps, scheduler: env.scheduler }) as unknown as QueryDeps;

beforeEach(async () => {
  env = await makeBackupEnv();
  g = await seedGarage(env);
});
afterEach(() => env.cleanup());

describe('documenti: scegli e aggiungi', () => {
  it('un PDF scelto diventa un documento dell\'auto con categoria, titolo e scadenza, e compare nel gruppo giusto', async () => {
    const file = await env.pick('assicurazione.pdf', pdfBytes(21), 'application/pdf');
    env.deps.fs.picker.pickDocument = async () => file;
    const res = await pickAndAdd(ui(), 'pdf', {
      parent: { type: 'vehicle', id: g.vehicleId },
      kind: 'policy',
      title: 'Polizza 2026',
      expiresOn: '2027-01-31',
    });
    expect(res.status).toBe('added');
    const docs = await listVehicleDocuments(env.deps, g.vehicleId);
    const groups = groupDocuments(docs);
    expect(groups.map((x) => x.kind)).toEqual(['registration_doc', 'policy', 'invoice']);
    const policy = groups.find((x) => x.kind === 'policy')?.items[0];
    expect(policy && documentTitle(policy)).toBe('Polizza 2026');
    expect(policy?.expiresOn).toBe('2027-01-31');
  });

  it('una foto dalla galleria o dalla fotocamera si salva come allegato dell\'intervento', async () => {
    env.deps.fs.picker.pickImage = async ({ camera }) => env.pick(camera ? 'scatto.jpg' : 'galleria.jpg', jpegBytes(camera ? 31 : 32), 'image/jpeg');
    const camera = await pickAndAdd(ui(), 'camera', { parent: { type: 'service_record', id: g.serviceId }, kind: 'invoice' });
    const gallery = await pickAndAdd(ui(), 'gallery', { parent: { type: 'service_record', id: g.serviceId }, kind: 'invoice' });
    expect([camera.status, gallery.status]).toEqual(['added', 'added']);
    const list = await listAttachments(env.deps, { type: 'service_record', id: g.serviceId });
    expect(list.map((a) => a.fileName).sort()).toEqual(['fattura.pdf', 'galleria.jpg', 'scatto.jpg']);
  });

  it('se l\'utente annulla non succede niente; se il selettore non parte, un messaggio in italiano', async () => {
    const before = (await listVehicleDocuments(env.deps, g.vehicleId)).length;
    env.deps.fs.picker.pickDocument = async () => null;
    expect(await pickAndAdd(ui(), 'pdf', { parent: { type: 'vehicle', id: g.vehicleId } })).toEqual({ status: 'cancelled' });
    env.deps.fs.picker.pickImage = async () => {
      throw new Error('camera not available: ENOENT');
    };
    expect(await pickAndAdd(ui(), 'camera', { parent: { type: 'vehicle', id: g.vehicleId } })).toEqual({ status: 'error', message: italian.documents.pickFailed });
    expect((await listVehicleDocuments(env.deps, g.vehicleId)).length).toBe(before);
  });

  it('un file che non e\' una foto o un PDF viene rifiutato con una frase chiara', async () => {
    const file = await env.pick('note.txt', new TextEncoder().encode('solo testo'), 'text/plain');
    env.deps.fs.picker.pickDocument = async () => file;
    const res = await pickAndAdd(ui(), 'pdf', { parent: { type: 'vehicle', id: g.vehicleId } });
    expect(res).toMatchObject({ status: 'error' });
    expect(res.status === 'error' && res.message).toContain('Formato non supportato');
  });

  it('apri/condividi passa il file vero al foglio di condivisione; se il file manca lo dice', async () => {
    const shared: { path: string; mime: string; title: string }[] = [];
    env.deps.fs.sharer.shareFile = async (path, mime, title) => void shared.push({ path, mime, title });
    expect(await openAttachment(ui(), g.invoice)).toBeNull();
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ mime: 'application/pdf', title: 'Fattura tagliando' });
    expect(await env.files.exists(shared[0]?.path ?? '')).toBe(true);

    await env.files.remove(shared[0]?.path ?? '');
    expect(await openAttachment(ui(), g.invoice)).toBe(italian.documents.fileMissing);
    env.deps.fs.sharer.shareFile = async () => {
      throw new Error('boom');
    };
    expect(await openAttachment(ui(), g.registration)).toBe(italian.errors.generic);
  });
});

describe('cestino', () => {
  it('un documento rimosso va nel cestino con i giorni rimasti e si ripristina (Annulla)', async () => {
    const res = await removeAttachment(env.deps, g.invoice.id);
    expect(res.ok).toBe(true);
    expect((await listAttachments(env.deps, { type: 'service_record', id: g.serviceId })).length).toBe(0);
    const trashed = await listTrashedAttachments(env.deps);
    expect(trashed).toHaveLength(1);
    expect(trashed[0]?.daysLeft).toBe(30);
    expect(italian.trash.daysLeft(trashed[0]?.daysLeft ?? 0)).toBe('Restano ancora 30 giorni');
    expect((await restoreAttachment(env.deps, g.invoice.id)).ok).toBe(true);
    expect(await listTrashedAttachments(env.deps)).toHaveLength(0);
  });

  it('l\'auto eliminata e\' nel cestino e si ripristina', async () => {
    const vehicles = await listTrashedVehicles(env.deps);
    expect(vehicles.map((v) => v.id)).toEqual([g.trashedVehicleId]);
    expect(vehicles[0]?.displayName).toBe('Vecchia Auto');
    expect((await restoreVehicle(env.deps, g.trashedVehicleId)).ok).toBe(true);
    expect(await listTrashedVehicles(env.deps)).toHaveLength(0);
  });
});

describe('backup: stato, esportazione, ripristino', () => {
  it('prima del backup lo stato avverte, dopo e\' "oggi" e la riga delle impostazioni lo dice', async () => {
    const today = env.deps.clock.todayLocal();
    const before = await getBackupStatus(env.deps);
    expect(backupStatusView(before, today)).toMatchObject({ title: italian.backup.never, tone: 'warning' });
    expect(backupRowSubtitle(before, today)).toBe(italian.backup.rowSubtitleNever);

    const exported = await exportBackup(env.deps, { appVersion: '1.0.0' });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exportSummary(exported.value)[0]).toContain(exported.value.fileName);
    const after = await getBackupStatus(env.deps);
    expect(after.lastBackupAt).not.toBeNull();
    expect(backupStatusView(after, today).title).toMatch(/^Ultimo backup: (oggi|ieri) alle \d{2}:\d{2}$|^Ultimo backup: il /);
    expect(backupStatusView(after, today).tone).toBe('ok');
    expect(after.needsReminder).toBe(false);
  });

  it('il file del backup scelto mostra l\'anteprima, poi "Unisci" e "Sostituisci" danno i numeri del risultato', async () => {
    const exported = await exportBackup(env.deps, { appVersion: '1.0.0' });
    if (!exported.ok) throw new Error('backup non riuscito');
    const preview = await inspectBackup(env.deps, exported.value.path);
    if (!preview.ok) throw new Error('anteprima non riuscita');
    const lines = previewLines(preview.value);
    expect(lines[0]).toContain('1 auto');
    expect(lines.some((l) => l.startsWith('Creato con la versione 1.0.0'))).toBe(true);
    expect(canMerge(preview.value)).toBe(true);

    const merged = await importBackup(env.deps, exported.value.path, { mode: 'merge' });
    expect(merged.ok).toBe(true);
    if (merged.ok) expect(importSummary(merged.value)[0]).toMatch(/^Inseriti \d+, aggiornati \d+, mantenuti quelli già presenti \d+\.$/);

    const replaced = await importBackup(env.deps, exported.value.path, { mode: 'replace' });
    expect(replaced.ok).toBe(true);
    if (replaced.ok) expect(importSummary(replaced.value).at(-1)).toBe(italian.backup.resultSafety);
  });

  it('un file qualunque o un backup troppo nuovo danno errori in italiano semplice', async () => {
    const junk = await env.pick('foto.jpg', jpegBytes(5), 'image/jpeg');
    const res = await inspectBackup(env.deps, junk.uri);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const text = describeBackupError(res.error);
      expect(text).toMatch(/non è un backup di MyGarage|danneggiato|non riesco/i);
      expect(text).not.toMatch(/ZIP archive|unzip|fflate|undefined|stack/i);
    }
    const missing = await inspectBackup(env.deps, `${env.root}/non-esiste.zip`);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(describeBackupError(missing.error)).toBe(italian.backup.errors['SOURCE_UNREADABLE']);
  });
});

describe('cancella tutti i dati', () => {
  it('dopo la cancellazione la verifica e\' completa: si puo\' tornare al benvenuto, e non restano auto ne\' documenti', async () => {
    const report = await wipeAllData({ ...env.deps, scheduler: env.scheduler });
    expect(wipeOutcome(report)).toEqual({ done: true, warnings: [] });
    expect(await listVehicleDocuments(env.deps, SAMPLE_IDS.vehicle1)).toEqual([]);
    expect(await listTrashedVehicles(env.deps)).toEqual([]);
    const status = await getBackupStatus(env.deps);
    expect(status.hasData).toBe(false);
    expect(backupStatusView(status, env.deps.clock.todayLocal()).detail).toBe(italian.backup.noDataHint);
  });
});
