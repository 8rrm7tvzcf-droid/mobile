// Helper condivisi dai casi d'uso che chiudono, riaprono o rimandano un promemoria (uso INTERNO al modulo).
import { nextRecurringDue } from '@/domain/reminders';
import type { RepeatUnit } from '@/domain/reminders';
import { toDomainError, validateOdometerReading } from '@/domain/odometer';
import type { OdometerReading } from '@/domain/odometer';
import type { LocalDate } from '@/domain/dates';
import type { Clock, IdGenerator, SqlDatabase, SqlValue } from '@/domain/ports';
import { Abort } from './internal';

export interface ReminderRow {
  id: string;
  vehicle_id: string;
  origin: 'generated' | 'manual';
  item_id: string | null;
  policy_id: string | null;
  payment_id: string | null;
  title: string;
  notes: string | null;
  category: string;
  due_on: string | null;
  due_time: string | null;
  due_km: number | null;
  soon_days: number;
  soon_km: number;
  notify_offsets_days: string;
  status: 'open' | 'done' | 'skipped';
  snoozed_until: string | null;
  snooze_until_km: number | null;
  completed_on: string | null;
  completion_id: string | null;
  repeat_every: number | null;
  repeat_unit: RepeatUnit | null;
  repeat_origin_on: string | null;
}

export const REMINDER_COLUMNS =
  'id, vehicle_id, origin, item_id, policy_id, payment_id, title, notes, category, due_on, due_time, due_km, soon_days, soon_km, notify_offsets_days, status, snoozed_until, snooze_until_km, completed_on, completion_id, repeat_every, repeat_unit, repeat_origin_on';

/** Promemoria non cancellato (soft delete), qualunque stato. */
export function loadReminder(tx: SqlDatabase, id: string): Promise<ReminderRow | undefined> {
  return tx.get<ReminderRow>(`SELECT ${REMINDER_COLUMNS} FROM reminders WHERE id = ? AND deleted_at IS NULL`, [id]);
}

type Env = { clock: Clock; ids: IdGenerator };

/**
 * Chiusura di un promemoria manuale ricorrente: crea la prima occorrenza dopo max(scadenza, oggi) (data.md 3.8).
 * Le occorrenze sono ancorate all'ORIGINE; i km facoltativi valgono solo per la prima occorrenza (la ricorrenza e' a data).
 * Restituisce l'id della nuova occorrenza, o null se il promemoria non si ripete.
 */
