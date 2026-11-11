// Manutenzione all'avvio (passo 4): cestino, coda dei file da cancellare, retention della telemetria.
/// <reference types="node" />
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTelemetryRetention,
  processPendingFileDeletions,
  purgeTrash,
  runDataMaintenance,
} from '@/data/maintenance/maintenance';
import { createSettingsRepository } from '@/data/repositories/settingsRepository';
import type { FileStore } from '@/domain/ports';
import { fuelLogRow, insertRow, nextId, odometerRow, openBootedDb, vehicleRow, type TestDb } from '../../support/db';
import { createNodeFileStore, makeTempDir } from '../../support/nodeFileStore';

const NOW = '2026-10-08T07:30:00.000Z';
const base = { created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' };
const count = async (t: TestDb, table: string): Promise<number> =>
  (await t.db.get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))?.n ?? -1;

describe('purgeTrash (cestino di 30 giorni)', () => {
  it('elimina definitivamente solo cio che e nel cestino da piu di N giorni, con cascata e coda dei file', async () => {
    const t = await openBootedDb();
    const { db } = t;
    const old = '2026-09-01T00:00:00.000Z'; // 37 giorni prima
    const recent = '2026-09-28T00:00:00.000Z'; // 10 giorni prima

    // veicolo cancellato da 37 giorni, con figli e un allegato con miniatura
    const a = await insertRow(db, 'vehicles', vehicleRow({ deleted_at: old }));
    const fa = await insertRow(db, 'fuel_logs', fuelLogRow(a));
    await insertRow(db, 'odometer_readings', odometerRow(a, '2026-08-01', 100, { source: 'fuel', fuel_log_id: fa }));
    await insertRow(db, 'attachments', {
      id: nextId(), owner_vehicle_id: a, kind: 'photo', file_name: 'a.jpg', stored_path: 'attachments/a.jpg',
      thumb_path: 'attachments/a_t.jpg', mime_type: 'image/jpeg', size_bytes: 1, sha256: 'a'.repeat(64), ...base,
    });
    // veicolo cancellato da 10 giorni: resta
    const b = await insertRow(db, 'vehicles', vehicleRow({ deleted_at: recent }));
    // veicolo attivo con un rifornimento cancellato da 37 giorni (via) e uno da 10 (resta) e uno attivo
    const c = await insertRow(db, 'vehicles', vehicleRow());
    await insertRow(db, 'fuel_logs', fuelLogRow(c, { deleted_at: old }));
    await insertRow(db, 'fuel_logs', fuelLogRow(c, { deleted_at: recent }));
    await insertRow(db, 'fuel_logs', fuelLogRow(c));
    // categorie dell'utente cancellate da 37 giorni: una senza spese (via), una con spese (resta)
    const free = nextId();
    const used = nextId();
    await insertRow(db, 'expense_categories', { id: free, name_it: 'Libera', is_system: 0, deleted_at: old, ...base });
    await insertRow(db, 'expense_categories', { id: used, name_it: 'Usata', is_system: 0, deleted_at: old, ...base });
    await insertRow(db, 'expenses', { id: nextId(), vehicle_id: c, spent_on: '2026-08-01', category_id: used, amount_cents: 100, ...base });

    const summary = await purgeTrash(db, { nowIso: NOW, retentionDays: 30 });

    expect(summary).toEqual({ fuel_logs: 1, vehicles: 1, expense_categories: 1 });
    expect(await db.get('SELECT id FROM vehicles WHERE id = ?', [a])).toBeUndefined();
    expect(await db.get('SELECT id FROM vehicles WHERE id = ?', [b])).toEqual({ id: b });
    expect(await count(t, 'odometer_readings')).toBe(0); // cascata dal veicolo A
    expect((await db.all('SELECT id FROM fuel_logs WHERE vehicle_id = ?', [c])).length).toBe(2); // 10 giorni + attivo
    expect(await db.get('SELECT id FROM expense_categories WHERE id = ?', [free])).toBeUndefined();
    expect(await db.get('SELECT id FROM expense_categories WHERE id = ?', [used])).toEqual({ id: used });
    expect((await db.all<{ stored_path: string }>('SELECT stored_path FROM pending_file_deletions ORDER BY id')).map((r) => r.stored_path).sort()).toEqual([
      'attachments/a.jpg', 'attachments/a_t.jpg',
    ]);
    expect(await purgeTrash(db, { nowIso: NOW, retentionDays: 30 })).toEqual({}); // idempotente
  });

  it('il confine e preciso: esattamente N giorni resta, un millisecondo oltre va via', async () => {
    const t = await openBootedDb();
    const { db } = t;
    const exactly = await insertRow(db, 'vehicles', vehicleRow({ deleted_at: '2026-09-08T07:30:00.000Z' })); // 30 giorni esatti
    const over = await insertRow(db, 'vehicles', vehicleRow({ deleted_at: '2026-09-08T07:29:59.999Z' })); // 30 giorni e 1 ms
    await purgeTrash(db, { nowIso: NOW, retentionDays: 30 });
    expect(await db.get('SELECT id FROM vehicles WHERE id = ?', [exactly])).toEqual({ id: exactly });
    expect(await db.get('SELECT id FROM vehicles WHERE id = ?', [over])).toBeUndefined();
    // un'altra retention
    await purgeTrash(db, { nowIso: NOW, retentionDays: 0 });
    expect(await count(t, 'vehicles')).toBe(0);
  });

  it('non tocca le categorie di sistema ne gli altri dati', async () => {
    const t = await openBootedDb();
    await purgeTrash(t.db, { nowIso: '2099-01-01T00:00:00.000Z', retentionDays: 0 });
    expect(await count(t, 'expense_categories')).toBe(13);
    expect(await count(t, 'service_templates')).toBe(27);
    expect(await count(t, 'app_settings')).toBe(17);
  });
});

