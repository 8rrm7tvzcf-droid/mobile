// Valutazione di una regola di manutenzione e dei promemoria con soglie (data.md 3.3, SPEC 8.3). Dominio puro:
// funzione di (regola, ultimo fatto, letture km, oggi) e di nient'altro (invariante I4).
import { addDays, addMonths, diffDays, endOfMonth } from '@/domain/dates';
import type { LocalDate } from '@/domain/dates';
import { dailyMax, kmAt, latestPoint } from './odometer';
import { estimateKmPerDay } from './rate';
import type {
  DueTrigger,
  Evaluation,
  LastDone,
  MaintenanceRule,
  OdometerPoint,
  RateParams,
  ReasonCode,
  ReminderState,
  VehicleRateProfile,
} from './types';

export const DEFAULT_SOON_DAYS = 30;
export const DEFAULT_SOON_KM = 1500;
/** Oltre questo orizzonte la previsione dei km non ha senso (FORECAST_BEYOND_10Y). */
export const MAX_FORECAST_DAYS = 3650;

function minDateNullable(a: LocalDate | null, b: LocalDate | null): LocalDate | null {
  if (a == null) return b;
  if (b == null) return a;
  return a <= b ? a : b;
}

export interface ThresholdsInput {
  today: LocalDate;
  /** Scadenza a tempo (data di calendario) oppure null. */
  dueOn: LocalDate | null;
  /** Scadenza a km oppure null. */
  dueKm: number | null;
  soonDays?: number;
  soonKm?: number;
  odometer?: readonly OdometerPoint[];
  vehicle?: VehicleRateProfile;
  rateParams?: Partial<RateParams>;
  /** Motivi gia' raccolti (es. dalla valutazione della regola): vengono riportati nel risultato. */
  reasons?: readonly ReasonCode[];
}

/**
 * Parte comune a regole e promemoria manuali: dati (dueOn, dueKm) calcola previsione, "il primo dei due" e stato.
 *
 * Se i km sono gia' raggiunti, `forecastOn` e' la data della lettura e `kmReached` e' vero. Altrimenti la data
 * prevista parte dall'ultima lettura e avanza con la media km/giorno (quindi un promemoria "per km" diventa comunque
 * scaduto, stimato, anche se nessuno aggiorna il contachilometri).
 */
export function evaluateThresholds(input: ThresholdsInput): Evaluation {
  const {
    today,
    dueOn,
    dueKm,
    soonDays = DEFAULT_SOON_DAYS,
    soonKm = DEFAULT_SOON_KM,
    odometer = [],
    vehicle = {},
    rateParams,
  } = input;
  const reasons: ReasonCode[] = [...(input.reasons ?? [])];
  const pts = dailyMax(odometer, today);
  const cur = latestPoint(pts);

  let forecastOn: LocalDate | null = null;
  let kmReached = false;
  let rate: ReturnType<typeof estimateKmPerDay> | null = null;
  if (dueKm != null) {
    if (!cur) {
      reasons.push('NO_ODOMETER');
    } else if (cur.km >= dueKm) {
      forecastOn = cur.on;
      kmReached = true;
    } else {
      rate = estimateKmPerDay(odometer, today, vehicle, rateParams);
      if (rate.confidence === 'none') {
        reasons.push('RATE_TOO_LOW');
      } else {
        // epsilon: 6440 / 40.000000000000007 non deve diventare 162 giorni (vettore V3)
        const days = Math.ceil((dueKm - cur.km) / rate.kmPerDay - 1e-9);
        if (days <= MAX_FORECAST_DAYS) forecastOn = addDays(cur.on, days);
        else reasons.push('FORECAST_BEYOND_10Y');
      }
    }
  }

  // il primo dei due
  const effectiveDueOn = minDateNullable(dueOn, forecastOn);
  const trigger: DueTrigger | null =
    effectiveDueOn == null ? null : dueOn === forecastOn ? 'both' : effectiveDueOn === dueOn ? 'time' : 'km';
  const estimated = trigger === 'km' && !kmReached;

  // stato (3.5): mai salvato, dipende da `today`
  const daysLeft = effectiveDueOn != null ? diffDays(today, effectiveDueOn) : null;
  const kmLeft = dueKm != null && cur ? dueKm - cur.km : null;
  let state: ReminderState;
  if (effectiveDueOn == null || daysLeft == null) state = 'unknown';
  else if (kmReached || daysLeft < 0) state = 'overdue';
  else if (daysLeft <= soonDays || (kmLeft != null && soonKm > 0 && kmLeft <= soonKm)) state = 'soon';
  else state = 'ok';

  return {
    state,
    dueOn,
    dueKm,
    forecastOn,
    effectiveDueOn,
    trigger,
    estimated,
    kmReached,
    daysLeft,
    kmLeft,
    currentKm: cur ? cur.km : null,
    dueToday: daysLeft === 0,
    forecastConfidence: rate ? rate.confidence : dueKm != null ? 'none' : null,
    rate: rate ? Math.round(rate.kmPerDay * 100) / 100 : null,
    reasons: [...new Set(reasons)],
  };
}

export interface RuleInput {
  today: LocalDate;
  rule: MaintenanceRule;
  /** Ultimo completamento oppure baseline della voce; null se non c'e'. */
  lastDone: LastDone | null;
  odometer?: readonly OdometerPoint[];
  vehicle?: VehicleRateProfile;
  rateParams?: Partial<RateParams>;
}

/**
 * Valutazione di una regola.
 *
 * - `interval_last_done`: scade al primo fra (ultimo fatto + mesi, con fine mese opzionale) e (km dell'ultimo fatto + intervallo);
 *   se l'ultimo fatto non ha i km si interpolano dalle letture (mai estrapolando);
 * - `interval_calendar` e `fixed_date`: scadono a `fixedDueOn` (la serie avanza al completamento, vedi `nextFixedDue`).
 *
 * Gli ingredienti che mancano non vengono inventati: finiscono in `reasons` e, se non resta nulla, lo stato e' `unknown`.
 */
export function evaluateRule(input: RuleInput): Evaluation {
  const { today, rule, lastDone, odometer = [], vehicle, rateParams } = input;
  const reasons: ReasonCode[] = [];
  const pts = dailyMax(odometer, today);

  // 1) scadenza per tempo
  let dueOn: LocalDate | null = null;
  if (rule.scheduleType === 'interval_last_done') {
    if (lastDone?.on && rule.intervalMonths) dueOn = addMonths(lastDone.on, rule.intervalMonths);
    else if (!lastDone) reasons.push('NO_LAST_DONE');
  } else if (rule.fixedDueOn) {
    dueOn = rule.fixedDueOn;
  } else {
    reasons.push('NO_FIXED_DATE');
  }
  if (dueOn && rule.periodEnd === 'end_of_month') dueOn = endOfMonth(dueOn);

  // 2) scadenza per km (solo regole "dall'ultimo fatto")
  let dueKm: number | null = null;
  if (rule.scheduleType === 'interval_last_done' && rule.intervalKm) {
    const baseKm = lastDone?.km ?? (lastDone?.on ? kmAt(lastDone.on, pts) : null);
    if (baseKm != null) dueKm = baseKm + rule.intervalKm;
    else reasons.push(lastDone ? 'NO_LAST_KM' : 'NO_LAST_DONE');
  }

  return evaluateThresholds({
    today,
    dueOn,
    dueKm,
    soonDays: rule.soonDays,
    soonKm: rule.soonKm,
    odometer,
    vehicle,
    rateParams,
    reasons,
  });
}
