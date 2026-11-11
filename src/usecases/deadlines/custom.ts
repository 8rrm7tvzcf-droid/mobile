// Scadenze personalizzate (SPEC 3.2 F-23, data.md 3.8): promemoria MANUALI con titolo, data, ricorrenza ancorata
// all'origine (giorno, settimana, mese, anno), km facoltativi e ora per il giorno stesso. Il motore ne aggiorna solo
// la cache calcolata (previsione, scadenza effettiva), mai i dati inseriti (I2).
import { isValidDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/dates';
import type { ItemCategory, ReasonCode, ReminderState } from '@/domain/maintenance';
import type { RepeatUnit } from '@/domain/reminders';
import { evaluateThresholds } from '@/domain/maintenance';
import { isValidKm } from '@/domain/units';
import type { Deps, UsecaseResult } from '../context';
import { abortNotFound, abortValidation, guard, parseOffsets } from './internal';
import { loadOdometerPoints, loadRateParams, reconcileInTx } from './load';
import { loadReminder } from './reminders';

const REPEAT_UNITS: readonly RepeatUnit[] = ['day', 'week', 'month', 'year'];

export interface CustomDeadlineFields {
  title: string;
  /** Almeno uno fra `dueOn` e `dueKm`. */
  dueOn?: LocalDate | null;
  dueKm?: number | null;
  /** 'HH:MM': ora del giorno stesso (solo promemoria manuali). */
  dueTime?: string | null;
  /** Ricorrenza: ogni N giorni/settimane/mesi/anni, ancorata alla data di origine (richiede `dueOn`). */
  repeat?: { every: number; unit: RepeatUnit } | null;
  category?: ItemCategory;
  notes?: string | null;
  /** Preavvisi in giorni prima della scadenza (0 = il giorno stesso). Default [30, 7, 0]. */
  notifyOffsetsDays?: number[];
  soonDays?: number;
  soonKm?: number;
}

export interface AddCustomDeadlineInput extends CustomDeadlineFields {
  vehicleId: string;
}

export interface CustomDeadlineResult {
  reminderId: string;
  state: ReminderState;
  effectiveDueOn: LocalDate | null;
  reasons: ReasonCode[];
}

interface Merged {
  title: string;
  dueOn: string | null;
  dueKm: number | null;
  dueTime: string | null;
  repeat: { every: number; unit: RepeatUnit } | null;
  category: string;
  notes: string | null;
  offsets: number[];
  soonDays: number;
  soonKm: number;
}

function validate(m: Merged): void {
  const title = m.title.trim();
  if (title.length < 1) abortValidation('title', 'Inserisci un titolo.');
  if (title.length > 120) abortValidation('title', 'Il titolo può avere al massimo 120 caratteri.');
  if (m.dueOn !== null && !isValidDate(m.dueOn)) abortValidation('dueOn', 'La data non è valida.');
  if (m.dueKm !== null && !isValidKm(m.dueKm)) abortValidation('dueKm', 'I km devono essere un numero intero tra 0 e 2.000.000.');
  if (m.dueOn === null && m.dueKm === null) abortValidation('dueOn', 'Indica una data o un chilometraggio.');
  if (m.dueTime !== null) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(m.dueTime)) abortValidation('dueTime', "L'ora deve essere nel formato HH:MM.");
    if (m.dueOn === null) abortValidation('dueTime', "L'ora si può indicare solo se c'è una data.");
  }
  if (m.repeat !== null) {
    if (!Number.isInteger(m.repeat.every) || m.repeat.every < 1 || m.repeat.every > 1000) {
      abortValidation('repeat', 'La ripetizione deve essere un numero intero da 1 a 1000.');
    }
    if (!REPEAT_UNITS.includes(m.repeat.unit)) abortValidation('repeat', "L'unità di ripetizione non è valida.");
    if (m.dueOn === null) abortValidation('repeat', 'Per ripetere la scadenza serve una data.');
  }
  if (!['legal', 'maintenance', 'check', 'tyres', 'other'].includes(m.category)) abortValidation('category', 'La categoria non è valida.');
  if (m.offsets.length > 10 || m.offsets.some((n) => !Number.isInteger(n) || n < 0 || n > 365)) {
    abortValidation('notifyOffsetsDays', 'I preavvisi devono essere giorni interi da 0 a 365 (al massimo 10).');
  }
  if (!Number.isInteger(m.soonDays) || m.soonDays < 0 || m.soonDays > 365) abortValidation('soonDays', 'I giorni "in arrivo" devono essere da 0 a 365.');
  if (!Number.isInteger(m.soonKm) || m.soonKm < 0 || m.soonKm > 100_000) abortValidation('soonKm', 'I km "in arrivo" devono essere da 0 a 100.000.');
}

