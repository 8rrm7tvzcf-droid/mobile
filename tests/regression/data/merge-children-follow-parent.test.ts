// DATA-1 (casi oltre alla prova originale): in «Unisci» le righe figlie senza cancellazione morbida (service_lines,
// insurance_coverages) seguono il genitore. Vince il genitore locale: restano le sue righe (nessun duplicato, nessuna
// garanzia risorta, nessun UNIQUE(policy_id, code) violato). Vince il genitore del backup: le righe locali si sostituiscono.
/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, importBackup } from '@/usecases/backup';
import { updatePolicy } from '@/usecases/insurance';
import { populateSampleData, SAMPLE_IDS } from '../../support/sampleData';
import { makeBackupEnv, unwrap, type BackupEnv } from '../../integration/usecases/backup/harness';

let env: BackupEnv;
beforeEach(async () => {
  env = await makeBackupEnv({ nowIso: '2026-10-08T07:30:00.000Z' });
  await populateSampleData(env.db);
});
afterEach(() => env.cleanup());

const codes = async (policyId: string): Promise<string[]> =>
  (await env.db.all<{ code: string }>('SELECT code FROM insurance_coverages WHERE policy_id = ? ORDER BY code', [policyId])).map((r) => r.code);

describe('merge import: le righe figlie seguono il genitore', () => {
  it('una garanzia tolta dopo il backup non risorge e una aggiunta non viola UNIQUE(policy_id, code)', async () => {
    const exp = unwrap(await exportBackup(env.deps, { appVersion: 't' }));
    expect(await codes(SAMPLE_IDS.policy1)).toEqual(['rca']);

    env.clock.set('2026-10-09T07:30:00.000Z');
    // l'utente sostituisce la garanzia: 'rca' via, 'kasko' dentro (nuovo ULID)
    const upd = await updatePolicy(env.deps, { policyId: SAMPLE_IDS.policy1, coverages: [{ code: 'kasko' }] });
    expect(upd.ok).toBe(true);
    expect(await codes(SAMPLE_IDS.policy1)).toEqual(['kasko']);

    env.clock.set('2026-10-10T07:30:00.000Z');
    const r = unwrap(await importBackup(env.deps, exp.path, { mode: 'merge' }));
    expect(await codes(SAMPLE_IDS.policy1)).toEqual(['kasko']);
    expect(r.byTable['insurance_coverages']).toEqual({ inserted: 0, updated: 0, keptLocal: 1 });
  });

  it('se il genitore del backup e\' piu\' recente le righe locali del genitore si sostituiscono con quelle del backup', async () => {
    const exp = unwrap(await exportBackup(env.deps, { appVersion: 't' }));
    // stato locale «vecchio»: intervento fermo a un istante precedente al backup, con una riga diversa (altro ULID)
    await env.db.run(`UPDATE service_records SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`, [SAMPLE_IDS.service1]);
    await env.db.run('DELETE FROM service_lines WHERE service_record_id = ?', [SAMPLE_IDS.service1]);
    await env.db.run(
      `INSERT INTO service_lines (id, service_record_id, position, line_type, description, amount_cents) VALUES ('01TESTID000000000000000999', ?, 0, 'part', 'Riga locale vecchia', 100)`,
      [SAMPLE_IDS.service1],
    );

    env.clock.set('2026-10-10T07:30:00.000Z');
    const r = unwrap(await importBackup(env.deps, exp.path, { mode: 'merge' }));
    const lines = await env.db.all<{ description: string }>('SELECT description FROM service_lines WHERE service_record_id = ?', [SAMPLE_IDS.service1]);
    expect(lines.map((l) => l.description)).toEqual(['Olio motore']);
    expect(r.byTable['service_lines']).toEqual({ inserted: 1, updated: 0, keptLocal: 0 });
    expect(await env.db.all('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('a parita\' di updated_at restano le righe locali e una seconda unione non cambia nulla', async () => {
    const exp = unwrap(await exportBackup(env.deps, { appVersion: 't' }));
    const first = unwrap(await importBackup(env.deps, exp.path, { mode: 'merge' }));
    expect({ inserted: first.inserted, updated: first.updated }).toEqual({ inserted: 0, updated: 0 });
    expect(await env.db.get('SELECT COUNT(*) AS n FROM service_lines')).toEqual({ n: 1 });
    expect(await codes(SAMPLE_IDS.policy1)).toEqual(['rca']);
  });
});