describe('processPendingFileDeletions', () => {
  let tmp: ReturnType<typeof makeTempDir> | undefined;
  afterEach(() => {
    tmp?.cleanup();
    tmp = undefined;
  });

  it('rimuove i file e svuota la coda; un file gia sparito non e un errore', async () => {
    tmp = makeTempDir();
    const files = createNodeFileStore(tmp.dir);
    const { db } = await openBootedDb();
    await files.write('attachments/a.jpg', Uint8Array.from([1]));
    await files.write('attachments/a_t.jpg', Uint8Array.from([2]));
    await db.run(`INSERT INTO pending_file_deletions (stored_path) VALUES ('attachments/a.jpg'), ('attachments/a_t.jpg'), ('attachments/mai-esistito.jpg')`);
    const res = await processPendingFileDeletions(db, files);
    expect(res).toEqual({ removed: 3, failed: 0 });
    expect(existsSync(join(tmp.dir, 'attachments/a.jpg'))).toBe(false);
    expect(existsSync(join(tmp.dir, 'attachments/a_t.jpg'))).toBe(false);
    expect((await db.all('SELECT * FROM pending_file_deletions')).length).toBe(0);
  });

  it('un file che non si riesce a rimuovere resta in coda e si riprova al giro dopo', async () => {
    const { db } = await openBootedDb();
    await db.run(`INSERT INTO pending_file_deletions (stored_path) VALUES ('attachments/bloccato.jpg'), ('attachments/ok.jpg')`);
    let blocked = true;
    const files: Pick<FileStore, 'exists' | 'remove'> = {
      exists: async () => true,
      remove: async (p) => {
        if (blocked && p.endsWith('bloccato.jpg')) throw new Error('permesso negato');
      },
    };
    expect(await processPendingFileDeletions(db, files)).toEqual({ removed: 1, failed: 1 });
    expect((await db.all<{ stored_path: string }>('SELECT stored_path FROM pending_file_deletions')).map((r) => r.stored_path)).toEqual(['attachments/bloccato.jpg']);
    blocked = false;
    expect(await processPendingFileDeletions(db, files)).toEqual({ removed: 1, failed: 0 });
    expect((await db.all('SELECT * FROM pending_file_deletions')).length).toBe(0);
  });
});

