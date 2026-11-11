// «Più tardi» sul promemoria del backup (Oggi): vale fino alla prossima apertura dell'app, non si salva su disco.
import { useSyncExternalStore } from 'react';

let snoozed = false;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const l of [...listeners]) l();
};

export function snoozeBackupReminder(): void {
  if (snoozed) return;
  snoozed = true;
  emit();
}

export function resetBackupReminderSnooze(): void {
  if (!snoozed) return;
  snoozed = false;
  emit();
}

export const isBackupReminderSnoozed = (): boolean => snoozed;

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function useBackupReminderSnoozed(): boolean {
  return useSyncExternalStore(subscribe, isBackupReminderSnoozed, isBackupReminderSnoozed);
}