export async function spawnNextOccurrence(tx: SqlDatabase, d: Env, r: ReminderRow): Promise<string | null> {
  if (r.origin !== 'manual' || r.repeat_every == null || r.repeat_unit == null || r.repeat_origin_on == null || r.due_on == null) {
    return null;
  }
  const next = nextRecurringDue(
    { originOn: r.repeat_origin_on, every: r.repeat_every, unit: r.repeat_unit },
    r.due_on,
    d.clock.todayLocal(),
  );
  const id = d.ids.ulid();
  const now = d.clock.nowIso();
  await tx.run(
    `INSERT INTO reminders (id, vehicle_id, origin, title, notes, category, due_on, due_time, due_km, soon_days, soon_km,
       notify_offsets_days, status, repeat_every, repeat_unit, repeat_origin_on, created_at, updated_at)
     VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
    [
      id,
      r.vehicle_id,
      r.title,
      r.notes,
      r.category,
      next,
      r.due_time,
      r.soon_days,
      r.soon_km,
      r.notify_offsets_days,
      r.repeat_every,
      r.repeat_unit,
      r.repeat_origin_on,
      now,
      now,
    ],
  );
  return id;
}

/** Soft delete dell'occorrenza aperta della stessa ricorrenza (annulla di una chiusura che l'aveva generata). */
export async function dropSpawnedOccurrence(tx: SqlDatabase, nowIso: string, r: ReminderRow): Promise<void> {
  if (r.origin !== 'manual' || r.repeat_every == null) return;
  await tx.run(
    `UPDATE reminders SET deleted_at = ?, updated_at = ?
     WHERE origin = 'manual' AND vehicle_id = ? AND status = 'open' AND deleted_at IS NULL AND id <> ?
       AND title = ? AND repeat_every = ? AND repeat_unit = ? AND repeat_origin_on = ?`,
    [nowIso, nowIso, r.vehicle_id, r.id, r.title, r.repeat_every, r.repeat_unit, r.repeat_origin_on as SqlValue],
  );
}

export interface KmRegistration {
  /** Km da usare nel completamento (null se assenti o ignorati). */
  km: number | null;
  /** Lettura creata (null se i km non c'erano, esisteva gia' la stessa lettura o i km sono stati ignorati). */
  readingId: string | null;
  /** Vero se i km erano in conflitto con le letture vicine e si e' scelto di ignorarli. */
  ignored: boolean;
  /** Avvisi non bloccanti (salto di km implausibile). */
  warnings: string[];
}

/** Nota (descrittiva) della lettura creata da un "Fatto". NON serve a ritrovarla: per quello c'e' `doneReadingIdOf`. */
export const doneReadingNote = (name: string): string => `Fatto: ${name}`.slice(0, 120);

/**
 * Id della lettura km creata dal "Fatto" `completionId`: e' DERIVATO dall'id del completamento (stesso id con il primo
 * carattere sostituito da '9', che un ULID non ha mai: il primo carattere va da 0 a 7). Lo schema non ha un legame
 * completamento -> lettura (la lettura nasce con `source = 'manual'`): cosi' l'annulla ritrova ESATTAMENTE quella lettura
 * senza confrontare istanti di creazione o note, che cambiano (orologio reale, voce rinominata).
 */
export const doneReadingIdOf = (completionId: string): string => `9${completionId.slice(1)}`;

/**
 * Registra i km di un "Fatto" nel registro dei km (data.md 3.7 passo 2), con la stessa validazione del trigger
 * `ODO_NON_MONOTONIC`. Se la stessa lettura (giorno e km) esiste gia' non ne crea un'altra. In caso di conflitto:
 * `fail` (errore tipizzato, la UI propone "correggi / ignora i km / e' un errore della lettura precedente")
 * oppure `skip_km` (si completa senza km).
 */
export async function registerKm(
  tx: SqlDatabase,
  d: Env,
  args: {
    vehicleId: string;
    doneOn: LocalDate;
    km: number | null;
    note: string;
    onConflict: 'fail' | 'skip_km';
    /** Id della lettura da creare (default: un nuovo ULID). */
    readingId?: string;
    /** Istante di creazione (default: adesso): il "Fatto" passa lo stesso `now` del completamento. */
    nowIso?: string;
  },
): Promise<KmRegistration> {
  if (args.km == null) return { km: null, readingId: null, ignored: false, warnings: [] };
  const rows = await tx.all<{ id: string; read_on: string; km: number; source: OdometerReading['source']; status: OdometerReading['status'] }>(
    'SELECT id, read_on, km, source, status FROM odometer_readings WHERE vehicle_id = ? AND deleted_at IS NULL',
    [args.vehicleId],
  );
  const existing: OdometerReading[] = rows.map((r) => ({ id: r.id, readOn: r.read_on, km: r.km, source: r.source, status: r.status }));
  const v = validateOdometerReading({ readOn: args.doneOn, km: args.km, source: 'manual' }, existing, {
    today: d.clock.todayLocal(),
  });
  if (!v.ok) {
    if (args.onConflict === 'skip_km' && v.errors.every((e) => e.code === 'NON_MONOTONIC')) {
      return { km: null, readingId: null, ignored: true, warnings: [] };
    }
    const domain = toDomainError(v);
    if (domain) throw new Abort(domain);
    throw new Abort({ code: 'VALIDATION', field: 'doneKm', message: v.errors[0]?.message ?? 'I km non sono validi.' });
  }
  const warnings = v.warnings.map((w) => w.message);
  const same = rows.find((r) => r.read_on === args.doneOn && r.km === args.km && r.status === 'valid');
  if (same) return { km: args.km, readingId: null, ignored: false, warnings };
  const id = args.readingId ?? d.ids.ulid();
  const now = args.nowIso ?? d.clock.nowIso();
  await tx.run(
    `INSERT INTO odometer_readings (id, vehicle_id, read_on, km, source, status, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'manual', 'valid', ?, ?, ?)`,
    [id, args.vehicleId, args.doneOn, args.km, args.note, now, now],
  );
  return { km: args.km, readingId: id, ignored: false, warnings };
}
