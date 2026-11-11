// Officine (F-38): creazione senza doppioni, modifica parziale, preferite, uso, eliminazione.
import { describe, expect, it } from 'vitest';
import { addServiceRecord, deleteServiceRecord, deleteWorkshop, getServiceRecord, listWorkshops, upsertWorkshop } from '@/usecases/services';
import { errorOf, garage, makeEnv, rows, unwrap } from './helpers';

describe('upsertWorkshop', () => {
  it('crea un officina con tutti i campi e emette l evento', async () => {
    const env = await makeEnv();
    const w = unwrap(
      await upsertWorkshop(env.deps, {
        name: '  Officina Rossi ', phone: '011 123456', email: 'info@rossi.it', website: 'https://rossi.it', address: 'Via Roma 1', city: 'Torino', notes: 'Aperta il sabato', isFavorite: true,
      }),
    );
    expect(w).toMatchObject({
      name: 'Officina Rossi', phone: '011 123456', email: 'info@rossi.it', website: 'https://rossi.it', address: 'Via Roma 1', city: 'Torino',
      notes: 'Aperta il sabato', isFavorite: true, serviceCount: 0, lastServiceOn: null, totalSpentCents: 0,
    });
    expect(w.id).toHaveLength(26);
    expect(env.events).toEqual([{ type: 'data-changed', scope: 'service' }]);
  });

  it('con lo stesso nome (senza distinguere maiuscole) riusa quella esistente e aggiorna solo i campi indicati', async () => {
    const env = await makeEnv();
    const a = unwrap(await upsertWorkshop(env.deps, { name: 'Officina Rossi', city: 'Torino', phone: '011 1' }));
    const b = unwrap(await upsertWorkshop(env.deps, { name: 'officina ROSSI', phone: null, notes: 'ottimi prezzi' }));
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ name: 'Officina Rossi', city: 'Torino', phone: '011 1', notes: 'ottimi prezzi' }); // il null non cancella un dato esistente
    expect(await rows(env.db, 'SELECT id FROM workshops')).toHaveLength(1);
  });

  it('con id modifica: i campi assenti restano, null svuota; il nome si puo cambiare', async () => {
    const env = await makeEnv();
    const a = unwrap(await upsertWorkshop(env.deps, { name: 'Officina Rossi', city: 'Torino', phone: '011 1' }));
    const b = unwrap(await upsertWorkshop(env.deps, { id: a.id, name: 'Rossi Auto', phone: null, isFavorite: true }));
    expect(b).toMatchObject({ id: a.id, name: 'Rossi Auto', phone: null, city: 'Torino', isFavorite: true });
    expect(await rows(env.db, 'SELECT id FROM workshops')).toHaveLength(1);
  });

  it('errori: nome mancante o troppo lungo, email non valida, id inesistente, campi troppo lunghi', async () => {
    const env = await makeEnv();
    expect(errorOf(await upsertWorkshop(env.deps, {}))).toMatchObject({ code: 'VALIDATION', field: 'name' });
    expect(errorOf(await upsertWorkshop(env.deps, { name: '   ' }))).toMatchObject({ code: 'VALIDATION', field: 'name' });
    expect(errorOf(await upsertWorkshop(env.deps, { name: 'x'.repeat(81) }))).toMatchObject({ field: 'name' });
    expect(errorOf(await upsertWorkshop(env.deps, { name: 'A', email: 'non-una-mail' }))).toMatchObject({ field: 'email' });
    expect(errorOf(await upsertWorkshop(env.deps, { name: 'A', phone: '1'.repeat(31) }))).toMatchObject({ field: 'phone' });
    expect(errorOf(await upsertWorkshop(env.deps, { id: '01TESTID000000000000009999', name: 'A' }))).toEqual({ code: 'ITEM_NOT_FOUND' });
    expect(await rows(env.db, 'SELECT id FROM workshops')).toEqual([]);
  });
});

