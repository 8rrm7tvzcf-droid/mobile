// Garage multi-veicolo (F-01, F-02, F-05): aggiunta, modifica, archivio, cestino, elenco e scheda.
export {
  addVehicle,
  updateVehicle,
  archiveVehicle,
  reactivateVehicle,
  deleteVehicle,
  restoreVehicle,
  listTrashedVehicles,
  purgeVehicle,
  purgeExpiredTrash,
  listVehicles,
  getVehicle,
  purgeDateOf,
} from './vehicles';
export {
  normalizePlate,
  normalizeVin,
  isValidItalianPlate,
  isValidVin,
  derivePowertrain,
  fuelCombinationError,
  validateVehicleInput,
  type VehicleFields,
} from './validate';
export * from './types';
