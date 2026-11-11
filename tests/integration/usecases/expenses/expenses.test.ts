// Spese (F-41, AC-07.6): categorie di sistema e personalizzate, registro, validazioni, cestino e avvisi sui doppioni.
import { beforeEach, describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORIES } from '@/data/seeds/catalog';
import { addFuelLog } from '@/usecases/fuel';
import {
  addExpense,
  createExpenseCategory,
  deleteExpense,
  deleteExpenseCategory,
  getExpense,
  listExpenseCategories,
  listExpenses,
  restoreExpense,
  updateExpense,
  updateExpenseCategory,
} from '@/usecases/expenses';
import { addVehicle } from '@/usecases/vehicles';
import { insertRow, serviceRow } from '../../../support/db';
import { count, errorCode, makeHarness, PANDA, unwrap, type Harness } from '../vehicles/harness';

let h: Harness;
let vid: string;
beforeEach(async () => {
  h = await makeHarness(); // oggi = 2026-10-08
  vid = unwrap(await addVehicle(h.deps, PANDA)).id;
  h.clearEvents();
});

const add = (o: Record<string, unknown> = {}) =>
  addExpense(h.deps, { vehicleId: vid, spentOn: '2026-09-10', categoryId: 'sys_parking', amountCents: 1250, ...o });

