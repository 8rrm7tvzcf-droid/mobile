// Polizze (AC-05, F-52/F-55): inserimento, rate, scadenza stampata vs stimata, tolleranza RC solo informativa,
// promemoria generati dal motore e invarianti I1-I5, modifica, eliminazione e ripristino.
import { beforeEach, describe, expect, it } from 'vitest';
import { reconcileVehicle } from '@/usecases/deadlines';
import {
  addPolicy,
  deletePolicy,
  getPolicy,
  listPolicies,
  restorePolicy,
  updatePolicy,
} from '@/usecases/insurance';
import type { AddPolicyInput } from '@/usecases/insurance';
import { count, errorOf, expectAtMostOneOpen, makeEnv, makeVehicle, openReminders, rows, unwrap } from '../fluids/harness';
import type { Env } from '../fluids/harness';

let env: Env;
let vid: string;

beforeEach(async () => {
  env = await makeEnv(); // oggi = 2026-10-08
  vid = await makeVehicle(env);
});

const base = (o: Partial<AddPolicyInput> = {}): AddPolicyInput => ({
  vehicleId: vid,
  kind: 'rca',
  company: 'Unipol',
  policyNumber: 'RC-123',
  startOn: '2026-03-10',
  endOn: '2027-03-10',
  premiumCents: 60000,
  installments: 4,
  ...o,
});
const add = (o: Partial<AddPolicyInput> = {}) => addPolicy(env.deps, base(o));

const reminderRows = (policyId?: string) =>
  rows(
    env.db,
    `SELECT title, category, due_on, effective_due_on, due_trigger, notify_offsets_days, soon_days, status, completed_on, policy_id, payment_id
     FROM reminders WHERE vehicle_id = ? AND deleted_at IS NULL ${policyId ? 'AND (policy_id = ? OR payment_id IN (SELECT id FROM insurance_payments WHERE policy_id = ?))' : ''}
     ORDER BY effective_due_on, title`,
    policyId ? [vid, policyId, policyId] : [vid],
  );

