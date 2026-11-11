// Prova di riproduzione: «Unisci» con un backup piu' vecchio duplica le righe di un intervento modificato.
// updateServiceRecord sostituisce le righe (DELETE + INSERT con nuovi ULID); l'import in modalita' merge fa upsert per id,
// quindi le righe del backup (id vecchi) non esistono piu' in locale e vengono reinserite accanto a quelle nuove.
// Atteso (corretto): l'intervento locale (piu' recente) resta con le sue righe; il totale righe non cambia.
/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, importBackup } from '@/usecases/backup';
import { updateServiceRecord } from '@/usecases/services';
import { populateSampleData, SAMPLE_IDS } from '../../support/sampleData';
import { makeBackupEnv, unwrap, type BackupEnv } from '../../integration/usecases/backup/harness';

let env: BackupEnv;
beforeEach(async () => {
  env = await makeBackupEnv({ nowIso: '2026-10-08T07:30:00.000Z' });
  await populateSampleData(env.db);
});
afterEach(() => env.cleanup());

describe('merge import: righe intervento', () => {
  it('non duplica le righe di un intervento modificato dopo il backup', async () => {
    const exp = unwrap(await exportBackup(env.deps, { appVersion: 't' }));

    // dopo il backup l'utente corregge le righe dell'intervento (nuove righe = nuovi ULID)
    env.clock.set('2026-10-09T07:30:00.000Z');
    const upd = await updateServiceRecord(env.deps, SAMPLE_IDS.service1, {
      lines: [{ lineType: 'part', description: 'Filtro aria', amountCents: 3000 }],
    });
    expect(upd.ok).toBe(true);
    const before = await env.db.all<{ description: string }>('SELECT description FROM service_lines WHERE service_record_id = ?', [SAMPLE_IDS.service1]);
    expect(before.map((r) => r.description)).toEqual(['Filtro aria']);

    // riporto dentro il backup piu' vecchio in modalita' «Unisci» (SPEC: «riportare dentro dati da un backup piu' vecchio»)
    env.clock.set('2026-10-10T07:30:00.000Z');
    const r = await importBackup(env.deps, exp.path, { mode: 'merge' });
    expect(r.ok).toBe(true);

    const after = await env.db.all<{ description: string }>(
      'SELECT description FROM service_lines WHERE service_record_id = ? ORDER BY position, id',
      [SAMPLE_IDS.service1],
    );
    // l'intervento locale e' piu' recente: deve restare con la sola riga «Filtro aria»
    expect(after.map((x) => x.description)).toEqual(['Filtro aria']);
  });
});
