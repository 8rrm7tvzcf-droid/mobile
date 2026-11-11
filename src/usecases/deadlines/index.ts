// Casi d'uso delle scadenze, parte di scrittura (SPEC 3.2 F-19..F-28, 8.3). API pubblica del modulo.
// Contratto con gli altri agenti: reconcileAll e reconcileVehicle (firma esatta).
export { reconcileAll, reconcileVehicle } from './reconcile';

// Wizard "Imposta le scadenze"
export { listSetupCatalog } from './catalog';
export type { SetupCatalog, SetupProposal, SetupQuestion } from './catalog';
export { setupDeadlines } from './setup';
export type { LastDoneAnswer, SetupDeadlinesInput, SetupDeadlinesResult, SetupItemInput, SetupItemResult, SetupReason } from './setup';
export { vehicleTags, templateApplies } from './applicability';
export type { VehicleTag } from './applicability';

// Regole e scadenze personalizzate
export { addCustomRule, updateDeadlineRule } from './rules';
export type { CustomRuleInput, DeadlineRulePatch, DeadlineRuleResult } from './rules';
export { addCustomDeadline, deleteDeadline, updateCustomDeadline } from './custom';
export type { AddCustomDeadlineInput, CustomDeadlineFields, CustomDeadlineResult } from './custom';

// Fatto / Rimanda / Salta / Annulla
export { completeDeadline, undoCompletion } from './complete';
export type { CompleteDeadlineInput, CompleteDeadlineResult, DeadlineNext, UndoCompletionResult } from './complete';
export { reopenReminder, skipDeadline } from './skip';
export type { ReopenReminderResult, SkipDeadlineResult } from './skip';
export { clearSnooze, snoozeDeadline } from './snooze';
export type { SnoozeDeadlineInput, SnoozeDeadlineResult } from './snooze';

// Utilita' di tempo per chi legge `snoozed_until` (stesso metodo di conversione usato per scriverlo)
export { localToUtcIso, utcIsoToLocal } from './internal';
