// Costi (F-42): semantica della vista `v_costs` (data.md §1.3, §1.6, SPEC §8.2).
// Quattro fonti, ognuna in una SUA tabella, unite senza duplicati: un tagliando da 210 EUR vive solo in
// `service_records`, un pieno solo in `fuel_logs`, una spesa solo in `expenses`, una rata pagata solo in
// `insurance_payments` (con `paid_on` valorizzato). Qui il dominio lavora sulle righe gia' lette dalla vista.
import type { LocalDate } from '@/domain/ports';

export const COST_SOURCES = ['service', 'fuel', 'expense', 'insurance'] as const;
export type CostSource = (typeof COST_SOURCES)[number];

/** Una riga di `v_costs`: `on_date`, `source`, `source_id`, `cents` (+ la categoria per le spese). */
export interface CostEntry {
  vehicleId?: string;
  onDate: LocalDate;
  source: CostSource;
  sourceId: string;
  /** Centesimi interi, lordi (nessun calcolo fiscale in v1). */
  cents: number;
  /** Solo per `source = 'expense'`: `expenses.category_id` (es. 'sys_toll', un ULID per le personalizzate). */
  categoryId?: string | null;
}

export const COST_SOURCE_LABELS_IT: Record<CostSource, string> = {
  service: 'Interventi',
  fuel: 'Carburante',
  expense: 'Spese',
  insurance: 'Assicurazione',
};

export const costSourceLabelIt = (source: CostSource): string => COST_SOURCE_LABELS_IT[source];