describe('addPolicy: dati, rate e garanzie (F-52, F-54, F-55)', () => {
  it('salva la polizza come stampata sul certificato e restituisce il dettaglio con i testi italiani', async () => {
    const { policy, endIsEstimated } = unwrap(
      await add({
        agencyName: 'Agenzia Centro',
        meritClass: 4,
        blackBox: true,
        claimsPhone: '800 111 222',
        claimsEmail: 'sinistri@example.test',
        assistancePhone: '800 333 444',
        agentName: 'Mario Rossi',
        agentPhone: '06 1234567',
        agentEmail: 'agente@example.test',
        notes: '  Polizza di prova ',
      }),
    );
    expect(endIsEstimated).toBe(false);
    expect(policy).toMatchObject({
      vehicleId: vid,
      kind: 'rca',
      kindLabel: 'RC auto',
      company: 'Unipol',
      agencyName: 'Agenzia Centro',
      policyNumber: 'RC-123',
      startOn: '2026-03-10',
      endOn: '2027-03-10',
      premiumCents: 60000,
      paymentFrequency: 'quarterly',
      meritClass: 4,
      blackBox: true,
      claimsPhone: '800 111 222',
      claimsEmail: 'sinistri@example.test',
      assistancePhone: '800 333 444',
      agentName: 'Mario Rossi',
      agentPhone: '06 1234567',
      agentEmail: 'agente@example.test',
      notes: 'Polizza di prova',
      renewedFromId: null,
      renewedById: null,
      cancelledOn: null,
      status: 'active',
      statusLabel: 'Attiva',
    });
    expect(policy.warningIt).toContain('La data di scadenza è quella indicata sul tuo contratto');
    expect(policy.id).toHaveLength(26);
  });

  it('il premio si divide con splitInstallments: il resto sulla prima rata, scadenze dalla decorrenza con clamp di fine mese', async () => {
    const { policy } = unwrap(await add({ premiumCents: 60001, startOn: '2026-01-31', endOn: '2027-01-31' }));
    expect(policy.installments.map((i) => [i.installmentNo, i.dueOn, i.amountCents])).toEqual([
      [1, '2026-01-31', 15001],
      [2, '2026-04-30', 15000],
      [3, '2026-07-31', 15000],
      [4, '2026-10-31', 15000],
    ]);
    expect(policy.installments.reduce((s, i) => s + i.amountCents, 0)).toBe(60001);
    expect(policy.installments.every((i) => i.installmentCount === 4)).toBe(true);
  });

  it('1, 2, 4 e 12 rate; la frequenza si deduce dal numero e viceversa; "single" e un pagamento unico', async () => {
    for (const [n, freq] of [[1, 'annual'], [2, 'semiannual'], [4, 'quarterly'], [12, 'monthly']] as const) {
      const { policy } = unwrap(await add({ kind: 'kasko', installments: n, premiumCents: 120000 }));
      expect(policy.paymentFrequency).toBe(freq);
      expect(policy.installmentCount).toBe(n);
      await deletePolicy(env.deps, policy.id);
    }
    const monthly = unwrap(await add({ kind: 'furto_incendio', installments: undefined, paymentFrequency: 'monthly', premiumCents: 12001 }));
    expect(monthly.policy.installmentCount).toBe(12);
    expect(monthly.policy.installments[0]!.amountCents).toBe(1001);
    const single = unwrap(await add({ kind: 'other', installments: undefined, paymentFrequency: 'single' }));
    expect(single.policy).toMatchObject({ paymentFrequency: 'single', installmentCount: 1 });
  });

  it('senza premio non nascono rate ne promemoria di rata (nessun importo inventato), ma la scadenza resta', async () => {
    const { policy } = unwrap(await add({ premiumCents: undefined }));
    expect(policy).toMatchObject({ premiumCents: 0, installmentCount: 0, nextUnpaid: null });
    expect(await count(env.db, 'insurance_payments')).toBe(0);
    expect((await reminderRows()).map((r) => r['title'])).toEqual(['Scadenza RCA Unipol']);
  });

  it('rate gia pagate: paid_on = scadenza della rata (mai nel futuro) e nessun promemoria per quelle', async () => {
    const { policy } = unwrap(await add({ paidInstallmentNos: [1, 2, 4] })); // la 4 scade il 2026-12-10, dopo oggi
    expect(policy.installments.map((i) => i.paidOn)).toEqual(['2026-03-10', '2026-06-10', null, '2026-10-08']);
    expect(policy).toMatchObject({ paidCount: 3, paidCents: 45000, unpaidCents: 15000 });
    expect(policy.nextUnpaid).toMatchObject({ installmentNo: 3, state: 'overdue' });
    const titles = (await reminderRows()).map((r) => r['title']);
    expect(titles).toContain('Rata 3/4');
    expect(titles).not.toContain('Rata 1/4');
    expect(titles).not.toContain('Rata 4/4');
  });

  it('garanzie (F-55): elenco, massimale e franchigia della garanzia principale del tipo', async () => {
    const { policy } = unwrap(
      await add({
        limitCents: 645_000_000,
        deductibleCents: 25_000,
        coverages: [
          { code: 'cristalli', limitCents: 50_000, deductibleBp: 1000 },
          { code: 'assistenza', notes: 'Soccorso stradale h24' },
        ],
      }),
    );
    expect(policy.coverages.map((c) => c.code).sort()).toEqual(['assistenza', 'cristalli', 'rca']);
    expect(policy.coverages.find((c) => c.code === 'rca')).toMatchObject({ label: 'RC auto', limitCents: 645_000_000, deductibleCents: 25_000, deductibleBp: null });
    expect(policy.coverages.find((c) => c.code === 'cristalli')).toMatchObject({ label: 'Cristalli', limitCents: 50_000, deductibleBp: 1000 });
    expect(policy.coverages.find((c) => c.code === 'assistenza')).toMatchObject({ label: 'Assistenza stradale', notes: 'Soccorso stradale h24' });
    // una polizza dedicata ai cristalli e di tipo "altro" con la garanzia cristalli
    const glass = unwrap(await add({ kind: 'other', company: 'Vetri SpA', coverages: [{ code: 'cristalli' }], premiumCents: 5000, installments: 1 }));
    expect(glass.policy.kindLabel).toBe('Altro');
  });

  it('scadenza mancante: decorrenza + 12 mesi e il risultato la dichiara stimata (A1, A2)', async () => {
    const a1 = unwrap(await add({ startOn: '2025-03-10', endOn: undefined }));
    expect(a1).toMatchObject({ endIsEstimated: true, policy: { endOn: '2026-03-10' } });
    const a2 = unwrap(await add({ kind: 'kasko', startOn: '2024-02-29', endOn: null }));
    expect(a2).toMatchObject({ endIsEstimated: true, policy: { endOn: '2025-02-28' } });
  });

  it('validazione: messaggi in italiano, nessuna scrittura', async () => {
    const cases: [Partial<AddPolicyInput>, string][] = [
      [{ company: '   ' }, 'company'],
      [{ company: 'x'.repeat(81) }, 'company'],
      [{ policyNumber: 'n'.repeat(41) }, 'policyNumber'],
      [{ startOn: '2026-02-30' }, 'startOn'],
      [{ endOn: '2026-13-01' }, 'endOn'],
      [{ startOn: '2026-03-10', endOn: '2026-03-10' }, 'endOn'],
      [{ endOn: '2026-03-09' }, 'endOn'],
      [{ premiumCents: -1 }, 'premiumCents'],
      [{ premiumCents: 100.5 }, 'premiumCents'],
      [{ installments: 3 as never }, 'installments'],
      [{ installments: 4, paymentFrequency: 'monthly' }, 'installments'],
      [{ installments: undefined, paymentFrequency: 'weekly' as never }, 'paymentFrequency'],
      [{ meritClass: 0 }, 'meritClass'],
      [{ meritClass: 19 }, 'meritClass'],
      [{ claimsEmail: 'non-una-mail' }, 'claimsEmail'],
      [{ kind: 'moto' as never }, 'kind'],
      [{ coverages: [{ code: 'rca' }, { code: 'rca' }] }, 'coverages[1].code'],
      [{ coverages: [{ code: 'volo' as never }] }, 'coverages[0].code'],
      [{ coverages: [{ code: 'rca', limitCents: -5 }] }, 'coverages[0].limitCents'],
      [{ coverages: [{ code: 'rca', deductibleBp: 10001 }] }, 'coverages[0].deductibleBp'],
      [{ paidInstallmentNos: [5] }, 'paidInstallmentNos'],
      [{ paidInstallmentNos: [0] }, 'paidInstallmentNos'],
      [{ premiumCents: 0, paidInstallmentNos: [1] }, 'paidInstallmentNos'],
    ];
    for (const [input, field] of cases) {
      const e = errorOf(await add(input));
      expect(e, JSON.stringify(input)).toMatchObject({ code: 'VALIDATION', field });
      expect(e.message).toEqual(expect.any(String));
    }
    expect(errorOf(await addPolicy(env.deps, base({ vehicleId: 'nope' }))).code).toBe('ITEM_NOT_FOUND');
    expect(await count(env.db, 'insurance_policies')).toBe(0);
    expect(await count(env.db, 'insurance_payments')).toBe(0);
    expect(env.events).toEqual([]);
  });

  it('emette gli eventi dopo il commit: insurance e reminders', async () => {
    unwrap(await add());
    expect(env.events).toEqual([
      { type: 'data-changed', scope: 'insurance', vehicleId: vid },
      { type: 'data-changed', scope: 'reminders', vehicleId: vid },
    ]);
  });
});

