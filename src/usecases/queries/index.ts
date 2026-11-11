// Letture (view model) per la UI: SPEC 6.1-6.3, F-13/F-14/F-24. Nessuna scrittura, nessun SQL nei componenti.
export { getDashboard, TODO_LIMIT, KM_BANNER_STALE_DAYS, KM_BANNER_HORIZON_DAYS, BACKUP_BANNER_MIN_CHANGES } from './dashboard';
export type { DashboardDeps, DashboardOptions } from './dashboard';
export { getDeadlineDetail, getVehicleDeadlines, parseOffsets } from './deadlines';
export { getTimeline, TIMELINE_DEFAULT_LIMIT } from './timeline';
export { CATEGORY_LABELS, CATEGORY_ORDER, describeEvaluation, legalInfoFor } from './describe';
export type {
  BannerActionId,
  BannerKind,
  CategorySummary,
  CompletionEntry,
  Dashboard,
  DashboardBanner,
  DeadlineDetail,
  DeadlineGroup,
  DeadlineGroups,
  DeadlineIcon,
  DeadlineOrigin,
  DeadlineReason,
  DeadlineRow,
  DeadlineTone,
  LegalInfo,
  LegalSource,
  NotificationStatus,
  RuleDescription,
  StateCounts,
  Timeline,
  TimelineEntry,
  TimelineIcon,
  TimelineKind,
  TimelineOptions,
  VehicleDeadlines,
  VehicleSummary,
} from './types';
