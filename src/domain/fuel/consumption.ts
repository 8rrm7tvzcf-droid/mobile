// Consumi pieno-a-pieno (F-39, F-40; data.md §3.10 e vettore V11). Dominio puro, solo interi.
//
// Come funziona: il consumo di un pieno e' il carburante messo da quel pieno (piu' gli eventuali rifornimenti
// PARZIALI fatti dopo il pieno precedente) diviso i km percorsi dal pieno precedente. Un rifornimento mancato
// (`missedBefore`) o i km mancanti spezzano la catena: da li' si riparte, senza inventare valori.
// Il consumo e' un intero in CENTESIMI di unita' per 100 km (643 = 6,43 L/100 km): niente virgola mobile nel dominio;
// la divisione in virgola mobile e' solo per mostrare (`formatConsumption`).
import { compareDates } from '@/domain/dates';
import type { LocalDate } from '@/domain/ports';
import { per100KmCents } from '@/domain/units';
import { TANK_ORDER, tankOf, unitForFuel, type FuelType, type QuantityUnit, type TankKey } from './types';

/** Un rifornimento con i km collegati (la query LEFT JOIN su `odometer_readings`: `km` puo' mancare). */
export interface ConsumptionLog {
  id: string;
  /** `fuel_logs.filled_on`. */
  on: LocalDate;
  km: number | null;
  quantityMilli: number;
  isFull: boolean;
  missedBefore: boolean;
  /** Per il raggruppamento per serbatoio. */
  fuelType?: FuelType;
  /** Per il costo al km del carburante: se manca, i costi dei punti sono `null`. */
  totalCents?: number;
  /** Per l'ordinamento a parita' di data (come la query: `filled_on, created_at, id`). */
  createdAt?: string;
}

export type ConsumptionSkipReason =
  | 'NO_KM' // pieno senza km collegati
  | 'KM_NOT_INCREASING' // km uguali o inferiori al pieno precedente
  | 'FIRST_FULL' // primo pieno: serve un secondo pieno
  | 'CHAIN_BROKEN'; // rifornimento mancato prima di questo pieno

export interface ConsumptionPoint {
  computed: true;
  id: string;
  on: LocalDate;
  /** Km dal pieno precedente. */
  distanceKm: number;
  /** Carburante consumato (pieno + parziali intermedi), in millesimi. */
  quantityMilli: number;
  /** Centesimi di unita' per 100 km: 643 = 6,43 L/100 km. */
  per100Centi: number;
  /** Spesa dei rifornimenti del tratto (pieno + parziali), se tutti hanno il totale. */
  costCents: number | null;
}

export interface ConsumptionSkipped {
  computed: false;
  id: string;
  on: LocalDate;
  reason: ConsumptionSkipReason;
}

export type ConsumptionEntry = ConsumptionPoint | ConsumptionSkipped;

export const SKIP_REASON_TEXT_IT: Record<ConsumptionSkipReason, string> = {
  FIRST_FULL: 'Primo pieno registrato: il consumo si calcola dal secondo pieno in poi.',
  NO_KM: 'Mancano i km di questo pieno: aggiungili per calcolare il consumo.',
  KM_NOT_INCREASING: 'I km non sono maggiori di quelli del pieno precedente: controlla le due letture.',
  CHAIN_BROKEN: 'Hai segnalato un rifornimento saltato: il consumo riparte dal prossimo pieno.',
};

