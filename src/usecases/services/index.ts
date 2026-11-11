// Interventi e tagliandi, cambio olio, officine (SPEC 3.3 F-35..F-38, 6.3.6, AC-06). API pubblica del modulo.

// Comandi sugli interventi (scrittura, una transazione ciascuno)
export {
  addServiceRecord,
  updateServiceRecord,
  deleteServiceRecord,
  restoreServiceRecord,
  setServiceCompletions,
  REPEAT_REMINDER_TITLE,
} from './records';

// Letture
export { listServiceRecords, getServiceRecord } from './queries';
export { suggestItemsForLines, suggestLastDoneFromHistory } from './suggest';

// Officine
export { upsertWorkshop, listWorkshops, deleteWorkshop } from './workshops';

// Classificazione delle righe, preimpostazioni per la UI
export {
  lineCategoryOf,
  categoryOfText,
  matchService,
  isFullServiceTitle,
  CATEGORY_TEMPLATES,
  LINE_CATEGORY_LABELS,
  SERVICE_PRESETS,
  LINE_PRESETS,
} from './classify';
export type { LineLike, ServiceLike, ServiceMatch, ServicePreset, LinePreset } from './classify';
export { oilChangeLines } from './validate';

export {
  SERVICE_KINDS,
  SERVICE_KIND_LABELS,
  LINE_TYPES,
  LINE_TYPE_LABELS,
  FLUID_KINDS,
  INSPECTION_RESULTS,
  INSPECTION_RESULT_LABELS,
} from './types';
export type {
  AddServiceRecordInput,
  AddServiceRecordResult,
  DeleteServiceRecordResult,
  InspectionResult,
  KmConflictChoice,
  LastDoneSuggestion,
  LineCategory,
  ListWorkshopsOptions,
  OilChangeDetail,
  OilChangeInput,
  RestoreServiceRecordResult,
  ServiceCompletionInfo,
  ServiceFilters,
  ServiceFluidKind,
  ServiceItemSuggestion,
  ServiceKind,
  ServiceLine,
  ServiceLineInput,
  ServiceLineType,
  ServiceRecordDetail,
  ServiceRecordFields,
  ServiceRecordSummary,
  ServiceWarning,
  ServiceWarningCode,
  SetServiceCompletionsResult,
  SuggestItemsOptions,
  UpdateServiceRecordPatch,
  UpdateServiceRecordResult,
  UpsertWorkshopInput,
  Workshop,
  WorkshopInput,
  WorkshopRef,
} from './types';
