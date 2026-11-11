// addServiceRecord (F-35, AC-06.1 e AC-06.6): record, righe, lettura km collegata con la coerenza dell'odometro, validazioni,
// scelte sui km incoerenti (AC-02), cambio olio (F-37), costi in centesimi interi.
import { describe, expect, it } from 'vitest';
import { addServiceRecord } from '@/usecases/services';
import { isOdometerConflict } from '@/usecases/odometer';
import { addOdo, errorOf, garage, rows, unwrap } from './helpers';

const BASE = { serviceOn: '2026-10-05', kind: 'scheduled' as const, title: 'Tagliando' };

describe('addServiceRecord: registrazione base', () => {
  it('salva tipo, data, km, officina e totale; crea la lettura km collegata (source service)', async () => {
    const { env, v } = await garage({});
    const r = unwrap(
      await addServiceRecord(env.deps, {
        vehicleId: v, ...BASE, km: 26000, totalCents: 21050, invoiceNumber: ' F/123 ', notes: ' tutto ok ',
        newWorkshop: { name: 'Officina Rossi', city: 'Torino', phone: '011 1234567' },
      }),
    );
    expect(r.record).toMatchObject({
      vehicleId: v, serviceOn: '2026-10-05', kind: 'scheduled', kindLabel: 'Tagliando', title: 'Tagliando', totalCents: 21050,
      invoiceNumber: 'F/123', notes: 'tutto ok', km: 26000, inspectionResult: null, inspectionNotice: null, deletedAt: null,
      workshop: { name: 'Officina Rossi', city: 'Torino', phone: '011 1234567' }, lines: [], oilChange: null, completions: [],
    });
    expect(r.record.id).toHaveLength(26);
    expect(r.odometerReadingId).toBe(r.record.odometerReadingId);
    const [odo] = await rows(env.db, 'SELECT * FROM odometer_readings WHERE service_record_id = ?', [r.record.id]);
    expect(odo).toMatchObject({ vehicle_id: v, read_on: '2026-10-05', km: 26000, source: 'service', status: 'valid', deleted_at: null });
    expect(r.warnings).toEqual([]);
    expect(env.events).toEqual([
      { type: 'data-changed', scope: 'service', vehicleId: v },
      { type: 'data-changed', scope: 'odometer', vehicleId: v },
    ]);
  });

  it('senza km non crea letture; senza titolo usa l etichetta del tipo', async () => {
    const { env, v } = await garage({});
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-10-05', kind: 'repair', totalCents: 8000 }));
    expect(r.record).toMatchObject({ title: 'Riparazione', km: null, odometerReadingId: null });
    expect(await rows(env.db, 'SELECT id FROM odometer_readings WHERE service_record_id IS NOT NULL')).toEqual([]);
    expect(env.events.map((e) => (e as { scope: string }).scope)).toEqual(['service']);
  });

  it('riusa l officina con lo stesso nome (nessun doppione)', async () => {
    const { env, v } = await garage({});
    const a = unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...BASE, newWorkshop: { name: 'Officina Rossi' } }));
    const b = unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...BASE, serviceOn: '2026-10-06', newWorkshop: { name: 'officina rossi', city: 'Asti' } }));
    expect(b.record.workshop?.id).toBe(a.record.workshop?.id);
    expect(await rows(env.db, 'SELECT name, city FROM workshops')).toEqual([{ name: 'Officina Rossi', city: 'Asti' }]);
  });

  it('un intervento a km uguali alla lettura del giorno non da errore (stesso giorno, nessun vincolo)', async () => {
    const { env, v } = await garage({});
    await addOdo(env, v, '2026-10-05', 26000);
    unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...BASE, km: 26500 }));
    expect(await rows(env.db, 'SELECT km FROM odometer_readings WHERE read_on = ? ORDER BY km', ['2026-10-05'])).toEqual([{ km: 26000 }, { km: 26500 }]);
  });
});