const normOffsets = (v: number[]): number[] => [...new Set(v)].sort((a, b) => b - a);

async function resultOf(tx: Parameters<Parameters<Deps['db']['transaction']>[0]>[0], d: Deps, reminderId: string): Promise<CustomDeadlineResult> {
  const r = await tx.get<{ vehicle_id: string; due_on: string | null; due_km: number | null; soon_days: number; soon_km: number }>(
    'SELECT vehicle_id, due_on, due_km, soon_days, soon_km FROM reminders WHERE id = ?',
    [reminderId],
  );
  if (!r) return abortNotFound();
  const ev = evaluateThresholds({
    today: d.clock.todayLocal(),
    dueOn: r.due_on,
    dueKm: r.due_km,
    soonDays: r.soon_days,
    soonKm: r.soon_km,
    odometer: await loadOdometerPoints(tx, r.vehicle_id),
    rateParams: await loadRateParams(tx),
  });
  return { reminderId, state: ev.state, effectiveDueOn: ev.effectiveDueOn, reasons: ev.reasons };
}

/** Crea una scadenza personalizzata (promemoria manuale), anche ricorrente. La data puo' essere gia' passata (risulta scaduta). */
export async function addCustomDeadline(d: Deps, input: AddCustomDeadlineInput): Promise<UsecaseResult<CustomDeadlineResult>> {
  const res = await guard(() =>
    d.db.transaction(async (tx): Promise<CustomDeadlineResult> => {
      const v = await tx.get<{ id: string }>('SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [input.vehicleId]);
      if (!v) return abortNotFound();
      const m: Merged = {
        title: input.title,
        dueOn: input.dueOn ?? null,
        dueKm: input.dueKm ?? null,
        dueTime: input.dueTime ?? null,
        repeat: input.repeat ?? null,
        category: input.category ?? 'other',
        notes: input.notes?.trim() ? input.notes.trim() : null,
        offsets: normOffsets(input.notifyOffsetsDays ?? [30, 7, 0]),
        soonDays: input.soonDays ?? 30,
        soonKm: input.soonKm ?? 1500,
      };
      validate(m);
      const id = d.ids.ulid();
      const now = d.clock.nowIso();
      await tx.run(
        `INSERT INTO reminders (id, vehicle_id, origin, title, notes, category, due_on, due_time, due_km, soon_days, soon_km,
           notify_offsets_days, status, repeat_every, repeat_unit, repeat_origin_on, created_at, updated_at)
         VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
        [
          id,
          input.vehicleId,
          m.title.trim(),
          m.notes,
          m.category,
          m.dueOn,
          m.dueTime,
          m.dueKm,
          m.soonDays,
          m.soonKm,
          JSON.stringify(m.offsets),
          m.repeat?.every ?? null,
          m.repeat?.unit ?? null,
          m.repeat ? m.dueOn : null,
          now,
          now,
        ],
      );
      await reconcileInTx(tx, d, input.vehicleId); // riempie la cache (scadenza effettiva, previsione)
      return resultOf(tx, d, id);
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId: input.vehicleId });
  return res;
}

/** Modifica una scadenza personalizzata aperta (solo promemoria manuali). Cambiare la data riancora la ricorrenza alla nuova data. */
export async function updateCustomDeadline(
  d: Deps,
  reminderId: string,
  patch: Partial<CustomDeadlineFields>,
): Promise<UsecaseResult<CustomDeadlineResult>> {
  let vehicleId = '';
  const res = await guard(() =>
    d.db.transaction(async (tx): Promise<CustomDeadlineResult> => {
      const r = await loadReminder(tx, reminderId);
      if (!r) return abortNotFound();
      if (r.origin !== 'manual') return abortValidation('reminderId', 'Questa scadenza segue la sua regola: modifica la regola.');
      if (r.status !== 'open') return abortValidation('reminderId', 'Questa scadenza è già chiusa.');
      vehicleId = r.vehicle_id;
      const repeat =
        patch.repeat !== undefined
          ? patch.repeat
          : r.repeat_every != null && r.repeat_unit != null
            ? { every: r.repeat_every, unit: r.repeat_unit }
            : null;
      const m: Merged = {
        title: patch.title ?? r.title,
        dueOn: patch.dueOn !== undefined ? patch.dueOn : r.due_on,
        dueKm: patch.dueKm !== undefined ? patch.dueKm : r.due_km,
        dueTime: patch.dueTime !== undefined ? patch.dueTime : r.due_time,
        repeat,
        category: patch.category ?? r.category,
        notes: patch.notes !== undefined ? (patch.notes?.trim() ? patch.notes.trim() : null) : r.notes,
        offsets: normOffsets(patch.notifyOffsetsDays ?? parseOffsets(r.notify_offsets_days)),
        soonDays: patch.soonDays ?? r.soon_days,
        soonKm: patch.soonKm ?? r.soon_km,
      };
      validate(m);
      const reanchor = m.repeat !== null && (patch.dueOn !== undefined || patch.repeat !== undefined || r.repeat_origin_on === null);
      const origin = m.repeat === null ? null : reanchor ? m.dueOn : r.repeat_origin_on;
      await tx.run(
        `UPDATE reminders SET title = ?, notes = ?, category = ?, due_on = ?, due_time = ?, due_km = ?, soon_days = ?, soon_km = ?,
           notify_offsets_days = ?, repeat_every = ?, repeat_unit = ?, repeat_origin_on = ?, updated_at = ? WHERE id = ?`,
        [
          m.title.trim(),
          m.notes,
          m.category,
          m.dueOn,
          m.dueTime,
          m.dueKm,
          m.soonDays,
          m.soonKm,
          JSON.stringify(m.offsets),
          m.repeat?.every ?? null,
          m.repeat?.unit ?? null,
          origin,
          d.clock.nowIso(),
          reminderId,
        ],
      );
      await reconcileInTx(tx, d, r.vehicle_id);
      return resultOf(tx, d, reminderId);
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId });
  return res;
}

/**
 * Elimina una scadenza (cestino, soft delete): un promemoria manuale oppure una voce di manutenzione con i suoi promemoria.
 * I promemoria generati da una voce non si eliminano da soli: si disattiva o si elimina la voce.
 */
export async function deleteDeadline(
  d: Deps,
  target: { reminderId: string } | { itemId: string },
): Promise<UsecaseResult<{ vehicleId: string }>> {
  const res = await guard(() =>
    d.db.transaction(async (tx) => {
      const now = d.clock.nowIso();
      if ('reminderId' in target) {
        const r = await loadReminder(tx, target.reminderId);
        if (!r) return abortNotFound();
        if (r.origin !== 'manual') return abortValidation('reminderId', 'Questa scadenza segue la sua regola: elimina o disattiva la regola.');
        await tx.run('UPDATE reminders SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, r.id]);
        return { vehicleId: r.vehicle_id };
      }
      const item = await tx.get<{ vehicle_id: string }>('SELECT vehicle_id FROM maintenance_items WHERE id = ? AND deleted_at IS NULL', [target.itemId]);
      if (!item) return abortNotFound();
      await tx.run('UPDATE maintenance_items SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, target.itemId]);
      await reconcileInTx(tx, d, item.vehicle_id); // i promemoria generati della voce spariscono
      return { vehicleId: item.vehicle_id };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId: res.value.vehicleId });
  return res;
}
