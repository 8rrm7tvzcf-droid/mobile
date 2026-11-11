// Rate del premio (F-54): "Segna pagata" e annullamento. La rata pagata entra nei costi (vista `v_costs`, per data di
// pagamento) SENZA doppioni: il premio della polizza non e' contato da nessun'altra parte, ogni rata una sola volta.
import { isValidDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/dates';
import { fail, invalid, ok } from '../context';
import type { Deps, UsecaseResult } from '../context';
import { abortNotFound, abortValidation, guard } from '../deadlines/internal';
import { reconcileInTx } from '../deadlines/load';
import { installmentView, loadDetail, loadPaymentRows } from './store';
import type { InstallmentResult, PolicyDetail } from './types';

interface PaymentWithPolicy {
  id: string;
  policy_id: string;
  vehicle_id: string;
  paid_on: LocalDate | null;
}

const SELECT_PAYMENT = `
  SELECT p.id, p.policy_id, pol.vehicle_id, p.paid_on
  FROM insurance_payments p JOIN insurance_policies pol ON pol.id = p.policy_id
  WHERE p.id = ? AND p.deleted_at IS NULL AND pol.deleted_at IS NULL`;

async function result(d: Deps, paymentId: string, policyId: string, reminderId: string | null): Promise<InstallmentResult> {
  const today = d.clock.todayLocal();
  const payments = await loadPaymentRows(d.db, policyId);
  const pay = payments.find((p) => p.id === paymentId);
  const policy = (await loadDetail(d.db, policyId, today)) as PolicyDetail;
  return { installment: installmentView(pay as NonNullable<typeof pay>, payments.length, today), policy, reminderId };
}

/**
 * Segna pagata una rata (default: oggi; non nel futuro). Il promemoria della rata si chiude (`done`, con la data di
 * pagamento) e il costo entra nei totali dell'auto alla data di pagamento. Una rata gia' pagata da' `VALIDATION`
 * (per correggere la data: `unmarkInstallmentPaid` e poi di nuovo questa).
 */
export async function markInstallmentPaid(
  d: Deps,
  input: { paymentId: string; paidOn?: LocalDate },
): Promise<UsecaseResult<InstallmentResult>> {
  const paidOn = input.paidOn ?? d.clock.todayLocal();
  if (!isValidDate(paidOn)) return invalid('paidOn', 'La data del pagamento non è valida.');
  if (paidOn > d.clock.todayLocal()) return fail({ code: 'FUTURE_DATE' });

  const res = await guard(() =>
    d.db.transaction(async (tx) => {
      const pay = await tx.get<PaymentWithPolicy>(SELECT_PAYMENT, [input.paymentId]);
      if (!pay) return abortNotFound();
      if (pay.paid_on !== null) return abortValidation('paymentId', 'Questa rata è già segnata come pagata.');
      await tx.run('UPDATE insurance_payments SET paid_on = ?, updated_at = ? WHERE id = ?', [paidOn, d.clock.nowIso(), pay.id]);
      const outcome = await reconcileInTx(tx, d, pay.vehicle_id);
      const closed = await tx.get<{ id: string }>(
        `SELECT id FROM reminders WHERE payment_id = ? AND status = 'done' AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 1`,
        [pay.id],
      );
      return { pay, reminderId: closed?.id ?? null, changed: outcome.changed };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  const { pay, reminderId, changed } = res.value;
  d.events.emit({ type: 'data-changed', scope: 'insurance', vehicleId: pay.vehicle_id });
  if (changed) d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId: pay.vehicle_id });
  return ok(await result(d, pay.id, pay.policy_id, reminderId));
}

/**
 * Annulla il pagamento di una rata: torna da pagare, esce dai costi e il suo promemoria si RIAPRE (lo stesso promemoria
 * che il pagamento aveva chiuso, non uno nuovo). Una rata non pagata da' `VALIDATION`.
 */
export async function unmarkInstallmentPaid(d: Deps, paymentId: string): Promise<UsecaseResult<InstallmentResult>> {
  const res = await guard(() =>
    d.db.transaction(async (tx) => {
      const pay = await tx.get<PaymentWithPolicy>(SELECT_PAYMENT, [paymentId]);
      if (!pay) return abortNotFound();
      if (pay.paid_on === null) return abortValidation('paymentId', 'Questa rata non è segnata come pagata.');
      const now = d.clock.nowIso();
      await tx.run('UPDATE insurance_payments SET paid_on = NULL, updated_at = ? WHERE id = ?', [now, pay.id]);

      let reopened: string | null = null;
      const open = await tx.get<{ id: string }>(
        `SELECT id FROM reminders WHERE payment_id = ? AND status = 'open' AND deleted_at IS NULL`,
        [pay.id],
      );
      if (!open) {
        const closed = await tx.get<{ id: string }>(
          `SELECT id FROM reminders WHERE payment_id = ? AND status = 'done' AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 1`,
          [pay.id],
        );
        if (closed) {
          await tx.run(`UPDATE reminders SET status = 'open', completed_on = NULL, updated_at = ? WHERE id = ?`, [now, closed.id]);
          reopened = closed.id;
        }
      }
      const outcome = await reconcileInTx(tx, d, pay.vehicle_id);
      const current =
        reopened ??
        (
          await tx.get<{ id: string }>(`SELECT id FROM reminders WHERE payment_id = ? AND status = 'open' AND deleted_at IS NULL`, [pay.id])
        )?.id ??
        null;
      return { pay, reminderId: current, changed: outcome.changed || reopened !== null };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  const { pay, reminderId, changed } = res.value;
  d.events.emit({ type: 'data-changed', scope: 'insurance', vehicleId: pay.vehicle_id });
  if (changed) d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId: pay.vehicle_id });
  return ok(await result(d, pay.id, pay.policy_id, reminderId));
}