describe('applyTelemetryRetention', () => {
  async function addSession(t: TestDb, seq: number, startedAt: string, seconds: number): Promise<void> {
    const v = (await t.db.get<{ id: string }>('SELECT id FROM vehicles LIMIT 1'))?.id ?? (await insertRow(t.db, 'vehicles', vehicleRow()));
    await insertRow(t.db, 'obd_sessions', { id: nextId(), seq, vehicle_id: v, kind: 'live', started_at: startedAt, ...base });
    await t.db.transaction(async (tx) => {
      for (let s = 0; s < seconds; s++) {
        await tx.run('INSERT INTO telemetry_samples (session_seq, pid, t_ms, value) VALUES (?, 268, ?, ?)', [seq, s * 1000, s]);
        await tx.run('INSERT INTO telemetry_samples (session_seq, pid, t_ms, value) VALUES (?, 269, ?, ?)', [seq, s * 1000, 100]);
      }
    });
  }

  it('i campioni piu vecchi di N giorni diventano rollup a 60 s (min/max/media) e la sessione e marcata', async () => {
    const t = await openBootedDb();
    await addSession(t, 1, '2026-08-29T10:00:00.000Z', 150); // 40 giorni fa
    await addSession(t, 2, '2026-10-03T10:00:00.000Z', 30); // 5 giorni fa
    const res = await applyTelemetryRetention(t.db, { nowIso: NOW, rawRetentionDays: 30, maxMb: 50 });
    expect(res).toEqual({ prunedSessions: 1, rollupRows: 6, deletedSamples: 300 });

    const rollups = await t.db.all<{ pid: number; bucket: number; n: number; v_min: number; v_max: number; v_avg: number }>(
      'SELECT pid, bucket, n, v_min, v_max, v_avg FROM telemetry_rollups WHERE session_seq = 1 ORDER BY pid, bucket',
    );
    expect(rollups).toEqual([
      { pid: 268, bucket: 0, n: 60, v_min: 0, v_max: 59, v_avg: 29.5 },
      { pid: 268, bucket: 1, n: 60, v_min: 60, v_max: 119, v_avg: 89.5 },
      { pid: 268, bucket: 2, n: 30, v_min: 120, v_max: 149, v_avg: 134.5 },
      { pid: 269, bucket: 0, n: 60, v_min: 100, v_max: 100, v_avg: 100 },
      { pid: 269, bucket: 1, n: 60, v_min: 100, v_max: 100, v_avg: 100 },
      { pid: 269, bucket: 2, n: 30, v_min: 100, v_max: 100, v_avg: 100 },
    ]);
    expect((await t.db.get<{ n: number }>('SELECT count(*) AS n FROM telemetry_samples WHERE session_seq = 1'))?.n).toBe(0);
    expect((await t.db.get<{ n: number }>('SELECT count(*) AS n FROM telemetry_samples WHERE session_seq = 2'))?.n).toBe(60); // recente: intatta
    expect(await t.db.get('SELECT samples_pruned_at FROM obd_sessions WHERE seq = 1')).toEqual({ samples_pruned_at: NOW });
    expect(await t.db.get('SELECT samples_pruned_at FROM obd_sessions WHERE seq = 2')).toEqual({ samples_pruned_at: null });

    // idempotente
    expect(await applyTelemetryRetention(t.db, { nowIso: NOW, rawRetentionDays: 30, maxMb: 50 })).toEqual({ prunedSessions: 0, rollupRows: 0, deletedSamples: 0 });
  });

  it('oltre telemetry.maxMb si riducono prima le sessioni piu vecchie, finche si rientra', async () => {
    const t = await openBootedDb();
    for (const [seq, started] of [[1, '2026-10-01T10:00:00.000Z'], [2, '2026-10-02T10:00:00.000Z'], [3, '2026-10-03T10:00:00.000Z']] as const) {
      await addSession(t, seq, started, 50); // 100 campioni a sessione
    }
    // limite = 150 righe (150 * 25 byte = 0,00375 MB): 300 righe -> si tolgono le due sessioni piu vecchie
    const res = await applyTelemetryRetention(t.db, { nowIso: NOW, rawRetentionDays: 30, maxMb: 0.00375 });
    expect(res.prunedSessions).toBe(2);
    expect(res.deletedSamples).toBe(200);
    const left = await t.db.all<{ session_seq: number; n: number }>('SELECT session_seq, count(*) AS n FROM telemetry_samples GROUP BY session_seq');
    expect(left).toEqual([{ session_seq: 3, n: 100 }]);
    expect((await t.db.get<{ n: number }>('SELECT count(*) AS n FROM telemetry_rollups WHERE session_seq IN (1, 2)'))?.n).toBe(2 * 2); // 1 bucket x 2 PID x 2 sessioni
  });

  it('un rollup gia presente (esecuzione interrotta) non crea doppioni', async () => {
    const t = await openBootedDb();
    await addSession(t, 1, '2026-08-01T10:00:00.000Z', 10);
    await t.db.run('INSERT INTO telemetry_rollups (session_seq, pid, bucket, n, v_min, v_max, v_avg) VALUES (1, 268, 0, 1, 0, 0, 0)');
    await applyTelemetryRetention(t.db, { nowIso: NOW, rawRetentionDays: 30, maxMb: 50 });
    expect(await t.db.get('SELECT n FROM telemetry_rollups WHERE session_seq = 1 AND pid = 268 AND bucket = 0')).toEqual({ n: 10 });
  });
});