describe('listWorkshops', () => {
  it('preferite prima, poi usate di recente; con uso (interventi, ultima visita, spesa); i cestinati non contano', async () => {
    const { env, v } = await garage({});
    const rossi = unwrap(await upsertWorkshop(env.deps, { name: 'Rossi' }));
    const bianchi = unwrap(await upsertWorkshop(env.deps, { name: 'Bianchi' }));
    const verdi = unwrap(await upsertWorkshop(env.deps, { name: 'Verdi', isFavorite: true }));
    unwrap(await upsertWorkshop(env.deps, { name: 'Neri' }));
    const a = unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-03-01', kind: 'repair', title: 'A', totalCents: 10000, workshopId: rossi.id }));
    unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-09-01', kind: 'repair', title: 'B', totalCents: 5050, workshopId: rossi.id }));
    unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-05-01', kind: 'repair', title: 'C', totalCents: 3000, workshopId: bianchi.id }));

    const list = await listWorkshops(env.deps);
    expect(list.map((w) => w.name)).toEqual(['Verdi', 'Rossi', 'Bianchi', 'Neri']);
    expect(list.find((w) => w.id === rossi.id)).toMatchObject({ serviceCount: 2, lastServiceOn: '2026-09-01', totalSpentCents: 15050 });
    expect(list.find((w) => w.id === verdi.id)).toMatchObject({ serviceCount: 0, lastServiceOn: null, totalSpentCents: 0 });

    unwrap(await deleteServiceRecord(env.deps, a.record.id));
    expect((await listWorkshops(env.deps)).find((w) => w.id === rossi.id)).toMatchObject({ serviceCount: 1, totalSpentCents: 5050 });
  });

  it('per nome e con ricerca su nome e citta', async () => {
    const env = await makeEnv();
    unwrap(await upsertWorkshop(env.deps, { name: 'Zeta Auto', city: 'Asti' }));
    unwrap(await upsertWorkshop(env.deps, { name: 'alfa motori', city: 'Torino' }));
    unwrap(await upsertWorkshop(env.deps, { name: 'Beta', city: 'Alessandria' }));
    expect((await listWorkshops(env.deps, { order: 'name' })).map((w) => w.name)).toEqual(['alfa motori', 'Beta', 'Zeta Auto']);
    expect((await listWorkshops(env.deps, { search: 'tori' })).map((w) => w.name)).toEqual(['alfa motori']);
    expect((await listWorkshops(env.deps, { search: 'AL', order: 'name' })).map((w) => w.name)).toEqual(['alfa motori', 'Beta']);
    expect(await listWorkshops(env.deps, { search: '%' })).toEqual([]); // % e' un carattere normale
  });
});

describe('deleteWorkshop', () => {
  it('esce dall elenco ma gli interventi ne conservano il nome', async () => {
    const { env, v } = await garage({});
    const w = unwrap(await upsertWorkshop(env.deps, { name: 'Rossi' }));
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-03-01', kind: 'repair', title: 'A', workshopId: w.id }));
    unwrap(await deleteWorkshop(env.deps, w.id));
    expect(await listWorkshops(env.deps)).toEqual([]);
    expect((await getServiceRecord(env.deps, r.record.id))!.workshop).toMatchObject({ name: 'Rossi' });
    expect(errorOf(await deleteWorkshop(env.deps, w.id))).toEqual({ code: 'ITEM_NOT_FOUND' });
    // non si puo' piu' scegliere per un nuovo intervento
    expect(errorOf(await addServiceRecord(env.deps, { vehicleId: v, serviceOn: '2026-03-02', kind: 'repair', title: 'B', workshopId: w.id }))).toMatchObject({ field: 'workshopId' });
    // ma se si indica di nuovo per nome ne nasce una nuova
    const again = unwrap(await upsertWorkshop(env.deps, { name: 'Rossi' }));
    expect(again.id).not.toBe(w.id);
  });
});
