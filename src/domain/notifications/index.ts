// Piano delle notifiche locali (SPEC 8.4): API pubblica del modulo.
export {
  DEFAULT_MAX_SCHEDULED,
  KEY_PREFIX,
  OVERDUE_REPEAT,
  SENTINEL_KEY,
  TEST_KEY,
  isOurKey,
  planNotifications,
  reminderKey,
} from './plan';
export { DEFAULT_NOTIFY_TIME } from '@/domain/reminders';
export type {
  CandidateKind,
  NotifiableReminder,
  NotificationCandidate,
  NotificationPlan,
  PlanInput,
  SentinelCandidate,
} from './plan';
export { diffScheduled, fnv1a, notificationHash } from './hash';
export type { ScheduleDiff, ScheduledRef } from './hash';
export { channelForCategory } from './channels';
export type { NotificationChannel } from './channels';