describe('categorie di spesa', () => {
  it('le 13 categorie di sistema del seed, «Altro» per ultima', async () => {
    const list = await listExpenseCategories(h);
    expect(list).toHaveLength(13);
    expect(list.every((c) => c.isSystem)).toBe(true);
    expect(list.map((c) => c.id).slice(0, 3)).toEqual(['sys_insurance_other', 'sys_road_tax', 'sys_inspection']);
    expect(list[list.length - 1]).toMatchObject({ id: 'sys_other', name: 'Altro' });
    expect(new Set(list.map((c) => c.id))).toEqual(new Set(EXPENSE_CATEGORIES.map((c) => c[0])));
  });

  it('crea una categoria personalizzata: dopo quelle di sistema e prima di «Altro»', async () => {
    const c = unwrap(await createExpenseCategory(h.deps, { name: '  Car   wash  ', icon: 'car' }));
    expect(c).toMatchObject({ name: 'Car wash', icon: 'car', isSystem: false });
    expect(c.id).toHaveLength(26);
    const list = await listExpenseCategories(h);
    expect(list).toHaveLength(14);
    expect(list[list.length - 2]!.id).toBe(c.id);
    expect(list[list.length - 1]!.id).toBe('sys_other');
    const second = unwrap(await createExpenseCategory(h.deps, { name: 'Radio' }));
    expect(second.sortOrder).toBeGreaterThan(c.sortOrder);
    expect(h.events.filter((e) => e.type === 'data-changed')).toHaveLength(2);
  });

  it('nome obbligatorio, di 40 caratteri al massimo, unico anche rispetto a quelle di sistema (senza badare alle maiuscole)', async () => {
    expect(errorCode(await createExpenseCategory(h.deps, { name: '   ' }))).toBe('VALIDATION');
    expect(errorCode(await createExpenseCategory(h.deps, { name: 'x'.repeat(41) }))).toBe('VALIDATION');
    unwrap(await createExpenseCategory(h.deps, { name: 'x'.repeat(40) }));
    const dup = await createExpenseCategory(h.deps, { name: 'pedaggi' });
    expect(errorCode(dup)).toBe('VALIDATION');
    if (!dup.ok && dup.error.code === 'VALIDATION') expect(dup.error).toMatchObject({ field: 'name', message: 'Esiste già una categoria con questo nome.' });
    unwrap(await createExpenseCategory(h.deps, { name: 'Radio' }));
    expect(errorCode(await createExpenseCategory(h.deps, { name: 'RADIO' }))).toBe('VALIDATION');
  });

  it('rinomina una personalizzata (non una di sistema, non con un nome gia\' preso)', async () => {
    const c = unwrap(await createExpenseCategory(h.deps, { name: 'Radio' }));
    expect(unwrap(await updateExpenseCategory(h.deps, c.id, { name: 'Autoradio', icon: 'music' }))).toMatchObject({ name: 'Autoradio', icon: 'music' });
    expect(unwrap(await updateExpenseCategory(h.deps, c.id, { name: 'Autoradio' })).name).toBe('Autoradio'); // lo stesso nome di se stessa
    expect(errorCode(await updateExpenseCategory(h.deps, c.id, { name: 'Multe' }))).toBe('VALIDATION');
    expect(errorCode(await updateExpenseCategory(h.deps, 'sys_fines', { name: 'Sanzioni' }))).toBe('VALIDATION');
    expect(errorCode(await updateExpenseCategory(h.deps, 'nessuna', { name: 'X' }))).toBe('ITEM_NOT_FOUND');
  });

  it('elimina una categoria non usata; se e\' usata chiede dove spostare le spese', async () => {
    const unused = unwrap(await createExpenseCategory(h.deps, { name: 'Vuota' }));
    expect(unwrap(await deleteExpenseCategory(h.deps, unused.id))).toEqual({ moved: 0 });
    expect((await listExpenseCategories(h)).some((c) => c.id === unused.id)).toBe(false);

    const used = unwrap(await createExpenseCategory(h.deps, { name: 'Usata' }));
    const e1 = unwrap(await add({ categoryId: used.id })).expense;
    const e2 = unwrap(await add({ categoryId: used.id, amountCents: 500 })).expense;
    unwrap(await deleteExpense(h.deps, e2.id)); // anche una spesa nel cestino va spostata
    expect(errorCode(await deleteExpenseCategory(h.deps, used.id))).toBe('VALIDATION');
    expect(errorCode(await deleteExpenseCategory(h.deps, used.id, { moveToCategoryId: used.id }))).toBe('VALIDATION');
    expect(errorCode(await deleteExpenseCategory(h.deps, used.id, { moveToCategoryId: 'nessuna' }))).toBe('VALIDATION');
    expect(unwrap(await deleteExpenseCategory(h.deps, used.id, { moveToCategoryId: 'sys_other' }))).toEqual({ moved: 2 });
    expect((await getExpense(h.deps, e1.id))!.categoryId).toBe('sys_other');
    expect((unwrap(await restoreExpense(h.deps, e2.id))).categoryId).toBe('sys_other');
  });

  it('le categorie di sistema non si eliminano', async () => {
    expect(errorCode(await deleteExpenseCategory(h.deps, 'sys_tolls'))).toBe('VALIDATION');
    expect(errorCode(await deleteExpenseCategory(h.deps, 'nessuna'))).toBe('ITEM_NOT_FOUND');
    expect(await listExpenseCategories(h)).toHaveLength(13);
  });

  it('una categoria eliminata non si puo\' piu\' scegliere per una spesa', async () => {
    const c = unwrap(await createExpenseCategory(h.deps, { name: 'Vuota' }));
    unwrap(await deleteExpenseCategory(h.deps, c.id));
    expect(errorCode(await add({ categoryId: c.id }))).toBe('VALIDATION');
  });
});