describe('promemoria generati dal motore (AC-05.1, I1-I5)', () => {
  it('AC-05.1: RC con scadenza 2026-03-10 genera il promemoria a 30, 14, 7, 1 e 0 giorni; le rate a 7, 1 e 0', async () => {
    const e2 = await makeEnv('2026-01-05T09:00:00.000Z');
    const v2 = await makeVehicle(e2);
    const { policy } = unwrap(
      await addPolicy(e2.deps, { vehicleId: v2, kind: 'rca', company: 'Generali', startOn: '2025-03-10', endOn: '2026-03-10', premiumCents: 40000, installments: 2 }),
    );
    const list = await rows(
      e2.db,
      `SELECT title, category, due_on, effective_due_on, due_trigger, notify_offsets_days, soon_days, status, policy_id, payment_id FROM reminders
       WHERE vehicle_id = ? AND deleted_at IS NULL ORDER BY effective_due_on, title`,
      [v2],
    );
    const rca = list.find((r) => r['policy_id'] === policy.id)!;
    expect(rca).toMatchObject({
      title: 'Scadenza RCA Generali',
      category: 'insurance',
      due_on: '2026-03-10',
      effective_due_on: '2026-03-10',
      due_trigger: 'time',
      notify_offsets_days: '[30,14,7,1,0]',
      soon_days: 30,
      status: 'open',
    });
    const rate = list.filter((r) => r['payment_id'] !== null);
    expect(rate.map((r) => [r['title'], r['due_on'], r['notify_offsets_days'], r['soon_days']])).toEqual([
      ['Rata 1/2', '2025-03-10', '[7,1,0]', 7],
      ['Rata 2/2', '2025-09-10', '[7,1,0]', 7],
    ]);
  });

  it('I1: al massimo un promemoria aperto per polizza e per rata, dopo qualunque sequenza di operazioni', async () => {
    const a = unwrap(await add()).policy;
    await reconcileVehicle(env.deps, vid);
    unwrap(await updatePolicy(env.deps, { policyId: a.id, endOn: '2027-04-10' }));
    await reconcileVehicle(env.deps, vid);
    unwrap(await add({ company: 'Altra', startOn: '2027-03-10', endOn: '2028-03-10' }));
    await reconcileVehicle(env.deps, vid);
    await expectAtMostOneOpen(env.db, vid);
    const open = await openReminders(env.db, vid);
    expect(open.filter((r) => r['policy_id'] !== null)).toHaveLength(1); // una sola polizza RC corrente
  });

  it('I2: il motore non modifica i dati dell utente (polizze, rate, garanzie), solo la cache dei promemoria generati', async () => {
    unwrap(await add({ limitCents: 100, coverages: [{ code: 'cristalli' }] }));
    const snap = async () => ({
      p: await rows(env.db, 'SELECT * FROM insurance_policies ORDER BY id'),
      pay: await rows(env.db, 'SELECT * FROM insurance_payments ORDER BY id'),
      c: await rows(env.db, 'SELECT * FROM insurance_coverages ORDER BY id'),
    });
    const before = await snap();
    env.clock.set('2026-11-20T09:00:00.000Z');
    await reconcileVehicle(env.deps, vid);
    expect(await snap()).toEqual(before);
  });

  it('I3/AC-05.2: la tolleranza dell RC e solo una nota informativa e non sposta ne la scadenza ne il promemoria', async () => {
    const a = unwrap(await add({ startOn: '2025-10-01', endOn: '2026-10-01', premiumCents: 0 })).policy; // scaduta da 7 giorni
    expect(a.expiry).toMatchObject({ state: 'in_grace', label: 'In tolleranza', daysOverdue: 7, graceEndsOn: '2026-10-16' });
    expect(a.expiry.note).toContain('Non farci affidamento');
    expect(a.status).toBe('expired');
    const [r] = await reminderRows(a.id);
    expect(r).toMatchObject({ due_on: '2026-10-01', effective_due_on: '2026-10-01', status: 'open' }); // non spostato di 15 giorni

    env.clock.set('2026-10-16T09:00:00.000Z'); // A5: ultimo giorno
    expect((await getPolicy(env.deps, a.id))!.expiry).toMatchObject({ state: 'in_grace', daysOverdue: 15 });
    env.clock.set('2026-10-17T09:00:00.000Z'); // A6: scoperta
    const later = (await getPolicy(env.deps, a.id))!;
    expect(later.expiry).toMatchObject({ state: 'uncovered', label: 'Scoperta', note: null });
    await reconcileVehicle(env.deps, vid);
    expect((await reminderRows(a.id))[0]).toMatchObject({ due_on: '2026-10-01', status: 'open' });
  });

  it('A3: scade oggi; le altre polizze (kasko) usano lo stato generico senza la nota dell RC', async () => {
    const rca = unwrap(await add({ startOn: '2025-10-08', endOn: '2026-10-08', premiumCents: 0 })).policy;
    expect(rca.expiry).toMatchObject({ state: 'due_today', label: 'Scade oggi', daysLeft: 0 });
    expect(rca.status).toBe('expiring');
    const kasko = unwrap(await add({ kind: 'kasko', startOn: '2025-09-01', endOn: '2026-10-01', premiumCents: 0 })).policy;
    expect(kasko.expiry).toMatchObject({ state: 'overdue', label: 'Scaduta da 7 giorni', daysOverdue: 7, note: null, graceEndsOn: null });
    expect(kasko.warningIt).toBeNull();
    expect(kasko.status).toBe('expired');
  });

  it('I5: la riconciliazione e idempotente: una seconda esecuzione non cambia nulla e non emette eventi', async () => {
    unwrap(await add());
    const before = await reminderRows();
    env.clearEvents();
    await reconcileVehicle(env.deps, vid);
    await reconcileVehicle(env.deps, vid);
    expect(await reminderRows()).toEqual(before);
    expect(env.events).toEqual([]);
  });

  it('una polizza piu recente dello stesso tipo chiude il promemoria della precedente (SPEC 8.3)', async () => {
    const old = unwrap(await add({ premiumCents: 0 })).policy;
    const recent = unwrap(await add({ company: 'Nuova', startOn: '2027-03-10', endOn: '2028-03-10', premiumCents: 0 })).policy;
    const oldReminder = (await reminderRows(old.id))[0]!;
    expect(oldReminder).toMatchObject({ status: 'done', title: 'Scadenza RCA Unipol' });
    expect((await reminderRows(recent.id))[0]).toMatchObject({ status: 'open', title: 'Scadenza RCA Nuova', due_on: '2028-03-10' });
    expect((await getPolicy(env.deps, old.id))!.status).toBe('renewed');
  });

  it('un veicolo non attivo (venduto) non genera promemoria', async () => {
    await env.db.run(`UPDATE vehicles SET status = 'sold', sold_on = '2026-09-01' WHERE id = ?`, [vid]);
    unwrap(await add());
    expect(await reminderRows()).toEqual([]);
  });
});

