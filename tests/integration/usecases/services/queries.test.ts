// Letture: elenco con filtri per tipo e periodo, dettaglio, "ultimo fatto" ricavato dallo storico (wizard "Imposta le scadenze", demo).
import { describe, expect, it } from 'vitest';
import { createDemoVehicle, buildDemoPlan } from '@/usecases/demo';
import {
  addServiceRecord,
  deleteServiceRecord,
  getServiceRecord,
  listServiceRecords,
  suggestLastDoneFromHistory,
  upsertWorkshop,
} from '@/usecases/services';
import { CABIN, OIL, SERVICE_MAIN, garage, makeEnv, unwrap } from './helpers';

async function history() {
  const g = await garage({ main: SERVICE_MAIN, oil: OIL, cabin: CABIN });
  const { env, v, items } = g;
  const w1 = unwrap(await upsertWorkshop(env.deps, { name: 'Officina Rossi', city: 'Torino' })).id;
  const w2 = unwrap(await upsertWorkshop(env.deps, { name: 'Gommista Verdi', city: 'Asti' })).id;
  const a = unwrap(
    await addServiceRecord(env.deps, {
      vehicleId: v, serviceOn: '2026-01-10', kind: 'scheduled', title: 'Tagliando', km: 12000, totalCents: 20000, workshopId: w1, invoiceNumber: 'FT-77',
      lines: [{ lineType: 'fluid', fluidKind: 'engine_oil', description: 'Olio motore 5W-30' }, { lineType: 'part', description: 'Filtro olio' }],
      completeItemIds: [items.main!, items.oil!],
    }),
  ).record;
  const b = unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-03-05', kind: 'repair', title: 'Freni anteriori', totalCents: 15000, workshopId: w2, notes: 'Pastiglie 100% usurate' })).record;
  const c = unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-06-02', kind: 'tyres', title: 'Gomme invernali', km: 15500, totalCents: 40000, workshopId: w1 })).record;
  const d = unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-09-15', kind: 'inspection', title: 'Revisione', inspectionResult: 'regular', totalCents: 7940 })).record;
  return { ...g, w1, w2, a, b, c, d };
}

describe('listServiceRecords', () => {
  it('dal piu recente, con officina, km, righe, olio e voci completate', async () => {
    const { env, v, a, b, c, d } = await history();
    const list = await listServiceRecords(env.deps, v);
    expect(list.map((r) => r.id)).toEqual([d.id, c.id, b.id, a.id]);
    expect(list[3]).toMatchObject({
      title: 'Tagliando', kindLabel: 'Tagliando', workshopName: 'Officina Rossi', km: 12000, totalCents: 20000, lineCount: 2, hasOil: true,
      invoiceNumber: 'FT-77', completedItemNames: ['Tagliando', 'Cambio olio motore e filtro'].sort(),
    });
    expect(list[2]).toMatchObject({ km: null, hasOil: false, lineCount: 0, completedItemNames: [], notes: 'Pastiglie 100% usurate' });
    expect(list[0]).toMatchObject({ kind: 'inspection', inspectionResult: 'regular', workshopName: null });
  });

  it('filtri per tipo, periodo (estremi inclusi), officina, testo; limit e offset', async () => {
    const { env, v, w1, a, b, c } = await history();
    const ids = async (f: Parameters<typeof listServiceRecords>[2]) => (await listServiceRecords(env.deps, v, f)).map((r) => r.id);
    expect(await ids({ kinds: ['scheduled', 'repair'] })).toEqual([b.id, a.id]);
    expect(await ids({ kinds: ['tyres'] })).toEqual([c.id]);
    expect(await ids({ from: '2026-03-05', to: '2026-06-02' })).toEqual([c.id, b.id]); // estremi inclusi
    expect(await ids({ from: '2026-06-03' })).toHaveLength(1);
    expect(await ids({ to: '2026-01-09' })).toEqual([]);
    expect(await ids({ workshopId: w1 })).toEqual([c.id, a.id]);
    expect(await ids({ text: 'olio' })).toEqual([a.id]); // descrizione di una riga
    expect(await ids({ text: 'FREN' })).toEqual([b.id]); // titolo, senza distinguere maiuscole
    expect(await ids({ text: 'usurate' })).toEqual([b.id]); // note
    expect(await ids({ text: 'ft-77' })).toEqual([a.id]); // fattura
    expect(await ids({ text: '100%' })).toEqual([b.id]); // % non e' un carattere jolly
    expect(await ids({ kinds: ['scheduled', 'tyres'], from: '2026-02-01', workshopId: w1 })).toEqual([c.id]);
    expect(await ids({ limit: 2 })).toHaveLength(2);
    expect(await ids({ limit: 2, offset: 3 })).toEqual([a.id]);
  });

  it('esclude gli interventi nel cestino e quelli di altre auto', async () => {
    const { env, v, a } = await history();
    unwrap(await deleteServiceRecord(env.deps, a.id));
    expect((await listServiceRecords(env.deps, v)).map((r) => r.id)).not.toContain(a.id);
    expect(await listServiceRecords(env.deps, '01TESTID000000000000009999')).toEqual([]);
  });
});