describe('addServiceRecord: righe e importi in centesimi interi (AC-06.6)', () => {
  it('salva le righe con tipo, quantita in millesimi, prezzi e specifica; il totale resta quello del record', async () => {
    const { env, v } = await garage({});
    const r = unwrap(
      await addServiceRecord(env.deps, {
        vehicleId: v, ...BASE, km: 26000, totalCents: 21000,
        lines: [
          { lineType: 'labor', description: 'Manodopera tagliando', amountCents: 6500 },
          { lineType: 'fluid', fluidKind: 'engine_oil', description: 'Olio motore 5W-30', spec: '5W-30 ACEA C3', quantityMilli: 4500, unitPriceCents: 1100, brand: 'Selenia' },
          { lineType: 'part', description: 'Filtro olio', partCode: 'OC 123', amountCents: 1400, warrantyMonths: 12 },
        ],
      }),
    );
    expect(r.record.lines.map((l) => [l.position, l.lineType, l.description, l.quantityMilli, l.unitPriceCents, l.amountCents, l.category])).toEqual([
      [0, 'labor', 'Manodopera tagliando', 1000, null, 6500, null],
      [1, 'fluid', 'Olio motore 5W-30', 4500, 1100, 4950, 'engine_oil'], // 4,5 L x 11,00 EUR = 49,50 EUR (intero)
      [2, 'part', 'Filtro olio', 1000, null, 1400, 'oil_filter'],
    ]);
    expect(r.record.lines[1]).toMatchObject({ spec: '5W-30 ACEA C3', brand: 'Selenia', fluidKind: 'engine_oil' });
    expect(r.record.lines[2]).toMatchObject({ partCode: 'OC 123', warrantyMonths: 12 });
    expect(r.record.totalCents).toBe(21000);
    expect(r.record.linesTotalCents).toBe(12850);
    expect(r.warnings.map((w) => w.code)).toEqual(['TOTAL_MISMATCH']); // il totale non coincide con la somma delle righe: avviso, non blocco
    expect(Number.isInteger(r.record.totalCents)).toBe(true);
  });

  it('senza totale usa la somma delle righe', async () => {
    const { env, v } = await garage({});
    const r = unwrap(
      await addServiceRecord(env.deps, {
        vehicleId: v, ...BASE,
        lines: [{ lineType: 'labor', description: 'Manodopera', amountCents: 6500 }, { lineType: 'part', description: 'Candele', amountCents: 3999 }],
      }),
    );
    expect(r.record.totalCents).toBe(10499);
    expect(r.warnings).toEqual([]);
  });

  it('arrotonda quantita x prezzo al centesimo con aritmetica intera (3,333 pezzi x 1,00 = 3,33)', async () => {
    const { env, v } = await garage({});
    const r = unwrap(
      await addServiceRecord(env.deps, { vehicleId: v, ...BASE, lines: [{ lineType: 'part', description: 'Viti', quantityMilli: 3333, unitPriceCents: 100 }] }),
    );
    expect(r.record.lines[0]!.amountCents).toBe(333);
  });

  it('il cambio olio (F-37) aggiunge la riga dell olio con specifica e litri e quella del filtro', async () => {
    const { env, v } = await garage({});
    const r = unwrap(
      await addServiceRecord(env.deps, {
        vehicleId: v, serviceOn: '2026-10-05', kind: 'scheduled', title: 'Cambio olio e filtri', totalCents: 9000, km: 26000,
        oilChange: { spec: '5W-30 ACEA C3', quantityMilli: 4200, filterReplaced: true, oilAmountCents: 5500, filterAmountCents: 1500 },
      }),
    );
    expect(r.record.lines.map((l) => [l.lineType, l.description, l.spec, l.quantityMilli, l.amountCents])).toEqual([
      ['fluid', 'Olio motore 5W-30 ACEA C3', '5W-30 ACEA C3', 4200, 5500],
      ['part', 'Filtro olio', null, 1000, 1500],
    ]);
    expect(r.record.oilChange).toEqual({ spec: '5W-30 ACEA C3', quantityMilli: 4200, filterReplaced: true });
    // se le righe dell'olio ci sono gia' non si duplicano
    const again = unwrap(
      await addServiceRecord(env.deps, {
        vehicleId: v, ...BASE, serviceOn: '2026-10-06',
        lines: [{ lineType: 'fluid', fluidKind: 'engine_oil', description: 'Olio motore', quantityMilli: 4000 }],
        oilChange: { spec: '0W-20', filterReplaced: false },
      }),
    );
    expect(again.record.lines).toHaveLength(1);
  });
});

