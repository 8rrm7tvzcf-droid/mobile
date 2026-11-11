// "Rimanda" (SPEC 3.2 F-25, data.md 3.6): nasconde il promemoria da "Da fare" e dalle notifiche fino alla fine dello snooze.
// Lo snooze NON cambia la scadenza e il motore non lo tocca mai (I2).
import { DEFAULT_NOTIFY_TIME, computeSnooze } from '@/domain/reminders';
import type { SnoozeChoice } from '@/domain/reminders';
import type { LocalDate } from '@/domain/dates';
import type { Deps, UsecaseResult } from '../context';
import { guard, localToUtcIso, abortNotFound, abortValidation } from './internal';
import { loadReminder } from './reminders';

export interface SnoozeDeadlineInput {
  reminderId: string;
  /** `{type:'tomorrow'}` (domani alle 09:00), `{type:'days', days:3}`, `{type:'days', days:7}`, `{type:'after_km', km?:500}`. */
  choice: SnoozeChoice;
}

export interface SnoozeDeadlineResult {
  reminderId: string;
  /** Istante UTC salvato in `snoozed_until` (per "dopo N km" e' la scadenza di sicurezza a +30 giorni). */
  snoozedUntil: string;
  /** Stessa fine in ora locale (per il messaggio "Rimandata a ..."). */
  untilLocal: { date: LocalDate; time: string };
  /** `snooze_until_km` per "dopo N km", altrimenti null. */
  untilKm: number | null;
}

async function notifyTimeOf(d: Deps): Promise<string> {
  const row = await d.db.get<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'notify.time'`);
  if (!row) return DEFAULT_NOTIFY_TIME;
  try {
    const v: unknown = JSON.parse(row.value);
    return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : DEFAULT_NOTIFY_TIME;
  } catch {
    return DEFAULT_NOTIFY_TIME;
  }
}

/**
 * Rimanda un promemoria aperto. "Dopo N km" richiede i km attuali (altrimenti errore di validazione sul campo `currentKm`:
 * la UI chiede di aggiungere una lettura) e salva anche una scadenza di sicurezza a +30 giorni, cosi' il promemoria non
 * resta zittito per sempre se l'utente non aggiorna i km. L'ora e' quella delle notifiche (`notify.time`, default 09:00).
 */
export async function snoozeDeadline(d: Deps, input: SnoozeDeadlineInput): Promise<UsecaseResult<SnoozeDeadlineResult>> {
  const notifyTime = await notifyTimeOf(d);
  let vehicleId = '';
  const res = await guard(() =>
    d.db.transaction(async (tx): Promise<SnoozeDeadlineResult> => {
      const rem = await loadReminder(tx, input.reminderId);
      if (!rem) return abortNotFound();
      if (rem.status !== 'open') return abortValidation('reminderId', 'Questa scadenza è già chiusa.');
      vehicleId = rem.vehicle_id;
      const cur = await tx.get<{ km: number }>('SELECT km FROM v_vehicle_odometer WHERE vehicle_id = ?', [rem.vehicle_id]);
      const target = computeSnooze(input.choice, d.clock.nowLocal(), { currentKm: cur?.km ?? null, notifyTime });
      if (!target.ok) {
        if (target.error.code === 'NO_ODOMETER') {
          return abortValidation('currentKm', 'Per rimandare «dopo N km» serve almeno una lettura dei km: aggiungi i km attuali.');
        }
        return abortValidation('choice', 'Il rimando scelto non è valido.');
      }
      const snoozedUntil = localToUtcIso(target.value.untilLocal, d.clock);
      await tx.run('UPDATE reminders SET snoozed_until = ?, snooze_until_km = ?, updated_at = ? WHERE id = ?', [
        snoozedUntil,
        target.value.untilKm,
        d.clock.nowIso(),
        rem.id,
      ]);
      return { reminderId: rem.id, snoozedUntil, untilLocal: target.value.untilLocal, untilKm: target.value.untilKm };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId });
  return res;
}

/** Toglie il rimando: il promemoria torna in "Da fare" e alle notifiche normali. */
export async function clearSnooze(d: Deps, reminderId: string): Promise<UsecaseResult<{ reminderId: string }>> {
  let vehicleId = '';
  const res = await guard(() =>
    d.db.transaction(async (tx) => {
      const rem = await loadReminder(tx, reminderId);
      if (!rem) return abortNotFound();
      vehicleId = rem.vehicle_id;
      await tx.run('UPDATE reminders SET snoozed_until = NULL, snooze_until_km = NULL, updated_at = ? WHERE id = ?', [
        d.clock.nowIso(),
        rem.id,
      ]);
      return { reminderId: rem.id };
    }, 'exclusive'),
  );
  if (!res.ok) return res;
  d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId });
  return res;
}
