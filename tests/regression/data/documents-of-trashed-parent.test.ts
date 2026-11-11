// Prova di riproduzione: i documenti di un intervento (o rifornimento, spesa, polizza) eliminato restano visibili in «Documenti».
// L'eliminazione manda il genitore nel cestino, ma `listVehicleDocuments` filtra solo `attachments.deleted_at`: la fattura
// allegata a un intervento nel cestino continua a comparire (e a potersi aprire/condividere) nell'elenco dei documenti
// dell'auto, mentre backup, CSV e `resolveOwnerVehicle` trattano il genitore nel cestino come inesistente.
// Atteso (corretto): dopo deleteServiceRecord la fattura non e' piu' nell'elenco; dopo restoreServiceRecord torna.
/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addAttachment, listAttachments, listVehicleDocuments } from '@/usecases/attachments';
import { deleteExpense, restoreExpense } from '@/usecases/expenses';
import { deletePolicy, restorePolicy } from '@/usecases/insurance';
import { deleteServiceRecord, restoreServiceRecord } from '@/usecases/services';
import { ulidOf } from '../../support/fakes';
import { populateSampleData, SAMPLE_IDS } from '../../support/sampleData';
import { makeBackupEnv, pdfBytes, unwrap, type BackupEnv } from '../../integration/usecases/backup/harness';

let env: BackupEnv;
beforeEach(async () => {
  env = await makeBackupEnv();
  await populateSampleData(env.db);
});
afterEach(() => env.cleanup());

describe('Documenti: genitore nel cestino', () => {
  it('non mostra la fattura di un intervento eliminato', async () => {
    const att = unwrap(
      await addAttachment(env.deps, {
        parent: { type: 'service_record', id: SAMPLE_IDS.service1 },
        file: await env.pick('fattura.pdf', pdfBytes(7), 'application/pdf'),
        kind: 'invoice',
        title: 'Fattura da eliminare',
      }),
    );
    expect((await listVehicleDocuments(env.deps, SAMPLE_IDS.vehicle1)).map((a) => a.id)).toContain(att.id);

    expect((await deleteServiceRecord(env.deps, SAMPLE_IDS.service1)).ok).toBe(true);
    expect((await listVehicleDocuments(env.deps, SAMPLE_IDS.vehicle1)).map((a) => a.id)).not.toContain(att.id);

    expect((await restoreServiceRecord(env.deps, SAMPLE_IDS.service1)).ok).toBe(true);
    expect((await listVehicleDocuments(env.deps, SAMPLE_IDS.vehicle1)).map((a) => a.id)).toContain(att.id);
  });

  it('vale anche per polizze e spese: spariscono con il genitore e tornano con il ripristino', async () => {
    const ids = async (): Promise<string[]> => (await listVehicleDocuments(env.deps, SAMPLE_IDS.vehicle1)).map((a) => a.id);
    const onPolicy = unwrap(
      await addAttachment(env.deps, { parent: { type: 'policy', id: SAMPLE_IDS.policy1 }, file: await env.pick('polizza.pdf', pdfBytes(8), 'application/pdf'), kind: 'policy' }),
    );
    const expenseId = ulidOf(60);
    const onExpense = unwrap(
      await addAttachment(env.deps, { parent: { type: 'expense', id: expenseId }, file: await env.pick('ricevuta.pdf', pdfBytes(9), 'application/pdf'), kind: 'receipt' }),
    );
    expect(await ids()).toEqual(expect.arrayContaining([onPolicy.id, onExpense.id]));

    expect((await deletePolicy(env.deps, SAMPLE_IDS.policy1)).ok).toBe(true);
    expect((await deleteExpense(env.deps, expenseId)).ok).toBe(true);
    expect(await ids()).not.toContain(onPolicy.id);
    expect(await ids()).not.toContain(onExpense.id);

    expect((await restorePolicy(env.deps, SAMPLE_IDS.policy1)).ok).toBe(true);
    expect((await restoreExpense(env.deps, expenseId)).ok).toBe(true);
    expect(await ids()).toEqual(expect.arrayContaining([onPolicy.id, onExpense.id]));
  });

  it("anche l'elenco degli allegati del singolo genitore nel cestino e' vuoto", async () => {
    const att = unwrap(
      await addAttachment(env.deps, { parent: { type: 'service_record', id: SAMPLE_IDS.service1 }, file: await env.pick('f.pdf', pdfBytes(3), 'application/pdf'), kind: 'invoice' }),
    );
    expect((await listAttachments(env.deps, { type: 'service_record', id: SAMPLE_IDS.service1 })).map((a) => a.id)).toContain(att.id);
    expect((await deleteServiceRecord(env.deps, SAMPLE_IDS.service1)).ok).toBe(true);
    expect(await listAttachments(env.deps, { type: 'service_record', id: SAMPLE_IDS.service1 })).toEqual([]);
  });
});
