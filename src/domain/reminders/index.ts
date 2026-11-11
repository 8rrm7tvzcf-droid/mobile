// Promemoria (occorrenze): ricorrenze, snooze e piano di riconciliazione (SPEC 8.3). API pubblica del modulo.
export * from './types';
export { nextOccurrence, nextRecurringDue, occurrenceOn } from './recurrence';
export {
  DEFAULT_NOTIFY_TIME,
  SNOOZE_DEFAULT_KM,
  SNOOZE_KM_SAFETY_DAYS,
  activeSnoozeUntil,
  computeSnooze,
  isSnoozed,
} from './snooze';
export type { SnoozeChoice, SnoozeError, SnoozeState, SnoozeTarget } from './snooze';
export {
  INSTALLMENT_NOTIFY_OFFSETS,
  POLICY_NOTIFY_OFFSETS,
  installmentReminderTitle,
  isEmptyChanges,
  planReminderChanges,
  policyReminderTitle,
} from './reconcile';
export type {
  ClosedCycle,
  CloseReason,
  NewReminder,
  OpenReminder,
  PolicyKind,
  ReconcileInput,
  ReconcileItem,
  ReconcilePayment,
  ReconcilePolicy,
  ReconcileVehicle,
  ReminderChanges,
  ReminderClose,
  ReminderFields,
  ReminderRemoval,
  ReminderUpdate,
  RemoveReason,
} from './reconcile';
