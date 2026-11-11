// Tipi pubblici dei rifornimenti (F-39, F-40; SPEC 6.3.8 S-22): registro, consumi, riepilogo e valori predefiniti del modulo.
import type { LocalDate } from '@/domain/ports';
import type {
  ConsumptionSkipReason,
  FuelAmountField,
  FuelType,
  QuantityUnit,
  TankKey,
} from '@/domain/fuel';
import type { OdometerSource } from '@/domain/odometer';

/** Consumo di un pieno, gia' pronto per la UI (SPEC S-22 punto 5: «6,1 L/100 km»). */
export interface FuelConsumptionComputed {
  computed: true;
  tank: TankKey;
  unit: QuantityUnit;
  /** Centesimi di unita' per 100 km: 643 = 6,43 L/100 km. */
  per100Centi: number;
  /** «6,43 L/100 km». */
  text: string;
  /** Km dal pieno precedente dello stesso serbatoio. */
  distanceKm: number;
  /** Carburante consumato nel tratto (pieno + parziali intermedi), in millesimi. */
  quantityMilli: number;
  /** Spesa del tratto in centesimi. */
  costCents: number | null;
}

/** Un pieno per cui il consumo non e' calcolabile, con la ragione in italiano. */
export interface FuelConsumptionSkipped {
  computed: false;
  reason: ConsumptionSkipReason;
  text: string;
}

export type FuelConsumptionView = FuelConsumptionComputed | FuelConsumptionSkipped;