describe('getServiceRecord', () => {
  it('dettaglio con officina, righe categorizzate, cambio olio e voci completate; null se non esiste', async () => {
    const { env, a } = await history();
    const d = (await getServiceRecord(env.deps, a.id))!;
    expect(d).toMatchObject({ id: a.id, km: 12000, workshop: { name: 'Officina Rossi', city: 'Torino' }, invoiceNumber: 'FT-77' });
    expect(d.lines.map((l) => l.category)).toEqual(['engine_oil', 'oil_filter']);
    expect(d.oilChange).toMatchObject({ filterReplaced: true });
    expect(d.completions.map((c) => c.templateId).sort()).toEqual(['tpl_oil_change', 'tpl_service_main']);
    expect(await getServiceRecord(env.deps, '01TESTID000000000000009999')).toBeNull();
  });
});

describe('suggestLastDoneFromHistory', () => {
  it('per ogni voce del catalogo l ultima data e gli ultimi km fatti dallo storico', async () => {
    const { env, v } = await garage({});
    const mk = (serviceOn: string, km: number | null, title: string, lines: { lineType: 'part' | 'fluid'; description: string; fluidKind?: 'engine_oil' }[]) =>
      addServiceRecord(env.deps, { vehicleId: v, serviceOn, kind: 'scheduled', title, km, lines });
    const s1 = unwrap(await mk('2026-01-10', 12000, 'Cambio olio e candele', [{ lineType: 'fluid', fluidKind: 'engine_oil', description: 'Olio motore' }, { lineType: 'part', description: 'Candele' }])).record;
    const s2 = unwrap(await mk('2026-03-01', 13000, 'Cambio olio', [{ lineType: 'fluid', fluidKind: 'engine_oil', description: 'Olio motore' }])).record;
    const s3 = unwrap(await mk('2026-04-01', null, 'Filtri', [{ lineType: 'part', description: 'Filtro aria' }, { lineType: 'part', description: 'Filtro abitacolo' }])).record;
    const last = await suggestLastDoneFromHistory(env.deps, v);
    expect(last['tpl_oil_change']).toEqual({ templateId: 'tpl_oil_change', doneOn: '2026-03-01', doneKm: 13000, serviceRecordId: s2.id, serviceTitle: 'Cambio olio' });
    expect(last['tpl_spark_plugs']).toMatchObject({ doneOn: '2026-01-10', doneKm: 12000, serviceRecordId: s1.id });
    expect(last['tpl_air_filter']).toMatchObject({ doneOn: '2026-04-01', doneKm: null, serviceRecordId: s3.id });
    expect(last['tpl_cabin_filter']).toMatchObject({ doneOn: '2026-04-01' });
    expect(Object.keys(last).sort()).toEqual(['tpl_air_filter', 'tpl_cabin_filter', 'tpl_oil_change', 'tpl_spark_plugs']);
    // un intervento eliminato non conta
    unwrap(await deleteServiceRecord(env.deps, s2.id));
    expect((await suggestLastDoneFromHistory(env.deps, v))['tpl_oil_change']).toMatchObject({ doneOn: '2026-01-10', serviceRecordId: s1.id });
  });

  it('la revisione conta solo se regolare; senza storico nessun suggerimento', async () => {
    const { env, v } = await garage({});
    expect(await suggestLastDoneFromHistory(env.deps, v)).toEqual({});
    unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-02-01', kind: 'inspection', title: 'Revisione', inspectionResult: 'regular' }));
    unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-08-01', kind: 'inspection', title: 'Revisione', inspectionResult: 'repeat' }));
    const last = await suggestLastDoneFromHistory(env.deps, v);
    expect(last['tpl_inspection']).toMatchObject({ doneOn: '2026-02-01' });
  });

  it('auto demo: tagliandi e revisione dello storico precompilano tagliando, olio, filtri e le altre voci', async () => {
    const env = await makeEnv();
    const { vehicleId } = unwrap(await createDemoVehicle(env.deps));
    const plan = buildDemoPlan(env.clock.todayLocal());
    const [first, inspection, second] = plan.services as [(typeof plan.services)[number], (typeof plan.services)[number], (typeof plan.services)[number]];
    const last = await suggestLastDoneFromHistory(env.deps, vehicleId);
    expect(Object.keys(last).sort()).toEqual([
      'tpl_air_filter', 'tpl_battery_check', 'tpl_brake_fluid', 'tpl_cabin_filter', 'tpl_coolant', 'tpl_ev_service', 'tpl_inspection',
      'tpl_oil_change', 'tpl_service_main', 'tpl_spark_plugs', 'tpl_wipers',
    ]);
    // l'ultimo tagliando vince su tagliando, olio e filtri; le voci fatte solo la prima volta restano a quella data
    for (const id of ['tpl_service_main', 'tpl_oil_change', 'tpl_air_filter', 'tpl_cabin_filter']) {
      expect(last[id]).toMatchObject({ doneOn: second.on, doneKm: second.km, serviceTitle: 'Tagliando' });
    }
    for (const id of ['tpl_brake_fluid', 'tpl_spark_plugs', 'tpl_coolant', 'tpl_battery_check', 'tpl_wipers']) {
      expect(last[id]).toMatchObject({ doneOn: first.on, doneKm: first.km, serviceTitle: 'Tagliando' });
    }
    expect(last['tpl_inspection']).toMatchObject({ doneOn: inspection.on, doneKm: inspection.km, serviceTitle: 'Revisione' });
  });
});
