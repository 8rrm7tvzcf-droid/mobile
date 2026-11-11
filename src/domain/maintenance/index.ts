// Motore delle scadenze (SPEC 8.3): API pubblica del modulo.
export * from './types';
export { dailyMax, latestPoint, kmAt } from './odometer';
export { RATE_DEFAULTS, estimateKmPerDay } from './rate';
export {
  DEFAULT_SOON_DAYS,
  DEFAULT_SOON_KM,
  MAX_FORECAST_DAYS,
  evaluateRule,
  evaluateThresholds,
} from './evaluate';
export type { RuleInput, ThresholdsInput } from './evaluate';
export { compareByUrgency, reasonMessage, sortByUrgency, stateLabel } from './state';
export type { StateView } from './state';
export { nextFixedDue, planCompletion, resolveLastDone } from './completion';
export type { BaselineRecord, CompletionPlan, CompletionRecord, SeriesOptions } from './completion';