describe('addServiceRecord: validazioni (messaggi in italiano)', () => {
  const bad = async (patch: Record<string, unknown>) => {
    const { env, v } = await garage({});
    const r = await addServiceRecord(env.deps, { vehicleId: v, ...BASE, ...patch } as never);
    expect(await rows(env.db, 'SELECT id FROM service_records')).toEqual([]); // nulla di scritto
    return errorOf(r);
  };

  it('data nel futuro: FUTURE_DATE; data non valida: VALIDATION', async () => {
    expect(await bad({ serviceOn: '2026-10-09' })).toEqual({ code: 'FUTURE_DATE' });
    expect(await bad({ serviceOn: '2026-02-30' })).toMatchObject({ code: 'VALIDATION', field: 'serviceOn', message: 'La data non è valida.' });
  });

  it('km non interi o fuori intervallo', async () => {
    expect(await bad({ km: 12.5 })).toMatchObject({ code: 'VALIDATION', field: 'km' });
    expect(await bad({ km: 2_000_001 })).toMatchObject({ code: 'VALIDATION', field: 'km' });
  });

  it('totale non intero o negativo (niente float)', async () => {
    expect(await bad({ totalCents: 10.5 })).toMatchObject({ code: 'VALIDATION', field: 'totalCents' });
    expect(await bad({ totalCents: -1 })).toMatchObject({ code: 'VALIDATION', field: 'totalCents' });
  });

  it('righe non valide: descrizione, quantita, importo, fluido su riga non fluido', async () => {
    expect(await bad({ lines: [{ lineType: 'part', description: '  ' }] })).toMatchObject({ field: 'lines[0].description' });
    expect(await bad({ lines: [{ lineType: 'part', description: 'x', quantityMilli: 0 }] })).toMatchObject({ field: 'lines[0].quantityMilli' });
    expect(await bad({ lines: [{ lineType: 'part', description: 'x', amountCents: 1.5 }] })).toMatchObject({ field: 'lines[0].amountCents' });
    expect(await bad({ lines: [{ lineType: 'part', description: 'x', fluidKind: 'engine_oil' }] })).toMatchObject({ field: 'lines[0].fluidKind' });
    expect(await bad({ lines: [{ lineType: 'boh', description: 'x' }] })).toMatchObject({ field: 'lines[0].lineType' });
  });

  it('revisione: serve l esito; l esito vale solo per la revisione', async () => {
    expect(await bad({ kind: 'inspection', title: 'Revisione' })).toMatchObject({ field: 'inspectionResult' });
    expect(await bad({ kind: 'repair', inspectionResult: 'regular' })).toMatchObject({ field: 'inspectionResult' });
    expect(await bad({ kind: 'inspection', inspectionResult: 'boh' })).toMatchObject({ field: 'inspectionResult' });
  });

  it('officina inesistente, auto inesistente, titolo troppo lungo', async () => {
    expect(await bad({ workshopId: '01TESTID000000000000009999' })).toMatchObject({ field: 'workshopId' });
    expect(await bad({ title: 'x'.repeat(121) })).toMatchObject({ field: 'title' });
    const { env } = await garage({});
    expect(errorOf(await addServiceRecord(env.deps, { vehicleId: '01TESTID000000000000009999', ...BASE }))).toEqual({ code: 'ITEM_NOT_FOUND' });
  });
});

describe('addServiceRecord: coerenza dei km con le letture vicine (AC-02, SPEC 6.3.6 punto 5)', () => {
  it('km incoerenti: errore ODO_NON_MONOTONIC con i dettagli e NIENTE scritto (transazione unica)', async () => {
    const { env, v } = await garage({});
    const r = await addServiceRecord(env.deps, { vehicleId: v, ...BASE, serviceOn: '2026-03-01', km: 16000, totalCents: 5000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(isOdometerConflict(r.error)).toBe(true);
      if (isOdometerConflict(r.error)) {
        expect(r.error.conflicts.map((c) => c.km)).toEqual([15000]);
        expect(r.error.allowedRange).toEqual({ min: 10000, max: 15000 });
      }
    }
    expect(await rows(env.db, 'SELECT id FROM service_records')).toEqual([]);
    expect(env.events).toEqual([]);
  });

  it('"Salva senza aggiornare i km": l intervento si salva, il registro km non cambia', async () => {
    const { env, v } = await garage({});
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...BASE, serviceOn: '2026-03-01', km: 16000, onOdometerConflict: 'skip_km' }));
    expect(r.kmIgnored).toBe(true);
    expect(r.odometerReadingId).toBeNull();
    expect(r.record.km).toBeNull();
    expect(await rows(env.db, `SELECT km FROM odometer_readings WHERE source = 'service'`)).toEqual([]);
  });

  it('"E un errore della lettura precedente": le letture in conflitto vengono ignorate e il km si salva', async () => {
    const { env, v } = await garage({});
    const r = unwrap(
      await addServiceRecord(env.deps, { vehicleId: v, ...BASE, serviceOn: '2026-03-01', km: 16000, onOdometerConflict: 'ignore_conflicting' }),
    );
    expect(r.ignoredReadingIds).toHaveLength(1);
    const ignored = await rows(env.db, `SELECT km, status FROM odometer_readings WHERE status = 'ignored'`);
    expect(ignored).toEqual([{ km: 15000, status: 'ignored' }]);
    expect(r.record.km).toBe(16000);
  });

  it('un intervento retrodatato e coerente e accettato', async () => {
    const { env, v } = await garage({});
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...BASE, serviceOn: '2026-03-01', km: 12000 }));
    expect(r.record.km).toBe(12000);
  });

  it('salto implausibile: avviso non bloccante', async () => {
    const { env, v } = await garage({});
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...BASE, serviceOn: '2026-06-02', km: 90000 }));
    expect(r.warnings.map((w) => w.code)).toEqual(['KM_IMPLAUSIBLE']);
    expect(r.record.km).toBe(90000);
  });
});

describe('addServiceRecord: nessun doppione di costi (AC-06, AC-07.6, vista v_costs)', () => {
  it('il costo entra una volta sola in v_costs, anche con le righe e la lettura km', async () => {
    const { env, v } = await garage({});
    const r = unwrap(
      await addServiceRecord(env.deps, {
        vehicleId: v, ...BASE, km: 26000, totalCents: 21000,
        lines: [{ lineType: 'labor', description: 'Manodopera', amountCents: 21000 }],
      }),
    );
    const costs = await rows(env.db, `SELECT source, source_id, cents FROM v_costs WHERE vehicle_id = ?`, [v]);
    expect(costs).toEqual([{ source: 'service', source_id: r.record.id, cents: 21000 }]);
  });
});