describe('updatePolicy', () => {
  it('modifica i campi indicati e il promemoria segue (titolo e scadenza); gli altri campi non cambiano', async () => {
    const p = unwrap(await add({ agencyName: 'Agenzia Centro' })).policy;
    env.clearEvents();
    const u = unwrap(await updatePolicy(env.deps, { policyId: p.id, company: 'Allianz', endOn: '2027-04-01', meritClass: 2, notes: null }));
    expect(u).toMatchObject({ company: 'Allianz', endOn: '2027-04-01', meritClass: 2, notes: null, agencyName: 'Agenzia Centro', policyNumber: 'RC-123', premiumCents: 60000 });
    const rca = (await reminderRows(p.id)).find((r) => r['policy_id'] === p.id)!;
    expect(rca).toMatchObject({ title: 'Scadenza RCA Allianz', due_on: '2027-04-01', status: 'open' });
    expect(env.events).toEqual([
      { type: 'data-changed', scope: 'insurance', vehicleId: vid },
      { type: 'data-changed', scope: 'reminders', vehicleId: vid },
    ]);
    await expectAtMostOneOpen(env.db, vid);
  });

  it('un valore null cancella un campo facoltativo; undefined lo lascia com e', async () => {
    const p = unwrap(await add({ agencyName: 'Centro', claimsPhone: '800' })).policy;
    const u = unwrap(await updatePolicy(env.deps, { policyId: p.id, agencyName: null, claimsPhone: undefined }));
    expect(u.agencyName).toBeNull();
    expect(u.claimsPhone).toBe('800');
  });

  it('premio e rate: il piano si rigenera (riusando le righe), anche passando da 12 a 2 rate e ritorno', async () => {
    const p = unwrap(await add({ installments: 12, premiumCents: 120000, startOn: '2026-10-10', endOn: '2027-10-10' })).policy;
    expect(p.installmentCount).toBe(12);
    const two = unwrap(await updatePolicy(env.deps, { policyId: p.id, installments: 2 }));
    expect(two.installments.map((i) => [i.installmentNo, i.dueOn, i.amountCents])).toEqual([
      [1, '2026-10-10', 60000],
      [2, '2027-04-10', 60000],
    ]);
    expect(two.paymentFrequency).toBe('semiannual');
    expect(await count(env.db, 'insurance_payments', 'policy_id = ? AND deleted_at IS NULL', [p.id])).toBe(2);
    expect((await reminderRows(p.id)).filter((r) => r['payment_id'] !== null).map((r) => r['title'])).toEqual(['Rata 1/2', 'Rata 2/2']);

    const back = unwrap(await updatePolicy(env.deps, { policyId: p.id, installments: 12, premiumCents: 120001 }));
    expect(back.installmentCount).toBe(12);
    expect(back.installments[0]!.amountCents).toBe(10001); // il resto sulla prima
    expect(await count(env.db, 'insurance_payments', 'policy_id = ?', [p.id])).toBe(12); // righe riusate, nessun doppione
    await expectAtMostOneOpen(env.db, vid);
  });

  it('con rate gia pagate premio, rate e decorrenza non si cambiano (VALIDATION) ma scadenza e compagnia si', async () => {
    const p = unwrap(await add({ paidInstallmentNos: [1] })).policy;
    const before = await rows(env.db, 'SELECT * FROM insurance_payments ORDER BY id');
    expect(errorOf(await updatePolicy(env.deps, { policyId: p.id, premiumCents: 70000 }))).toMatchObject({ code: 'VALIDATION', field: 'premiumCents' });
    expect(errorOf(await updatePolicy(env.deps, { policyId: p.id, installments: 2 }))).toMatchObject({ code: 'VALIDATION', field: 'installments' });
    expect(errorOf(await updatePolicy(env.deps, { policyId: p.id, startOn: '2026-03-11' }))).toMatchObject({ code: 'VALIDATION', field: 'startOn' });
    expect(await rows(env.db, 'SELECT * FROM insurance_payments ORDER BY id')).toEqual(before);
    const ok = unwrap(await updatePolicy(env.deps, { policyId: p.id, company: 'Reale Mutua', endOn: '2027-03-31' }));
    expect(ok).toMatchObject({ company: 'Reale Mutua', endOn: '2027-03-31', paidCount: 1 });
    // premio uguale e rate uguali: nessun problema anche se pagate
    unwrap(await updatePolicy(env.deps, { policyId: p.id, premiumCents: 60000, installments: 4 }));
  });

  it('annullare la polizza (cancelledOn) toglie i promemoria di scadenza e di rata; toglierlo li fa rinascere', async () => {
    const p = unwrap(await add()).policy;
    expect((await reminderRows(p.id)).length).toBeGreaterThan(1);
    const c = unwrap(await updatePolicy(env.deps, { policyId: p.id, cancelledOn: '2026-09-30' }));
    expect(c).toMatchObject({ status: 'cancelled', statusLabel: 'Annullata', cancelledOn: '2026-09-30' });
    expect(await reminderRows(p.id)).toEqual([]);
    const back = unwrap(await updatePolicy(env.deps, { policyId: p.id, cancelledOn: null }));
    expect(back.status).not.toBe('cancelled');
    expect((await reminderRows(p.id)).length).toBeGreaterThan(1);
    expect(errorOf(await updatePolicy(env.deps, { policyId: p.id, cancelledOn: '2026-03-09' }))).toMatchObject({ field: 'cancelledOn' });
    expect(errorOf(await updatePolicy(env.deps, { policyId: p.id, cancelledOn: '2026-13-01' }))).toMatchObject({ field: 'cancelledOn' });
  });

  it('garanzie: l elenco sostituisce quello esistente; massimale e franchigia toccano solo la garanzia principale', async () => {
    const p = unwrap(await add({ coverages: [{ code: 'cristalli', limitCents: 100 }, { code: 'assistenza' }], limitCents: 5000 })).policy;
    const mainId = p.coverages.find((c) => c.code === 'rca')!.id;
    const u1 = unwrap(await updatePolicy(env.deps, { policyId: p.id, deductibleCents: 250 }));
    expect(u1.coverages.find((c) => c.code === 'rca')).toMatchObject({ id: mainId, limitCents: 5000, deductibleCents: 250 });
    expect(u1.coverages.find((c) => c.code === 'cristalli')!.limitCents).toBe(100);
    const u2 = unwrap(await updatePolicy(env.deps, { policyId: p.id, coverages: [{ code: 'cristalli', limitCents: 200 }, { code: 'tutela_legale' }] }));
    expect(u2.coverages.map((c) => c.code).sort()).toEqual(['cristalli', 'tutela_legale']);
    expect(u2.coverages.find((c) => c.code === 'cristalli')!.limitCents).toBe(200);
  });

  it('validazione e inesistente: nulla cambia', async () => {
    const p = unwrap(await add()).policy;
    expect(errorOf(await updatePolicy(env.deps, { policyId: p.id, endOn: '2026-03-10' }))).toMatchObject({ field: 'endOn' });
    expect(errorOf(await updatePolicy(env.deps, { policyId: p.id, company: '' }))).toMatchObject({ field: 'company' });
    expect(errorOf(await updatePolicy(env.deps, { policyId: 'nope', company: 'X' })).code).toBe('ITEM_NOT_FOUND');
    expect((await getPolicy(env.deps, p.id))!.company).toBe('Unipol');
  });
});

