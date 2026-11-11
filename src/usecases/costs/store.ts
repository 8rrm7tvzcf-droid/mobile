// Accesso SQL ai costi: la vista `v_costs` (interventi + rifornimenti + spese + rate assicurative pagate, senza doppioni)
// con la categoria delle spese. SQL a mano dentro i casi d'uso (SPEC 8.6). Interno al modulo.
import type { CostEntry, CostSource } from '@/domain/costs';
import type { SqlDatabase, SqlValue } from '@/domain/ports';
import type { ResolvedPeriod } from './period';

export async function vehicleExists(db: SqlDatabase, vehicleId: string): Promise<boolean> {
  return (await db.get<{ id: string }>('SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicleId])) !== undefined;
}

/**
 * Le righe di `v_costs` di un veicolo nel periodo, nel formato del dominio. La LEFT JOIN su `expenses` aggiunge la categoria
 * alle sole spese e, essendo sulla chiave primaria, non moltiplica mai le righe.
 */
export async function loadCostEntries(
  db: SqlDatabase,
  vehicleId: string,
  period: ResolvedPeriod,
  excludeCategoryIds: readonly string[] = [],
): Promise<CostEntry[]> {
  const where = ['c.vehicle_id = ?'];
  const params: SqlValue[] = [vehicleId];
  if (period.from) {
    where.push('c.on_date >= ?');
    params.push(period.from);
  }
  if (period.to) {
    where.push('c.on_date <= ?');
    params.push(period.to);
  }
  if (excludeCategoryIds.length > 0) {
    where.push(`NOT (c.source = 'expense' AND e.category_id IN (${excludeCategoryIds.map(() => '?').join(', ')}))`);
    params.push(...excludeCategoryIds);
  }
  const rows = await db.all<{
    vehicle_id: string;
    on_date: string;
    source: CostSource;
    source_id: string;
    cents: number;
    category_id: string | null;
  }>(
    `SELECT c.vehicle_id, c.on_date, c.source, c.source_id, c.cents, e.category_id
     FROM v_costs c LEFT JOIN expenses e ON c.source = 'expense' AND e.id = c.source_id
     WHERE ${where.join(' AND ')}
     ORDER BY c.on_date, c.source, c.source_id`,
    params,
  );
  return rows.map((r) => ({
    vehicleId: r.vehicle_id,
    onDate: r.on_date,
    source: r.source,
    sourceId: r.source_id,
    cents: r.cents,
    categoryId: r.source === 'expense' ? r.category_id : undefined,
  }));
}

/** Nome e icona di ogni categoria di spesa (anche se cancellata: lo storico la conserva). */
export async function loadCategoryLabels(db: SqlDatabase): Promise<Map<string, { name: string; icon: string | null }>> {
  const rows = await db.all<{ id: string; name_it: string; icon: string | null }>('SELECT id, name_it, icon FROM expense_categories');
  return new Map(rows.map((r) => [r.id, { name: r.name_it, icon: r.icon }]));
}