/** Una riga del registro rifornimenti. */
export interface FuelLogEntry {
  id: string;
  vehicleId: string;
  filledOn: LocalDate;
  fuelType: FuelType;
  fuelLabel: string;
  /** Es. «100 ottani». */
  grade: string | null;
  /** Il serbatoio riempito (`null` per l'AdBlue, che non ha consumi). */
  tank: TankKey | null;
  /** Millesimi di L, kg o kWh. */
  quantityMilli: number;
  quantityUnit: QuantityUnit;
  /** Millesimi di euro per unita'. */
  unitPriceMilli: number | null;
  totalCents: number;
  isFull: boolean;
  /** «Ho saltato un rifornimento» prima di questo. */
  missedBefore: boolean;
  station: string | null;
  notes: string | null;
  /** Km della lettura collegata (null se il rifornimento non ha km). */
  km: number | null;
  /** Id della lettura nel registro km (`source = 'fuel'`). */
  odometerReadingId: string | null;
  /** `true` se la lettura collegata e' stata messa da parte dal registro km (non conta per i consumi). */
  kmIgnored: boolean;
  /**
   * Consumo del tratto chiuso da questo pieno; `null` per i rifornimenti parziali e per l'AdBlue.
   * Nei risultati degli elenchi e di `getFuelLog` e' calcolato sulla catena di TUTTI i rifornimenti del veicolo.
   */
  consumption: FuelConsumptionView | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------- scritture

export type OdometerConflictChoice = 'fail' | 'skip_km';

/**
 * Dati di un nuovo rifornimento. Servono due qualsiasi tra quantita', prezzo unitario e totale: il terzo si calcola
 * (aritmetica intera); con tutti e tre i valori restano quelli immessi (e un totale che non torna da' solo un avviso).
 */
export interface AddFuelLogInput {
  vehicleId: string;
  /** Default: oggi. */
  filledOn?: LocalDate;
  /** Default: l'ultimo carburante usato se ancora valido per l'auto, altrimenti il primario. */
  fuelType?: FuelType;
  /** Facoltativa: deve coincidere con l'unita' del carburante (L, kg, kWh). */
  quantityUnit?: QuantityUnit;
  /** Es. «100 ottani» (max 40 caratteri). */
  grade?: string | null;
  /** Millesimi di unita': 40,000 L = 40000. */
  quantityMilli?: number | null;
  /** Millesimi di euro per unita': 1,859 EUR/L = 1859. */
  unitPriceMilli?: number | null;
  /** Centesimi: 74,36 EUR = 7436. */
  totalCents?: number | null;
  /** Default true (pieno). */
  isFull?: boolean;
  /** «Ho saltato un rifornimento»: spezza la catena dei consumi. Default false. */
  missedBefore?: boolean;
  station?: string | null;
  notes?: string | null;
  /** Km del contachilometri: crea la lettura collegata con la stessa regola di coerenza di `addOdometerReading`. */
  km?: number | null;
  /**
   * Cosa fare se i km sono incoerenti con le letture vicine: `fail` (default: errore `ODO_NON_MONOTONIC`, la UI propone le
   * tre scelte di SPEC 6.3.6 punto 5) oppure `skip_km` («Salva senza aggiornare i km»: il rifornimento si salva senza km).
   */
  onOdometerConflict?: OdometerConflictChoice;
  /** «È un errore della lettura precedente»: le letture in conflitto vengono messe da parte (`ignored`) nella stessa transazione. */
  resolveConflicts?: 'ignore-conflicting';
}

/** Modifica parziale: i campi non indicati restano invariati. */
export interface UpdateFuelLogInput {
  filledOn?: LocalDate;
  fuelType?: FuelType;
  quantityUnit?: QuantityUnit;
  grade?: string | null;
  /**
   * Quantita', prezzo e totale: i campi indicati valgono come immessi dall'utente, quello NON indicato si ricalcola
   * (cambiando la quantita' o il prezzo si ricalcola il totale; cambiando il totale si ricalcola il prezzo).
   * `unitPriceMilli: null` = «ricalcola il prezzo dal totale».
   */
  quantityMilli?: number;
  unitPriceMilli?: number | null;
  totalCents?: number;
  isFull?: boolean;
  missedBefore?: boolean;
  station?: string | null;
  notes?: string | null;
  /** Nuovi km; `null` toglie i km (la lettura collegata va nel cestino); omesso = invariati. */
  km?: number | null;
  onOdometerConflict?: OdometerConflictChoice;
  resolveConflicts?: 'ignore-conflicting';
}

export interface FuelWriteResult {
  fuelLog: FuelLogEntry;
  /** Consumo del tratto chiuso da questo pieno (lo stesso di `fuelLog.consumption`); `null` per parziali e AdBlue. */
  consumption: FuelConsumptionView | null;
  /** Avvisi non bloccanti (totale che non torna, prezzo insolito, km con salto implausibile...), in italiano. */
  warnings: string[];
  /** Il campo calcolato dai due forniti, se ce n'era uno. */
  computed: FuelAmountField | null;
  /** Quantita' x prezzo, se il prezzo e' noto: per mostrare «dovrebbe essere 74,36 €». */
  expectedTotalCents: number | null;
  /** La lettura km creata/aggiornata (null se il rifornimento non ha km). */
  odometerReadingId: string | null;
  /** I km erano in conflitto e sono stati lasciati fuori (`onOdometerConflict: 'skip_km'`). */
  kmIgnored: boolean;
  /** Letture messe da parte con `resolveConflicts` (vuoto altrimenti). */
  ignoredReadingIds: string[];
}

export type AddFuelLogResult = FuelWriteResult;
export type UpdateFuelLogResult = FuelWriteResult;

export interface DeleteFuelLogResult {
  id: string;
  vehicleId: string;
}

export interface RestoreFuelLogResult {
  fuelLog: FuelLogEntry;
  /** `false` se i km non sono piu' coerenti con le letture registrate nel frattempo: il rifornimento torna ma senza km. */
  kmRestored: boolean;
  warnings: string[];
}

// ---------------------------------------------------------------- letture

export interface ListFuelLogsOptions {
  /** Solo questo carburante. */
  fuelType?: FuelType;
  /** Default: dal piu' recente. */
  order?: 'desc' | 'asc';
  limit?: number;
  offset?: number;
}

/** Un punto della serie dei consumi (grafico + tabella alternativa). */
export interface FuelConsumptionPoint {
  id: string;
  on: LocalDate;
  per100Centi: number;
  text: string;
  distanceKm: number;
}

/** Un punto della serie dei prezzi unitari. */
export interface FuelPricePoint {
  id: string;
  on: LocalDate;
  unitPriceMilli: number;
}

/** Spesa e quantita' di un carburante nel periodo. */
export interface FuelTypeTotals {
  fuelType: FuelType;
  fuelLabel: string;
  unit: QuantityUnit;
  logCount: number;
  quantityMilli: number;
  totalCents: number;
  /** Prezzo medio ponderato (totale / quantita'), millesimi di euro per unita'. */
  avgUnitPriceMilli: number | null;
  /** Prezzi unitari nel tempo (solo i rifornimenti con prezzo), in ordine di data. */
  prices: FuelPricePoint[];
}

/** Consumi di UN serbatoio nel periodo (con un'auto bifuel ce n'e' uno per carburante). */
export interface FuelTankSummary {
  tank: TankKey;
  label: string;
  unit: QuantityUnit;
  /** Rifornimenti di questo serbatoio nel periodo. */
  logCount: number;
  /** Quanti pieni del periodo hanno un consumo calcolato. */
  count: number;
  totalDistanceKm: number;
  totalQuantityMilli: number;
  avgPer100Centi: number | null;
  lastPer100Centi: number | null;
  bestPer100Centi: number | null;
  worstPer100Centi: number | null;
  /** Gli stessi valori gia' formattati («6,43 L/100 km»). */
  avgText: string | null;
  lastText: string | null;
  bestText: string | null;
  worstText: string | null;
  /** Spesa dei tratti calcolati e costo per 100 km (centesimi). */
  totalCostCents: number | null;
  costPer100KmCents: number | null;
  /** Serie per il grafico, in ordine di data. */
  series: FuelConsumptionPoint[];
}

export interface FuelSummary {
  vehicleId: string;
  period: { from: LocalDate | null; to: LocalDate | null };
  /** Rifornimenti nel periodo (AdBlue incluso). */
  logCount: number;
  /** Spesa totale in carburante nel periodo, in centesimi. */
  totalCostCents: number;
  byFuel: FuelTypeTotals[];
  tanks: FuelTankSummary[];
  /** Piu' di un serbatoio con rifornimenti (benzina + GPL/metano, ibrido plug-in): i consumi sono per carburante. */
  bifuel: boolean;
  /** Avvertenza onesta da mostrare con piu' serbatoi; `null` con uno solo. */
  caveat: string | null;
  /** Somma dei costi per 100 km dei serbatoi: il solo valore confrontabile con due carburanti. */
  combinedCostPer100KmCents: number | null;
  /** `false` se qualche serbatoio non ha ancora un consumo calcolato (il costo combinato e' parziale). */
  combinedComplete: boolean;
}

/** Km suggeriti per il campo «km» del modulo (sempre modificabili). */
export interface SuggestedKm {
  km: number;
  /** `true` = stima (ultima lettura + media giornaliera): mostrare l'etichetta «stimato». */
  estimated: boolean;
  /** 'today' = letta oggi; 'projected' = stimata; 'last' = ultima lettura nota (di un giorno precedente, nessuna stima possibile). */
  basis: 'today' | 'projected' | 'last';
  /** Provenienza della lettura di partenza: «da OBD», «da rifornimento»... */
  sourceLabel: string;
  source: OdometerSource;
  /** Data della lettura di partenza. */
  asOf: LocalDate;
  /** Testo pronto: «stimato», «ultima lettura» o la provenienza. */
  label: string;
}

/** Valori predefiniti del modulo «Rifornimento» (S-22: in meno di 10 secondi). */
export interface FuelFormDefaults {
  vehicleId: string;
  today: LocalDate;
  /** I carburanti tra cui scegliere (primario, secondario; per i diesel anche HVO e AdBlue). */
  fuelTypes: FuelType[];
  /** Il carburante preselezionato: l'ultimo usato se ancora valido, altrimenti il primario. */
  fuelType: FuelType;
  quantityUnit: QuantityUnit;
  /** Ultimo prezzo unitario noto per OGNI carburante dell'auto (millesimi di euro per unita'). */
  lastUnitPriceMilli: Partial<Record<FuelType, number>>;
  /** Ultima gradazione/ottani per carburante. */
  lastGrade: Partial<Record<FuelType, string>>;
  /** L'ultima stazione usata e le ultime (distinte) per l'autocompletamento. */
  lastStation: string | null;
  recentStations: string[];
  /** Km suggeriti; null se l'auto non ha ancora letture. */
  suggestedKm: SuggestedKm | null;
  /** Pieno e' l'impostazione di partenza. */
  isFull: true;
  /** Capacita' del serbatoio (millesimi di litro) se nota: serve all'avviso «piu' della capacita'». */
  tankCapacityMl: number | null;
}
