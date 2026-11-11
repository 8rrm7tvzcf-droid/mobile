// Spese (F-41; SPEC 6.3.8 S-23): aggiunta, modifica, eliminazione (cestino), ripristino, scheda ed elenco.
// Scritture in transazione con `tx`; evento 'data-changed' dopo il commit. Le spese non hanno km ne' scadenze collegate.
import { isValidDate } from '@/domain/dates';
import type { LocalDate, SqlDatabase, SqlValue } from '@/domain/ports';
import { fail, invalid, ok, type Deps, type UsecaseResult } from '../context';
import { resolvePeriod, type DatePeriod } from '../costs/period';
import {
  EXPENSE_SCOPE,
  EXPENSE_SELECT,
  cleanText,
  selectCategory,
  selectExpenseRow,
  toExpense,
  vehicleExists,
  type ExpenseRow,
} from './store';
import type { AddExpenseInput, ExpenseEntry, ExpenseWriteResult, ListExpensesOptions, UpdateExpenseInput } from './types';

const MAX_AMOUNT_CENTS = 100_000_000_000; // CHECK amount_cents BETWEEN 0 AND 100000000000
const MAX_DESCRIPTION = 200;
const MAX_VENDOR = 80;
const MAX_NOTES = 1000;

const SOURCE_LABEL_IT = {
  service: 'un intervento',
  fuel: 'un rifornimento',
  insurance: 'una rata assicurativa',
  expense: "un'altra spesa",
} as const;

/** Avvisi sui doppioni LOGICI: stesso veicolo, stesso giorno, stesso importo in un'altra fonte dei costi (non blocca mai). */
async function duplicateWarnings(
  db: SqlDatabase,
  e: { id: string; vehicleId: string; spentOn: LocalDate; amountCents: number },
): Promise<string[]> {
  const rows = await db.all<{ source: keyof typeof SOURCE_LABEL_IT }>(
    `SELECT DISTINCT source FROM v_costs
     WHERE vehicle_id = ? AND on_date = ? AND cents = ? AND NOT (source = 'expense' AND source_id = ?)`,
    [e.vehicleId, e.spentOn, e.amountCents, e.id],
  );
  return rows.map(
    (r) => `Esiste già ${SOURCE_LABEL_IT[r.source]} dello stesso importo nello stesso giorno: controlla di non averlo registrato due volte.`,
  );
}

function checkAmount(amountCents: unknown): UsecaseResult<number> {
  if (typeof amountCents !== 'number' || !Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_AMOUNT_CENTS) {
    return invalid('amountCents', "L'importo deve essere maggiore di zero.");
  }
  return ok(amountCents);
}

function checkDate(spentOn: string, today: LocalDate): UsecaseResult<LocalDate> {
  if (!isValidDate(spentOn)) return invalid('spentOn', 'La data non è valida.');
  if (spentOn > today) return fail({ code: 'FUTURE_DATE' });
  return ok(spentOn);
}

async function checkCategory(db: SqlDatabase, categoryId: string): Promise<UsecaseResult<string>> {
  if (typeof categoryId !== 'string' || !(await selectCategory(db, categoryId))) {
    return invalid('categoryId', 'Scegli una categoria valida.');
  }
  return ok(categoryId);
}

const emit = (d: Deps, vehicleId: string): void => d.events.emit({ type: 'data-changed', scope: EXPENSE_SCOPE, vehicleId });

/**
 * Aggiunge una spesa. Categoria obbligatoria (di sistema o personalizzata), importo in centesimi maggiore di zero,
 * data non futura (default oggi). Se esiste gia' un costo dello stesso importo nello stesso giorno in un'altra fonte
 * (intervento, rifornimento, rata) il risultato porta un avviso: i costi non si duplicano.
 */
