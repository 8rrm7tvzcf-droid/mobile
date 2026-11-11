// Polizze (F-52), rinnovo (F-53) e garanzie (F-55): scritture in transazione con `tx`, riconciliazione dei promemoria
// nella stessa transazione (scadenza polizza a 30/14/7/1/0 giorni, rate non pagate a 7/1/0: li genera il motore), eventi dopo il commit.
import { isValidDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/dates';
import { splitInstallments } from '@/domain/insurance';
import type { SqlDatabase } from '@/domain/ports';
import { invalid, ok } from '../context';
import type { Deps, UsecaseResult } from '../context';
import { abortNotFound, abortValidation, guard } from '../deadlines/internal';
import { reconcileInTx } from '../deadlines/load';
import { vehicleExists } from '../odometer/store';
import {
  loadCoverageRows,
  loadDetail,
  loadPaymentRows,
  loadPolicyRow,
} from './store';
import type { PolicyRow } from './store';
import type {
  AddPolicyInput,
  AddPolicyResult,
  CoverageInput,
  DeletePolicyResult,
  PolicyDetail,
  PolicyFields,
  RenewPolicyInput,
  RenewPolicyResult,
  UpdatePolicyInput,
} from './types';
import { applyMainCoverage, checkPaidNos, definedOnly, normalizePolicy } from './validate';
import type { Checked, NormalizedPolicy } from './validate';

type Env = Pick<Deps, 'clock' | 'ids'>;

async function insertPolicyRow(tx: SqlDatabase, id: string, vehicleId: string, n: NormalizedPolicy, renewedFromId: string | null, now: string): Promise<void> {
  await tx.run(
    `INSERT INTO insurance_policies (id, vehicle_id, kind, company, agency_name, policy_number, start_on, end_on, premium_cents,
       payment_frequency, merit_class, black_box, claims_phone, claims_email, assistance_phone, agent_name, agent_phone,
       agent_email, renewed_from_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      vehicleId,
      n.kind,
      n.company,
      n.agencyName,
      n.policyNumber,
      n.startOn,
      n.endOn,
      n.premiumCents,
      n.paymentFrequency,
      n.meritClass,
      n.blackBox ? 1 : 0,
      n.claimsPhone,
      n.claimsEmail,
      n.assistancePhone,
      n.agentName,
      n.agentPhone,
      n.agentEmail,
      renewedFromId,
      n.notes,
      now,
      now,
    ],
  );
}

async function insertCoverage(tx: SqlDatabase, d: Env, policyId: string, c: Required<CoverageInput>, now: string): Promise<void> {
  await tx.run(
    `INSERT INTO insurance_coverages (id, policy_id, code, limit_cents, deductible_cents, deductible_bp, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.ids.ulid(), policyId, c.code, c.limitCents, c.deductibleCents, c.deductibleBp, c.notes, now, now],
  );
}

/** Allinea le garanzie dell'elenco: aggiorna per codice, aggiunge le nuove, toglie quelle che non ci sono piu'. */
async function syncCoverages(tx: SqlDatabase, d: Env, policyId: string, list: readonly Required<CoverageInput>[], now: string): Promise<void> {
  const existing = await loadCoverageRows(tx, policyId);
  const byCode = new Map(existing.map((c) => [c.code, c]));
  for (const c of list) {
    const cur = byCode.get(c.code);
    if (!cur) {
      await insertCoverage(tx, d, policyId, c, now);
    } else if (
      cur.limit_cents !== c.limitCents ||
      cur.deductible_cents !== c.deductibleCents ||
      cur.deductible_bp !== c.deductibleBp ||
      cur.notes !== c.notes
    ) {
      await tx.run(
        'UPDATE insurance_coverages SET limit_cents = ?, deductible_cents = ?, deductible_bp = ?, notes = ?, updated_at = ? WHERE id = ?',
        [c.limitCents, c.deductibleCents, c.deductibleBp, c.notes, now, cur.id],
      );
    }
  }
  const keep = new Set(list.map((c) => c.code));
  for (const cur of existing) if (!keep.has(cur.code)) await tx.run('DELETE FROM insurance_coverages WHERE id = ?', [cur.id]);
}

/** Le rate del premio (il resto sulla prima, scadenze dalla decorrenza con clamp di fine mese). Senza premio non nascono rate. */
function scheduleOf(n: Pick<NormalizedPolicy, 'premiumCents' | 'paymentFrequency' | 'startOn'>) {
  return n.premiumCents > 0 ? splitInstallments(n.premiumCents, n.paymentFrequency, n.startOn) : [];
}

/** `paid_on` di una rata dichiarata "gia' pagata" alla creazione: la sua scadenza, ma mai nel futuro. */
const paidOnFor = (dueOn: LocalDate, today: LocalDate): LocalDate => (dueOn < today ? dueOn : today);

async function insertPayments(
  tx: SqlDatabase,
  d: Env,
  policyId: string,
  n: NormalizedPolicy,
  paidNos: readonly number[],
  now: string,
): Promise<void> {
  const today = d.clock.todayLocal();
  for (const s of scheduleOf(n)) {
    await tx.run(
      `INSERT INTO insurance_payments (id, policy_id, installment_no, due_on, amount_cents, paid_on, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.ids.ulid(), policyId, s.installmentNo, s.dueOn, s.amountCents, paidNos.includes(s.installmentNo) ? paidOnFor(s.dueOn, today) : null, now, now],
    );
  }
}

/**
 * Rigenera il piano delle rate dopo un cambio di premio, rate o decorrenza. Le righe si RIUSANO per numero di rata
 * (UNIQUE (policy_id, installment_no) vale anche per le righe nel cestino): aggiorna quelle esistenti, aggiunge le nuove,
 * mette nel cestino quelle in eccesso. Il chiamante garantisce che nessuna rata sia pagata.
 */
async function regeneratePayments(tx: SqlDatabase, d: Env, policyId: string, n: NormalizedPolicy, now: string): Promise<void> {
  const all = await tx.all<{ id: string; installment_no: number; deleted_at: string | null }>(
    'SELECT id, installment_no, deleted_at FROM insurance_payments WHERE policy_id = ?',
    [policyId],
  );
  const byNo = new Map(all.map((p) => [p.installment_no, p]));
  const schedule = scheduleOf(n);
  for (const s of schedule) {
    const cur = byNo.get(s.installmentNo);
    if (cur) {
      await tx.run(
        'UPDATE insurance_payments SET due_on = ?, amount_cents = ?, paid_on = NULL, deleted_at = NULL, updated_at = ? WHERE id = ?',
        [s.dueOn, s.amountCents, now, cur.id],
      );
    } else {
      await tx.run(
        `INSERT INTO insurance_payments (id, policy_id, installment_no, due_on, amount_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [d.ids.ulid(), policyId, s.installmentNo, s.dueOn, s.amountCents, now, now],
      );
    }
  }
  const keep = new Set(schedule.map((s) => s.installmentNo));
  for (const cur of all) {
    if (!keep.has(cur.installment_no) && cur.deleted_at === null) {
      await tx.run('UPDATE insurance_payments SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, cur.id]);
    }
  }
}

function emitChanges(d: Deps, vehicleId: string, remindersChanged: boolean): void {
  d.events.emit({ type: 'data-changed', scope: 'insurance', vehicleId });
  if (remindersChanged) d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId });
}

