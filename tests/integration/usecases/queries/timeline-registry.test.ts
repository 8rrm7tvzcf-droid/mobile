// getTimeline esteso (S-13): interventi, rifornimenti, spese, controlli dei livelli, polizze e rate pagate, con filtri per tipo e periodo.
import { beforeEach, describe, expect, it } from 'vitest';
import { addExpense } from '@/usecases/expenses';
import { addFluidCheck } from '@/usecases/fluids';
import { addFuelLog, deleteFuelLog } from '@/usecases/fuel';
import { addPolicy } from '@/usecases/insurance';
import { getTimeline } from '@/usecases/queries';
import { addServiceRecord } from '@/usecases/services';
import { makeEnv, makeVehicle, unwrap } from '../fluids/harness';
import type { Env } from '../fluids/harness';

let env: Env;
let vid: string;

beforeEach(async () => {
  env = await makeEnv(); // oggi = 2026-10-08; l'auto ha 10.000 km (01/01) e 15.000 km (01/06)
  vid = await makeVehicle(env);
  unwrap(await addServiceRecord(env.deps, { vehicleId: vid, serviceOn: '2026-08-01', kind: 'scheduled', km: 15500, totalCents: 21000 }));
  unwrap(await addFuelLog(env.deps, { vehicleId: vid, filledOn: '2026-09-10', quantityMilli: 40000, totalCents: 7436, km: 16000 }));
  unwrap(await addFuelLog(env.deps, { vehicleId: vid, filledOn: '2026-09-25', quantityMilli: 30000, unitPriceMilli: 1859, km: 16600 }));
  unwrap(await addExpense(env.deps, { vehicleId: vid, spentOn: '2026-09-12', categoryId: 'sys_tolls', amountCents: 1250, description: 'Autostrada' }));
  unwrap(await addFluidCheck(env.deps, { vehicleId: vid, fluid: 'engine_oil', level: 'ok', checkedOn: '2026-09-20', km: 16300 }));
  unwrap(
    await addPolicy(env.deps, {
      vehicleId: vid,
      kind: 'rca',
      company: 'Unipol',
      startOn: '2026-03-10',
      endOn: '2027-03-10',
      premiumCents: 60000,
      installments: 4,
      paidInstallmentNos: [1],
    }),
  );
});

const kinds = async (opts: Parameters<typeof getTimeline>[2] = {}) => (await getTimeline(env.deps, vid, opts))!.entries.map((e) => [e.date, e.kind]);

describe('getTimeline esteso', () => {
  it('unisce tutti i tipi di voce in ordine di data decrescente, senza ripetere i km nati da altre voci', async () => {
    const t = (await getTimeline(env.deps, vid))!;
    const list = t.entries.filter((e) => e.kind !== 'deadline').map((e) => [e.date, e.kind]);
    expect(list).toEqual([
      ['2026-09-25', 'fuel'],
      ['2026-09-20', 'fluid'],
      ['2026-09-12', 'expense'],
      ['2026-09-10', 'fuel'],
      ['2026-08-01', 'service'],
      ['2026-06-01', 'odometer'],
      ['2026-03-10', 'installment'],
      ['2026-03-10', 'policy'],
      ['2026-01-01', 'odometer'],
    ]);
    // nessuna lettura km duplicata: quelle di rifornimento, intervento e controllo vivono sulla loro voce
    expect(t.entries.filter((e) => e.kind === 'odometer').map((e) => e.km)).toEqual([15000, 10000]);
  });

  it('porta importo e km sulle voci che li hanno', async () => {
    const t = (await getTimeline(env.deps, vid))!;
    const fuel = t.entries.filter((e) => e.kind === 'fuel');
    expect(fuel[0]).toMatchObject({ title: 'Rifornimento · Benzina', amountCents: 5577, km: 16600, kmText: '16.600 km', icon: 'fuel' });
    expect(fuel[0]!.text).toContain('30,000 L');
    expect(fuel[0]!.text).toContain('1,859 €/L');
    expect(fuel[0]!.text).toContain('pieno');
    // il secondo pieno chiude un tratto: nel testo c'e' il consumo
    expect(fuel[0]!.text).toContain('L/100 km');
    expect(fuel[1]).toMatchObject({ amountCents: 7436, km: 16000 });
    expect(t.entries.find((e) => e.kind === 'service')).toMatchObject({ title: 'Tagliando', amountCents: 21000, km: 15500, icon: 'service' });
    expect(t.entries.find((e) => e.kind === 'expense')).toMatchObject({ title: 'Pedaggi', text: 'Autostrada', amountCents: 1250, km: null });
    expect(t.entries.find((e) => e.kind === 'fluid')).toMatchObject({ title: 'Controllo · Olio motore', km: 16300, amountCents: null });
    const rata = t.entries.find((e) => e.kind === 'installment')!;
    expect(rata).toMatchObject({ amountCents: 15000, icon: 'payment' });
    expect(rata.text).toContain('Rata 1 di 4');
    // la polizza non e' un costo: i soldi sono nelle rate pagate
    expect(t.entries.find((e) => e.kind === 'policy')).toMatchObject({ amountCents: null, icon: 'policy' });
  });

  it('filtra per tipo', async () => {
    expect(await kinds({ kinds: ['fuel'] })).toEqual([
      ['2026-09-25', 'fuel'],
      ['2026-09-10', 'fuel'],
    ]);
    expect(await kinds({ kinds: ['expense', 'service'] })).toEqual([
      ['2026-09-12', 'expense'],
      ['2026-08-01', 'service'],
    ]);
    expect(await kinds({ kinds: ['policy', 'installment'] })).toHaveLength(2);
  });

  it('filtra per periodo, estremi inclusi', async () => {
    // le scadenze aperte (rate in arrivo) seguono lo stesso periodo
    expect((await kinds({ from: '2026-09-01', to: '2026-09-30' })).map(([, k]) => k).filter((k) => k !== 'deadline')).toEqual(['fuel', 'fluid', 'expense', 'fuel']);
    expect(await kinds({ from: '2026-09-12', to: '2026-09-20' })).toEqual([
      ['2026-09-20', 'fluid'],
      ['2026-09-12', 'expense'],
    ]);
    expect(await kinds({ from: '2027-01-01' })).toEqual([['2027-03-10', 'deadline']]); // la scadenza RC, ancora aperta
  });

  it('un rifornimento eliminato sparisce dal registro (e con lui la sua lettura km)', async () => {
    const fuelId = (await getTimeline(env.deps, vid, { kinds: ['fuel'] }))!.entries[0]!.id;
    unwrap(await deleteFuelLog(env.deps, fuelId));
    expect(await kinds({ kinds: ['fuel'] })).toEqual([['2026-09-10', 'fuel']]);
  });

  it('applica il limite dopo i filtri', async () => {
    const t = (await getTimeline(env.deps, vid, { kinds: ['fuel', 'expense'], limit: 2 }))!;
    expect(t.entries.map((e) => e.kind)).toEqual(['fuel', 'expense']);
  });
});
