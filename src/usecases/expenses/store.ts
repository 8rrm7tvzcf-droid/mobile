// Accesso SQL a spese e categorie (SQL a mano dentro i casi d'uso, SPEC 8.6). Interno al modulo.
import type { SqlDatabase } from '@/domain/ports';
import type { ExpenseCategory, ExpenseEntry } from './types';

export interface CategoryRow {
  id: string;
  name_it: string;
  icon: string | null;
  is_system: number;
  sort_order: number;
  deleted_at: string | null;
}

export const toCategory = (r: CategoryRow): ExpenseCategory => ({
  id: r.id,
  name: r.name_it,
  icon: r.icon,
  isSystem: r.is_system === 1,
  sortOrder: r.sort_order,
});

export const CATEGORY_COLUMNS = 'id, name_it, icon, is_system, sort_order, deleted_at';

export async function selectCategory(db: SqlDatabase, id: string, includeDeleted = false): Promise<CategoryRow | undefined> {
  return db.get<CategoryRow>(
    `SELECT ${CATEGORY_COLUMNS} FROM expense_categories WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`,
    [id],
  );
}

export interface ExpenseRow {
  id: string;
  vehicle_id: string;
  spent_on: string;
  category_id: string;
  category_name: string;
  category_icon: string | null;
  category_is_system: number;
  amount_cents: number;
  description: string | null;
  vendor: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const EXPENSE_SELECT = `SELECT e.id, e.vehicle_id, e.spent_on, e.category_id, c.name_it AS category_name, c.icon AS category_icon,
       c.is_system AS category_is_system, e.amount_cents, e.description, e.vendor, e.notes, e.created_at, e.updated_at, e.deleted_at
FROM expenses e JOIN expense_categories c ON c.id = e.category_id`;

export async function selectExpenseRow(db: SqlDatabase, id: string, includeDeleted = false): Promise<ExpenseRow | undefined> {
  return db.get<ExpenseRow>(`${EXPENSE_SELECT} WHERE e.id = ?${includeDeleted ? '' : ' AND e.deleted_at IS NULL'}`, [id]);
}

export const toExpense = (r: ExpenseRow): ExpenseEntry => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  spentOn: r.spent_on,
  categoryId: r.category_id,
  categoryName: r.category_name,
  categoryIcon: r.category_icon,
  isSystemCategory: r.category_is_system === 1,
  amountCents: r.amount_cents,
  description: r.description,
  vendor: r.vendor,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function vehicleExists(db: SqlDatabase, vehicleId: string): Promise<boolean> {
  return (await db.get<{ id: string }>('SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicleId])) !== undefined;
}

export const cleanText = (v: string | null | undefined, max: number): string | null => {
  if (v == null) return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, max);
};

/**
 * Scope dell'evento `data-changed` per le spese: `DomainEvent` (domain/ports) non ha uno scope 'expenses', quindi carburante e
 * spese condividono 'fuel' (i sottoscrittori ricaricano comunque tutto: la UI e la riconciliazione delle scadenze).
 */
export const EXPENSE_SCOPE = 'fuel' as const;
