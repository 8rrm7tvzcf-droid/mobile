// Revisione (AC-06.5, SPEC 6.3.6 punto 4, M-3): regolare -> scadenza a fine mese di data + 24 mesi; da ripetere -> promemoria
// entro un mese; sospesa -> avviso informativo senza dichiarazioni su dove si possa circolare (W-13).
import { describe, expect, it } from 'vitest';
import { INSPECTION_RULES } from '@/domain/italy';
import {
  REPEAT_REMINDER_TITLE,
  addServiceRecord,
  deleteServiceRecord,
  restoreServiceRecord,
  suggestItemsForLines,
  updateServiceRecord,
} from '@/usecases/services';
import { INSPECTION, garage, openOf, rows, unwrap } from './helpers';

const REV = { kind: 'inspection' as const, title: 'Revisione', km: 26000, totalCents: 7940 };

const repeatReminders = (db: Parameters<typeof rows>[0]) =>
  rows(db, `SELECT id, title, category, due_on, effective_due_on, status, origin, notes, deleted_at FROM reminders WHERE title = ? ORDER BY created_at, id`, [REPEAT_REMINDER_TITLE]);

describe('revisione: esito regolare', () => {
  it('la scadenza riparte dalla data REALE: fine mese di (data + 24 mesi)', async () => {
    const { env, v, items } = await garage({ insp: INSPECTION }, { first_registration_on: '2018-05-20' });
    expect(await openOf(env.db, items.insp!)).toMatchObject({ due_on: '2026-06-30' }); // era scaduta
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...REV, serviceOn: '2026-10-05', inspectionResult: 'regular', completeItemIds: 'suggested' }));
    expect(r.completions.map((c) => c.templateId)).toEqual(['tpl_inspection']);
    expect(await openOf(env.db, items.insp!)).toMatchObject({ due_on: '2028-10-31' }); // 2026-10-05 + 24 mesi = 2028-10-05 -> fine mese
    expect(r.completions[0]!.nextText).toBe('Prossimo revisione periodica: entro il 31/10/2028.');
    expect(r.record).toMatchObject({ kind: 'inspection', inspectionResult: 'regular', inspectionNotice: null });
    expect(r.repeatReminderId).toBeNull();
    expect(await repeatReminders(env.db)).toEqual([]);
  });

  it('fine mese bisestile: revisione del 10-2-2026 -> 29-2-2028', async () => {
    const { env, v, items } = await garage({ insp: INSPECTION });
    unwrap(await addServiceRecord(env.deps, { vehicleId: v, kind: 'inspection', title: 'Revisione', serviceOn: '2026-02-10', inspectionResult: 'regular', completeItemIds: [items.insp!] }));
    expect(await openOf(env.db, items.insp!)).toMatchObject({ due_on: '2028-02-29' });
  });
});

