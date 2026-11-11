// Dal database al piano di notifiche pronto per la porta NotificationScheduler (data.md 4.7).
import type { LocalDate } from '@/domain/dates';
import { fnv1a, notificationHash, planNotifications } from '@/domain/notifications';
import type { PlannedNotification } from '@/domain/ports';
import type { Deps } from '../context';
import { readNotifySettings } from '../queries/settings';
import type { NotifySettings } from '../queries/settings';
import { loadNotifiableReminders } from './load';
import { renderReminderNotification, renderSentinel } from './render';
import type { RenderedContent } from './render';

export interface BuiltPlan {
  settings: NotifySettings;
  /** Notifiche desiderate (in ordine di tempo), sentinella compresa. */
  items: PlannedNotification[];
  /** Candidate rimaste fuori dalla finestra (sostituite dalla sentinella). */
  overflow: number;
  /** Ora e fuso con cui sono stati calcolati hash e istanti. */
  timeZone: string;
}

/** Hash di contenuto + fuso: se il fuso cambia cambiano tutti gli hash e il piano si ripianifica (SPEC 6.3.13). */
export function contentHash(c: RenderedContent, date: LocalDate, time: string, timeZone: string): string {
  return fnv1a(`${timeZone}|${notificationHash({ date, time, channel: c.channel, title: c.title, body: c.body })}`);
}

/**
 * Notifiche desiderate adesso: impostazioni -> promemoria aperti -> `planNotifications` (finestra `notify.maxScheduled`,
 * sentinella) -> testi. Con gli avvisi spenti (`notify.enabled = false`) il piano e' vuoto. Non tocca lo scheduler.
 */
export async function buildPlannedNotifications(d: Deps): Promise<BuiltPlan> {
  const settings = await readNotifySettings(d.db);
  const timeZone = d.clock.timeZone();
  if (!settings.enabled) return { settings, items: [], overflow: 0, timeZone };

  const reminders = await loadNotifiableReminders(d.db, d.clock);
  const byId = new Map(reminders.map((r) => [r.id, r]));
  const plan = planNotifications({
    reminders,
    nowLocal: d.clock.nowLocal(),
    notifyTime: settings.time,
    maxScheduled: settings.maxScheduled,
  });

  const items: PlannedNotification[] = [];
  for (const c of plan.items) {
    const r = byId.get(c.reminderId);
    if (!r) continue;
    const content = renderReminderNotification(c, r, settings.privacy);
    items.push({
      key: c.key,
      hash: contentHash(content, c.date, c.time, timeZone),
      date: c.date,
      time: c.time,
      ...content,
    });
  }
  if (plan.sentinel) {
    const content = renderSentinel(plan.sentinel);
    items.push({
      key: plan.sentinel.key,
      hash: contentHash(content, plan.sentinel.date, plan.sentinel.time, timeZone),
      date: plan.sentinel.date,
      time: plan.sentinel.time,
      ...content,
    });
  }
  return { settings, items, overflow: plan.overflow, timeZone };
}
