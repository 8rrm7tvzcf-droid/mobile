// Registro chilometri (AC-02): coerenza monotona, conflitti, avvisi, ignora/ripristina, elenco, eliminazione.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addOdometerReading,
  checkOdometerReading,
  deleteOdometerReading,
  isOdometerConflict,
  latestOdometer,
  listOdometerReadings,
  mapSqlError,
  markReadingIgnored,
} from '@/usecases/odometer';
import { addVehicle, deleteVehicle } from '@/usecases/vehicles';
import { populateSampleData, SAMPLE_IDS } from '../../../support/sampleData';
import { count, errorCode, makeHarness, PANDA, unwrap, type Harness } from '../vehicles/harness';

let h: Harness;
let vid: string;
beforeEach(async () => {
  h = await makeHarness(); // oggi = 2026-10-08
  vid = unwrap(await addVehicle(h.deps, PANDA)).id;
  h.clearEvents();
});

const add = (km: number, readOn: string, extra: Record<string, unknown> = {}) =>
  addOdometerReading(h.deps, { vehicleId: vid, km, readOn, ...extra });

/** Le tre letture dell esempio AC-02 punto 1. */
async function seedAc02(): Promise<void> {
  unwrap(await add(10000, '2026-01-01'));
  unwrap(await add(15000, '2026-06-01'));
  unwrap(await add(12000, '2026-03-01')); // retrodatata ma coerente
}

describe('addOdometerReading: coerenza monotona', () => {
  it('AC-02.1: 10.000, 15.000 e 12.000 retrodatata sono accettate', async () => {
    await seedAc02();
    const list = await listOdometerReadings(h.deps, vid);
    expect(list.map((r) => [r.readOn, r.km])).toEqual([
      ['2026-06-01', 15000],
      ['2026-03-01', 12000],
      ['2026-01-01', 10000],
    ]);
  });

  it('AC-02.2: 16.000 il 2026-03-02 e 14.000 il 2026-07-01 sono rifiutate con ODO_NON_MONOTONIC e i dettagli per la finestra a tre scelte', async () => {
    await seedAc02();
    const a = await add(16000, '2026-03-02');
    expect(errorCode(a)).toBe('ODO_NON_MONOTONIC');
    if (a.ok || !isOdometerConflict(a.error)) throw new Error('doveva essere un conflitto');
    expect(a.error.conflicts.map((c) => [c.readOn, c.km])).toEqual([['2026-06-01', 15000]]);
    expect(a.error.previous).toMatchObject({ readOn: '2026-03-01', km: 12000 });
    expect(a.error.next).toMatchObject({ readOn: '2026-06-01', km: 15000 });
    expect(a.error.allowedRange).toEqual({ min: 12000, max: 15000 });
    expect(a.error.message).toContain('15.000');

    const b = await add(14000, '2026-07-01');
    expect(errorCode(b)).toBe('ODO_NON_MONOTONIC');
    if (b.ok || !isOdometerConflict(b.error)) throw new Error('doveva essere un conflitto');
    expect(b.error.allowedRange).toEqual({ min: 15000, max: 2_000_000 });
    expect(await count(h.db, 'odometer_readings')).toBe(3);
    expect(h.events.filter((e) => e.type === 'data-changed' && e.scope === 'odometer')).toHaveLength(3); // solo le 3 riuscite del seed
  });

  it('AC-02.3: due letture nello stesso giorno non hanno vincoli', async () => {
    await seedAc02();
    unwrap(await add(13000, '2026-04-01'));
    unwrap(await add(12800, '2026-04-01'));
    expect(await count(h.db, 'odometer_readings', "read_on = '2026-04-01'")).toBe(2);
  });

  it('AC-02.3: una lettura ignorata esce da calcoli e controlli', async () => {
    await seedAc02();
    const list = await listOdometerReadings(h.deps, vid);
    const top = list[0]!; // 15.000 il 2026-06-01
    unwrap(await markReadingIgnored(h.deps, top.id));
    unwrap(await add(16000, '2026-03-02')); // ora e coerente
    expect((await latestOdometer(h.deps, vid))?.km).toBe(16000);
  });

  it('«È un errore della lettura precedente»: resolveConflicts mette da parte le letture in conflitto e salva, in una transazione', async () => {
    await seedAc02();
    const conflicting = (await listOdometerReadings(h.deps, vid))[0]!;
    h.clearEvents();
    const r = unwrap(await add(16000, '2026-03-02', { resolveConflicts: 'ignore-conflicting' }));
    expect(r.ignoredReadingIds).toEqual([conflicting.id]);
    expect(r.reading).toMatchObject({ km: 16000, readOn: '2026-03-02', status: 'valid' });
    const after = await listOdometerReadings(h.deps, vid);
    expect(after.find((x) => x.id === conflicting.id)?.status).toBe('ignored');
    expect(h.events).toEqual([{ type: 'data-changed', scope: 'odometer', vehicleId: vid }]);
  });

  it('resolveConflicts non copre gli altri errori (data futura) e non lascia nulla a meta', async () => {
    await seedAc02();
    const r = await add(16000, '2026-10-09', { resolveConflicts: 'ignore-conflicting' });
    expect(errorCode(r)).toBe('FUTURE_DATE');
    expect(await count(h.db, 'odometer_readings', "status = 'ignored'")).toBe(0);
  });

  it('un conflitto con piu letture le ignora tutte', async () => {
    unwrap(await add(10000, '2026-01-01'));
    unwrap(await add(20000, '2026-02-01'));
    unwrap(await add(30000, '2026-03-01'));
    const r = unwrap(await add(5000, '2026-04-01', { resolveConflicts: 'ignore-conflicting' }));
    expect(r.ignoredReadingIds).toHaveLength(3);
    expect((await latestOdometer(h.deps, vid))?.km).toBe(5000);
  });
});

