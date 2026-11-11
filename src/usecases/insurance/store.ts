// Accesso SQL alle polizze e costruzione delle viste (SQL a mano dentro i casi d'uso, SPEC 8.6). Uso INTERNO al modulo.
import type { LocalDate } from '@/domain/dates';
import { RCA_WARNING, policyExpiryStatus, selectCurrentPolicies } from '@/domain/insurance';
import type { PaymentFrequency, PolicyKind } from '@/domain/insurance';
import { deadlineStatus } from '@/domain/italy/calendar';
import { formatDateIt } from '@/domain/units';
import type { SqlDatabase } from '@/domain/ports';
import { COVERAGE_LABELS, POLICY_KIND_LABELS } from './types';
import type {
  CoverageCode,
  CoverageView,
  InstallmentState,
  InstallmentView,
  PolicyDetail,
  PolicyExpiry,
  PolicyStatusKind,
  PolicySummary,
} from './types';

export interface PolicyRow {
  id: string;
  vehicle_id: string;
  kind: PolicyKind;
  company: string;
  agency_name: string | null;
  policy_number: string | null;
  start_on: LocalDate;
  end_on: LocalDate;
  premium_cents: number;
  payment_frequency: PaymentFrequency;
  merit_class: number | null;
  black_box: number;
  claims_phone: string | null;
  claims_email: string | null;
  assistance_phone: string | null;
  agent_name: string | null;
  agent_phone: string | null;
  agent_email: string | null;
  renewed_from_id: string | null;
  cancelled_on: LocalDate | null;
  notes: string | null;
  created_at: string;
  deleted_at: string | null;
}

export const POLICY_COLUMNS = `id, vehicle_id, kind, company, agency_name, policy_number, start_on, end_on, premium_cents,
  payment_frequency, merit_class, black_box, claims_phone, claims_email, assistance_phone, agent_name, agent_phone,
  agent_email, renewed_from_id, cancelled_on, notes, created_at, deleted_at`;

export interface PaymentRow {
  id: string;
  policy_id: string;
  installment_no: number;
  due_on: LocalDate;
  amount_cents: number;
  paid_on: LocalDate | null;
  deleted_at: string | null;
}

export interface CoverageRow {
  id: string;
  policy_id: string;
  code: CoverageCode;
  limit_cents: number | null;
  deductible_cents: number | null;
  deductible_bp: number | null;
  notes: string | null;
}

/** Una polizza per id; con `includeDeleted` anche quella nel cestino. */
export function loadPolicyRow(db: SqlDatabase, id: string, includeDeleted = false): Promise<PolicyRow | undefined> {
  return db.get<PolicyRow>(
    `SELECT ${POLICY_COLUMNS} FROM insurance_policies WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`,
    [id],
  );
}

/** Le polizze non cancellate di un veicolo, dalla piu' recente (scadenza, poi decorrenza). */
export function loadVehiclePolicyRows(db: SqlDatabase, vehicleId: string): Promise<PolicyRow[]> {
  return db.all<PolicyRow>(
    `SELECT ${POLICY_COLUMNS} FROM insurance_policies WHERE vehicle_id = ? AND deleted_at IS NULL
     ORDER BY end_on DESC, start_on DESC, id DESC`,
    [vehicleId],
  );
}

/** Le rate non cancellate di UNA polizza, in ordine di numero. */
export function loadPaymentRows(db: SqlDatabase, policyId: string): Promise<PaymentRow[]> {
  return db.all<PaymentRow>(
    `SELECT id, policy_id, installment_no, due_on, amount_cents, paid_on, deleted_at FROM insurance_payments
     WHERE policy_id = ? AND deleted_at IS NULL ORDER BY installment_no`,
    [policyId],
  );
}

