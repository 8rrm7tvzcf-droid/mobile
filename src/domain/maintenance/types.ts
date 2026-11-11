// Tipi del motore delle scadenze (SPEC 8.3, data.md 3). Dominio puro: nessun import di pacchetti.
import type { LocalDate } from '@/domain/dates';

export type ScheduleType = 'interval_last_done' | 'interval_calendar' | 'fixed_date';
export type PeriodEnd = 'exact' | 'end_of_month';
/** Categoria di una voce di manutenzione (`maintenance_items.category`). */
export type ItemCategory = 'legal' | 'maintenance' | 'check' | 'tyres' | 'other';

/** Chi ha "vinto" fra tempo e chilometri. `both` = la previsione km cade esattamente nel giorno della scadenza a tempo. */
export type DueTrigger = 'time' | 'km' | 'both';
export type RateConfidence = 'none' | 'low' | 'medium' | 'high';
/** Lo stato non si salva mai: si calcola da `oggi` e dai km (data.md 3.5). */
export type ReminderState = 'unknown' | 'ok' | 'soon' | 'overdue';

/** Motivi per cui un ingrediente manca (invariante I3: nessun dato inventato). */
export type ReasonCode =
  | 'NO_LAST_DONE'
  | 'NO_LAST_KM'
  | 'NO_FIXED_DATE'
  | 'NO_ODOMETER'
  | 'RATE_TOO_LOW'
  | 'FORECAST_BEYOND_10Y'
  /** Il ciclo corrente e' stato saltato dall'utente: nessuna scadenza finche' non si registra un "Fatto" o si modifica la regola. */
  | 'CYCLE_SKIPPED';

/** Lettura del contachilometri (anche piu' di una al giorno: conta la piu' alta). */
export interface OdometerPoint {
  on: LocalDate;
  km: number;
}

/** Dati del veicolo che servono alla stima dei km/giorno (i "prior"). */
export interface VehicleRateProfile {
  annualKmEstimate?: number | null;
  firstRegistrationOn?: LocalDate | null;
}

/** Regola di manutenzione: i campi di `maintenance_items` che il motore legge. */
export interface MaintenanceRule {
  scheduleType: ScheduleType;
  intervalKm?: number | null;
  intervalMonths?: number | null;
  periodEnd?: PeriodEnd | null;
  fixedDueOn?: LocalDate | null;
  /** Default 30. */
  soonDays?: number;
  /** Default 1500; 0 = nessuna soglia a km. */
  soonKm?: number;
}

/** Ultimo "fatto" di una regola: l'ultimo completamento oppure la base (baseline) della voce. */
export interface LastDone {
  on: LocalDate;
  km?: number | null;
}

export interface RateParams {
  windowDays: number;
  halfLifeDays: number;
  minSegDays: number;
  clampMultiple: number;
  fullTrustDays: number;
  maxKmPerDay: number;
  minKmPerDay: number;
  defaultAnnualKm: number;
}

export type RatePriorSource = 'user_estimate' | 'lifetime_average' | 'default';

export interface RateEstimate {
  kmPerDay: number;
  confidence: RateConfidence;
  /** `prior` = nessun dato misurato; `blended` = misura mescolata al prior; `measured` = solo misura. */
  source: 'measured' | 'blended' | 'prior';
  priorSource: RatePriorSource;
  spanDays: number;
  points: number;
  /** Giorni dall'ultima lettura (null se non ce ne sono). */
  staleDays: number | null;
}

export interface Evaluation {
  state: ReminderState;
  /** Scadenza a tempo (null se non applicabile o se manca un ingrediente). */
  dueOn: LocalDate | null;
  /** Scadenza a km (null come sopra). */
  dueKm: number | null;
  /** Data prevista in cui si raggiungeranno i km (o data della lettura se gia' raggiunti). */
  forecastOn: LocalDate | null;
  /** Il primo dei due: min(dueOn, forecastOn) ignorando i null. */
  effectiveDueOn: LocalDate | null;
  trigger: DueTrigger | null;
  /** Vero se vince la previsione e i km non sono ancora raggiunti: la UI scrive "circa" / "stima". */
  estimated: boolean;
  kmReached: boolean;
  /** Negativo = scaduto da N giorni; 0 = scade oggi (`dueToday`), non scaduto. */
  daysLeft: number | null;
  kmLeft: number | null;
  currentKm: number | null;
  dueToday: boolean;
  forecastConfidence: RateConfidence | null;
  /** Media km/giorno usata per la previsione, arrotondata a 2 decimali. */
  rate: number | null;
  reasons: ReasonCode[];
}