describe('revisione: esito da ripetere', () => {
  it('non completa la voce della revisione; nasce il promemoria "Rifare la revisione" entro un mese di calendario', async () => {
    const { env, v, items } = await garage({ insp: INSPECTION });
    const before = await openOf(env.db, items.insp!);
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...REV, serviceOn: '2026-10-05', inspectionResult: 'repeat', completeItemIds: 'suggested' }));
    expect(r.completions).toEqual([]); // "da ripetere" non e' una revisione superata
    expect(await openOf(env.db, items.insp!)).toMatchObject({ id: before['id'], due_on: '2026-06-30' });

    expect(r.repeatReminderId).not.toBeNull();
    const [rem] = await repeatReminders(env.db);
    expect(rem).toMatchObject({
      id: r.repeatReminderId, title: 'Rifare la revisione', category: 'legal', origin: 'manual', status: 'open', due_on: '2026-11-05',
      effective_due_on: '2026-11-05', deleted_at: null,
    });
    expect(rem!['notes']).toContain('05/10/2026');
    expect(r.record.inspectionNotice).toBe(INSPECTION_RULES.repeat.warningText);
  });

  it('il suggerimento spiega perche la revisione non si segna fatta', async () => {
    const { env, v, items } = await garage({ insp: INSPECTION });
    const sug = await suggestItemsForLines(env.deps, v, [], { kind: 'inspection', inspectionResult: 'repeat', title: 'Revisione' });
    expect(sug.find((s) => s.itemId === items.insp)).toMatchObject({ matched: false, preselected: false });
    expect(sug[0]!.reason).toContain('da ripetere');
    const reg = await suggestItemsForLines(env.deps, v, [], { kind: 'inspection', inspectionResult: 'regular', title: 'Revisione' });
    expect(reg[0]).toMatchObject({ matched: true, preselected: true });
  });

  it('modificare l esito o la data sposta/toglie il promemoria; senza cambi non lo tocca', async () => {
    const { env, v, items } = await garage({ insp: INSPECTION });
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...REV, serviceOn: '2026-10-05', inspectionResult: 'repeat' }));
    const id = r.record.id;

    const same = unwrap(await updateServiceRecord(env.deps, id, { notes: 'verbale n. 12' }));
    expect(same.repeatReminderId).toBe(r.repeatReminderId);
    expect(await repeatReminders(env.db)).toHaveLength(1);

    const moved = unwrap(await updateServiceRecord(env.deps, id, { serviceOn: '2026-10-01' }));
    expect(moved.repeatReminderId).not.toBe(r.repeatReminderId);
    const list = await repeatReminders(env.db);
    expect(list.filter((x) => x['deleted_at'] === null)).toHaveLength(1);
    expect(list.find((x) => x['deleted_at'] === null)).toMatchObject({ due_on: '2026-11-01' });

    const regular = unwrap(await updateServiceRecord(env.deps, id, { inspectionResult: 'regular', completeItemIds: [items.insp!] }));
    expect(regular.repeatReminderId).toBeNull();
    expect((await repeatReminders(env.db)).filter((x) => x['deleted_at'] === null)).toEqual([]);
    expect(await openOf(env.db, items.insp!)).toMatchObject({ due_on: '2028-10-31' });
  });

  it('cambiando il tipo l esito si azzera e il promemoria sparisce', async () => {
    const { env, v } = await garage({ insp: INSPECTION });
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...REV, serviceOn: '2026-10-05', inspectionResult: 'repeat' }));
    const u = unwrap(await updateServiceRecord(env.deps, r.record.id, { kind: 'repair', title: 'Riparazioni dopo la revisione' }));
    expect(u.record).toMatchObject({ kind: 'repair', inspectionResult: null, inspectionNotice: null });
    expect((await repeatReminders(env.db)).filter((x) => x['deleted_at'] === null)).toEqual([]);
  });

  it('eliminare l intervento toglie il promemoria; ripristinarlo lo ricrea', async () => {
    const { env, v } = await garage({ insp: INSPECTION });
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...REV, serviceOn: '2026-10-05', inspectionResult: 'repeat' }));
    unwrap(await deleteServiceRecord(env.deps, r.record.id));
    expect((await repeatReminders(env.db)).filter((x) => x['deleted_at'] === null)).toEqual([]);
    unwrap(await restoreServiceRecord(env.deps, r.record.id));
    const active = (await repeatReminders(env.db)).filter((x) => x['deleted_at'] === null);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ due_on: '2026-11-05', status: 'open' });
  });
});

describe('revisione: esito sospesa', () => {
  it('nessuna scadenza ne completamento: solo l avviso informativo, senza dichiarazioni su dove si possa circolare', async () => {
    const { env, v, items } = await garage({ insp: INSPECTION });
    const before = await openOf(env.db, items.insp!);
    const r = unwrap(await addServiceRecord(env.deps, { vehicleId: v, ...REV, serviceOn: '2026-10-05', inspectionResult: 'suspended', completeItemIds: 'suggested' }));
    expect(r.completions).toEqual([]);
    expect(r.repeatReminderId).toBeNull();
    expect(await repeatReminders(env.db)).toEqual([]);
    expect(await openOf(env.db, items.insp!)).toMatchObject({ id: before['id'], due_on: '2026-06-30' });
    expect(r.record.inspectionNotice).toBe("Dopo una revisione sospesa serve una nuova richiesta di revisione: leggi le indicazioni sul Portale dell'Automobilista.");
    expect(r.record.inspectionNotice).not.toMatch(/circol/i);
  });
});
