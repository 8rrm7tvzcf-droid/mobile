// Promemoria da notificare: aperti, di auto attive, con la fine dello snooze ancora valida (data.md 4.7).
// Si legge la CACHE `reminders` (la ricalcola la riconciliazione): la sincronizzazione non scrive mai sul database.
import type { LocalDate } from '@/domain/dates';
import type { DueTrigger } from '@/domain/maintenance';
import type { NotifiableReminder } from '@/domain/notifications';
import type { Clock, SqlDatabase } from '@/domain/ports';
import type { ReminderCategory } from '@/domain/reminders';
import { activeSnoozeUntil } from '@/domain/reminders';
import { isoToLocal } from '../queries/localTime';
import { vehicleLabel } from '../queries/load';

/** Promemoria con i dati che servono a scrivere il testo della notifica. */
export interface NotifiableWithContext extends NotifiableReminder {
  title: string;
  vehicleId: string;
  vehicleLabel: string;
  plate: string | null;
  trigger: DueTrigger | null;
  /** I km della scadenza sono gia' stati raggiunti da una lettura reale: la scadenza e' certa, non una stima. */
  kmReached?: boolean;
}

interface Row {
  id: string;
  vehicle_id: string;
  title: string;
  category: ReminderCategory;
  effective_due_on: string | null;
  due_time: string | null;
  due_km: number | null;
  due_trigger: DueTrigger | null;
  notify_offsets_days: string;
  snoozed_until: string | null;
  snooze_until_km: number | null;
  item_id: string | null;
  item_notify: number | null;
  item_active: number | null;
  item_deleted_at: string | null;
  nickname: string | null;
  make: string;
  model: string;
  plate: string | null;
}

const DEFAULT_OFFSETS: readonly number[] = [30, 7, 0];

function offsetsOf(json: string): number[] {
  try {
    const v: unknown = JSON.parse(json);
    if (Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 365)) return v as number[];
  } catch {
    // JSON non valido: predefinito
  }
  return [...DEFAULT_OFFSETS];
}

export async function loadNotifiableReminders(db: SqlDatabase, clock: Clock): Promise<NotifiableWithContext[]> {
  const today: LocalDate = clock.todayLocal();
  const nowLocal = clock.nowLocal();
  const rows = await db.all<Row>(
    `SELECT r.id, r.vehicle_id, r.title, r.category, r.effective_due_on, r.due_time, r.due_km, r.due_trigger, r.notify_offsets_days,
            r.snoozed_until, r.snooze_until_km, r.item_id,
            i.notify_enabled AS item_notify, i.is_active AS item_active, i.deleted_at AS item_deleted_at,
            v.nickname, v.make, v.model, v.plate
       FROM reminders r
       JOIN vehicles v ON v.id = r.vehicle_id
       LEFT JOIN maintenance_items i ON i.id = r.item_id
      WHERE r.status = 'open' AND r.deleted_at IS NULL AND v.deleted_at IS NULL AND v.status = 'active'
      ORDER BY r.effective_due_on, r.id`,
  );
  const kmRows = await db.all<{ vehicle_id: string; km: number }>(
    `SELECT vehicle_id, MAX(km) AS km FROM odometer_readings
      WHERE status = 'valid' AND deleted_at IS NULL AND read_on <= ? GROUP BY vehicle_id`,
    [today],
  );
  const currentKm = new Map(kmRows.map((k) => [k.vehicle_id, k.km]));

  const out: NotifiableWithContext[] = [];
  for (const r of rows) {
    if (r.item_id && (r.item_active === 0 || r.item_deleted_at != null)) continue; // regola spenta o nel cestino
    const km = currentKm.get(r.vehicle_id) ?? null;
    out.push({
      id: r.id,
      category: r.category,
      status: 'open',
      // per i generati da una voce vale `notify_enabled` della voce; per polizze, rate e manuali si notifica sempre
      notifyEnabled: r.item_id ? r.item_notify === 1 : true,
      effectiveDueOn: r.effective_due_on,
      notifyOffsetsDays: offsetsOf(r.notify_offsets_days),
      dueTime: r.due_time,
      snoozedUntilLocal: activeSnoozeUntil(
        { snoozedUntilLocal: r.snoozed_until ? isoToLocal(r.snoozed_until, clock) : null, snoozeUntilKm: r.snooze_until_km },
        nowLocal,
        km,
      ),
      title: r.title,
      vehicleId: r.vehicle_id,
      vehicleLabel: vehicleLabel(r),
      plate: r.plate,
      trigger: r.due_trigger,
      kmReached: r.due_km != null && km != null && km >= r.due_km,
    });
  }
  return out;
}