describe('addExpense / getExpense', () => {
  it('registra una spesa con categoria, importo in centesimi e testi puliti', async () => {
    const r = unwrap(await add({ description: '  Parcheggio centro ', vendor: ' Comune ', notes: ' ' }));
    expect(r.warnings).toEqual([]);
    expect(r.expense).toMatchObject({
      vehicleId: vid,
      spentOn: '2026-09-10',
      categoryId: 'sys_parking',
      categoryName: 'Parcheggio e sosta',
      isSystemCategory: true,
      amountCents: 1250,
      description: 'Parcheggio centro',
      vendor: 'Comune',
      notes: null,
    });
    expect(await getExpense(h.deps, r.expense.id)).toEqual(r.expense);
    expect(h.events).toEqual([{ type: 'data-changed', scope: 'fuel', vehicleId: vid }]);
  });

  it('la data di default e\' oggi', async () => {
    const r = unwrap(await addExpense(h.deps, { vehicleId: vid, categoryId: 'sys_tolls', amountCents: 300 }));
    expect(r.expense.spentOn).toBe('2026-10-08');
  });

  it('validazioni: importo, data, categoria, auto', async () => {
    for (const amountCents of [0, -5, 12.5, Number.NaN, 100_000_000_001]) {
      const r = await add({ amountCents });
      expect(errorCode(r)).toBe('VALIDATION');
      if (!r.ok && r.error.code === 'VALIDATION') expect(r.error.field).toBe('amountCents');
    }
    expect(errorCode(await add({ spentOn: '2026-10-09' }))).toBe('FUTURE_DATE');
    expect(errorCode(await add({ spentOn: '2026-13-01' }))).toBe('VALIDATION');
    expect(errorCode(await add({ categoryId: 'sys_nessuna' }))).toBe('VALIDATION');
    expect(errorCode(await addExpense(h.deps, { vehicleId: 'nessuna', categoryId: 'sys_tolls', amountCents: 100 }))).toBe('ITEM_NOT_FOUND');
    expect(await count(h.db, 'expenses')).toBe(0);
    expect(h.events).toEqual([]);
  });

  it('descrizione e fornitore troppo lunghi vengono accorciati ai limiti del DB', async () => {
    const r = unwrap(await add({ description: 'd'.repeat(300), vendor: 'v'.repeat(100) }));
    expect(r.expense.description).toHaveLength(200);
    expect(r.expense.vendor).toHaveLength(80);
  });

  it('avvisa (senza bloccare) se esiste lo stesso importo nello stesso giorno in un\'altra fonte dei costi', async () => {
    await insertRow(h.db, 'service_records', serviceRow(vid, { service_on: '2026-09-10', total_cents: 21000 }));
    const dup = unwrap(await add({ categoryId: 'sys_other', amountCents: 21000 }));
    expect(dup.warnings).toHaveLength(1);
    expect(dup.warnings[0]).toContain('un intervento');
    const fuel = unwrap(await addFuelLog(h.deps, { vehicleId: vid, filledOn: '2026-09-11', quantityMilli: 30000, totalCents: 5000 }));
    expect(fuel.fuelLog.totalCents).toBe(5000);
    const dup2 = unwrap(await add({ spentOn: '2026-09-11', amountCents: 5000 }));
    expect(dup2.warnings[0]).toContain('un rifornimento');
    expect(unwrap(await add({ spentOn: '2026-09-12', amountCents: 5000 })).warnings).toEqual([]); // un altro giorno
    // l'altra spesa identica e' segnalata come «un'altra spesa»
    expect(unwrap(await add({ spentOn: '2026-09-11', amountCents: 5000, vendor: 'x' })).warnings.join(' ')).toContain('un\'altra spesa');
  });
});

