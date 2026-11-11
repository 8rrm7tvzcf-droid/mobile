// Controllo livelli (F-44, S-24): registrazione in 3 tocchi con completamento delle voci di controllo, elenco e stato.
// Eventi: dopo ogni scrittura `data-changed` con scope `service` (non esiste uno scope "fluids"), piu' `reminders` se i
// promemoria sono cambiati e `odometer` se e' cambiato il registro km.
export { addFluidCheck, deleteFluidCheck, MAX_NOTES_LENGTH, MAX_PRODUCT_LENGTH } from './checks';
export { getFluidCheck, getFluidStatus, getFluidStatusOf, getToppedUpSummary, listFluidChecks } from './queries';
export { FLUID_CHECK_TEMPLATES } from './types';
export type {
  AddFluidCheckInput,
  AddFluidCheckResult,
  DeleteFluidCheckResult,
  FluidCheckEntry,
  FluidCompletion,
  FluidStatusEntry,
  FluidStatusOptions,
  ListFluidChecksOptions,
} from './types';