describe('addOdometerReading: validazione e avvisi', () => {
  it('la data predefinita e oggi; la lettura porta la provenienza', async () => {
    const r = unwrap(await addOdometerReading(h.deps, { vehicleId: vid, km: 1234, note: '  dopo il tagliando ' }));
    expect(r.reading).toMatchObject({
      readOn: '2026-10-08',
      km: 1234,
      source: 'manual',
      sourceLabel: 'Inserito a mano',
      status: 'valid',
      note: 'dopo il tagliando',
      linkedId: null,
      canDelete: true,
    });
    expect(r.warnings).toEqual([]);
  });

  it('la provenienza import e ammessa, le altre no', async () => {
    expect(unwrap(await add(10, '2026-01-01', { source: 'import' })).reading.sourceLabel).toBe('Importato');
    expect(await add(20, '2026-01-02', { source: 'fuel' })).toMatchObject({ ok: false, error: { field: 'source' } });
  });

  it('km non interi o fuori intervallo e data non valida: VALIDATION; data futura: FUTURE_DATE', async () => {
    expect(await add(1.5, '2026-01-01')).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'km' } });
    expect(await add(-1, '2026-01-01')).toMatchObject({ ok: false, error: { field: 'km' } });
    expect(await add(2_000_001, '2026-01-01')).toMatchObject({ ok: false, error: { field: 'km' } });
    expect(await add(100, '2026-02-30')).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'readOn' } });
    expect(errorCode(await add(100, '2026-10-09'))).toBe('FUTURE_DATE');
    expect(await count(h.db, 'odometer_readings')).toBe(0);
  });

  it('auto inesistente o nel cestino: ITEM_NOT_FOUND', async () => {
    expect(errorCode(await addOdometerReading(h.deps, { vehicleId: 'non-esiste', km: 1 }))).toBe('ITEM_NOT_FOUND');
    unwrap(await deleteVehicle(h.deps, vid));
    expect(errorCode(await add(1, '2026-01-01'))).toBe('ITEM_NOT_FOUND');
  });

  it('un salto implausibile e un avviso non bloccante: la lettura viene salvata e l avviso torna nel risultato', async () => {
    unwrap(await add(10000, '2026-01-01'));
    const r = unwrap(await add(40000, '2026-01-02'));
    expect(r.warnings.map((w) => w.code)).toEqual(['IMPLAUSIBLE_JUMP']);
    expect(r.previous).toMatchObject({ km: 10000 });
    expect(await count(h.db, 'odometer_readings')).toBe(2);
  });

  it('oltre il milione di km: avviso VERY_HIGH_KM', async () => {
    const r = unwrap(await add(1_500_000, '2026-01-01'));
    expect(r.warnings.map((w) => w.code)).toContain('VERY_HIGH_KM');
  });

  it('se il trigger scatta lo stesso, l errore SQL e tradotto in ODO_NON_MONOTONIC', async () => {
    await seedAc02();
    let thrown: unknown;
    try {
      await h.db.run(
        `INSERT INTO odometer_readings (id, vehicle_id, read_on, km, source) VALUES ('01TESTID000000000000008888', ?, '2026-03-02', 16000, 'manual')`,
        [vid],
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(mapSqlError(thrown)).toMatchObject({ code: 'ODO_NON_MONOTONIC' });
    expect(mapSqlError(new Error('UNIQUE constraint failed: vehicles.plate'))).toEqual({ code: 'DUPLICATE_PLATE' });
    expect(mapSqlError(new Error('disco pieno'))).toBeNull();
  });
});