const unwrapChecked = <T>(c: Checked<T>): UsecaseResult<T> => (c.ok ? ok(c.value) : invalid(c.field, c.message));

/**
 * Aggiunge una polizza (F-52) con garanzie (F-55) e rate (F-54), in una transazione, e riconcilia i promemoria:
 *  - il premio si divide in 1/2/4/12 rate con `splitInstallments` (il resto in centesimi sulla prima rata); senza premio non
 *    nascono rate; `paidInstallmentNos` segna subito pagate quelle gia' versate;
 *  - la scadenza e' quella stampata sul certificato; se manca vale decorrenza + 12 mesi e `endIsEstimated` e' vero;
 *  - il motore genera "Scadenza RCA <compagnia>" (30, 14, 7, 1, 0 giorni) e "Rata n/N" (7, 1, 0) per ogni rata non pagata.
 * La tolleranza di 15 giorni dell'RC auto e' solo una nota informativa: non sposta date ne' promemoria.
 */
export async function addPolicy(d: Deps, input: AddPolicyInput): Promise<UsecaseResult<AddPolicyResult>> {
  const normalized = unwrapChecked(normalizePolicy(input, applyMainCoverage(input.coverages ?? [], input.kind, input)));
  if (!normalized.ok) return normalized;
  const n = normalized.value;
  const paid = checkedPaidNos(input.paidInstallmentNos, n);
  if (!paid.ok) return invalid(paid.field, paid.message);

  const res = await guard(() =>
    d.db.transaction(async (tx) => {
      if (!(await vehicleExists(tx, input.vehicleId))) return abortNotFound();
      const id = d.ids.ulid();
      const now = d.clock.nowIso();
      await insertPolicyRow(tx, id, input.vehicleId, n, null, now);
      for (const c of n.coverages) await insertCoverage(tx, d, id, c, now);
      await insertPayments(tx, d, id, n, paid.value, now);
      const outcome = await reconcileInTx(tx, d, input.vehicleId);
      return { id, changed: outcome.changed };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  emitChanges(d, input.vehicleId, res.value.changed);
  const policy = (await loadDetail(d.db, res.value.id, d.clock.todayLocal())) as PolicyDetail;
  return ok({ policy, endIsEstimated: n.endIsEstimated });
}

function checkedPaidNos(nos: readonly number[] | undefined, n: NormalizedPolicy): Checked<number[]> {
  const count = n.premiumCents > 0 ? n.installmentCount : 0;
  if (count === 0 && nos && nos.length > 0) {
    return { ok: false, field: 'paidInstallmentNos', message: 'Indica il premio per poter segnare le rate pagate.' };
  }
  return checkPaidNos(nos, count);
}

function fieldsOf(row: PolicyRow): PolicyFields {
  return {
    kind: row.kind,
    company: row.company,
    agencyName: row.agency_name,
    policyNumber: row.policy_number,
    startOn: row.start_on,
    endOn: row.end_on,
    premiumCents: row.premium_cents,
    paymentFrequency: row.payment_frequency,
    meritClass: row.merit_class,
    blackBox: row.black_box === 1,
    claimsPhone: row.claims_phone,
    claimsEmail: row.claims_email,
    assistancePhone: row.assistance_phone,
    agentName: row.agent_name,
    agentPhone: row.agent_phone,
    agentEmail: row.agent_email,
    notes: row.notes,
  };
}

/** Un `installments` esplicito vince sulla frequenza memorizzata (e viceversa): non devono entrare in conflitto. */
function mergeFields(base: PolicyFields, patch: Partial<PolicyFields>): PolicyFields {
  const merged = { ...base, ...patch } as PolicyFields;
  if (patch.installments !== undefined && patch.paymentFrequency === undefined) merged.paymentFrequency = undefined;
  if (patch.paymentFrequency !== undefined && patch.installments === undefined) merged.installments = undefined;
  return merged;
}

/**
 * Modifica una polizza (solo i campi indicati). Premio, rate e decorrenza cambiano il piano delle rate: si possono
 * modificare solo se nessuna rata e' segnata pagata (altrimenti `VALIDATION`: annulla prima il pagamento). Cambiare la
 * scadenza o annullare la polizza (`cancelledOn`) si riflette subito sui promemoria. `coverages` sostituisce l'elenco.
 */
export async function updatePolicy(d: Deps, input: UpdatePolicyInput): Promise<UsecaseResult<PolicyDetail>> {
  const { policyId, cancelledOn, coverages: coveragePatch, ...rest } = input;
  const patch = definedOnly(rest) as Partial<PolicyFields>;
  if (cancelledOn != null && !isValidDate(cancelledOn)) return invalid('cancelledOn', "La data di annullamento non è valida.");

  const res = await guard(() =>
    d.db.transaction(async (tx) => {
      const row = await loadPolicyRow(tx, policyId);
      if (!row) return abortNotFound();
      const existingCoverages = (await loadCoverageRows(tx, policyId)).map(
        (c): CoverageInput => ({ code: c.code, limitCents: c.limit_cents, deductibleCents: c.deductible_cents, deductibleBp: c.deductible_bp, notes: c.notes }),
      );
      const merged = mergeFields(fieldsOf(row), patch);
      const n = normalizePolicy(merged, applyMainCoverage(coveragePatch ?? existingCoverages, merged.kind, patch));
      if (!n.ok) return abortValidation(n.field, n.message);
      const p = n.value;

      const effectiveCancelled = cancelledOn === undefined ? row.cancelled_on : cancelledOn;
      if (effectiveCancelled != null && effectiveCancelled < p.startOn) {
        return abortValidation(cancelledOn === undefined ? 'startOn' : 'cancelledOn', "La data di annullamento non può precedere la decorrenza.");
      }

      const payments = await loadPaymentRows(tx, policyId);
      const schedule = scheduleOf(p);
      const same =
        schedule.length === payments.length &&
        schedule.every((s, i) => {
          const cur = payments[i] as (typeof payments)[number];
          return cur.installment_no === s.installmentNo && cur.due_on === s.dueOn && cur.amount_cents === s.amountCents;
        });
      const now = d.clock.nowIso();
      if (!same) {
        if (payments.some((x) => x.paid_on !== null)) {
          const field = p.premiumCents !== row.premium_cents ? 'premiumCents' : p.startOn !== row.start_on ? 'startOn' : 'installments';
          return abortValidation(field, 'Ci sono rate già pagate: annulla prima il pagamento per cambiare premio, rate o decorrenza.');
        }
        await regeneratePayments(tx, d, policyId, p, now);
      }

      await tx.run(
        `UPDATE insurance_policies SET kind = ?, company = ?, agency_name = ?, policy_number = ?, start_on = ?, end_on = ?,
           premium_cents = ?, payment_frequency = ?, merit_class = ?, black_box = ?, claims_phone = ?, claims_email = ?,
           assistance_phone = ?, agent_name = ?, agent_phone = ?, agent_email = ?, cancelled_on = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
        [
          p.kind,
          p.company,
          p.agencyName,
          p.policyNumber,
          p.startOn,
          p.endOn,
          p.premiumCents,
          p.paymentFrequency,
          p.meritClass,
          p.blackBox ? 1 : 0,
          p.claimsPhone,
          p.claimsEmail,
          p.assistancePhone,
          p.agentName,
          p.agentPhone,
          p.agentEmail,
          effectiveCancelled,
          p.notes,
          now,
          policyId,
        ],
      );
      await syncCoverages(tx, d, policyId, p.coverages, now);
      const outcome = await reconcileInTx(tx, d, row.vehicle_id);
      return { vehicleId: row.vehicle_id, changed: outcome.changed };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  emitChanges(d, res.value.vehicleId, res.value.changed);
  return ok((await loadDetail(d.db, policyId, d.clock.todayLocal())) as PolicyDetail);
}

/**
 * Elimina una polizza (cestino, soft delete): le rate restano com'erano (cosi' `restorePolicy` e' esatto), ma i costi
 * delle rate pagate escono dai totali e i promemoria della polizza e delle sue rate spariscono con la riconciliazione.
 * Se era un rinnovo, la polizza precedente torna quella corrente e il suo promemoria di scadenza rinasce.
 */
export async function deletePolicy(d: Deps, policyId: string): Promise<UsecaseResult<DeletePolicyResult>> {
  const res = await guard(() =>
    d.db.transaction(async (tx) => {
      const row = await loadPolicyRow(tx, policyId);
      if (!row) return abortNotFound();
      const now = d.clock.nowIso();
      await tx.run('UPDATE insurance_policies SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, policyId]);
      const outcome = await reconcileInTx(tx, d, row.vehicle_id);
      return { policyId, vehicleId: row.vehicle_id, changed: outcome.changed };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  emitChanges(d, res.value.vehicleId, res.value.changed);
  return ok({ policyId, vehicleId: res.value.vehicleId });
}

/** Ripristina una polizza eliminata (annulla `deletePolicy`). `ITEM_NOT_FOUND` se non e' nel cestino o l'auto non c'e' piu'. */
export async function restorePolicy(d: Deps, policyId: string): Promise<UsecaseResult<PolicyDetail>> {
  const res = await guard(() =>
    d.db.transaction(async (tx) => {
      const row = await loadPolicyRow(tx, policyId, true);
      if (!row || row.deleted_at === null) return abortNotFound();
      if (!(await vehicleExists(tx, row.vehicle_id))) return abortNotFound();
      await tx.run('UPDATE insurance_policies SET deleted_at = NULL, updated_at = ? WHERE id = ?', [d.clock.nowIso(), policyId]);
      const outcome = await reconcileInTx(tx, d, row.vehicle_id);
      return { vehicleId: row.vehicle_id, changed: outcome.changed };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  emitChanges(d, res.value.vehicleId, res.value.changed);
  return ok((await loadDetail(d.db, policyId, d.clock.todayLocal())) as PolicyDetail);
}

/**
 * Rinnovo (F-53, SPEC 6.3.7 punto 3): crea la nuova polizza dalla precedente (`renewed_from_id`), con decorrenza proposta =
 * scadenza precedente, stesso tipo, compagnia, contatti, garanzie, premio e rate (tutto sovrascrivibile tranne il tipo).
 * La vecchia risulta "rinnovata" e il suo promemoria si chiude (lo fa il motore: la nuova ha la scadenza piu' lontana).
 * NESSUN rinnovo tacito: la polizza non si rinnova mai da sola, solo con questa chiamata. Le rate non pagate della vecchia
 * restano da pagare. Errori: gia' rinnovata, scadenza non successiva a quella della precedente.
 */
export async function renewPolicy(d: Deps, input: RenewPolicyInput): Promise<UsecaseResult<RenewPolicyResult>> {
  const { policyId, paidInstallmentNos, coverages: coveragePatch, ...rest } = input;
  const patch = definedOnly(rest) as Partial<PolicyFields>;

  const res = await guard(() =>
    d.db.transaction(async (tx) => {
      const old = await loadPolicyRow(tx, policyId);
      if (!old) return abortNotFound();
      const already = await tx.get<{ id: string }>('SELECT id FROM insurance_policies WHERE renewed_from_id = ? AND deleted_at IS NULL', [policyId]);
      if (already) return abortValidation('policyId', 'Questa polizza è già stata rinnovata.');

      const oldCoverages = (await loadCoverageRows(tx, policyId)).map(
        (c): CoverageInput => ({ code: c.code, limitCents: c.limit_cents, deductibleCents: c.deductible_cents, deductibleBp: c.deductible_bp, notes: c.notes }),
      );
      const base: PolicyFields = { ...fieldsOf(old), startOn: old.end_on, endOn: null };
      const merged = mergeFields(base, patch);
      const n = normalizePolicy(merged, applyMainCoverage(coveragePatch ?? oldCoverages, merged.kind, patch));
      if (!n.ok) return abortValidation(n.field, n.message);
      const p = n.value;
      if (p.endOn <= old.end_on) {
        return abortValidation('endOn', 'La scadenza della nuova polizza deve essere dopo quella della polizza che rinnovi.');
      }
      const paid = checkedPaidNos(paidInstallmentNos, p);
      if (!paid.ok) return abortValidation(paid.field, paid.message);

      const id = d.ids.ulid();
      const now = d.clock.nowIso();
      await insertPolicyRow(tx, id, old.vehicle_id, p, old.id, now);
      for (const c of p.coverages) await insertCoverage(tx, d, id, c, now);
      await insertPayments(tx, d, id, p, paid.value, now);
      const outcome = await reconcileInTx(tx, d, old.vehicle_id);
      return {
        id,
        vehicleId: old.vehicle_id,
        endIsEstimated: p.endIsEstimated,
        changed: outcome.changed,
        closedReminderIds: outcome.changes.close.filter((c) => c.reason === 'policy_renewed').map((c) => c.id),
      };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  const v = res.value;
  emitChanges(d, v.vehicleId, v.changed);
  const today = d.clock.todayLocal();
  return ok({
    policy: (await loadDetail(d.db, v.id, today)) as PolicyDetail,
    previous: (await loadDetail(d.db, policyId, today)) as PolicyDetail,
    endIsEstimated: v.endIsEstimated,
    closedReminderIds: v.closedReminderIds,
  });
}
