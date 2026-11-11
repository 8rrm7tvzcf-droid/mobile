// Tipi pubblici dei costi (F-42; SPEC 6.3.8 S-60): totali per fonte, categoria, mese e anno, costo al km, serie mensile.
import type { CostPerKm, CostSource, PossibleDuplicate } from '@/domain/costs';
import type { LocalDate } from '@/domain/ports';

export interface CostsOptions {
  /**
   * Esclude le spese di queste categorie da totali e costo al km (es. `['sys_purchase']`: il prezzo d'acquisto
   * dell'auto non e' un costo di esercizio). Default: nessuna esclusione, come da SPEC.
   */
  excludeCategoryIds?: readonly string[];
}

/** Totale per fonte dei costi: interventi, carburante, spese, rate assicurative pagate. */
export interface CostSourceTotal {
  source: CostSource;
  label: string;
  cents: number;
  count: number;
  /** Quota sul totale in punti base (10000 = 100%). */
  shareBp: number;
}

/** Totale per categoria: interventi, carburante e assicurazione sono categorie a se', le spese hanno la loro. */
export interface CostCategoryTotal {
  /** `service` | `fuel` | `insurance` | `expense:<categoryId>`. */
  key: string;
  source: CostSource;
  /** Solo per le spese. */
  categoryId: string | null;
  label: string;
  icon: string | null;
  cents: number;
  count: number;
  shareBp: number;
}

export interface CostMonthTotal {
  /** 'YYYY-MM'. */
  month: string;
  /** «ottobre 2026». */
  label: string;
  cents: number;
  count: number;
  /** Il totale del mese ripartito per fonte (per le barre impilate). */
  bySource: Record<CostSource, number>;
}

export interface CostYearTotal {
  year: number;
  cents: number;
  count: number;
}

export interface CostSummary {
  vehicleId: string;
  period: { from: LocalDate | null; to: LocalDate | null };
  /** Totale del periodo SENZA doppioni, in centesimi. */
  totalCents: number;
  /** Quante voci di costo compongono il totale. */
  count: number;
  bySource: CostSourceTotal[];
  byCategory: CostCategoryTotal[];
  /** Solo i mesi con costi, in ordine cronologico (per la serie con i mesi vuoti: `getCostSeries`). */
  byMonth: CostMonthTotal[];
  /** Totale annuo, in ordine cronologico. */
  byYear: CostYearTotal[];
  /**
   * Costo al km: costi del periodo diviso i km tra la prima e l'ultima lettura del periodo. `NO_KM_DATA` con meno di due
   * letture nel periodo, `ZERO_DISTANCE` se i km non sono cambiati; `explanationIt` spiega sempre il calcolo.
   */
  costPerKm: CostPerKm;
  /** Stesso importo, stesso giorno, fonti diverse: indizi di un costo registrato due volte (non cambiano i totali). */
  possibleDuplicates: PossibleDuplicate[];
}

export interface CostSeriesPoint {
  month: string;
  label: string;
  cents: number;
  count: number;
  bySource: Record<CostSource, number>;
}

/** Serie mensile per il grafico (con i mesi senza costi a zero) e per l'alternativa tabellare. */
export interface CostSeries {
  vehicleId: string;
  /** Primo e ultimo mese ('YYYY-MM'), estremi inclusi. */
  fromMonth: string;
  toMonth: string;
  points: CostSeriesPoint[];
  totalCents: number;
  /** Il mese piu' alto (per la scala del grafico); 0 se non ci sono costi. */
  maxCents: number;
  /** Media mensile sul numero di mesi della serie, arrotondata al centesimo. */
  averagePerMonthCents: number;
}