describe('checkOdometerReading', () => {
  it('verifica senza scrivere: errori, avvisi, conflitti, vicini e intervallo ammesso', async () => {
    await seedAc02();
    h.clearEvents();
    const c = unwrap(await checkOdometerReading(h.deps, { vehicleId: vid, km: 16000, readOn: '2026-03-02' }));
    expect(c.ok).toBe(false);
    expect(c.errors.map((e) => e.code)).toEqual(['NON_MONOTONIC']);
    expect(c.conflicts).toHaveLength(1);
    expect(c.allowedRange).toEqual({ min: 12000, max: 15000 });

    const good = unwrap(await checkOdometerReading(h.deps, { vehicleId: vid, km: 13000, readOn: '2026-03-02' }));
    expect(good).toMatchObject({ ok: true, previous: { km: 12000 }, next: { km: 15000 } });
    expect(await count(h.db, 'odometer_readings')).toBe(3);
    expect(h.events).toEqual([]);
  });

  it('excludeId: modificando una lettura non confligge con se stessa', async () => {
    await seedAc02();
    const mid = (await listOdometerReadings(h.deps, vid)).find((r) => r.km === 12000)!;
    const c = unwrap(await checkOdometerReading(h.deps, { vehicleId: vid, km: 12500, readOn: mid.readOn, excludeId: mid.id }));
    expect(c.ok).toBe(true);
    expect(c.allowedRange).toEqual({ min: 10000, max: 15000 });
  });

  it('auto inesistente: ITEM_NOT_FOUND', async () => {
    expect(errorCode(await checkOdometerReading(h.deps, { vehicleId: 'x', km: 1 }))).toBe('ITEM_NOT_FOUND');
  });
});

