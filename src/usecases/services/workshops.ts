// Officine (F-38): anagrafica con preferite e uso (interventi, ultima visita, spesa). "Ricerca o nuova" in S-20.
import type { Deps, UsecaseResult } from '../context';
import { fail, ok } from '../context';
import { Abort, abortNotFound, abortValidation, guard, type Tx } from './internal';
import { WORKSHOP_SELECT, loadWorkshop, toWorkshop } from './store';
import type { WorkshopRow } from './store';
import { normalizeWorkshop } from './validate';
import type { ListWorkshopsOptions, UpsertWorkshopInput, Workshop } from './types';

const COLUMN_OF: Record<string, string> = {
  name: 'name',
  phone: 'phone',
  email: 'email',
  website: 'website',
  address: 'address',
  city: 'city',
  notes: 'notes',
  isFavorite: 'is_favorite',
};

/**
 * Crea o modifica un'officina dentro una transazione e ne restituisce l'id. Con `id` si modifica (solo i campi presenti;
 * `null` svuota); senza `id` si crea, oppure si riusa l'officina con lo stesso nome (senza distinguere maiuscole) aggiornandola
 * con i campi non vuoti indicati: niente doppioni.
 */
export async function upsertWorkshopInTx(tx: Tx, d: Pick<Deps, 'clock' | 'ids'>, input: UpsertWorkshopInput): Promise<string> {
  const { id: inputId, ...fields } = input;
  const checked = normalizeWorkshop(fields);
  if (!checked.ok) throw new Abort(checked.error);
  const v = checked.value;
  const now = d.clock.nowIso();

  let id = inputId ?? null;
  let onlyNonEmpty = false;
  if (id) {
    const row = await tx.get<{ id: string }>('SELECT id FROM workshops WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!row) return abortNotFound();
  } else {
    if (v.name === undefined) return abortValidation('name', "Indica il nome dell'officina.");
    const same = await tx.get<{ id: string }>('SELECT id FROM workshops WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1', [v.name]);
    if (same) {
      id = same.id;
      onlyNonEmpty = true;
    }
  }

  if (id) {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    for (const [key, value] of Object.entries(v)) {
      if (onlyNonEmpty && (value === null || key === 'name')) continue;
      sets.push(`${COLUMN_OF[key]!} = ?`);
      params.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | null));
    }
    if (sets.length > 0) await tx.run(`UPDATE workshops SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, now, id]);
    return id;
  }

  id = d.ids.ulid();
  await tx.run(
    `INSERT INTO workshops (id, name, phone, email, website, address, city, notes, is_favorite, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, v.name!, v.phone ?? null, v.email ?? null, v.website ?? null, v.address ?? null, v.city ?? null, v.notes ?? null, v.isFavorite ? 1 : 0, now, now],
  );
  return id;
}

/** Crea o modifica un'officina (vedi `upsertWorkshopInTx`). Errori: `VALIDATION` sul campo, `ITEM_NOT_FOUND` se `id` non esiste. */
export async function upsertWorkshop(d: Deps, input: UpsertWorkshopInput): Promise<UsecaseResult<Workshop>> {
  const res = await guard(() =>
    d.db.transaction(async (tx): Promise<Workshop> => {
      const id = await upsertWorkshopInTx(tx, d, input);
      return (await loadWorkshop(tx, id))!;
    }, 'exclusive'),
  );
  if (res.ok) d.events.emit({ type: 'data-changed', scope: 'service' });
  return res;
}

/**
 * Le officine: preferite, poi usate di recente (ordine `recent`, default) oppure per nome; con `search` filtra per nome o citta'.
 * Ogni riga porta l'uso (interventi non nel cestino, ultima visita, spesa totale).
 */
export async function listWorkshops(d: Pick<Deps, 'db'>, opts: ListWorkshopsOptions = {}): Promise<Workshop[]> {
  const params: string[] = [];
  let where = 'WHERE w.deleted_at IS NULL';
  const search = opts.search?.trim();
  if (search) {
    where += ` AND (w.name LIKE ? ESCAPE '\\' OR w.city LIKE ? ESCAPE '\\')`;
    const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    params.push(like, like);
  }
  const order =
    opts.order === 'name' ? 'ORDER BY w.name COLLATE NOCASE, w.id' : 'ORDER BY w.is_favorite DESC, last_service_on DESC, w.name COLLATE NOCASE, w.id';
  const rows = await d.db.all<WorkshopRow>(`${WORKSHOP_SELECT} ${where} ${order}`, params);
  return rows.map(toWorkshop);
}

/** Elimina un'officina (cestino): gli interventi che la citano ne conservano il nome. */
export async function deleteWorkshop(d: Deps, workshopId: string): Promise<UsecaseResult<void>> {
  const now = d.clock.nowIso();
  const r = await d.db.transaction(async (tx) => tx.run('UPDATE workshops SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, workshopId]), 'exclusive');
  if (r.changes === 0) return fail({ code: 'ITEM_NOT_FOUND' });
  d.events.emit({ type: 'data-changed', scope: 'service' });
  return ok(undefined);
}