describe('deletePolicy e restorePolicy', () => {
  it('elimina: sparisce dall elenco, escono i promemoria e i costi; ripristina: tutto torna com era', async () => {
    const p = unwrap(await add({ paidInstallmentNos: [1, 2] })).policy;
    const costsSql = `SELECT COALESCE(SUM(cents), 0) AS n FROM v_costs WHERE vehicle_id = ? AND source = 'insurance'`;
    expect((await env.db.get<{ n: number }>(costsSql, [vid]))!.n).toBe(30000);
    const remindersBefore = await reminderRows();
    env.clearEvents();

    const del = unwrap(await deletePolicy(env.deps, p.id));
    expect(del).toEqual({ policyId: p.id, vehicleId: vid });
    expect(await listPolicies(env.deps, vid)).toEqual([]);
    expect(await getPolicy(env.deps, p.id)).toBeNull();
    expect(await reminderRows()).toEqual([]);
    expect((await env.db.get<{ n: number }>(costsSql, [vid]))!.n).toBe(0);
    expect(env.events).toEqual([
      { type: 'data-changed', scope: 'insurance', vehicleId: vid },
      { type: 'data-changed', scope: 'reminders', vehicleId: vid },
    ]);

    const restored = unwrap(await restorePolicy(env.deps, p.id));
    expect(restored).toMatchObject({ id: p.id, paidCount: 2, company: 'Unipol' });
    expect((await env.db.get<{ n: number }>(costsSql, [vid]))!.n).toBe(30000);
    expect(await reminderRows()).toEqual(remindersBefore); // stessi promemoria (ricreati) con gli stessi dati
    await expectAtMostOneOpen(env.db, vid);
  });

  it('errori: eliminare due volte, ripristinare chi non e nel cestino o non esiste', async () => {
    const p = unwrap(await add()).policy;
    expect(errorOf(await restorePolicy(env.deps, p.id)).code).toBe('ITEM_NOT_FOUND'); // non e nel cestino
    unwrap(await deletePolicy(env.deps, p.id));
    env.clearEvents();
    expect(errorOf(await deletePolicy(env.deps, p.id)).code).toBe('ITEM_NOT_FOUND');
    expect(errorOf(await deletePolicy(env.deps, 'nope')).code).toBe('ITEM_NOT_FOUND');
    expect(errorOf(await restorePolicy(env.deps, 'nope')).code).toBe('ITEM_NOT_FOUND');
    expect(env.events).toEqual([]);
  });

  it('eliminare l auto nel cestino impedisce di ripristinare la polizza', async () => {
    const p = unwrap(await add()).policy;
    unwrap(await deletePolicy(env.deps, p.id));
    await env.db.run(`UPDATE vehicles SET deleted_at = '2026-10-08T07:30:00.000Z' WHERE id = ?`, [vid]);
    expect(errorOf(await restorePolicy(env.deps, p.id)).code).toBe('ITEM_NOT_FOUND');
  });
});

