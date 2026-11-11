// Media km/giorno robusta anche con pochi dati (data.md 3.4, SPEC 8.3). Dominio puro.
import { addDays, diffDays, isValidDate } from '@/domain/dates';
import { dailyMax, latestPoint } from './odometer';
import type {
  OdometerPoint,
  RateConfidence,
  RateEstimate,
  RateParams,
  RatePriorSource,
  VehicleRateProfile,
} from './types';

/** Parametri di default: da tarare con dati reali (SPEC 8.3). */
export const RATE_DEFAULTS: RateParams = {
  windowDays: 180,
  halfLifeDays: 90,
  minSegDays: 7,
  clampMultiple: 3,
  fullTrustDays: 90,
  maxKmPerDay: 1500,
  minKmPerDay: 0.5,
  defaultAnnualKm: 12000,
};

interface WeightedValue {
  v: number;
  w: number;
}

function weightedMedian(items: readonly WeightedValue[]): number {
  const sorted = [...items].sort((a, b) => a.v - b.v);
  const total = sorted.reduce((x, i) => x + i.w, 0);
  let acc = 0;
  for (const i of sorted) {
    acc += i.w;
    if (acc >= total / 2) return i.v;
  }
  return (sorted[sorted.length - 1] as WeightedValue).v;
}

interface Segment {
  end: string;
  days: number;
  dKm: number;
}

/**
 * Stima i km al giorno.
 *
 * - una lettura per giorno (la piu' alta), solo fino a oggi; finestra mobile di `windowDays` piu' l'ultima lettura precedente;
 * - segmenti fra letture consecutive, quelli piu' corti di `minSegDays` si fondono col successivo;
 * - peso = durata x decadimento esponenziale (emivita `halfLifeDays`); con >= 3 segmenti nessuno supera `clampMultiple` x mediana pesata;
 * - con meno di `fullTrustDays` di dati la misura e' mescolata al prior (stima utente > media dall'immatricolazione > default);
 * - confidenza: high (>= 120 giorni e >= 4 punti), medium (>= 45 e >= 3), altrimenti low; -1 livello se l'ultima lettura ha > 60 giorni;
 *   `none` se la media e' sotto `minKmPerDay` (auto ferma: nessuna previsione).
 */
export function estimateKmPerDay(
  readings: readonly OdometerPoint[],
  today: string,
  vehicle: VehicleRateProfile = {},
  params: Partial<RateParams> = {},
): RateEstimate {
  const p: RateParams = { ...RATE_DEFAULTS, ...params };
  const all = dailyMax(readings, today);
  const windowStart = addDays(today, -p.windowDays);
  const inWindow = all.filter((r) => r.on >= windowStart);
  const anchor = [...all].filter((r) => r.on < windowStart).pop();
  const pts = anchor ? [anchor, ...inWindow] : inWindow;
  const last = latestPoint(all);
  const staleDays = last ? diffDays(last.on, today) : null;

  // prior: stima dell'utente > media dalla prima immatricolazione > default (segnaposto a bassa confidenza)
  let prior: number;
  let priorSource: RatePriorSource;
  const firstReg = vehicle.firstRegistrationOn;
  if (vehicle.annualKmEstimate && vehicle.annualKmEstimate > 0) {
    prior = vehicle.annualKmEstimate / 365;
    priorSource = 'user_estimate';
  } else if (last && firstReg && isValidDate(firstReg) && diffDays(firstReg, today) >= 365) {
    prior = last.km / diffDays(firstReg, today);
    priorSource = 'lifetime_average';
  } else {
    prior = p.defaultAnnualKm / 365;
    priorSource = 'default';
  }

  let measured: number | null = null;
  let spanDays = 0;
  if (pts.length >= 2) {
    // segmenti fra letture consecutive; quelli piu' corti di minSegDays si fondono col successivo (evita denominatori minuscoli)
    const segs: Segment[] = [];
    let startIdx = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[startIdx] as OdometerPoint;
      const b = pts[i] as OdometerPoint;
      const days = diffDays(a.on, b.on);
      if (days >= p.minSegDays || i === pts.length - 1) {
        segs.push({ end: b.on, days, dKm: b.km - a.km });
        startIdx = i;
      }
    }
    if (segs.length >= 2 && (segs[segs.length - 1] as Segment).days < p.minSegDays) {
      // l'ultimo segmento e' troppo corto: unisci al precedente
      const l = segs.pop() as Segment;
      const q = segs[segs.length - 1] as Segment;
      q.end = l.end;
      q.days += l.days;
      q.dKm += l.dKm;
    }
    spanDays = diffDays((pts[0] as OdometerPoint).on, (pts[pts.length - 1] as OdometerPoint).on);
    let items: WeightedValue[] = segs
      .filter((s) => s.days > 0)
      .map((s) => ({
        v: Math.max(0, s.dKm / s.days),
        w: s.days * Math.pow(0.5, Math.max(0, diffDays(s.end, today)) / p.halfLifeDays),
      }));
    if (items.length >= 3) {
      // winsorizing: nessun segmento conta piu' di clampMultiple x mediana pesata (taglia i picchi di una gita)
      const med = weightedMedian(items);
      if (med > 0) items = items.map((i) => ({ ...i, v: Math.min(i.v, p.clampMultiple * med) }));
    }
    const tw = items.reduce((a, i) => a + i.w, 0);
    if (tw > 0) measured = items.reduce((a, i) => a + i.v * i.w, 0) / tw;
  }

  let rate: number;
  let source: RateEstimate['source'];
  if (measured == null) {
    rate = prior;
    source = 'prior';
  } else {
    const lambda = Math.min(1, spanDays / p.fullTrustDays); // restringimento verso il prior quando i dati sono pochi
    rate = lambda * measured + (1 - lambda) * prior;
    source = lambda >= 1 ? 'measured' : 'blended';
  }
  rate = Math.min(rate, p.maxKmPerDay);

  let confidence: RateConfidence = 'low';
  if (source !== 'prior') {
    if (spanDays >= 120 && pts.length >= 4) confidence = 'high';
    else if (spanDays >= 45 && pts.length >= 3) confidence = 'medium';
    if (staleDays != null && staleDays > 60) confidence = confidence === 'high' ? 'medium' : 'low';
  }
  if (!(rate >= p.minKmPerDay)) confidence = 'none'; // include NaN: nessuna previsione se la stima non e' un numero sensato
  return { kmPerDay: rate, confidence, source, priorSource, spanDays, points: pts.length, staleDays };
}
