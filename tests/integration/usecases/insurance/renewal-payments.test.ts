// Rinnovo (AC-05.3, F-53), rate e pagamenti (F-54) con i costi senza doppioni, riepilogo assicurativo dell'auto.
import { beforeEach, describe, expect, it } from 'vitest';
import { reconcileVehicle } from '@/usecases/deadlines';
import {
  addPolicy,
  deletePolicy,
  getInsuranceSummary,
  getPolicy,
  listPolicies,
  markInstallmentPaid,
  renewPolicy,
  unmarkInstallmentPaid,
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
const add = async (o: Partial<AddPolicyInput> = {}) => unwrap(await addPolicy(env.deps, base(o))).policy;

const reminderOf = async (where: string, params: string[]) =>
  (await rows(env.db, `SELECT id, title, status, due_on, completed_on, policy_id, payment_id FROM reminders WHERE deleted_at IS NULL AND ${where} ORDER BY created_at, id`, params));

const insuranceCosts = async (): Promise<{ n: number; sum: number }> =>
  (await env.db.get<{ n: number; sum: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(cents), 0) AS sum FROM v_costs WHERE vehicle_id = ? AND source = 'insurance'`,
    [vid],
  ))!;

describe('renewPolicy (F-53, AC-05.3)', () => {
  it('crea la nuova polizza collegata alla precedente con decorrenza = scadenza precedente; la vecchia diventa "rinnovata" e il suo promemoria si chiude', async () => {
    const old = await add({
      agencyName: 'Agenzia Centro',
      meritClass: 3,
      blackBox: true,
      claimsPhone: '800 111 222',
      agentEmail: 'agente@example.test',
      limitCents: 645_000_000,
      coverages: [{ code: 'cristalli', limitCents: 50_000 }],
      premiumCents: 0,
    });
    const oldReminder = (await reminderOf('policy_id = ?', [old.id]))[0]!;
    expect(oldReminder['status']).toBe('open');
    env.clearEvents();

    const r = unwrap(await renewPolicy(env.deps, { policyId: old.id }));
    expect(r.endIsEstimated).toBe(true); // nessuna scadenza indicata: decorrenza + 12 mesi
    expect(r.policy).toMatchObject({
      kind: 'rca',
      company: 'Unipol',
      agencyName: 'Agenzia Centro',
      policyNumber: 'RC-123',
      startOn: '2027-03-10', // = scadenza precedente
      endOn: '2028-03-10',
      meritClass: 3,
      blackBox: true,
      claimsPhone: '800 111 222',
      agentEmail: 'agente@example.test',
      renewedFromId: old.id,
      status: 'active',
    });
    expect(r.policy.coverages.map((c) => [c.code, c.limitCents]).sort()).toEqual([['cristalli', 50_000], ['rca', 645_000_000]]);
    expect(r.policy.coverages.map((c) => c.id)).not.toContain(old.coverages[0]!.id); // copie, non le stesse righe

    expect(r.previous).toMatchObject({ id: old.id, status: 'renewed', statusLabel: 'Rinnovata', renewedById: r.policy.id });
    expect(r.closedReminderIds).toEqual([oldReminder['id']]);
    const closed = (await reminderOf('id = ?', [oldReminder['id'] as string]))[0]!;
    expect(closed).toMatchObject({ status: 'done', completed_on: '2026-10-08' });
    expect((await reminderOf('policy_id = ?', [r.policy.id]))[0]).toMatchObject({ status: 'open', title: 'Scadenza RCA Unipol', due_on: '2028-03-10' });
    expect(env.events).toEqual([
      { type: 'data-changed', scope: 'insurance', vehicleId: vid },
      { type: 'data-changed', scope: 'reminders', vehicleId: vid },
    ]);
    await expectAtMostOneOpen(env.db, vid);
  });

  it('con date, premio, rate e compagnia indicati si sovrascrive la copia; il tipo resta quello della precedente', async () => {
    const old = await add({ premiumCents: 60000, installments: 4 });
    const r = unwrap(
      await renewPolicy(env.deps, {
        policyId: old.id,
        company: 'Allianz',
        policyNumber: 'AZ-9',
        startOn: '2027-03-11',
        endOn: '2028-03-10',
        premiumCents: 48000,
        installments: 2,
        meritClass: 2,
        coverages: [{ code: 'rca' }],
      }),
    );
    expect(r.endIsEstimated).toBe(false);
    expect(r.policy).toMatchObject({ kind: 'rca', company: 'Allianz', policyNumber: 'AZ-9', startOn: '2027-03-11', endOn: '2028-03-10', premiumCents: 48000, paymentFrequency: 'semiannual', meritClass: 2 });
    expect(r.policy.installments.map((i) => [i.dueOn, i.amountCents])).toEqual([['2027-03-11', 24000], ['2027-09-11', 24000]]);
    expect(r.policy.coverages.map((c) => c.code)).toEqual(['rca']);
  });

  it('senza indicare il premio la nuova polizza eredita premio e frequenza della precedente, con rate dalla nuova decorrenza', async () => {
    const old = await add({ premiumCents: 60001, installments: 4 });
    const r = unwrap(await renewPolicy(env.deps, { policyId: old.id }));
    expect(r.policy).toMatchObject({ premiumCents: 60001, paymentFrequency: 'quarterly', installmentCount: 4 });
    expect(r.policy.installments.map((i) => [i.dueOn, i.amountCents])).toEqual([
      ['2027-03-10', 15001],
      ['2027-06-10', 15000],
      ['2027-09-10', 15000],
      ['2027-12-10', 15000],
    ]);
    expect(r.policy.installments.every((i) => i.paidOn === null)).toBe(true);
  });

  it('le rate non pagate della polizza rinnovata restano da pagare (con i loro promemoria)', async () => {
    const old = await add({ paidInstallmentNos: [1] });
    unwrap(await renewPolicy(env.deps, { policyId: old.id }));
    const stillOpen = await reminderOf(`payment_id IN (SELECT id FROM insurance_payments WHERE policy_id = ?) AND status = 'open'`, [old.id]);
    expect(stillOpen.map((r) => r['title'])).toEqual(['Rata 2/4', 'Rata 3/4', 'Rata 4/4']);
    const summary = await getInsuranceSummary(env.deps, vid);
    expect(summary.unpaid.count).toBe(3 + 4); // 3 della vecchia + 4 della nuova
  });

  it('paidInstallmentNos segna subito pagate le rate della nuova polizza gia versate', async () => {
    const old = await add({ premiumCents: 40000, installments: 2 });
    const r = unwrap(await renewPolicy(env.deps, { policyId: old.id, startOn: '2026-10-01', endOn: '2027-10-01', paidInstallmentNos: [1] }));
    expect(r.policy.installments.map((i) => i.paidOn)).toEqual(['2026-10-01', null]);
  });

  it('errori: gia rinnovata, scadenza non successiva, date non valide, polizza inesistente; nulla viene scritto', async () => {
    const old = await add();
    unwrap(await renewPolicy(env.deps, { policyId: old.id }));
    const policies = await count(env.db, 'insurance_policies');
    expect(errorOf(await renewPolicy(env.deps, { policyId: old.id }))).toMatchObject({ code: 'VALIDATION', field: 'policyId' });
    const fresh = await add({ kind: 'kasko' });
    expect(errorOf(await renewPolicy(env.deps, { policyId: fresh.id, endOn: '2027-03-10' }))).toMatchObject({ field: 'endOn' }); // non dopo la precedente
    expect(errorOf(await renewPolicy(env.deps, { policyId: fresh.id, startOn: '2027-03-10', endOn: '2027-03-09' }))).toMatchObject({ field: 'endOn' });
    expect(errorOf(await renewPolicy(env.deps, { policyId: fresh.id, startOn: '2027-02-30' }))).toMatchObject({ field: 'startOn' });
    expect(errorOf(await renewPolicy(env.deps, { policyId: fresh.id, premiumCents: -5 }))).toMatchObject({ field: 'premiumCents' });
    expect(errorOf(await renewPolicy(env.deps, { policyId: fresh.id, paidInstallmentNos: [9] }))).toMatchObject({ field: 'paidInstallmentNos' });
    expect(errorOf(await renewPolicy(env.deps, { policyId: 'nope' })).code).toBe('ITEM_NOT_FOUND');
    expect(await count(env.db, 'insurance_policies')).toBe(policies + 1); // solo la kasko aggiunta nel test
  });

  it('eliminare il rinnovo fa tornare corrente la polizza precedente e rinascere il suo promemoria; si puo rinnovare di nuovo', async () => {
    const old = await add({ premiumCents: 0 });
    const r = unwrap(await renewPolicy(env.deps, { policyId: old.id }));
    unwrap(await deletePolicy(env.deps, r.policy.id));
    expect((await getPolicy(env.deps, old.id))!.status).toBe('active');
    const open = await reminderOf(`policy_id = ? AND status = 'open'`, [old.id]);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ due_on: '2027-03-10' });
    await expectAtMostOneOpen(env.db, vid);
    const again = unwrap(await renewPolicy(env.deps, { policyId: old.id }));
    expect(again.policy.renewedFromId).toBe(old.id);
  });

  it('AC-05.5: nessun rinnovo tacito: a scadenza passata la polizza non si rinnova da sola e il promemoria resta aperto', async () => {
    const p = await add({ premiumCents: 0 });
    env.clock.set('2027-04-01T08:00:00.000Z'); // 22 giorni dopo la scadenza
    await reconcileVehicle(env.deps, vid);
    expect(await count(env.db, 'insurance_policies')).toBe(1);
    expect(await reminderOf(`policy_id = ? AND status = 'open'`, [p.id])).toHaveLength(1);
    expect((await getPolicy(env.deps, p.id))!).toMatchObject({ status: 'expired', expiry: { state: 'uncovered' } });
  });

  it('catena di rinnovi: una sola polizza corrente e un solo promemoria di scadenza aperto (I1)', async () => {
    let cur = await add({ premiumCents: 0, startOn: '2024-03-10', endOn: '2025-03-10' });
    for (let i = 0; i < 3; i++) cur = unwrap(await renewPolicy(env.deps, { policyId: cur.id })).policy;
    const all = await listPolicies(env.deps, vid);
    expect(all.map((p) => p.status)).toEqual(['active', 'renewed', 'renewed', 'renewed']);
    expect(all.map((p) => p.startOn)).toEqual(['2027-03-10', '2026-03-10', '2025-03-10', '2024-03-10']);
    expect(all.map((p) => p.endOn)).toEqual(['2028-03-10', '2027-03-10', '2026-03-10', '2025-03-10']);
    expect((await openReminders(env.db, vid)).filter((r) => r['policy_id'] !== null)).toHaveLength(1);
    await expectAtMostOneOpen(env.db, vid);
    await reconcileVehicle(env.deps, vid);
    await expectAtMostOneOpen(env.db, vid);
  });
});

describe('markInstallmentPaid / unmarkInstallmentPaid (F-54)', () => {
  it('segna pagata: data di oggi di default, promemoria chiuso con la data di pagamento, rata nei costi per data di pagamento', async () => {
    const p = await add({ startOn: '2026-10-10', endOn: '2027-10-10' });
    const first = p.installments[0]!;
    const pending = (await reminderOf('payment_id = ?', [first.id]))[0]!;
    expect(pending['status']).toBe('open');
    expect(await insuranceCosts()).toEqual({ n: 0, sum: 0 });
    env.clearEvents();

    const r = unwrap(await markInstallmentPaid(env.deps, { paymentId: first.id }));
    expect(r.installment).toMatchObject({ id: first.id, installmentNo: 1, installmentCount: 4, paidOn: '2026-10-08', state: 'paid', label: 'Pagata il 08/10/2026', amountCents: 15000 });
    expect(r.reminderId).toBe(pending['id']);
    expect(r.policy).toMatchObject({ paidCount: 1, paidCents: 15000, unpaidCents: 45000 });
    expect(r.policy.nextUnpaid).toMatchObject({ installmentNo: 2 });
    expect((await reminderOf('id = ?', [pending['id'] as string]))[0]).toMatchObject({ status: 'done', completed_on: '2026-10-08' });
    expect(await insuranceCosts()).toEqual({ n: 1, sum: 15000 });
    expect(env.events).toEqual([
      { type: 'data-changed', scope: 'insurance', vehicleId: vid },
      { type: 'data-changed', scope: 'reminders', vehicleId: vid },
    ]);
    await expectAtMostOneOpen(env.db, vid);
  });

  it('con una data di pagamento indicata; nel futuro o non valida e un errore', async () => {
    const p = await add();
    const r = unwrap(await markInstallmentPaid(env.deps, { paymentId: p.installments[0]!.id, paidOn: '2026-03-12' }));
    expect(r.installment.paidOn).toBe('2026-03-12');
    expect((await env.db.get<{ on_date: string }>(`SELECT on_date FROM v_costs WHERE source = 'insurance'`))!.on_date).toBe('2026-03-12');
    expect(errorOf(await markInstallmentPaid(env.deps, { paymentId: p.installments[1]!.id, paidOn: '2026-10-09' })).code).toBe('FUTURE_DATE');
    expect(errorOf(await markInstallmentPaid(env.deps, { paymentId: p.installments[1]!.id, paidOn: '2026-02-31' }))).toMatchObject({ field: 'paidOn' });
    expect((await getPolicy(env.deps, p.id))!.paidCount).toBe(1);
  });

  it('costi senza doppioni: ogni rata pagata conta una volta, il premio della polizza non conta; pagare tutte da il premio', async () => {
    const p = await add({ premiumCents: 60001 });
    for (const i of p.installments) unwrap(await markInstallmentPaid(env.deps, { paymentId: i.id, paidOn: i.dueOn < '2026-10-08' ? i.dueOn : '2026-10-08' }));
    expect(await insuranceCosts()).toEqual({ n: 4, sum: 60001 });
    const summary = await getInsuranceSummary(env.deps, vid);
    expect(summary).toMatchObject({ paidTotalCents: 60001, paidThisYearCents: 60001, unpaid: { count: 0, totalCents: 0, next: null } });
    // dopo aver pagato tutte le rate resta solo il promemoria di scadenza della polizza
    expect((await openReminders(env.db, vid)).map((r) => r['title'])).toEqual(['Scadenza RCA Unipol']);
  });

  it('una rata gia pagata, una inesistente o una di polizza eliminata non si puo segnare', async () => {
    const p = await add();
    const id = p.installments[0]!.id;
    unwrap(await markInstallmentPaid(env.deps, { paymentId: id }));
    expect(errorOf(await markInstallmentPaid(env.deps, { paymentId: id }))).toMatchObject({ code: 'VALIDATION', field: 'paymentId' });
    expect(errorOf(await markInstallmentPaid(env.deps, { paymentId: 'nope' })).code).toBe('ITEM_NOT_FOUND');
    unwrap(await deletePolicy(env.deps, p.id));
    expect(errorOf(await markInstallmentPaid(env.deps, { paymentId: p.installments[1]!.id })).code).toBe('ITEM_NOT_FOUND');
    expect(errorOf(await unmarkInstallmentPaid(env.deps, id)).code).toBe('ITEM_NOT_FOUND');
  });

  it('annulla il pagamento: la rata torna da pagare, esce dai costi e si riapre LO STESSO promemoria; stato identico a prima', async () => {
    const p = await add({ startOn: '2026-10-10', endOn: '2027-10-10' });
    const visible = async () => ({
      reminders: await rows(env.db, `SELECT id, title, status, due_on, effective_due_on, completed_on, completion_id, snoozed_until FROM reminders WHERE deleted_at IS NULL ORDER BY id`),
      payments: await rows(env.db, 'SELECT id, installment_no, due_on, amount_cents, paid_on, deleted_at FROM insurance_payments ORDER BY id'),
    });
    const before = await visible();
    const pay = p.installments[1]!;
    const marked = unwrap(await markInstallmentPaid(env.deps, { paymentId: pay.id }));
    expect(await visible()).not.toEqual(before);
    env.clearEvents();

    const r = unwrap(await unmarkInstallmentPaid(env.deps, pay.id));
    expect(r.installment).toMatchObject({ paidOn: null, state: 'upcoming', label: 'Scade tra 94 giorni', daysLeft: 94 });
    expect(r.reminderId).toBe(marked.reminderId);
    expect(await visible()).toEqual(before);
    expect(await insuranceCosts()).toEqual({ n: 0, sum: 0 });
    expect(env.events).toEqual([
      { type: 'data-changed', scope: 'insurance', vehicleId: vid },
      { type: 'data-changed', scope: 'reminders', vehicleId: vid },
    ]);
    expect(errorOf(await unmarkInstallmentPaid(env.deps, pay.id))).toMatchObject({ code: 'VALIDATION', field: 'paymentId' });
    await expectAtMostOneOpen(env.db, vid);
    await reconcileVehicle(env.deps, vid); // I5
    expect(await visible()).toEqual(before);
  });

  it('gli stati della rata: scaduta, scade oggi, in arrivo; i giorni sono quelli del calendario', async () => {
    const p = await add({ startOn: '2026-07-08', endOn: '2027-07-08', installments: 4 }); // rate 07-08, 10-08, 2027-01-08, 2027-04-08
    expect(p.installments.map((i) => [i.state, i.label, i.daysLeft, i.daysOverdue])).toEqual([
      ['overdue', 'Scaduta da 92 giorni', null, 92],
      ['due_today', 'Scade oggi', 0, null],
      ['upcoming', 'Scade tra 92 giorni', 92, null],
      ['upcoming', 'Scade tra 182 giorni', 182, null],
    ]);
    expect(p.nextUnpaid).toMatchObject({ installmentNo: 1, state: 'overdue' });
  });
});

describe('getInsuranceSummary', () => {
  it('auto senza polizze o inesistente: riepilogo vuoto, hasRca false', async () => {
    for (const id of [vid, 'nope']) {
      expect(await getInsuranceSummary(env.deps, id)).toEqual({
        vehicleId: id,
        current: [],
        rca: null,
        hasRca: false,
        nextExpiry: null,
        rcaGraceNote: null,
        unpaid: { count: 0, totalCents: 0, overdueCount: 0, overdueCents: 0, next: null },
        paidThisYearCents: 0,
        paidTotalCents: 0,
        currentPremiumCents: 0,
        counts: { total: 0, current: 0, renewed: 0, expired: 0, cancelled: 0 },
      });
    }
  });

  it('RC + kasko: polizze correnti, prossima scadenza, rate da pagare e in ritardo, pagato nell anno e in tutto', async () => {
    const rca = await add({ startOn: '2026-07-08', endOn: '2027-07-08', premiumCents: 40000, installments: 4 }); // 10.000 a rata
    const kasko = await add({ kind: 'kasko', company: 'Reale', startOn: '2026-01-01', endOn: '2026-12-31', premiumCents: 24000, installments: 2 });
    unwrap(await markInstallmentPaid(env.deps, { paymentId: rca.installments[0]!.id, paidOn: '2026-07-08' }));
    unwrap(await markInstallmentPaid(env.deps, { paymentId: kasko.installments[0]!.id, paidOn: '2026-01-02' }));
    const s = await getInsuranceSummary(env.deps, vid);
    expect(s.hasRca).toBe(true);
    expect(s.rca).toMatchObject({ id: rca.id });
    expect(s.current.map((p) => p.id).sort()).toEqual([kasko.id, rca.id].sort());
    expect(s.nextExpiry).toMatchObject({ policyId: kasko.id, kind: 'kasko', company: 'Reale', endOn: '2026-12-31', expiry: { state: 'valid', daysLeft: 84 } });
    expect(s.currentPremiumCents).toBe(64000);
    expect(s.paidTotalCents).toBe(10000 + 12000);
    expect(s.paidThisYearCents).toBe(22000);
    // RCA: rate 2 (scade oggi), 3, 4 da pagare; kasko: rata 2 del 2026-07-01 da pagare e in ritardo
    expect(s.unpaid).toMatchObject({ count: 4, totalCents: 3 * 10000 + 12000, overdueCount: 1, overdueCents: 12000 });
    expect(s.unpaid.next).toMatchObject({ installmentNo: 2, dueOn: '2026-07-01', state: 'overdue', policyKind: 'kasko', company: 'Reale' });
    expect(s.counts).toEqual({ total: 2, current: 2, renewed: 0, expired: 0, cancelled: 0 });
  });

  it('polizze rinnovate o annullate escono dalle correnti; le rate pagate restano nei costi; quelle non pagate delle annullate no', async () => {
    const a = await add({ startOn: '2025-03-10', endOn: '2026-03-10', premiumCents: 20000, installments: 2, paidInstallmentNos: [1, 2] });
    const b = unwrap(await renewPolicy(env.deps, { policyId: a.id, premiumCents: 22000, installments: 2, paidInstallmentNos: [1] })).policy;
    const c = await add({ kind: 'kasko', premiumCents: 10000, installments: 1, paidInstallmentNos: [1] });
    unwrap(await updatePolicy(env.deps, { policyId: c.id, cancelledOn: '2026-08-01' }));
    const d2 = await add({ kind: 'furto_incendio', premiumCents: 8000, installments: 2 });
    unwrap(await updatePolicy(env.deps, { policyId: d2.id, cancelledOn: '2026-08-02' }));

    const s = await getInsuranceSummary(env.deps, vid);
    expect(s.current.map((p) => p.id)).toEqual([b.id]);
    expect(s.counts).toEqual({ total: 4, current: 1, renewed: 1, expired: 0, cancelled: 2 });
    expect(s.paidTotalCents).toBe(10000 + 10000 + 11000 + 10000); // a (2 rate), b (1 rata), c (1 rata annullata ma pagata)
    expect(s.paidTotalCents).toBe((await insuranceCosts()).sum); // stessa cifra delle viste dei costi
    expect(s.unpaid.count).toBe(1); // solo la rata 2 del rinnovo; le rate della furto-incendio annullata non contano
    expect(s.unpaid.totalCents).toBe(11000);
  });

  it('la tolleranza dell RC compare solo come nota nel riepilogo', async () => {
    await add({ startOn: '2025-10-01', endOn: '2026-10-01', premiumCents: 0 });
    const s = await getInsuranceSummary(env.deps, vid);
    expect(s.rca).toMatchObject({ status: 'expired', expiry: { state: 'in_grace' } });
    expect(s.rcaGraceNote).toContain('Non farci affidamento');
    expect(s.nextExpiry).toMatchObject({ endOn: '2026-10-01' });
  });
});