describe('updateExpense, deleteExpense, restoreExpense', () => {
  it('modifica parziale: i campi non indicati restano', async () => {
    const e = unwrap(await add({ description: 'Sosta', vendor: 'Comune' })).expense;
    const u = unwrap(await updateExpense(h.deps, e.id, { amountCents: 1500, categoryId: 'sys_tolls', description: null }));
    expect(u.expense).toMatchObject({ amountCents: 1500, categoryId: 'sys_tolls', description: null, vendor: 'Comune', spentOn: '2026-09-10' });
    const v = unwrap(await updateExpense(h.deps, e.id, { spentOn: '2026-08-01' }));
    expect(v.expense.spentOn).toBe('2026-08-01');
    expect(v.expense.amountCents).toBe(1500);
  });

  it('rifiuta valori non validi e id sconosciuti; nessuna modifica parziale', async () => {
    const e = unwrap(await add()).expense;
    expect(errorCode(await updateExpense(h.deps, e.id, { amountCents: 0 }))).toBe('VALIDATION');
    expect(errorCode(await updateExpense(h.deps, e.id, { spentOn: '2027-01-01' }))).toBe('FUTURE_DATE');
    expect(errorCode(await updateExpense(h.deps, e.id, { categoryId: 'boh', amountCents: 9999 }))).toBe('VALIDATION');
    expect(errorCode(await updateExpense(h.deps, 'nessuna', { notes: 'x' }))).toBe('ITEM_NOT_FOUND');
    expect((await getExpense(h.deps, e.id))!.amountCents).toBe(1250);
  });

  it('elimina nel cestino e ripristina; due volte e\' ITEM_NOT_FOUND', async () => {
    const e = unwrap(await add()).expense;
    h.clearEvents();
    expect(unwrap(await deleteExpense(h.deps, e.id))).toEqual({ id: e.id, vehicleId: vid });
    expect(await getExpense(h.deps, e.id)).toBeNull();
    expect(await listExpenses(h.deps, vid)).toEqual([]);
    expect(await count(h.db, 'expenses')).toBe(1); // cestino
    expect(errorCode(await deleteExpense(h.deps, e.id))).toBe('ITEM_NOT_FOUND');
    expect(errorCode(await restoreExpense(h.deps, 'nessuna'))).toBe('ITEM_NOT_FOUND');
    expect(unwrap(await restoreExpense(h.deps, e.id)).id).toBe(e.id);
    expect(errorCode(await restoreExpense(h.deps, e.id))).toBe('ITEM_NOT_FOUND');
    expect(h.events).toHaveLength(2);
  });

  it('una spesa eliminata esce dai costi (v_costs) e ritorna col ripristino', async () => {
    const e = unwrap(await add()).expense;
    const costs = () => h.db.get<{ n: number; t: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(cents), 0) AS t FROM v_costs WHERE source = 'expense'");
    expect(await costs()).toEqual({ n: 1, t: 1250 });
    unwrap(await deleteExpense(h.deps, e.id));
    expect(await costs()).toEqual({ n: 0, t: 0 });
    unwrap(await restoreExpense(h.deps, e.id));
    expect(await costs()).toEqual({ n: 1, t: 1250 });
  });
});

describe('listExpenses', () => {
  beforeEach(async () => {
    unwrap(await add({ spentOn: '2026-01-05', categoryId: 'sys_tolls', amountCents: 400 }));
    unwrap(await add({ spentOn: '2026-02-10', categoryId: 'sys_parking', amountCents: 200 }));
    unwrap(await add({ spentOn: '2026-02-10', categoryId: 'sys_tolls', amountCents: 700 }));
    unwrap(await add({ spentOn: '2026-03-20', categoryId: 'sys_fines', amountCents: 9000 }));
  });

  it('dalla piu\' recente, con categoria; filtri per periodo (estremi inclusi) e categoria', async () => {
    const all = await listExpenses(h.deps, vid);
    expect(all.map((e) => e.spentOn)).toEqual(['2026-03-20', '2026-02-10', '2026-02-10', '2026-01-05']);
    expect(all[0]).toMatchObject({ categoryName: 'Multe', amountCents: 9000 });
    expect((await listExpenses(h.deps, vid, { from: '2026-02-10', to: '2026-02-10' })).map((e) => e.amountCents).sort()).toEqual([200, 700]);
    expect((await listExpenses(h.deps, vid, { from: '2026-02-01', to: '2026-03-31' }, { categoryId: 'sys_tolls' })).map((e) => e.amountCents)).toEqual([700]);
    expect((await listExpenses(h.deps, vid, null, { order: 'asc', limit: 2 })).map((e) => e.spentOn)).toEqual(['2026-01-05', '2026-02-10']);
    expect(await listExpenses(h.deps, 'nessuna')).toEqual([]);
  });
});
