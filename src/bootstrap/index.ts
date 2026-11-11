// API pubblica del composition root (SPEC 8.6). Contratto con gli altri strati:
//   createAppRoot(): Promise<AppRoot>      (root.ts sul telefono, root.web.ts sul web: Metro sceglie da solo)
//   AppProvider                            provider radice con caricamento e schermata di recupero
//   useApp(): AppRoot                      le dipendenze per i casi d'uso, dentro <AppProvider>
export { createAppRoot } from './root';
export { AppProvider, useApp, type AppProviderProps } from './AppProvider';
export type { AppRoot, ObdTransportOptions } from './types';
// Facciata OBD per la UI (src/bootstrap/obdService.ts): la UI non importa mai src/obd, solo questi nomi.
export { DEMO_SCENARIOS } from './obdService';
export type {
  CapabilityReport,
  ChecklistItem,
  DecodedPid,
  DemoScenario,
  DtcSection,
  FreezeFrame,
  LiveSample,
  LiveStopReason,
  Mode01Status,
  MonitorStatus,
  ObdConnectStep,
  ObdFailure,
  ObdFailureCode,
  ObdPhase,
  ObdReadStep,
  ObdResult,
  ObdService,
  ObdState,
  PidCapability,
  Provenance,
  Reading,
  SectionStatus,
  ServiceProbe,
  Snapshot,
  StartLiveOptions,
} from './obdService';