/** Le rate non cancellate di tutte le polizze non cancellate di un veicolo, raggruppate per polizza. */
export async function loadVehiclePayments(db: SqlDatabase, vehicleId: string): Promise<Map<string, PaymentRow[]>> {
  const rows = await db.all<PaymentRow>(
    `SELECT p.id, p.policy_id, p.installment_no, p.due_on, p.amount_cents, p.paid_on, p.deleted_at
     FROM insurance_payments p JOIN insurance_policies pol ON pol.id = p.policy_id
     WHERE pol.vehicle_id = ? AND pol.deleted_at IS NULL AND p.deleted_at IS NULL
     ORDER BY p.policy_id, p.installment_no`,
    [vehicleId],
  );
  const out = new Map<string, PaymentRow[]>();
  for (const r of rows) {
    const list = out.get(r.policy_id) ?? [];
    list.push(r);
    out.set(r.policy_id, list);
  }
  return out;
}

export function loadCoverageRows(db: SqlDatabase, policyId: string): Promise<CoverageRow[]> {
  return db.all<CoverageRow>(
    `SELECT id, policy_id, code, limit_cents, deductible_cents, deductible_bp, notes FROM insurance_coverages
     WHERE policy_id = ? ORDER BY created_at, id`,
    [policyId],
  );
}

export function coverageView(r: CoverageRow): CoverageView {
  return {
    id: r.id,
    code: r.code,
    label: COVERAGE_LABELS[r.code],
    limitCents: r.limit_cents,
    deductibleCents: r.deductible_cents,
    deductibleBp: r.deductible_bp,
    notes: r.notes,
  };
}

export function installmentView(p: PaymentRow, installmentCount: number, today: LocalDate): InstallmentView {
  let state: InstallmentState;
  let label: string;
  let daysLeft: number | null = null;
  let daysOverdue: number | null = null;
  if (p.paid_on) {
    state = 'paid';
    label = `Pagata il ${formatDateIt(p.paid_on)}`;
  } else {
    const s = deadlineStatus(today, p.due_on);
    state = s.state === 'valid' ? 'upcoming' : s.state === 'due_today' ? 'due_today' : 'overdue';
    label = s.label;
    daysLeft = s.daysLeft;
    daysOverdue = s.daysOverdue;
  }
  return {
    id: p.id,
    policyId: p.policy_id,
    installmentNo: p.installment_no,
    installmentCount,
    dueOn: p.due_on,
    amountCents: p.amount_cents,
    paidOn: p.paid_on,
    state,
    label,
    daysLeft,
    daysOverdue,
  };
}

export function expiryOf(kind: PolicyKind, endOn: LocalDate, today: LocalDate): PolicyExpiry {
  const s = policyExpiryStatus(kind, today, endOn);
  if (s.kind === 'rca') {
    return {
      state: s.status.state,
      daysLeft: s.status.daysLeft,
      daysOverdue: s.status.daysOverdue,
      label: s.status.label,
      note: s.status.note,
      graceEndsOn: s.status.graceEndsOn,
    };
  }
  return { state: s.status.state, daysLeft: s.status.daysLeft, daysOverdue: s.status.daysOverdue, label: s.status.label, note: null, graceEndsOn: null };
}

const STATUS_LABEL: Record<PolicyStatusKind, string> = {
  active: 'Attiva',
  expiring: 'In scadenza',
  expired: 'Scaduta',
  renewed: 'Rinnovata',
  cancelled: 'Annullata',
};

/** Giorni di preavviso entro cui una polizza valida e' "in scadenza" (come il primo promemoria). */
export const EXPIRING_DAYS = 30;

/**
 * Le viste riassuntive di TUTTE le polizze non cancellate di un veicolo. Lo stato "rinnovata" segue la regola del motore
 * dei promemoria (SPEC 8.3): una polizza e' rinnovata se ne esiste una piu' recente dello stesso tipo non annullata.
 */
