// Schermata "Oggi" (SPEC 6.3.4, F-13, F-24): view model completo, calcolato al momento della lettura.
import { diffDays, isValidDate } from '@/domain/dates';
import type { LocalDate } from '@/domain/dates';
import type { NotificationScheduler, PermissionState, SqlDatabase } from '@/domain/ports';
import { formatDateIt, plural } from '@/domain/units';
import type { Deps } from '../context';
import { categorySummaries, countRows, groupRows, nextDeadline, vehicleSummary } from './aggregate';
import { loadDeadlineRows, loadVehicleInfos } from './load';
import type { VehicleInfo } from './load';
import { readBackupSettings, readNotifySettings } from './settings';
import type { Dashboard, DashboardBanner, DeadlineRow, NotificationStatus } from './types';

/** Dipendenze di `getDashboard`: con `scheduler` (NotificationDeps) la lettura include il permesso delle notifiche. */
export type DashboardDeps = Deps & { scheduler?: NotificationScheduler };

export interface DashboardOptions {
  /** Selettore d'auto: null/assente = "Tutte le auto". */
  vehicleId?: string | null;
}

export const TODO_LIMIT = 50;
/** Banner "Aggiorna i km": ultima lettura piu' vecchia di questi giorni con una scadenza a km prevista entro `KM_BANNER_HORIZON_DAYS`. */
export const KM_BANNER_STALE_DAYS = 30;
export const KM_BANNER_HORIZON_DAYS = 90;
/** Banner "Fai un backup": almeno queste modifiche dall'ultimo backup (e `backup.nudgeDays` giorni). */
export const BACKUP_BANNER_MIN_CHANGES = 5;

const CHANGE_TABLES = [
  'vehicles',
  'odometer_readings',
  'fuel_logs',
  'service_records',
  'expenses',
  'insurance_policies',
  'maintenance_items',
  'maintenance_completions',
  'fluid_checks',
] as const;

async function countChangesSince(db: SqlDatabase, since: string | null): Promise<number> {
  const sql = `SELECT ${CHANGE_TABLES.map((t) => `(SELECT COUNT(*) FROM ${t} WHERE updated_at > ?)`).join(' + ')} AS n`;
  const row = await db.get<{ n: number }>(sql, CHANGE_TABLES.map(() => since ?? ''));
  return row?.n ?? 0;
}

async function readPermission(scheduler: NotificationScheduler | undefined): Promise<PermissionState | 'unknown'> {
  if (!scheduler) return 'unknown';
  try {
    return await scheduler.getPermission();
  } catch {
    return 'unknown';
  }
}

function notificationsBanner(status: NotificationStatus): DashboardBanner | null {
  const base = {
    kind: 'notifications' as const,
    tone: 'warning' as const,
    title: 'Avvisi spenti',
    message: 'Senza notifiche potresti perdere una scadenza.',
  };
  if (!status.enabled) return { ...base, action: { id: 'open-notification-settings', label: 'Attiva gli avvisi' } };
  switch (status.permission) {
    case 'undetermined':
      return { ...base, action: { id: 'enable-notifications', label: 'Attiva gli avvisi' } };
    case 'denied':
      return { ...base, action: { id: 'retry-notifications', label: 'Riprova' } };
    case 'blocked':
      return { ...base, action: { id: 'open-system-settings', label: 'Apri impostazioni' } };
    default:
      return null;
  }
}

