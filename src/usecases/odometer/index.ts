// Registro chilometri (F-03): letture manuali, verifica di coerenza, elenco, ignora/ripristina, previsione km/giorno.
export {
  addOdometerReading,
  checkOdometerReading,
  listOdometerReadings,
  latestOdometer,
  markReadingIgnored,
  deleteOdometerReading,
  isOdometerConflict,
} from './odometer';
export { getKmForecast } from './forecast';
export { mapSqlError, sqlMessage, isUniqueOn } from './sqlErrors';
export type {
  AddOdometerReadingInput,
  AddOdometerReadingResult,
  KmForecast,
  KmRange,
  ListOdometerOptions,
  OdometerCheck,
  OdometerConflictError,
  OdometerEntry,
} from './types';