describe('listOdometerReadings e latestOdometer', () => {
  it('ordina dal piu recente (data, poi km), con limit/offset e senza le ignorate su richiesta', async () => {
    unwrap(await add(100, '2026-01-01'));
    unwrap(await add(200, '2026-02-01'));
    unwrap(await add(250, '2026-02-01'));
    const wrong = unwrap(await add(300, '2026-03-01')).reading;
    unwrap(await add(400, '2026-04-01'));
    unwrap(await markReadingIgnored(h.deps, wrong.id));

    const all = await listOdometerReadings(h.deps, vid);
    expect(all.map((r) => r.km)).toEqual([400, 300, 250, 200, 100]);
    expect(all[1]?.status).toBe('ignored');
    expect((await listOdometerReadings(h.deps, vid, { includeIgnored: false })).map((r) => r.km)).toEqual([400, 250, 200, 100]);
    expect((await listOdometerReadings(h.deps, vid, { limit: 2 })).map((r) => r.km)).toEqual([400, 300]);
    expect((await listOdometerReadings(h.deps, vid, { limit: 2, offset: 2 })).map((r) => r.km)).toEqual([250, 200]);
    expect(await listOdometerReadings(h.deps, 'non-esiste')).toEqual([]);
  });

  it('latestOdometer: ultima lettura valida con provenienza; a parita di data i km piu alti; null senza letture', async () => {
    expect(await latestOdometer(h.deps, vid)).toBeNull();
    unwrap(await add(500, '2026-05-01'));
    unwrap(await add(480, '2026-05-01'));
    unwrap(await add(90, '2026-02-01'));
    expect(await latestOdometer(h.deps, vid)).toEqual({ km: 500, readOn: '2026-05-01', source: 'manual', sourceLabel: 'Inserito a mano' });
  });
});

describe('markReadingIgnored', () => {
  it('ignora e ripristina; ripristinare una lettura incoerente da ODO_NON_MONOTONIC con i dettagli', async () => {
    await seedAc02();
    const top = (await listOdometerReadings(h.deps, vid))[0]!; // 15.000 il 2026-06-01
    h.clearEvents();
    expect(unwrap(await markReadingIgnored(h.deps, top.id))).toMatchObject({ id: top.id, status: 'ignored' });
    expect(h.events).toEqual([{ type: 'data-changed', scope: 'odometer', vehicleId: vid }]);
    unwrap(await add(16000, '2026-03-02'));

    const back = await markReadingIgnored(h.deps, top.id, false);
    expect(errorCode(back)).toBe('ODO_NON_MONOTONIC');
    if (back.ok || !isOdometerConflict(back.error)) throw new Error('doveva essere un conflitto');
    expect(back.error.conflicts.map((c) => c.km)).toEqual([16000]);
    expect((await listOdometerReadings(h.deps, vid)).find((r) => r.id === top.id)?.status).toBe('ignored');
  });

  it('e idempotente (nessun evento se nulla cambia); id inesistente: ITEM_NOT_FOUND', async () => {
    const r = unwrap(await add(100, '2026-01-01')).reading;
    h.clearEvents();
    unwrap(await markReadingIgnored(h.deps, r.id, false)); // gia valida
    expect(h.events).toEqual([{ type: 'data-changed', scope: 'odometer', vehicleId: vid }]); // emette comunque: costa poco, la UI ricarica
    expect(errorCode(await markReadingIgnored(h.deps, 'non-esiste'))).toBe('ITEM_NOT_FOUND');
  });
});

describe('deleteOdometerReading', () => {
  it('elimina (cestino) una lettura manuale: sparisce da elenco e da km attuali', async () => {
    unwrap(await add(100, '2026-01-01'));
    const r = unwrap(await add(200, '2026-02-01')).reading;
    h.clearEvents();
    unwrap(await deleteOdometerReading(h.deps, r.id));
    expect(h.events).toEqual([{ type: 'data-changed', scope: 'odometer', vehicleId: vid }]);
    expect((await listOdometerReadings(h.deps, vid)).map((x) => x.km)).toEqual([100]);
    expect((await latestOdometer(h.deps, vid))?.km).toBe(100);
    expect(errorCode(await deleteOdometerReading(h.deps, r.id))).toBe('ITEM_NOT_FOUND');
    unwrap(await add(150, '2026-03-01')); // la lettura cancellata non vincola piu
  });

  it('una lettura collegata a un intervento non si elimina da qui', async () => {
    await populateSampleData(h.db);
    const linked = (await listOdometerReadings(h.deps, SAMPLE_IDS.vehicle1)).find((r) => r.source === 'service')!;
    expect(linked).toMatchObject({ canDelete: false, sourceLabel: 'Da un intervento' });
    expect(linked.linkedId).toBe(SAMPLE_IDS.service1);
    expect(await deleteOdometerReading(h.deps, linked.id)).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'source' } });
  });
});