describe('runDataMaintenance (passo 4 dell\'avvio)', () => {
  it('legge i parametri da app_settings ed esegue i tre passi', async () => {
    const t = await openBootedDb();
    const { db } = t;
    const settings = createSettingsRepository(db, t.clock);
    await settings.set('trash.retentionDays', 7);
    await insertRow(db, 'vehicles', vehicleRow({ deleted_at: '2026-10-01T00:00:00.000Z' })); // 7 giorni e mezzo fa: via
    await insertRow(db, 'vehicles', vehicleRow({ deleted_at: '2026-10-05T00:00:00.000Z' })); // resta
    const removedPaths: string[] = [];
    await db.run(`INSERT INTO pending_file_deletions (stored_path) VALUES ('attachments/x.jpg')`);
    const report = await runDataMaintenance(db, {
      clock: { nowIso: () => NOW },
      files: { exists: async () => true, remove: async (p) => void removedPaths.push(p) },
    });
    expect(report.errors).toEqual([]);
    expect(report.trash).toEqual({ vehicles: 1 });
    expect(report.files).toEqual({ removed: 1, failed: 0 });
    expect(report.telemetry).toEqual({ prunedSessions: 0, rollupRows: 0, deletedSamples: 0 });
    expect(removedPaths).toEqual(['attachments/x.jpg']);
    expect(await count(t, 'vehicles')).toBe(1);
  });

  it('un passo che fallisce finisce in errors e non impedisce gli altri; senza FileStore la coda resta', async () => {
    const t = await openBootedDb();
    const { db } = t;
    await db.run(`INSERT INTO pending_file_deletions (stored_path) VALUES ('attachments/x.jpg')`);
    await db.exec('DROP TABLE telemetry_rollups'); // fa fallire solo il passo della telemetria (se ci sono sessioni vecchie)
    await insertRow(db, 'vehicles', vehicleRow({ deleted_at: '2020-01-01T00:00:00.000Z' }));
    const v = await insertRow(db, 'vehicles', vehicleRow());
    await insertRow(db, 'obd_sessions', { id: nextId(), seq: 1, vehicle_id: v, kind: 'live', started_at: '2020-01-01T00:00:00.000Z', ...base });
    await db.run('INSERT INTO telemetry_samples (session_seq, pid, t_ms, value) VALUES (1, 268, 0, 1)');
    const report = await runDataMaintenance(db, { clock: { nowIso: () => NOW } });
    expect(report.trash).toEqual({ vehicles: 1 });
    expect(report.files).toBeUndefined();
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatch(/^telemetria: .*telemetry_rollups/);
    expect(await count(t, 'pending_file_deletions')).toBe(1); // intatta
  });
});
