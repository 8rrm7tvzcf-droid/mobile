// Sincronizzazione delle notifiche locali (SPEC 8.4): API pubblica del modulo.
export { syncNotifications } from './sync';
export type { SyncReport } from './sync';
export {
  COALESCE_MS,
  FOREGROUND_MIN_INTERVAL_MS,
  attachSyncToEvents,
  createSyncCoordinator,
} from './coordinator';
export type { SyncCoordinator, SyncCoordinatorOptions, SyncCoordinatorState, SyncReason } from './coordinator';
export { GUIDE_BLOCKED, GUIDE_DENIED, TEST_DELAY_SECONDS, verifyNotifications } from './verify';
export type { VerifyNextAction, VerifyOptions, VerifyReport } from './verify';
export { buildPlannedNotifications } from './plan';
export type { BuiltPlan } from './plan';
export { APP_NAME, ROUTE_PREFIX, SENTINEL_BODY, TEST_BODY, renderReminderNotification, renderSentinel } from './render';
export type { RenderedContent } from './render';
