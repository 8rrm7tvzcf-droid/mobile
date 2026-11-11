// Letture del contachilometri come serie di punti (data, km). Dominio puro.
import { diffDays } from '@/domain/dates';
import type { OdometerPoint } from './types';

/** Una lettura per giorno (la piu' alta), solo fino a oggi, in ordine cronologico. */
export function dailyMax(readings: readonly OdometerPoint[], today: string): OdometerPoint[] {
  const byDay = new Map<string, number>();
  for (const r of readings) {
    if (r.on <= today) byDay.set(r.on, Math.max(byDay.get(r.on) ?? -1, r.km));
  }
  return [...byDay].map(([on, km]) => ({ on, km })).sort((a, b) => (a.on < b.on ? -1 : 1));
}

export function latestPoint(points: readonly OdometerPoint[]): OdometerPoint | null {
  return points.length ? (points[points.length - 1] as OdometerPoint) : null;
}

/**
 * Km a una data per interpolazione lineare fra due letture. Fuori dall'intervallo delle letture
 * non estrapola mai: ritorna null (invariante I3, nessun dato inventato). `points` = output di `dailyMax`.
 */
export function kmAt(on: string, points: readonly OdometerPoint[]): number | null {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as OdometerPoint;
    const b = points[i + 1] as OdometerPoint;
    if (on >= a.on && on <= b.on) {
      const span = diffDays(a.on, b.on);
      return span === 0 ? a.km : Math.round(a.km + ((b.km - a.km) * diffDays(a.on, on)) / span);
    }
  }
  const hit = points.find((p) => p.on === on);
  return hit ? hit.km : null;
}