export function buildSummaries(
  rows: readonly PolicyRow[],
  payments: ReadonlyMap<string, readonly PaymentRow[]>,
  today: LocalDate,
): PolicySummary[] {
  // a parita' di scadenza e decorrenza vince l'id maggiore (come il motore): si ordina per id decrescente
  const byIdDesc = [...rows].sort((a, b) => (a.id < b.id ? 1 : -1));
  const sel = selectCurrentPolicies(
    byIdDesc.map((r) => ({ id: r.id, kind: r.kind, startOn: r.start_on, endOn: r.end_on, cancelledOn: r.cancelled_on })),
  );
  const superseded = new Set(sel.superseded.map((p) => p.id));
  const renewedBy = new Map<string, string>();
  for (const r of [...rows].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (r.renewed_from_id) renewedBy.set(r.renewed_from_id, r.id); // l'ultimo (id maggiore) vince
  }

  return rows.map((r): PolicySummary => {
    const list = payments.get(r.id) ?? [];
    const views = list.map((p) => installmentView(p, list.length, today));
    const paid = views.filter((v) => v.state === 'paid');
    const unpaid = views.filter((v) => v.state !== 'paid');
    const expiry = expiryOf(r.kind, r.end_on, today);
    let status: PolicyStatusKind;
    if (r.cancelled_on) status = 'cancelled';
    else if (superseded.has(r.id)) status = 'renewed';
    else if (expiry.state === 'overdue' || expiry.state === 'in_grace' || expiry.state === 'uncovered') status = 'expired';
    else if (expiry.state === 'due_today' || (expiry.daysLeft !== null && expiry.daysLeft <= EXPIRING_DAYS)) status = 'expiring';
    else status = 'active';
    return {
      id: r.id,
      vehicleId: r.vehicle_id,
      kind: r.kind,
      kindLabel: POLICY_KIND_LABELS[r.kind],
      company: r.company,
      policyNumber: r.policy_number,
      startOn: r.start_on,
      endOn: r.end_on,
      premiumCents: r.premium_cents,
      paymentFrequency: r.payment_frequency,
      installmentCount: list.length,
      paidCount: paid.length,
      paidCents: paid.reduce((s, v) => s + v.amountCents, 0),
      unpaidCents: unpaid.reduce((s, v) => s + v.amountCents, 0),
      nextUnpaid: unpaid[0] ?? null,
      status,
      statusLabel: STATUS_LABEL[status],
      expiry,
      meritClass: r.merit_class,
      renewedFromId: r.renewed_from_id,
      renewedById: renewedBy.get(r.id) ?? null,
      cancelledOn: r.cancelled_on,
    };
  });
}

/** La vista di dettaglio di una polizza (con garanzie e rate) a partire dalla sua vista riassuntiva. */
export async function buildDetail(
  db: SqlDatabase,
  row: PolicyRow,
  summary: PolicySummary,
  today: LocalDate,
): Promise<PolicyDetail> {
  const payments = await loadPaymentRows(db, row.id);
  const coverages = (await loadCoverageRows(db, row.id)).map(coverageView);
  return {
    ...summary,
    agencyName: row.agency_name,
    blackBox: row.black_box === 1,
    claimsPhone: row.claims_phone,
    claimsEmail: row.claims_email,
    assistancePhone: row.assistance_phone,
    agentName: row.agent_name,
    agentPhone: row.agent_phone,
    agentEmail: row.agent_email,
    notes: row.notes,
    coverages,
    installments: payments.map((p) => installmentView(p, payments.length, today)),
    warningIt: row.kind === 'rca' ? RCA_WARNING : null,
    createdAt: row.created_at,
  };
}

/** Carica riepilogo e dettaglio di una polizza (con le sorelle dello stesso veicolo per lo stato "rinnovata"). */
export async function loadDetail(db: SqlDatabase, policyId: string, today: LocalDate): Promise<PolicyDetail | null> {
  const row = await loadPolicyRow(db, policyId);
  if (!row) return null;
  const rows = await loadVehiclePolicyRows(db, row.vehicle_id);
  const payments = await loadVehiclePayments(db, row.vehicle_id);
  const summary = buildSummaries(rows, payments, today).find((s) => s.id === policyId);
  if (!summary) return null;
  return buildDetail(db, row, summary, today);
}
