// Scheduler "finto" per l'anteprima web e per le prove: non programma nulla nel sistema, ricorda le notifiche in
// memoria (cosi' la differenza idempotente del dominio funziona come sul telefono) e STAMPA il piano in console.
import { isOurKey } from '@/domain/notifications';
import type { NotificationScheduler, PermissionState, PlannedNotification } from '@/domain/ports';

export interface ConsoleSchedulerOptions {
  /** Dove scrivere (default: console.info). */
  log?: (line: string) => void;
  /** Stato iniziale del permesso (default: 'undetermined': la richiesta lo porta a 'granted', come l'utente che accetta). */
  permission?: PermissionState;
}

export interface ScheduledEntry extends PlannedNotification {
  timeZone: string;
}

export interface ConsoleNotificationScheduler extends NotificationScheduler {
  /** Le notifiche attualmente "programmate", per chiave. */
  readonly scheduled: ReadonlyMap<string, ScheduledEntry>;
  /** Forza lo stato del permesso (per provare i casi 'denied' e 'blocked' dall'anteprima). */
  setPermission(state: PermissionState): void;
}

export function createConsoleNotificationScheduler(opts: ConsoleSchedulerOptions = {}): ConsoleNotificationScheduler {
  const log = opts.log ?? ((line: string): void => console.info(line));
  const store = new Map<string, ScheduledEntry>();
  let permission: PermissionState = opts.permission ?? 'undetermined';

  return {
    scheduled: store,
    setPermission(state) {
      permission = state;
    },
    async getPermission() {
      return permission;
    },
    async requestPermission() {
      if (permission === 'undetermined') permission = 'granted';
      log(`[notifiche] permesso richiesto: ${permission}`);
      return permission;
    },
    async listScheduled() {
      return [...store.values()].filter((e) => isOurKey(e.key)).map((e) => ({ key: e.key, hash: e.hash }));
    },
    async schedule(items, timeZone) {
      for (const item of items) {
        store.set(item.key, { ...item, timeZone });
        log(`[notifiche] + ${item.key}  ${item.date} ${item.time} (${timeZone})  [${item.channel}]  ${item.title} - ${item.body}`);
      }
      if (items.length > 0) log(`[notifiche] programmate ${items.length}, in attesa ${store.size}`);
    },
    async cancel(keys) {
      let removed = 0;
      for (const key of keys) {
        if (!isOurKey(key)) continue;
        if (store.delete(key)) {
          removed++;
          log(`[notifiche] - ${key}`);
        }
      }
      if (removed > 0) log(`[notifiche] annullate ${removed}, in attesa ${store.size}`);
    },
  };
}
