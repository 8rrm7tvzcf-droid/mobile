// Cestino (F-05): elenco, eliminazione definitiva a cascata (con la coda dei file) e svuotamento automatico.
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '@/domain/dates';
import {
  addVehicle,
  deleteVehicle,
  listTrashedVehicles,
  listVehicles,
  purgeExpiredTrash,
  purgeVehicle,
} from '@/usecases/vehicles';
import { setSetting } from '@/usecases/settings';
import { populateSampleData, SAMPLE_IDS } from '../../../support/sampleData';
import { count, errorCode, makeHarness, PANDA, unwrap, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await makeHarness('2026-10-08T07:30:00.000Z');
});

describe('listTrashedVehicles', () => {
  it('elenca le auto eliminate, le piu recenti per prime, con il giorno dell eliminazione definitiva', async () => {
    const a = unwrap(await addVehicle(h.deps, { ...PANDA, nickname: 'A', plate: 'AB123CD' }));
    const b = unwrap(await addVehicle(h.deps, { ...PANDA, nickname: 'B' }));
    unwrap(await addVehicle(h.deps, { ...PANDA, nickname: 'C' })); // resta in garage
    unwrap(await deleteVehicle(h.deps, a.id));
    h.clock.set('2026-10-18T07:30:00.000Z');
    unwrap(await deleteVehicle(h.deps, b.id));

    const trash = await listTrashedVehicles(h.deps);
    expect(trash.map((t) => t.displayName)).toEqual(['B', 'A']);
    expect(trash[0]).toMatchObject({ id: b.id, purgeOn: addDays('2026-10-18', 30), daysLeft: 30, plate: null });
    expect(trash[1]).toMatchObject({ id: a.id, purgeOn: '2026-11-07', daysLeft: 20, plate: 'AB123CD' });
    expect(await listVehicles(h.deps)).toHaveLength(1);
  });
});

describe('purgeVehicle (Elimina definitivamente)', () => {
  it('cancella a cascata le righe e accoda i file degli allegati da rimuovere', async () => {
    await populateSampleData(h.db);
    const id = SAMPLE_IDS.vehicle1;
    expect(await count(h.db, 'attachments')).toBe(1);
    expect(await count(h.db, 'pending_file_deletions')).toBe(0);

    // il file dell'allegato sta su disco (il campione ha solo la riga)
    const stored = (await h.db.get<{ stored_path: string }>('SELECT stored_path FROM attachments'))!.stored_path;
    const filePath = `${h.fileDeps.fs.dirs.attachments}/${stored.slice('attachments/'.length)}`;
    await h.fileDeps.fs.files.write(filePath, new Uint8Array([1, 2, 3]));

    // non si elimina definitivamente un auto che e ancora in garage
    expect(errorCode(await purgeVehicle(h.fileDeps, id))).toBe('ITEM_NOT_FOUND');

    unwrap(await deleteVehicle(h.deps, id));
    h.clearEvents();
    unwrap(await purgeVehicle(h.fileDeps, id));
    expect(h.events).toEqual([{ type: 'data-changed', scope: 'vehicles', vehicleId: id }]);

    for (const [table, col] of [
      ['vehicles', 'id'],
      ['odometer_readings', 'vehicle_id'],
      ['fuel_logs', 'vehicle_id'],
      ['service_records', 'vehicle_id'],
      ['maintenance_items', 'vehicle_id'],
      ['reminders', 'vehicle_id'],
      ['insurance_policies', 'vehicle_id'],
      ['expenses', 'vehicle_id'],
      ['tyre_sets', 'vehicle_id'],
      ['fluid_checks', 'vehicle_id'],
      ['dtc_events', 'vehicle_id'],
      ['attachments', 'owner_vehicle_id'],
    ] as const) {
      expect(await count(h.db, table, `${col} = ?`, [id]), table).toBe(0);
    }
    expect(await count(h.db, 'service_lines')).toBe(0);
    expect(await count(h.db, 'insurance_payments')).toBe(0);
    // DATA-2: il trigger ha accodato il file e purgeVehicle lo ha rimosso subito (prima restava su disco fino al riavvio)
    expect(h.fileMap.has(filePath)).toBe(false);
    expect(await count(h.db, 'pending_file_deletions')).toBe(0);
    expect(await count(h.db, 'vehicles')).toBe(1); // resta l auto demo del campione
  });

  it('un id inesistente da ITEM_NOT_FOUND', async () => {
    expect(errorCode(await purgeVehicle(h.fileDeps, 'non-esiste'))).toBe('ITEM_NOT_FOUND');
  });
});

describe('purgeExpiredTrash', () => {
  it('elimina solo le auto nel cestino da almeno trash.retentionDays giorni', async () => {
    const a = unwrap(await addVehicle(h.deps, { ...PANDA, nickname: 'A', initialKm: 10 }));
    unwrap(await deleteVehicle(h.deps, a.id)); // 2026-10-08
    h.clock.set('2026-10-20T07:30:00.000Z');
    const b = unwrap(await addVehicle(h.deps, { ...PANDA, nickname: 'B' }));
    unwrap(await deleteVehicle(h.deps, b.id)); // 2026-10-20
    const keep = unwrap(await addVehicle(h.deps, { ...PANDA, nickname: 'resta' }));

    h.clock.set('2026-11-06T07:30:00.000Z'); // A: 29 giorni, B: 17
    expect(await purgeExpiredTrash(h.deps)).toBe(0);
    h.clock.set('2026-11-07T07:30:00.000Z'); // A: 30 giorni
    h.clearEvents();
    expect(await purgeExpiredTrash(h.deps)).toBe(1);
    expect(h.events).toEqual([{ type: 'data-changed', scope: 'vehicles' }]);
    expect((await listTrashedVehicles(h.deps)).map((t) => t.id)).toEqual([b.id]);
    expect(await count(h.db, 'odometer_readings')).toBe(0); // la lettura di A e sparita con lui
    expect(await listVehicles(h.deps)).toHaveLength(1);
    expect((await listVehicles(h.deps))[0]?.id).toBe(keep.id);

    h.clearEvents();
    expect(await purgeExpiredTrash(h.deps)).toBe(0);
    expect(h.events).toEqual([]);
  });

  it('rispetta una permanenza diversa da 30 giorni', async () => {
    unwrap(await setSetting(h.deps, 'trash.retentionDays', 3));
    const a = unwrap(await addVehicle(h.deps, PANDA));
    unwrap(await deleteVehicle(h.deps, a.id));
    h.clock.set('2026-10-10T07:30:00.000Z');
    expect(await purgeExpiredTrash(h.deps)).toBe(0);
    h.clock.set('2026-10-11T07:30:00.000Z');
    expect(await purgeExpiredTrash(h.deps)).toBe(1);
    expect(await listTrashedVehicles(h.deps)).toEqual([]);
  });
});