/** Stesso ordine della query SQL: data, istante di creazione, id. */
export function sortConsumptionLogs<T extends { on: LocalDate; createdAt?: string; id: string }>(logs: readonly T[]): T[] {
  return [...logs].sort(
    (a, b) =>
      compareDates(a.on, b.on) ||
      ((a.createdAt ?? '') < (b.createdAt ?? '') ? -1 : (a.createdAt ?? '') > (b.createdAt ?? '') ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * Consumi pieno-a-pieno di UN solo serbatoio (passare solo i rifornimenti dello stesso serbatoio).
 * Restituisce una voce per ogni pieno, nell'ordine: calcolata o saltata con la ragione. I rifornimenti parziali
 * non producono voci: la loro quantita' entra nel pieno successivo.
 *
 * Vettore V11: A pieno 10.000 km 40 L; B parziale 10.300 km 15 L; C pieno 10.700 km 30 L (-> 6,43 su 700 km, 45 L);
 * D pieno 11.300 km 36 L (-> 6,00); E pieno 11.900 km 33 L con `missedBefore` (nessun valore); F pieno 12.500 km 38,4 L (-> 6,40).
 */
export function fullToFull(logs: readonly ConsumptionLog[]): ConsumptionEntry[] {
  const out: ConsumptionEntry[] = [];
  let anchorKm: number | null = null;
  let fuelSince = 0;
  let costSince: number | null = 0; // null = almeno un rifornimento del tratto senza totale
  const addCost = (c: number | undefined) => {
    costSince = costSince === null || c === undefined ? null : costSince + c;
  };
  for (const f of sortConsumptionLogs(logs)) {
    let broken = false;
    if (f.missedBefore) {
      broken = anchorKm !== null;
      anchorKm = null;
      fuelSince = 0;
      costSince = 0;
    }
    if (!f.isFull) {
      fuelSince += f.quantityMilli;
      addCost(f.totalCents);
      continue;
    }
    if (f.km == null) {
      anchorKm = null;
      fuelSince = 0;
      costSince = 0;
      out.push({ computed: false, id: f.id, on: f.on, reason: 'NO_KM' });
      continue;
    }
    if (anchorKm !== null && f.km > anchorKm) {
      const distanceKm = f.km - anchorKm;
      const quantityMilli = fuelSince + f.quantityMilli;
      addCost(f.totalCents);
      out.push({
        computed: true,
        id: f.id,
        on: f.on,
        distanceKm,
        quantityMilli,
        // centesimi per 100 km = (quantityMilli / 1000) / distanceKm * 100 * 100 = quantityMilli * 10 / distanceKm
        per100Centi: Math.round((quantityMilli * 10) / distanceKm),
        costCents: costSince,
      });
    } else {
      out.push({
        computed: false,
        id: f.id,
        on: f.on,
        reason: anchorKm !== null ? 'KM_NOT_INCREASING' : broken ? 'CHAIN_BROKEN' : 'FIRST_FULL',
      });
    }
    anchorKm = f.km;
    fuelSince = 0;
    costSince = 0;
  }
  return out;
}

/** Solo le voci calcolate. */
export const computedPoints = (entries: readonly ConsumptionEntry[]): ConsumptionPoint[] =>
  entries.filter((e): e is ConsumptionPoint => e.computed);

export interface ConsumptionSummary {
  /** Quanti pieni hanno un consumo calcolato. */
  count: number;
  totalDistanceKm: number;
  totalQuantityMilli: number;
  /** Media sui km totali (totale carburante / totale km), non la media dei rapporti. */
  avgPer100Centi: number | null;
  lastPer100Centi: number | null;
  /** Il consumo migliore (piu' basso) e il peggiore (piu' alto). */
  bestPer100Centi: number | null;
  worstPer100Centi: number | null;
  /** Spesa totale dei tratti calcolati e costo per 100 km, se tutti i rifornimenti avevano il totale. */
  totalCostCents: number | null;
  costPer100KmCents: number | null;
}

export function summarizeConsumption(points: readonly ConsumptionPoint[]): ConsumptionSummary {
  let totalDistanceKm = 0;
  let totalQuantityMilli = 0;
  let totalCost: number | null = 0;
  let best: number | null = null;
  let worst: number | null = null;
  for (const p of points) {
    totalDistanceKm += p.distanceKm;
    totalQuantityMilli += p.quantityMilli;
    totalCost = totalCost === null || p.costCents === null ? null : totalCost + p.costCents;
    if (best === null || p.per100Centi < best) best = p.per100Centi;
    if (worst === null || p.per100Centi > worst) worst = p.per100Centi;
  }
  const n = points.length;
  return {
    count: n,
    totalDistanceKm,
    totalQuantityMilli,
    avgPer100Centi: n > 0 ? Math.round((totalQuantityMilli * 10) / totalDistanceKm) : null,
    lastPer100Centi: n > 0 ? points[n - 1]!.per100Centi : null,
    bestPer100Centi: best,
    worstPer100Centi: worst,
    totalCostCents: n > 0 ? totalCost : null,
    costPer100KmCents: n > 0 && totalCost !== null ? per100KmCents(totalCost, totalDistanceKm) : null,
  };
}

export interface FuelConsumptionLog extends ConsumptionLog {
  fuelType: FuelType;
}

export interface TankConsumption {
  tank: TankKey;
  unit: QuantityUnit;
  /** Quanti rifornimenti di questo serbatoio sono stati forniti. */
  logs: number;
  entries: ConsumptionEntry[];
  points: ConsumptionPoint[];
  summary: ConsumptionSummary;
}

export interface ConsumptionReport {
  /** Un elemento per serbatoio con almeno un rifornimento (AdBlue escluso), in ordine fisso. */
  tanks: TankConsumption[];
  /** Piu' di un serbatoio con rifornimenti (benzina + GPL/metano, ibrido plug-in). */
  bifuel: boolean;
  /** Avvertenza onesta da mostrare con piu' serbatoi; `null` con uno solo. */
  caveat: string | null;
  /**
   * Costo del carburante per 100 km, somma dei costi per 100 km dei singoli serbatoi: l'unico valore davvero
   * confrontabile con due carburanti. `null` se nessun serbatoio ha dati; indicativo se `combinedComplete` e' false.
   */
  combinedCostPer100KmCents: number | null;
  /** `false` se qualche serbatoio con rifornimenti non ha ancora un consumo calcolato (il costo combinato e' parziale). */
  combinedComplete: boolean;
}

export const BIFUEL_CAVEAT_IT =
  'Con due carburanti il consumo di ciascuno è calcolato su tutti i km percorsi tra due pieni, anche quelli fatti con ' +
  "l'altro carburante: i valori singoli sono indicativi. Il costo per 100 km complessivo è più affidabile.";

/**
 * Consumi per serbatoio: ogni carburante ha la sua catena pieno-a-pieno (gasolio e HVO insieme).
 * Con un'auto bifuel i consumi si calcolano PER carburante (SPEC §6.3.8) e il report lo dichiara apertamente.
 */
export function consumptionByTank(logs: readonly FuelConsumptionLog[]): ConsumptionReport {
  const tanks: TankConsumption[] = [];
  for (const tank of TANK_ORDER) {
    const own = logs.filter((l) => tankOf(l.fuelType) === tank);
    if (own.length === 0) continue;
    const entries = fullToFull(own);
    const points = computedPoints(entries);
    tanks.push({
      tank,
      unit: unitForFuel(own[0]!.fuelType),
      logs: own.length,
      entries,
      points,
      summary: summarizeConsumption(points),
    });
  }
  const withCost = tanks.filter((t) => t.summary.costPer100KmCents !== null);
  const bifuel = tanks.length > 1;
  return {
    tanks,
    bifuel,
    caveat: bifuel ? BIFUEL_CAVEAT_IT : null,
    combinedCostPer100KmCents: withCost.length > 0 ? withCost.reduce((s, t) => s + t.summary.costPer100KmCents!, 0) : null,
    combinedComplete: tanks.length > 0 && withCost.length === tanks.length,
  };
}

/** Prezzo medio ponderato per unita' (millesimi di euro): totale / quantita'. Solo per rifornimenti nella stessa unita'. */
export function averageUnitPriceMilli(logs: readonly { quantityMilli: number; totalCents: number }[]): number | null {
  let q = 0;
  let t = 0;
  for (const l of logs) {
    q += l.quantityMilli;
    t += l.totalCents;
  }
  return q > 0 ? Math.round((t * 10000) / q) : null;
}
