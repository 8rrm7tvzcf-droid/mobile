// Spese (S-23, F-41): lettura dell'input, dati per i casi d'uso e righe d'elenco. Pura.
import { formatDateIt, formatEuro, parseDateIt, parseEuroToCents } from '@/domain/units';
import type { AddExpenseInput, ExpenseCategory, ExpenseEntry, UpdateExpenseInput } from '@/usecases/expenses';
import type { ChoiceOption } from '../components/Choices';
import { it } from '../i18n/it';

/** Categoria proposta quando non ce n'e' una usata di recente. */
export const DEFAULT_EXPENSE_CATEGORY = 'sys_other';

export interface ExpenseFormValues {
  categoryId: string;
  amount: string;
  date: string;
  description: string;
  vendor: string;
  notes: string;
}

export interface ExpenseFormErrors {
  amount?: string;
  date?: string;
  category?: string;
  form?: string;
}

export function initialExpenseForm(today: string, categoryId: string): ExpenseFormValues {
  return { categoryId, amount: '', date: formatDateIt(today), description: '', vendor: '', notes: '' };
}

export function formFromExpense(e: ExpenseEntry): ExpenseFormValues {
  return {
    categoryId: e.categoryId,
    amount: parseCentsText(e.amountCents),
    date: formatDateIt(e.spentOn),
    description: e.description ?? '',
    vendor: e.vendor ?? '',
    notes: e.notes ?? '',
  };
}

/** Centesimi -> testo per il campo ("1250" -> "12,50"). */
export function parseCentsText(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const frac = String(Math.abs(cents % 100)).padStart(2, '0');
  return `${whole},${frac}`;
}

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

export type ExpenseBuild<T> = { ok: true; input: T } | { ok: false; errors: ExpenseFormErrors };

function read(v: ExpenseFormValues, today: string): { errors: ExpenseFormErrors; amount: number | null; date: string | null } {
  const errors: ExpenseFormErrors = {};
  const amount = parseEuroToCents(v.amount);
  if (amount === null || amount <= 0) errors.amount = it.expense.invalidAmount;
  const date = parseDateIt(v.date);
  if (date === null) errors.date = it.common.dateExample;
  else if (date > today) errors.date = it.common.futureDate;
  return { errors, amount, date };
}

export function buildAddExpenseInput(vehicleId: string, v: ExpenseFormValues, today: string): ExpenseBuild<AddExpenseInput> {
  const { errors, amount, date } = read(v, today);
  if (Object.keys(errors).length > 0 || amount === null || date === null) return { ok: false, errors };
  return {
    ok: true,
    input: {
      vehicleId,
      spentOn: date,
      categoryId: v.categoryId,
      amountCents: amount,
      description: orNull(v.description),
      vendor: orNull(v.vendor),
      notes: orNull(v.notes),
    },
  };
}

export function buildUpdateExpenseInput(v: ExpenseFormValues, today: string): ExpenseBuild<UpdateExpenseInput> {
  const { errors, amount, date } = read(v, today);
  if (Object.keys(errors).length > 0 || amount === null || date === null) return { ok: false, errors };
  return {
    ok: true,
    input: {
      spentOn: date,
      categoryId: v.categoryId,
      amountCents: amount,
      description: orNull(v.description),
      vendor: orNull(v.vendor),
      notes: orNull(v.notes),
    },
  };
}

/** Campo del caso d'uso -> campo del modulo. */
export function expenseErrorField(field: string | undefined): keyof ExpenseFormErrors {
  switch (field) {
    case 'amountCents':
      return 'amount';
    case 'spentOn':
    case 'date':
      return 'date';
    case 'categoryId':
      return 'category';
    default:
      return 'form';
  }
}

export const categoryOptions = (categories: readonly ExpenseCategory[]): ChoiceOption<string>[] =>
  categories.map((c) => ({ value: c.id, label: c.name }));

export const expenseRowTitle = (e: ExpenseEntry): string => `${formatEuro(e.amountCents)} · ${e.categoryName}`;

export function expenseRowSubtitle(e: ExpenseEntry): string {
  return [formatDateIt(e.spentOn), e.description, e.vendor].filter((p): p is string => Boolean(p)).join(' · ');
}

export const expenseRowA11y = (e: ExpenseEntry): string => `${expenseRowTitle(e)}. ${expenseRowSubtitle(e)}`;

/** Nome di categoria valido: 1-40 caratteri senza spazi ai lati. */
export function cleanCategoryName(name: string): string | null {
  const t = name.trim().replace(/\s+/g, ' ');
  return t === '' ? null : t;
}
