// Distanze (SPEC §8.1, data.md §7.2). Canonico nel DB: km INTERI (0..2.000.000).
// La preferenza km/miglia e' solo di visualizzazione: si converte UNA volta, quando l'utente scrive,
// e non si risalva mai un valore convertito per la visualizzazione. Dominio puro.

export type DistanceUnit = 'km' | 'mi';

/** Miglia internazionali: esatto per definizione. */
export const KM_PER_MI = 1.609344;

/** Limite del `CHECK` sulle colonne km (`BETWEEN 0 AND 2000000`). */
export const MAX_KM = 2_000_000;

/** Input utente in miglia -> km interi canonici. */
export const miToKm = (mi: number): number => Math.round(mi * KM_PER_MI);

/** Solo per la visualizzazione: kmToMi(miToKm(mi)) === mi per ogni intero 0..500.000 (verificato). */
export const kmToMi = (km: number): number => Math.round(km / KM_PER_MI);

export const toDisplayDistance = (km: number, unit: DistanceUnit): number => (unit === 'mi' ? kmToMi(km) : km);

export const fromDisplayDistance = (value: number, unit: DistanceUnit): number =>
  unit === 'mi' ? miToKm(value) : Math.round(value);

/** Un km valido per il DB: intero tra 0 e 2.000.000. */
export function isValidKm(km: number): boolean {
  return Number.isInteger(km) && km >= 0 && km <= MAX_KM;
}

export const distanceUnitLabel = (unit: DistanceUnit): string => (unit === 'mi' ? 'mi' : 'km');
