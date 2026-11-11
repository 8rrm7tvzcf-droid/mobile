// Letture del controllo livelli (F-44, S-24): elenco dei controlli e stato per fluido. Niente scritture.
import { addDays } from '@/domain/dates';
import { FLUID_INFO, evaluateFluidStatus, fluidStatusList, toppedUpSummary } from '@/domain/fluids';
import type { Fluid, FluidVehicle, ToppedUpSummary } from '@/domain/fluids';
import type { LocalDate, SqlDatabase } from '@/domain/ports';
import type { Deps } from '../context';
import { latestReadingOf } from '../odometer/store';
import { FLUID_CHECK_SELECT, loadCheck, loadChecks, toEntry } from './store';
import type { FluidCheckRow } from './store';
import type { FluidCheckEntry, FluidStatusEntry, FluidStatusOptions, ListFluidChecksOptions } from './types';

/** I controlli di un veicolo, dal piu' recente (data, poi ordine di creazione). Vuoto se il veicolo non esiste. */
export async function listFluidChecks(
  d: Pick<Deps, 'db'>,
  vehicleId: string,
  opts: ListFluidChecksOptions = {},
): Promise<FluidCheckEntry[]> {
  const where = ['f.vehicle_id = ?', 'f.deleted_at IS NULL'];
  const params: (string | number)[] = [vehicleId];
  if (opts.fluid) {
    where.push('f.fluid = ?');
    params.push(opts.fluid);
  }
  if (opts.from) {
    where.push('f.checked_on >= ?');
    params.push(opts.from);
  }
  if (opts.to) {
    where.push('f.checked_on <= ?');
    params.push(opts.to);
  }
  const limit = opts.limit !== undefined ? Math.max(1, Math.floor(opts.limit)) : -1; // -1 = nessun limite in SQLite
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const rows = await d.db.all<FluidCheckRow>(
    `${FLUID_CHECK_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY f.checked_on DESC, f.created_at DESC, f.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map(toEntry);
}

/** Un controllo per id (null se non esiste o e' nel cestino). */
export function getFluidCheck(d: Pick<Deps, 'db'>, checkId: string): Promise<FluidCheckEntry | null> {
  return loadCheck(d.db, checkId);
}

async function loadFluidVehicle(db: SqlDatabase, vehicleId: string): Promise<FluidVehicle | null> {
  const v = await db.get<{
    fuel_primary: FluidVehicle['fuelPrimary'];
    fuel_secondary: FluidVehicle['fuelSecondary'];
    powertrain: FluidVehicle['powertrain'];
  }>('SELECT fuel_primary, fuel_secondary, powertrain FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicleId]);
  return v ? { fuelPrimary: v.fuel_primary, fuelSecondary: v.fuel_secondary, powertrain: v.powertrain } : null;
}

function decorate(s: ReturnType<typeof evaluateFluidStatus>): FluidStatusEntry {
  const info = FLUID_INFO[s.fluid];
  return {
    ...s,
    fluidLabelIt: info.labelIt,
    hintIt: info.hintIt,
    obdNoteIt: info.obdNoteIt,
    readableViaObd: false,
    nextCheckOn: s.last && info.recheckDays !== null ? addDays(s.last.checkedOn, info.recheckDays) : null,
    nextCheckKm: s.last?.km != null && info.recheckKm !== null ? s.last.km + info.recheckKm : null,
  };
}

/**
 * L'elenco S-24: per ogni fluido applicabile all'auto (AdBlue solo diesel, niente olio motore sulle elettriche...) l'ultimo
 * controllo, lo stato (mai controllato / da tenere d'occhio / da ricontrollare / ok) e i suggerimenti onesti del dominio.
 * Lo stato si calcola ogni volta con "oggi" dell'orologio: non e' salvato. Vuoto se il veicolo non esiste.
 */
export async function getFluidStatus(
  d: Pick<Deps, 'db' | 'clock'>,
  vehicleId: string,
  opts: FluidStatusOptions = {},
): Promise<FluidStatusEntry[]> {
  const vehicle = await loadFluidVehicle(d.db, vehicleId);
  if (!vehicle) return [];
  const checks = await loadChecks(d.db, vehicleId);
  const current = await latestReadingOf(d.db, vehicleId);
  return fluidStatusList(checks, d.clock.todayLocal(), vehicle, {
    currentKm: current?.km ?? null,
    pressureUnit: opts.pressureUnit ?? 'bar',
  }).map(decorate);
}

/** Stato di UN fluido, anche se non e' nell'elenco applicabile (es. "altro"). Usato dal risultato di `addFluidCheck`. */
export async function getFluidStatusOf(
  d: Pick<Deps, 'db' | 'clock'>,
  vehicleId: string,
  fluid: Fluid,
  opts: FluidStatusOptions = {},
): Promise<FluidStatusEntry> {
  const checks = await loadChecks(d.db, vehicleId);
  const current = await latestReadingOf(d.db, vehicleId);
  return decorate(
    evaluateFluidStatus(fluid, checks, d.clock.todayLocal(), { currentKm: current?.km ?? null, pressureUnit: opts.pressureUnit ?? 'bar' }),
  );
}

/**
 * Rabbocchi di un fluido in un periodo (estremi inclusi): quanti e quanto (solo quelli con quantita' indicata).
 * E' il dato per l'olio rabboccato nell'anno (base di F-45, V1). Conta solo gli esiti "rabboccato".
 */
export async function getToppedUpSummary(
  d: Pick<Deps, 'db'>,
  vehicleId: string,
  fluid: Fluid,
  from: LocalDate,
  to: LocalDate,
): Promise<ToppedUpSummary> {
  return toppedUpSummary(await loadChecks(d.db, vehicleId), fluid, from, to);
}
