// Helper dei test di backup, ripristino, esportazione, cancellazione e allegati: database migrato in memoria, cartelle
// temporanee reali (FileStore su node:fs), ZIP con fflate (come in produzione, ma qui dietro la porta ZipCodec),
// SHA-256 di Node, bus di eventi che registra, scheduler finto.
/// <reference types="node" />
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import type { DomainEvent, FileServices, HashService, PickedFile, ZipCodec } from '@/domain/ports';
import type { FileDeps, UsecaseResult } from '@/usecases/context';
import { FIXED_NOW, sequentialIds, type TestClock } from '../../../support/fakes';
import { openBootedDb } from '../../../support/db';
import { createNodeFileStore, makeTempDir } from '../../../support/nodeFileStore';
import type { NodeSqlDatabase } from '../../../support/nodeSqlite';
import { FakeScheduler } from '../notifications/fakeScheduler';

export const fflateZip: ZipCodec = {
  zip: (entries) => zipSync(Object.fromEntries(entries.map((e) => [e.name, e.bytes])), { level: 6 }),
  unzip: (bytes) => Object.entries(unzipSync(bytes)).map(([name, b]) => ({ name, bytes: b })),
};

export const nodeHash: HashService = {
  sha256Hex: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
};

export interface BackupEnv {
  deps: FileDeps;
  db: NodeSqlDatabase;
  clock: TestClock;
  events: DomainEvent[];
  scheduler: FakeScheduler;
  files: ReturnType<typeof createNodeFileStore>;
  root: string;
  dirs: { attachments: string; backups: string; temp: string };
  /** Scrive un file di prova nella cartella «cache» del selettore e lo restituisce come PickedFile. */
  pick(name: string, bytes: Uint8Array, mimeType?: string | null): Promise<PickedFile>;
  cleanup(): void;
}

/** Un ambiente completo. `idStart` evita collisioni tra gli ID di due ambienti usati nello stesso test. */
export async function makeBackupEnv(opts: { nowIso?: string; idStart?: number } = {}): Promise<BackupEnv> {
  const booted = await openBootedDb();
  const nowIso = opts.nowIso ?? FIXED_NOW;
  booted.clock.set(nowIso);
  const tmp = makeTempDir('mygarage-backup-');
  const dirs = { attachments: join(tmp.dir, 'attachments'), backups: join(tmp.dir, 'backups'), temp: join(tmp.dir, 'temp') };
  const files = createNodeFileStore(tmp.dir);
  const fs: FileServices = {
    files,
    zip: fflateZip,
    hash: nodeHash,
    dirs,
    picker: { pickDocument: async () => null, pickImage: async () => null },
    sharer: { shareFile: async () => undefined },
  };
  const events: DomainEvent[] = [];
  const deps: FileDeps = {
    db: booted.db,
    clock: booted.clock,
    ids: sequentialIds(opts.idStart ?? 500_000),
    events: { emit: (e) => void events.push(e), on: () => () => undefined },
    fs,
  };
  const scheduler = new FakeScheduler();
  return {
    deps,
    db: booted.db,
    clock: booted.clock,
    events,
    scheduler,
    files,
    root: tmp.dir,
    dirs,
    pick: async (name, bytes, mimeType = null) => {
      const uri = join(tmp.dir, 'picker', name);
      await files.write(uri, bytes);
      return { uri, name, mimeType, size: bytes.length };
    },
    cleanup: tmp.cleanup,
  };
}

export function unwrap<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error(`atteso ok, ottenuto errore: ${JSON.stringify(r.error)}`);
  return r.value;
}

export function errorCode<T>(r: UsecaseResult<T> | { ok: boolean; error?: { code: string } }): string {
  if (r.ok) throw new Error('atteso un errore, ottenuto ok');
  return (r as { error: { code: string } }).error.code;
}

// ------------------------------------------------------------------ file di prova (firme reali dei formati)

const filler = (n: number, seed: number): number[] => Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

/** Un «JPEG» minimo: la firma FF D8 FF E0 e byte di riempimento diversi per ogni seme. */
export const jpegBytes = (seed = 1, size = 600): Uint8Array => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...filler(size, seed)]);
/** Un «PDF» minimo con l'intestazione %PDF-1.7. */
export const pdfBytes = (seed = 1): Uint8Array => new TextEncoder().encode(`%PDF-1.7\n% prova ${seed}\n1 0 obj << >> endobj\n%%EOF\n`);
export const pngBytes = (): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...filler(64, 9)]);

export async function count(db: NodeSqlDatabase, table: string, where = '1=1'): Promise<number> {
  return (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))?.n ?? 0;
}

// ------------------------------------------------------------------ un garage di prova completo

import { insertRow } from '../../../support/db';
import { populateSampleData, SAMPLE_IDS } from '../../../support/sampleData';
import { ulidOf } from '../../../support/fakes';
import { addAttachment } from '@/usecases/attachments';
import type { Attachment } from '@/usecases/attachments';
import { setSettings } from '@/usecases/settings';
import { collectBackupData } from '@/usecases/backup';
import type { BackupDocument } from '@/usecases/backup';

