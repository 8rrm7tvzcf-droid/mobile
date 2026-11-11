// Spese (F-41): registro con categorie di sistema (13) e personalizzate.
export { addExpense, updateExpense, deleteExpense, restoreExpense, getExpense, listExpenses } from './expenses';
export {
  listExpenseCategories,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
  MAX_CATEGORY_NAME,
} from './categories';
export type {
  AddExpenseInput,
  CreateExpenseCategoryInput,
  DeleteExpenseCategoryOptions,
  ExpenseCategory,
  ExpenseEntry,
  ExpenseWriteResult,
  ListExpensesOptions,
  UpdateExpenseCategoryInput,
  UpdateExpenseInput,
} from './types';
export type { DatePeriod } from '../costs/period';
