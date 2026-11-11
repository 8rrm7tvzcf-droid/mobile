// Media km/giorno e confidenza (F-03, SPEC 8.3): il calcolo e' nel dominio (estimateKmPerDay); qui si leggono letture,
// dati del veicolo e parametri dalle impostazioni.
import { estimateKmPerDay, type OdometerPoint } from '@/domain/maintenance';
import { sourceLabelIt, type CurrentKm } from '@/domain/odometer';
import type { Deps } from '../context';
import { readSetting } from '../settings';
import { latestReadingOf } from './store';
import type { KmForecast } from './types';

/**
 * Previsione dei km per un veicolo: km/giorno, confidenza (`none` = auto ferma, nessuna previsione), da dove viene la
 * stima e i km stimati oggi. Torna null se il veicolo non esiste. Non scrive nulla.
 */
export async function getKmForecast(d: Pick<Deps, 'db' | 'clock'>, vehicleId: string): Promise<KmForecast | null> {
  const vehicle = await d.db.get<{ annual_km_estimate: number | null; first_registration_on: string | null }>(
    'SELECT annual_km_estimate, first_registration_on FROM vehicles WHERE id = ? AND deleted_at IS NULL',
    [vehicleId],
  );
  if (!vehicle) return null;
  const rows = await d.db.all<{ read_on: string; km: number }>(
    `SELECT read_on, km FROM odometer_readings WHERE vehicle_id = ? AND status = 'valid' AND deleted_at IS NULL`,
    [vehicleId],
  );
  const points: OdometerPoint[] = rows.map((r) => ({ on: r.read_on, km: r.km }));
  const today = d.clock.todayLocal();
  const [windowDays, halfLifeDays, defaultAnnualKm] = [
    await readSetting(d.db, 'forecast.windowDays'),
    await readSetting(d.db, 'forecast.halfLifeDays'),
    await readSetting(d.db, 'forecast.defaultAnnualKm'),
  ];
  const estimate = estimateKmPerDay(
    points,
    today,
    { annualKmEstimate: vehicle.annual_km_estimate, firstRegistrationOn: vehicle.first_registration_on },
    { windowDays, halfLifeDays, defaultAnnualKm },
  );
  const latest = await latestReadingOf(d.db, vehicleId);
  const stale = estimate.staleDays ?? 0;
  const projectedKm =
    latest && stale > 0 && estimate.confidence !== 'none' ? latest.km + Math.round(estimate.kmPerDay * stale) : null;
  const currentKm: CurrentKm | null = latest ? { ...latest, sourceLabel: sourceLabelIt(latest.source) } : null;
  return {
    ...estimate,
    kmPerYear: Math.round(estimate.kmPerDay * 365),
    currentKm,
    projectedKm,
    isInitialEstimate: estimate.source === 'prior',
  };
}
