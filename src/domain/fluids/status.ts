// Stato di un controllo livelli (F-44, S-24): ultima verifica, esito, ricontrollo dovuto. Funzioni pure:
// "oggi" e i km attuali sono parametri, mai letti dall'orologio. Lo stato si calcola, non si salva.
import { compareDates, diffDays } from '@/domain/dates';
import type { LocalDate } from '@/domain/ports';
import { formatPressure, formatScaled, plural, type PressureUnit } from '@/domain/units';
import { FLUID_INFO, applicableFluids, levelLabelIt, levelSuggestionIt } from './info';
import type { Fluid, FluidCheck, FluidVehicle } from './types';

export type FluidStatusKind =
  | 'never' // mai controllato
  | 'attention' // l'ultimo esito era basso o alto
  | 'overdue' // da ricontrollare (giorni o km)
  | 'ok';

export interface FluidStatus {
  fluid: Fluid;
  kind: FluidStatusKind;
  last: FluidCheck | null;
  daysSince: number | null;
  kmSince: number | null;
  recheckDue: boolean;
  /** "OK", "Rabboccato", "Basso", "Alto", "Da ricontrollare", "Mai controllato": sempre testo, mai solo un colore. */
  labelIt: string;
  /** "Ultima verifica: 12 giorni fa" / "Mai controllato". */
  detailIt: string;
  /** Suggerimento onesto se l'ultimo esito era basso o alto. */
  suggestionIt: string | null;
}

/** "oggi", "ieri", "5 giorni fa", "3 settimane fa", "4 mesi fa", "2 anni fa". */
export function agoIt(days: number): string {
  const d = Math.max(0, Math.trunc(days));
  if (d === 0) return 'oggi';
  if (d === 1) return 'ieri';
  if (d < 14) return `${d} giorni fa`;
  if (d < 60) return `${Math.floor(d / 7)} settimane fa`;
  if (d < 730) return `${Math.floor(d / 30)} mesi fa`;
  return `${Math.floor(d / 365)} anni fa`;
}

/** L'ultimo controllo di un fluido: data piu' recente, a parita' l'id piu' grande (ULID = ordine di creazione). */
export function lastCheckFor(checks: readonly FluidCheck[], fluid: Fluid): FluidCheck | null {
  let best: FluidCheck | null = null;
  for (const c of checks) {
    if (c.fluid !== fluid) continue;
    if (best === null || compareDates(c.checkedOn, best.checkedOn) > 0 || (c.checkedOn === best.checkedOn && c.id > best.id)) {
      best = c;
    }
  }
  return best;
}

export interface FluidStatusOptions {
  /** Km attuali del veicolo, per l'intervallo a km (olio). */
  currentKm?: number | null;
  /** Unita' per mostrare la pressione misurata. Default bar. */
  pressureUnit?: PressureUnit;
}

export function evaluateFluidStatus(
  fluid: Fluid,
  checks: readonly FluidCheck[],
  today: LocalDate,
  opts: FluidStatusOptions = {},
): FluidStatus {
  const last = lastCheckFor(checks, fluid);
  if (last === null) {
    return {
      fluid,
      kind: 'never',
      last: null,
      daysSince: null,
      kmSince: null,
      recheckDue: false,
      labelIt: 'Mai controllato',
      detailIt: 'Mai controllato',
      suggestionIt: null,
    };
  }
  const info = FLUID_INFO[fluid];
  const daysSince = Math.max(0, diffDays(last.checkedOn, today));
  const kmSince = opts.currentKm != null && last.km != null ? Math.max(0, opts.currentKm - last.km) : null;
  const recheckDue =
    (info.recheckDays !== null && daysSince >= info.recheckDays) ||
    (info.recheckKm !== null && kmSince !== null && kmSince >= info.recheckKm);
  const needsAttention = last.level === 'low' || last.level === 'high';
  const kind: FluidStatusKind = needsAttention ? 'attention' : recheckDue ? 'overdue' : 'ok';

  let detail = `Ultima verifica: ${agoIt(daysSince)}`;
  if (fluid === 'tyre_pressure' && last.valueMillibar != null) {
    detail += ` · ${formatPressure(last.valueMillibar, opts.pressureUnit ?? 'bar')}`;
  } else if (last.level === 'topped_up' && last.addedMl != null) {
    detail += ` · ${formatAddedAmount(last.addedMl)} aggiunti`;
  }
  return {
    fluid,
    kind,
    last,
    daysSince,
    kmSince,
    recheckDue,
    labelIt: kind === 'overdue' ? 'Da ricontrollare' : levelLabelIt(fluid, last.level),
    detailIt: detail,
    suggestionIt: needsAttention ? levelSuggestionIt(fluid, last.level) : null,
  };
}

/** L'elenco S-24: un elemento per ogni fluido applicabile al veicolo, nell'ordine standard. */
export function fluidStatusList(
  checks: readonly FluidCheck[],
  today: LocalDate,
  vehicle: FluidVehicle,
  opts: FluidStatusOptions = {},
): FluidStatus[] {
  return applicableFluids(vehicle).map((f) => evaluateFluidStatus(f, checks, today, opts));
}

/** Quantita' aggiunta in testo: 250 ml -> "250 ml"; 1500 ml -> "1,5 L"; 2000 ml -> "2 L". */
export function formatAddedAmount(ml: number): string {
  if (!Number.isFinite(ml)) return '–';
  if (ml < 1000) return `${Math.round(ml)} ml`;
  const s = formatScaled(Math.round(ml), 3, { grouping: false }).replace(/,?0+$/, '');
  return `${s} L`;
}

export interface ToppedUpSummary {
  /** Quanti rabbocchi nel periodo. */
  count: number;
  /** Totale aggiunto in ml (solo i rabbocchi con la quantita' indicata). */
  totalMl: number;
  /** Rabbocchi senza quantita': contano nella frequenza ma non nel totale. */
  withoutAmount: number;
}

/**
 * Rabbocchi di un fluido in un periodo (estremi inclusi): per l'olio e' l'indizio di consumo anomalo (base di F-45, V1).
 * Conta solo i controlli con esito «rabboccato».
 */
export function toppedUpSummary(
  checks: readonly FluidCheck[],
  fluid: Fluid,
  from: LocalDate,
  to: LocalDate,
): ToppedUpSummary {
  let count = 0;
  let totalMl = 0;
  let withoutAmount = 0;
  for (const c of checks) {
    if (c.fluid !== fluid || c.level !== 'topped_up') continue;
    if (compareDates(c.checkedOn, from) < 0 || compareDates(c.checkedOn, to) > 0) continue;
    count += 1;
    if (c.addedMl != null) totalMl += c.addedMl;
    else withoutAmount += 1;
  }
  return { count, totalMl, withoutAmount };
}

/** "3 rabbocchi, 1,2 L" per la scheda dell'olio. */
export function describeToppedUp(s: ToppedUpSummary): string {
  if (s.count === 0) return 'Nessun rabbocco nel periodo';
  const amount = s.totalMl > 0 ? `, ${formatAddedAmount(s.totalMl)} in tutto` : '';
  return `${plural(s.count, 'rabbocco', 'rabbocchi')}${amount}`;
}