/** Una sola auto per banner: la prima (ordine del garage) che ha una scadenza a km e dati km vecchi o mancanti. */
function updateKmBanner(today: LocalDate, vehicles: readonly VehicleInfo[], rows: readonly DeadlineRow[]): DashboardBanner | null {
  for (const v of vehicles) {
    const kmRows = rows.filter((r) => r.vehicleId === v.id && r.dueKm != null && !r.kmReached);
    if (kmRows.length === 0) continue;
    if (v.lastReadingOn == null) {
      return {
        kind: 'update-km',
        tone: 'info',
        title: 'Aggiorna i km',
        message: `Inserisci i km di ${v.label}: servono per stimare le scadenze a chilometri.`,
        action: { id: 'update-odometer', label: 'Aggiorna i km' },
        vehicleId: v.id,
      };
    }
    const stale = diffDays(v.lastReadingOn, today);
    const soonForecast = kmRows.some((r) => r.forecastOn != null && diffDays(today, r.forecastOn) <= KM_BANNER_HORIZON_DAYS);
    if (stale > KM_BANNER_STALE_DAYS && soonForecast) {
      return {
        kind: 'update-km',
        tone: 'info',
        title: 'Aggiorna i km',
        message: `Ultima lettura di ${v.label}: ${formatDateIt(v.lastReadingOn)} (${plural(stale, 'giorno', 'giorni')} fa). Aggiornala per avere stime più precise.`,
        action: { id: 'update-odometer', label: 'Aggiorna i km' },
        vehicleId: v.id,
      };
    }
  }
  return null;
}

async function backupBanner(db: SqlDatabase, today: LocalDate): Promise<DashboardBanner | null> {
  const s = await readBackupSettings(db);
  const lastDay = s.lastExportAt ? s.lastExportAt.slice(0, 10) : null;
  if (lastDay && isValidDate(lastDay) && diffDays(lastDay, today) < s.nudgeDays) return null;
  const changes = await countChangesSince(db, s.lastExportAt);
  if (changes < BACKUP_BANNER_MIN_CHANGES) return null;
  return {
    kind: 'backup',
    tone: 'info',
    title: 'Fai un backup',
    message: lastDay && isValidDate(lastDay)
      ? `L'ultimo backup risale al ${formatDateIt(lastDay)}: i tuoi dati sono solo su questo telefono.`
      : 'Non hai ancora un backup: i tuoi dati sono solo su questo telefono.',
    action: { id: 'open-backup', label: 'Esporta ora' },
  };
}

/**
 * View model di "Oggi". Lo stato di ogni scadenza si calcola qui da `oggi` (orologio iniettato) e dai km: non esiste
 * nessuno stato salvato. Se `d` ha `scheduler` il risultato include il permesso delle notifiche (banner "Attiva gli avvisi").
 */
export async function getDashboard(d: DashboardDeps, options: DashboardOptions = {}): Promise<Dashboard> {
  const today = d.clock.todayLocal();
  const vehicles = await loadVehicleInfos(d.db, today, { activeOnly: true });
  const allRows = await loadDeadlineRows(d.db, d.clock, vehicles);
  const vehicleId = options.vehicleId && vehicles.some((v) => v.id === options.vehicleId) ? options.vehicleId : null;
  const selectedVehicles = vehicleId ? vehicles.filter((v) => v.id === vehicleId) : vehicles;
  const rows = vehicleId ? allRows.filter((r) => r.vehicleId === vehicleId) : allRows;

  const settings = await readNotifySettings(d.db);
  const permission = await readPermission(d.scheduler);
  const notifications: NotificationStatus = {
    enabled: settings.enabled,
    permission,
    active: settings.enabled && permission === 'granted',
  };

  const hasVehicles = vehicles.length > 0;
  const banners: DashboardBanner[] = [];
  if (hasVehicles) {
    const n = notificationsBanner(notifications);
    if (n) banners.push(n);
    const k = updateKmBanner(today, selectedVehicles, rows);
    if (k) banners.push(k);
    if (banners.length < 2) {
      const b = await backupBanner(d.db, today);
      if (b) banners.push(b);
    }
  }

  return {
    today,
    vehicles: vehicles.map((v) => vehicleSummary(v, allRows.filter((r) => r.vehicleId === v.id))),
    hasVehicles,
    showVehicleSelector: vehicles.length > 1,
    vehicleId,
    next: nextDeadline(rows),
    categories: categorySummaries(rows),
    groups: groupRows(rows),
    counts: countRows(rows),
    todo: rows.filter((r) => r.kind === 'reminder' && !r.snoozed).slice(0, TODO_LIMIT),
    banners: banners.slice(0, 2),
    notifications,
    emptyState: !hasVehicles ? 'no-vehicles' : rows.length === 0 ? 'no-deadlines' : null,
  };
}
