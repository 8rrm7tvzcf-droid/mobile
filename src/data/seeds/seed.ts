// Seed idempotenti dei cataloghi e delle impostazioni (data.md 1.5 e 2.5, passo 3 dell'avvio).
// Si eseguono a OGNI avvio, dopo le migrazioni; le migrazioni contengono solo struttura.
//  - service_templates: upsert che sovrascrive solo se la versione del catalogo e' piu' alta;
//  - expense_categories (sys_*): upsert di nome/icona/ordine solo se cambiati; le categorie dell'utente (id ULID) non si toccano;
//  - app_settings: INSERT OR IGNORE, un valore gia' presente non si sovrascrive mai.
import type { Clock, IdGenerator, SqlDatabase } from '@/domain/ports';
import { EXPENSE_CATEGORIES, TEMPLATE_ROWS, type ExpenseCategorySeed, type TemplateRow } from './catalog';
import { DEFAULTED_SETTING_KEYS, SETTING_DEFAULTS } from './settingsDefaults';

export interface SeedDeps {
  clock: Pick<Clock, 'nowIso'>;
  ids: Pick<IdGenerator, 'ulid'>;
}

const UPSERT_TEMPLATE = `INSERT INTO service_templates
  (id, version, name_it, category, schedule_type, interval_km, interval_months, period_end, anchor_month, anchor_day,
   soon_days, soon_km, notify_offsets_days, applies_to, default_enabled, is_indicative, note_it, sort_order)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  version = excluded.version, name_it = excluded.name_it, category = excluded.category, schedule_type = excluded.schedule_type,
  interval_km = excluded.interval_km, interval_months = excluded.interval_months, period_end = excluded.period_end,
  anchor_month = excluded.anchor_month, anchor_day = excluded.anchor_day, soon_days = excluded.soon_days, soon_km = excluded.soon_km,
  notify_offsets_days = excluded.notify_offsets_days, applies_to = excluded.applies_to, default_enabled = excluded.default_enabled,
  is_indicative = excluded.is_indicative, note_it = excluded.note_it, sort_order = excluded.sort_order
WHERE excluded.version > service_templates.version`;

const UPSERT_CATEGORY = `INSERT INTO expense_categories (id, name_it, icon, is_system, sort_order, created_at, updated_at)
VALUES (?, ?, ?, 1, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET name_it = excluded.name_it, icon = excluded.icon, sort_order = excluded.sort_order,
  updated_at = excluded.updated_at
WHERE expense_categories.name_it IS NOT excluded.name_it OR expense_categories.icon IS NOT excluded.icon
   OR expense_categories.sort_order IS NOT excluded.sort_order`;

/** Upsert dei template; `rows` si puo' sostituire nei test (di default il catalogo di codice). */
export async function seedTemplates(db: SqlDatabase, rows: readonly TemplateRow[] = TEMPLATE_ROWS): Promise<void> {
  await db.transaction(async (tx) => {
    for (const r of rows) {
      await tx.run(UPSERT_TEMPLATE, [
        r.id,
        r.version,
        r.name_it,
        r.category,
        r.schedule_type,
        r.interval_km,
        r.interval_months,
        r.period_end,
        r.anchor_month,
        r.anchor_day,
        r.soon_days,
        r.soon_km,
        r.notify_offsets_days,
        r.applies_to,
        r.default_enabled,
        r.is_indicative,
        r.note_it,
        r.sort_order,
      ]);
    }
  }, 'exclusive');
}

export async function seedExpenseCategories(
  db: SqlDatabase,
  deps: Pick<SeedDeps, 'clock'>,
  categories: readonly ExpenseCategorySeed[] = EXPENSE_CATEGORIES,
): Promise<void> {
  const now = deps.clock.nowIso();
  await db.transaction(async (tx) => {
    for (const [id, nameIt, icon, sortOrder] of categories) {
      await tx.run(UPSERT_CATEGORY, [id, nameIt, icon, sortOrder, now, now]);
    }
  }, 'exclusive');
}

/** Impostazioni di default (INSERT OR IGNORE) e `device.id` (ULID generato una sola volta, al primo avvio). */
export async function seedSettings(db: SqlDatabase, deps: SeedDeps): Promise<void> {
  const now = deps.clock.nowIso();
  await db.transaction(async (tx) => {
    const insert = 'INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)';
    for (const key of DEFAULTED_SETTING_KEYS) {
      await tx.run(insert, [key, JSON.stringify(SETTING_DEFAULTS[key]), now]);
    }
    const existing = await tx.get('SELECT 1 AS present FROM app_settings WHERE key = ?', ['device.id']);
    if (!existing) await tx.run(insert, ['device.id', JSON.stringify(deps.ids.ulid()), now]);
  }, 'exclusive');
}

/** Tutti i seed dell'avvio (passo 3 della sequenza). */
export async function seedAll(db: SqlDatabase, deps: SeedDeps): Promise<void> {
  await db.transaction(async (tx) => {
    await seedTemplates(tx);
    await seedExpenseCategories(tx, deps);
    await seedSettings(tx, deps);
  }, 'exclusive');
}