describe('listPolicies e getPolicy', () => {
  it('elenco dalla piu recente; includeInactive:false tiene solo le correnti', async () => {
    const a = unwrap(await add({ startOn: '2025-03-10', endOn: '2026-03-10', premiumCents: 0 })).policy;
    const b = unwrap(await add({ startOn: '2026-03-10', endOn: '2027-03-10', premiumCents: 0 })).policy;
    const k = unwrap(await add({ kind: 'kasko', startOn: '2026-01-01', endOn: '2026-12-31', premiumCents: 0 })).policy;
    const c = unwrap(await add({ kind: 'furto_incendio', startOn: '2026-01-01', endOn: '2027-01-01', premiumCents: 0 })).policy;
    await updatePolicy(env.deps, { policyId: c.id, cancelledOn: '2026-05-01' });
    const all = await listPolicies(env.deps, vid);
    expect(all.map((p) => [p.id, p.status])).toEqual([
      [b.id, 'active'],
      [c.id, 'cancelled'],
      [k.id, 'active'], // scade il 2026-12-31, tra 84 giorni
      [a.id, 'renewed'],
    ]);
    expect((await listPolicies(env.deps, vid, { includeInactive: false })).map((p) => p.id)).toEqual([b.id, k.id]);
    expect(await listPolicies(env.deps, 'nope')).toEqual([]);
    expect(await getPolicy(env.deps, 'nope')).toBeNull();
  });

  it('una polizza in scadenza entro 30 giorni e "in scadenza"; oltre e "attiva"', async () => {
    const soon = unwrap(await add({ startOn: '2025-11-07', endOn: '2026-11-07', premiumCents: 0 })).policy;
    expect(soon).toMatchObject({ status: 'expiring', statusLabel: 'In scadenza', expiry: { state: 'valid', daysLeft: 30, label: 'Scade tra 30 giorni' } });
    const later = unwrap(await add({ kind: 'kasko', startOn: '2025-11-08', endOn: '2026-11-08', premiumCents: 0 })).policy;
    expect(later.status).toBe('active');
  });
});
