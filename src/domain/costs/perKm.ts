// Costo al km con la spiegazione del calcolo (F-42, SPEC §6.3.8 S-60):
// «costi del periodo diviso i km percorsi tra la prima e l'ultima lettura del periodo».
import type { LocalDate } from '@/domain/ports';
import { kmTravelled, type OdometerReading } from '@/domain/odometer';
import { formatEuro, formatEuroPerKm, formatInt, perKmMilli, per100KmCents } from '@/domain/units';
import { filterCostPeriod, filterCostSources, totalCostCents } from './aggregate';
import type { CostEntry, CostSource } from './types';

export type CostPerKmFailure = 'NO_KM_DATA' | 'ZERO_DISTANCE';

export type CostPerKm =
  | {
      ok: true;
      totalCents: number;
      km: number;
      /** Millesimi di euro al km: 348 = 0,348 EUR/km. */
      perKmMilli: number;
      /** Centesimi per 100 km: 3480 = 34,80 EUR/100 km. */
      per100KmCents: number;
      /** "0,35 €/km", pronto da mostrare. */
      text: string;
      /** Spiegazione del calcolo, in italiano, con i numeri usati. */
      explanationIt: string;
    }
  | { ok: false; reason: CostPerKmFailure; explanationIt: string };

export const COST_PER_KM_EXPLANATION_IT =
  "Costi del periodo divisi per i km percorsi tra la prima e l'ultima lettura del periodo.";

/**
 * Costo al km di un periodo. `entries` sono le righe di `v_costs` del veicolo (anche di altri periodi: si filtra qui);
 * `readings` il registro km del veicolo. Con `sources` si restringe a certe fonti (es. senza carburante).
 * Non calcolabile con meno di due letture nel periodo o se i km non sono cambiati: lo dice, non inventa.
 */
export function costPerKmForPeriod(
  entries: readonly CostEntry[],
  readings: readonly OdometerReading[],
  from: LocalDate,
  to: LocalDate,
  opts: { sources?: readonly CostSource[] } = {},
): CostPerKm {
  const inPeriod = filterCostPeriod(opts.sources ? filterCostSources(entries, opts.sources) : entries, from, to);
  return costPerKm(totalCostCents(inPeriod), kmTravelled(readings, from, to)?.km ?? null);
}

/** Costo al km da un totale e dai km percorsi (`null` = letture insufficienti). */
export function costPerKm(totalCents: number, km: number | null): CostPerKm {
  if (km === null) {
    return {
      ok: false,
      reason: 'NO_KM_DATA',
      explanationIt: 'Per calcolare il costo al km servono almeno due letture dei km nel periodo.',
    };
  }
  const milli = perKmMilli(totalCents, km);
  const per100 = per100KmCents(totalCents, km);
  if (milli === null || per100 === null) {
    return {
      ok: false,
      reason: 'ZERO_DISTANCE',
      explanationIt: 'Le letture del periodo indicano gli stessi km: non si può calcolare il costo al km.',
    };
  }
  return {
    ok: true,
    totalCents,
    km,
    perKmMilli: milli,
    per100KmCents: per100,
    text: formatEuroPerKm(milli),
    explanationIt:
      `${COST_PER_KM_EXPLANATION_IT} ` + `${formatEuro(totalCents)} ÷ ${formatInt(km)} km = ${formatEuroPerKm(milli)}.`,
  };
}