export interface Garage {
  vehicleId: string;
  demoId: string;
  serviceId: string;
  /** PDF allegato all'intervento. */
  invoice: Attachment;
  /** Libretto dell'auto, con scadenza collegata. */
  registration: Attachment;
  trashedVehicleId: string;
}

/**
 * Popola un ambiente con il garage sintetico di `populateSampleData` (auto reale + auto demo con OBD simulato) e in piu':
 * allegati con file veri, una categoria di spesa dell'utente, elementi nel cestino, un allegato dell'auto demo e impostazioni scelte.
 */
export async function seedGarage(env: BackupEnv): Promise<Garage> {
  await populateSampleData(env.db);
  // l'allegato fittizio del garage di prova non ha un file: qui servono file veri
  await env.db.run('DELETE FROM attachments WHERE id = ?', [ulidOf(95)]);
  await env.db.run('DELETE FROM pending_file_deletions');

  const invoice = unwrap(
    await addAttachment(env.deps, {
      parent: { type: 'service_record', id: SAMPLE_IDS.service1 },
      file: await env.pick('fattura.pdf', pdfBytes(11), 'application/pdf'),
      title: 'Fattura tagliando',
      kind: 'invoice',
    }),
  );
  const registration = unwrap(
    await addAttachment(env.deps, {
      parent: { type: 'vehicle', id: SAMPLE_IDS.vehicle1 },
      file: await env.pick('libretto.jpg', jpegBytes(12), 'image/jpeg'),
      title: 'Libretto',
      kind: 'registration_doc',
      expiresOn: '2027-03-15',
    }),
  );
  // l'auto demo ha un allegato: non deve entrare nel backup
  unwrap(await addAttachment(env.deps, { parent: { type: 'vehicle', id: SAMPLE_IDS.demo }, file: await env.pick('demo.jpg', jpegBytes(13), 'image/jpeg') }));

  const at = '2026-06-02T08:00:00.000Z';
  await insertRow(env.db, 'expense_categories', { id: ulidOf(200), name_it: 'Autolavaggio', is_system: 0, created_at: at, updated_at: at });
  await insertRow(env.db, 'expenses', { id: ulidOf(201), vehicle_id: SAMPLE_IDS.vehicle1, spent_on: '2026-05-20', category_id: ulidOf(200), amount_cents: 1550, created_at: at, updated_at: at });
  // cestino: un rifornimento cancellato e un'auto intera con un figlio
  await insertRow(env.db, 'fuel_logs', {
    id: ulidOf(52), vehicle_id: SAMPLE_IDS.vehicle1, filled_on: '2026-02-01', fuel_type: 'petrol', quantity_milli: 10000, quantity_unit: 'L',
    total_cents: 1800, created_at: at, updated_at: at, deleted_at: '2026-09-01T08:00:00.000Z',
  });
  const trashedVehicleId = ulidOf(3);
  await insertRow(env.db, 'vehicles', {
    id: trashedVehicleId, make: 'Vecchia', model: 'Auto', fuel_primary: 'diesel', plate: 'OLD0001', created_at: at, updated_at: at, deleted_at: '2026-09-02T08:00:00.000Z',
  });
  await insertRow(env.db, 'fuel_logs', {
    id: ulidOf(53), vehicle_id: trashedVehicleId, filled_on: '2025-02-01', fuel_type: 'diesel', quantity_milli: 40000, quantity_unit: 'L',
    total_cents: 7000, created_at: at, updated_at: at,
  });
  unwrap(await setSettings(env.deps, { 'notify.time': '08:30', 'notify.privacy': 'full', 'backup.nudgeDays': 14 }));
  env.events.length = 0;
  return { vehicleId: SAMPLE_IDS.vehicle1, demoId: SAMPLE_IDS.demo, serviceId: SAMPLE_IDS.service1, invoice, registration, trashedVehicleId };
}

/** Il documento di backup che si otterrebbe adesso (stessi dati che finirebbero in data.json), senza scrivere nulla. */
export function docOf(env: BackupEnv, includeTrash = false): Promise<BackupDocument> {
  return collectBackupData(env.db, { includeTrash, appVersion: 'test', exportedAt: '2000-01-01T00:00:00.000Z' });
}

/** Contenuto di tutte le tabelle utente, per confrontare lo stato prima e dopo (rollback). */
export async function fullState(env: BackupEnv): Promise<string> {
  const tables = [
    'vehicles', 'workshops', 'obd_adapters', 'expense_categories', 'fuel_logs', 'service_records', 'service_lines', 'fluid_checks', 'expenses',
    'obd_sessions', 'odometer_readings', 'maintenance_items', 'maintenance_completions', 'insurance_policies', 'insurance_coverages',
    'insurance_payments', 'reminders', 'tyre_sets', 'tyre_fitments', 'dtc_events', 'attachments', 'telemetry_samples', 'pending_file_deletions',
    'app_settings',
  ];
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t] = await env.db.all(`SELECT * FROM ${t} ORDER BY 1, 2`);
  return JSON.stringify(out);
}

/** Tutti i file sotto una cartella con il loro contenuto (per confronti), ordinati per nome. */
export async function dirContents(env: BackupEnv, dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of (await env.files.list(dir)).sort()) out[name] = Buffer.from(await env.files.read(`${dir}/${name}`)).toString('base64');
  return out;
}
