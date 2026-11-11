// Categorie di spesa (F-41): le 13 di sistema (seed) e quelle personalizzate dell'utente.
// Le categorie cancellate restano nel DB (soft delete) per non rompere lo storico, ma spariscono dall'elenco.
import { fail, invalid, ok, type Deps, type UsecaseResult } from '../context';
import { AbortTx } from '../odometer/sqlErrors';
import {
  CATEGORY_COLUMNS,
  EXPENSE_SCOPE,
  cleanText,
  selectCategory,
  toCategory,
  type CategoryRow,
} from './store';
import type {
  CreateExpenseCategoryInput,
  DeleteExpenseCategoryOptions,
  ExpenseCategory,
  UpdateExpenseCategoryInput,
} from './types';

export const MAX_CATEGORY_NAME = 40;
const MAX_ICON = 40;
/** Le categorie personalizzate vengono dopo quelle di sistema (che arrivano a 120) e prima di «Altro» (id `sys_other`, sempre ultima). */
const FIRST_CUSTOM_SORT_ORDER = 210;

const normalizeName = (name: string): string => name.trim().replace(/\s+/g, ' ');
const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Le categorie disponibili (di sistema e personalizzate) nell'ordine di visualizzazione; «Altro» e' sempre l'ultima. */
export async function listExpenseCategories(d: Pick<Deps, 'db'>): Promise<ExpenseCategory[]> {
  const rows = await d.db.all<CategoryRow>(
    `SELECT ${CATEGORY_COLUMNS} FROM expense_categories WHERE deleted_at IS NULL
     ORDER BY CASE WHEN id = 'sys_other' THEN 1 ELSE 0 END, sort_order, name_it, id`,
  );
  return rows.map(toCategory);
}

async function checkName(
  tx: Deps['db'],
  raw: string,
  ownId: string | null,
): Promise<UsecaseResult<string>> {
  const name = normalizeName(raw);
  if (name.length < 1) return invalid('name', 'Scrivi il nome della categoria.');
  if (name.length > MAX_CATEGORY_NAME) return invalid('name', `Il nome può avere al massimo ${MAX_CATEGORY_NAME} caratteri.`);
  const others = await tx.all<{ id: string; name_it: string }>('SELECT id, name_it FROM expense_categories WHERE deleted_at IS NULL');
  if (others.some((o) => o.id !== ownId && sameName(o.name_it, name))) {
    return invalid('name', 'Esiste già una categoria con questo nome.');
  }
  return ok(name);
}

/** Crea una categoria personalizzata (nome unico, 1-40 caratteri). */
export async function createExpenseCategory(d: Deps, input: CreateExpenseCategoryInput): Promise<UsecaseResult<ExpenseCategory>> {
  const out = await d.db.transaction(async (tx): Promise<UsecaseResult<ExpenseCategory>> => {
    const name = await checkName(tx, input.name ?? '', null);
    if (!name.ok) return name;
    const id = d.ids.ulid();
    const now = d.clock.nowIso();
    const max = await tx.get<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM expense_categories WHERE is_system = 0');
    const sortOrder = Math.max(FIRST_CUSTOM_SORT_ORDER - 10, max?.m ?? 0) + 10;
    await tx.run(
      `INSERT INTO expense_categories (id, name_it, icon, is_system, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)`,
      [id, name.value, cleanText(input.icon, MAX_ICON), sortOrder, now, now],
    );
    return ok(toCategory((await selectCategory(tx, id))!));
  }, 'exclusive');
  if (out.ok) d.events.emit({ type: 'data-changed', scope: EXPENSE_SCOPE });
  return out;
}

const SYSTEM_MSG = 'Le categorie di sistema non si possono modificare ne eliminare: crea una categoria tua.';

/** Rinomina una categoria personalizzata o ne cambia l'icona. Le categorie di sistema sono fisse. */
export async function updateExpenseCategory(
  d: Deps,
  id: string,
  patch: UpdateExpenseCategoryInput,
): Promise<UsecaseResult<ExpenseCategory>> {
  const out = await d.db.transaction(async (tx): Promise<UsecaseResult<ExpenseCategory>> => {
    const row = await selectCategory(tx, id);
    if (!row) return fail({ code: 'ITEM_NOT_FOUND' });
    if (row.is_system === 1) return invalid('id', SYSTEM_MSG);
    let name = row.name_it;
    if (patch.name !== undefined) {
      const n = await checkName(tx, patch.name, id);
      if (!n.ok) return n;
      name = n.value;
    }
    const icon = patch.icon !== undefined ? cleanText(patch.icon, MAX_ICON) : row.icon;
    await tx.run('UPDATE expense_categories SET name_it = ?, icon = ?, updated_at = ? WHERE id = ?', [name, icon, d.clock.nowIso(), id]);
    return ok(toCategory((await selectCategory(tx, id))!));
  }, 'exclusive');
  if (out.ok) d.events.emit({ type: 'data-changed', scope: EXPENSE_SCOPE });
  return out;
}

/**
 * Elimina una categoria personalizzata (cestino). Se e' usata da delle spese bisogna scegliere dove spostarle
 * (`moveToCategoryId`): lo storico dei costi non perde mai una categoria.
 */
export async function deleteExpenseCategory(
  d: Deps,
  id: string,
  opts: DeleteExpenseCategoryOptions = {},
): Promise<UsecaseResult<{ moved: number }>> {
  try {
    const out = await d.db.transaction(async (tx): Promise<UsecaseResult<{ moved: number }>> => {
      const row = await selectCategory(tx, id);
      if (!row) return fail({ code: 'ITEM_NOT_FOUND' });
      if (row.is_system === 1) return invalid('id', SYSTEM_MSG);
      const used = (await tx.get<{ n: number }>('SELECT COUNT(*) AS n FROM expenses WHERE category_id = ? AND deleted_at IS NULL', [id]))!.n;
      let moved = 0;
      if (used > 0) {
        const target = opts.moveToCategoryId;
        if (!target) {
          throw new AbortTx(
            invalid('moveToCategoryId', `Questa categoria è usata da ${used} ${used === 1 ? 'spesa' : 'spese'}: scegli in quale categoria spostarle.`),
          );
        }
        if (target === id || !(await selectCategory(tx, target))) {
          throw new AbortTx(invalid('moveToCategoryId', 'La categoria di destinazione non è valida.'));
        }
        const now = d.clock.nowIso();
        // anche le spese nel cestino: se tornano, non puntano a una categoria cancellata
        moved = (await tx.run('UPDATE expenses SET category_id = ?, updated_at = ? WHERE category_id = ?', [target, now, id])).changes;
      }
      const now = d.clock.nowIso();
      await tx.run('UPDATE expense_categories SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
      return ok({ moved });
    }, 'exclusive');
    if (out.ok) d.events.emit({ type: 'data-changed', scope: EXPENSE_SCOPE });
    return out;
  } catch (e) {
    if (e instanceof AbortTx) return e.result as UsecaseResult<{ moved: number }>;
    throw e;
  }
}