export async function addExpense(d: Deps, input: AddExpenseInput): Promise<UsecaseResult<ExpenseWriteResult>> {
  const out = await d.db.transaction(async (tx): Promise<UsecaseResult<ExpenseWriteResult>> => {
    if (!(await vehicleExists(tx, input.vehicleId))) return fail({ code: 'ITEM_NOT_FOUND' });
    const date = checkDate(input.spentOn ?? d.clock.todayLocal(), d.clock.todayLocal());
    if (!date.ok) return date;
    const category = await checkCategory(tx, input.categoryId);
    if (!category.ok) return category;
    const amount = checkAmount(input.amountCents);
    if (!amount.ok) return amount;
    const id = d.ids.ulid();
    const now = d.clock.nowIso();
    await tx.run(
      `INSERT INTO expenses (id, vehicle_id, spent_on, category_id, amount_cents, description, vendor, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.vehicleId,
        date.value,
        category.value,
        amount.value,
        cleanText(input.description, MAX_DESCRIPTION),
        cleanText(input.vendor, MAX_VENDOR),
        cleanText(input.notes, MAX_NOTES),
        now,
        now,
      ],
    );
    const expense = toExpense((await selectExpenseRow(tx, id))!);
    return ok({ expense, warnings: await duplicateWarnings(tx, expense) });
  }, 'exclusive');
  if (out.ok) emit(d, out.value.expense.vehicleId);
  return out;
}

/** Modifica una spesa (campi non indicati = invariati). */
export async function updateExpense(d: Deps, id: string, patch: UpdateExpenseInput): Promise<UsecaseResult<ExpenseWriteResult>> {
  const out = await d.db.transaction(async (tx): Promise<UsecaseResult<ExpenseWriteResult>> => {
    const row = await selectExpenseRow(tx, id);
    if (!row) return fail({ code: 'ITEM_NOT_FOUND' });
    const date = patch.spentOn !== undefined ? checkDate(patch.spentOn, d.clock.todayLocal()) : ok(row.spent_on);
    if (!date.ok) return date;
    const category = patch.categoryId !== undefined ? await checkCategory(tx, patch.categoryId) : ok(row.category_id);
    if (!category.ok) return category;
    const amount = patch.amountCents !== undefined ? checkAmount(patch.amountCents) : ok(row.amount_cents);
    if (!amount.ok) return amount;
    await tx.run(
      `UPDATE expenses SET spent_on = ?, category_id = ?, amount_cents = ?, description = ?, vendor = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      [
        date.value,
        category.value,
        amount.value,
        patch.description !== undefined ? cleanText(patch.description, MAX_DESCRIPTION) : row.description,
        patch.vendor !== undefined ? cleanText(patch.vendor, MAX_VENDOR) : row.vendor,
        patch.notes !== undefined ? cleanText(patch.notes, MAX_NOTES) : row.notes,
        d.clock.nowIso(),
        id,
      ],
    );
    const expense = toExpense((await selectExpenseRow(tx, id))!);
    return ok({ expense, warnings: await duplicateWarnings(tx, expense) });
  }, 'exclusive');
  if (out.ok) emit(d, out.value.expense.vehicleId);
  return out;
}

/** Elimina una spesa (cestino, ripristinabile con `restoreExpense`): esce subito da elenchi e costi. */
export async function deleteExpense(d: Deps, id: string): Promise<UsecaseResult<{ id: string; vehicleId: string }>> {
  const out = await d.db.transaction(async (tx): Promise<UsecaseResult<{ id: string; vehicleId: string }>> => {
    const row = await tx.get<{ vehicle_id: string }>('SELECT vehicle_id FROM expenses WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!row) return fail({ code: 'ITEM_NOT_FOUND' });
    const now = d.clock.nowIso();
    await tx.run('UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
    return ok({ id, vehicleId: row.vehicle_id });
  }, 'exclusive');
  if (out.ok) emit(d, out.value.vehicleId);
  return out;
}

/** Ripristina una spesa dal cestino (se l'auto e' nel cestino torna `ITEM_NOT_FOUND`). */
export async function restoreExpense(d: Deps, id: string): Promise<UsecaseResult<ExpenseEntry>> {
  const out = await d.db.transaction(async (tx): Promise<UsecaseResult<ExpenseEntry>> => {
    const row = await selectExpenseRow(tx, id, true);
    if (!row || row.deleted_at === null || !(await vehicleExists(tx, row.vehicle_id))) return fail({ code: 'ITEM_NOT_FOUND' });
    await tx.run('UPDATE expenses SET deleted_at = NULL, updated_at = ? WHERE id = ?', [d.clock.nowIso(), id]);
    return ok(toExpense((await selectExpenseRow(tx, id))!));
  }, 'exclusive');
  if (out.ok) emit(d, out.value.vehicleId);
  return out;
}

/** La scheda di una spesa; null se non esiste o e' nel cestino. */
export async function getExpense(d: Pick<Deps, 'db'>, id: string): Promise<ExpenseEntry | null> {
  const row = await selectExpenseRow(d.db, id);
  return row ? toExpense(row) : null;
}

/** Le spese di un veicolo nel periodo (default: sempre), dalla piu' recente. Vuoto se il veicolo non esiste. */
export async function listExpenses(
  d: Pick<Deps, 'db'>,
  vehicleId: string,
  period?: DatePeriod | null,
  opts: ListExpensesOptions = {},
): Promise<ExpenseEntry[]> {
  const p = resolvePeriod(period);
  const where = ['e.vehicle_id = ?', 'e.deleted_at IS NULL'];
  const params: SqlValue[] = [vehicleId];
  if (p.from) {
    where.push('e.spent_on >= ?');
    params.push(p.from);
  }
  if (p.to) {
    where.push('e.spent_on <= ?');
    params.push(p.to);
  }
  if (opts.categoryId) {
    where.push('e.category_id = ?');
    params.push(opts.categoryId);
  }
  const dir = opts.order === 'asc' ? 'ASC' : 'DESC';
  const limit = opts.limit !== undefined ? Math.max(1, Math.floor(opts.limit)) : -1; // -1 = nessun limite in SQLite
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const rows = await d.db.all<ExpenseRow>(
    `${EXPENSE_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY e.spent_on ${dir}, e.created_at ${dir}, e.id ${dir} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map(toExpense);
}
