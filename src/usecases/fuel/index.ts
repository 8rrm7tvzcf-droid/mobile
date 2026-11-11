// Rifornimenti e ricariche (F-39, F-40): registro, consumi pieno-a-pieno per serbatoio, riepilogo e valori predefiniti.
export { addFuelLog, updateFuelLog, deleteFuelLog, restoreFuelLog } from './fuelLogs';
export { getFuelLog, listFuelLogs, getFuelSummary, getFuelFormDefaults } from './queries';
export type {
  AddFuelLogInput,
  AddFuelLogResult,
  DeleteFuelLogResult,
  FuelConsumptionComputed,
  FuelConsumptionPoint,
  FuelConsumptionSkipped,
  FuelConsumptionView,
  FuelFormDefaults,
  FuelLogEntry,
  FuelPricePoint,
  FuelSummary,
  FuelTankSummary,
  FuelTypeTotals,
  FuelWriteResult,
  ListFuelLogsOptions,
  OdometerConflictChoice,
  RestoreFuelLogResult,
  SuggestedKm,
  UpdateFuelLogInput,
  UpdateFuelLogResult,
} from './types';
export type { DatePeriod } from '../costs/period';
