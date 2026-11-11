// Riconoscimento degli errori SQLite piu' comuni, uguale su expo-sqlite, node:sqlite e sql.js
// (si basa sul testo del messaggio, che tutti e tre conservano; expo lo incapsula in "Error code : ...").
//
// I repository li usano per tradurre l'errore del database in un errore di dominio
// (es. ODO_NON_MONOTONIC, DUPLICATE_PLATE) senza dipendere dall'adattatore.

import type { DomainError } from '@/domain/ports';

export function sqlErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

/** Trigger `trg_odo_mono_*`: la lettura km romperebbe la monotonia fra giorni diversi. */
export function isOdoNonMonotonic(e: unknown): boolean {
  return sqlErrorMessage(e).includes('ODO_NON_MONOTONIC');
}

/** Trigger M-5: un adattatore 'simulator' si collega solo a un veicolo demo. */
export function isSimulatorRequiresDemo(e: unknown): boolean {
  return sqlErrorMessage(e).includes('SIMULATOR_REQUIRES_DEMO_VEHICLE');
}

export function isConstraintError(e: unknown): boolean {
  return /constraint failed|ODO_NON_MONOTONIC|SIMULATOR_REQUIRES_DEMO_VEHICLE/i.test(sqlErrorMessage(e));
}

/** `UNIQUE constraint failed: <tabella>.<colonna>`; con `target` (es. 'vehicles.plate') controlla anche la colonna/indice. */
export function isUniqueViolation(e: unknown, target?: string): boolean {
  const msg = sqlErrorMessage(e);
  if (!/UNIQUE constraint failed/i.test(msg)) return false;
  return target === undefined || msg.includes(target);
}

export function isForeignKeyViolation(e: unknown): boolean {
  return /FOREIGN KEY constraint failed/i.test(sqlErrorMessage(e));
}

export function isCheckViolation(e: unknown): boolean {
  return /CHECK constraint failed/i.test(sqlErrorMessage(e));
}

/**
 * Traduce gli errori del database che hanno un equivalente di dominio (ports.DomainError); undefined per gli altri
 * (da rilanciare). I repository la usano nel catch di inserimenti e modifiche.
 */
export function toDomainError(e: unknown): DomainError | undefined {
  if (isOdoNonMonotonic(e)) {
    return { code: 'ODO_NON_MONOTONIC', message: 'I chilometri non sono coerenti con le altre letture del veicolo.' };
  }
  if (isUniqueViolation(e, 'vehicles.plate')) return { code: 'DUPLICATE_PLATE' };
  return undefined;
}
