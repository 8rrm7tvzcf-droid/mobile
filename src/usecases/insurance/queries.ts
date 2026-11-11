// Letture delle assicurazioni (S-40, S-41, riquadro dell'auto): elenco, dettaglio e riepilogo. Niente scritture.
import type { Deps } from '../context';
import {
  buildSummaries,
  installmentView,
  loadDetail,
  loadVehiclePayments,
  loadVehiclePolicyRows,
} from './store';
import type { InsuranceSummary, InstallmentsOverview, InstallmentView, ListPoliciesOptions, PolicyDetail, PolicySummary } from './types';

/**
 * Le polizze di un'auto, dalla piu' recente (scadenza, poi decorrenza), con stato (attiva / in scadenza / scaduta /
 * rinnovata / annullata), scadenza con la nota informativa dell'RC e prossima rata da pagare. Vuoto se l'auto non ha polizze.
 */
export async function listPolicies(
  d: Pick<Deps, 'db' | 'clock'>,
  vehicleId: string,
  opts: ListPoliciesOptions = {},
): Promise<PolicySummary[]> {
  const rows = await loadVehiclePolicyRows(d.db, vehicleId);
  const payments = await loadVehiclePayments(d.db, vehicleId);
  const all = buildSummaries(rows, payments, d.clock.todayLocal());
  return opts.includeInactive === false ? all.filter((p) => p.status !== 'renewed' && p.status !== 'cancelled') : all;
}

/** Una polizza con garanzie, rate e contatti (null se non esiste o e' nel cestino). */
export function getPolicy(d: Pick<Deps, 'db' | 'clock'>, policyId: string): Promise<PolicyDetail | null> {
  return loadDetail(d.db, policyId, d.clock.todayLocal());
}

/**
 * Il riepilogo assicurativo di un'auto: polizze correnti (una per tipo), RC auto, prossima scadenza, rate da pagare e
 * pagate. "Oggi" viene dall'orologio. Un'auto senza polizze da' un riepilogo vuoto (`hasRca: false`).
 */
export async function getInsuranceSummary(d: Pick<Deps, 'db' | 'clock'>, vehicleId: string): Promise<InsuranceSummary> {
  const today = d.clock.todayLocal();
  const rows = await loadVehiclePolicyRows(d.db, vehicleId);
  const payments = await loadVehiclePayments(d.db, vehicleId);
  const summaries = buildSummaries(rows, payments, today);

  const current = summaries.filter((p) => p.status !== 'renewed' && p.status !== 'cancelled');
  const rca = current.find((p) => p.kind === 'rca') ?? null;
  const soonest = [...current].sort((a, b) => (a.endOn < b.endOn ? -1 : a.endOn > b.endOn ? 1 : a.id < b.id ? -1 : 1))[0];

  const unpaidViews: (InstallmentView & { policyKind: PolicySummary['kind']; company: string })[] = [];
  let paidThisYearCents = 0;
  let paidTotalCents = 0;
  const year = today.slice(0, 4);
  for (const p of summaries) {
    const list = payments.get(p.id) ?? [];
    for (const pay of list) {
      if (pay.paid_on) {
        paidTotalCents += pay.amount_cents; // come `v_costs`: ogni rata pagata di ogni polizza non cancellata, anche se annullata
        if (pay.paid_on.slice(0, 4) === year) paidThisYearCents += pay.amount_cents;
      } else if (p.status !== 'cancelled') {
        unpaidViews.push({ ...installmentView(pay, list.length, today), policyKind: p.kind, company: p.company });
      }
    }
  }
  unpaidViews.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.installmentNo - b.installmentNo));
  const overdue = unpaidViews.filter((v) => v.state === 'overdue');
  const unpaid: InstallmentsOverview = {
    count: unpaidViews.length,
    totalCents: unpaidViews.reduce((s, v) => s + v.amountCents, 0),
    overdueCount: overdue.length,
    overdueCents: overdue.reduce((s, v) => s + v.amountCents, 0),
    next: unpaidViews[0] ?? null,
  };

  return {
    vehicleId,
    current,
    rca,
    hasRca: rca !== null,
    nextExpiry: soonest ? { policyId: soonest.id, kind: soonest.kind, company: soonest.company, endOn: soonest.endOn, expiry: soonest.expiry } : null,
    rcaGraceNote: rca?.expiry.note ?? null,
    unpaid,
    paidThisYearCents,
    paidTotalCents,
    currentPremiumCents: current.reduce((s, p) => s + p.premiumCents, 0),
    counts: {
      total: summaries.length,
      current: current.length,
      renewed: summaries.filter((p) => p.status === 'renewed').length,
      expired: summaries.filter((p) => p.status === 'expired').length,
      cancelled: summaries.filter((p) => p.status === 'cancelled').length,
    },
  };
}
