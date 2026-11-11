// Letture dei rifornimenti per la UI (S-22, S-14, S-60): elenco, scheda, riepilogo consumi/costi e valori predefiniti.
// Nessuna scrittura. Il periodo filtra cio' che si MOSTRA; i consumi si calcolano sempre sulla catena completa dei pieni.
import {
  FUEL_TYPES,
  TANK_LABELS_IT,
  averageUnitPriceMilli,
  consumptionByTank,
  defaultFuelType,
  fuelLabelIt,
  fuelTypesForVehicle,
  summarizeConsumption,
  tankOf,
  unitForFuel,
  type ConsumptionPoint,
  type FuelType,
  type TankKey,
} from '@/domain/fuel';
import { formatConsumption } from '@/domain/units';
import type { SqlValue } from '@/domain/ports';
import type { Deps } from '../context';
import { resolvePeriod, inPeriod, type DatePeriod } from '../costs/period';
import { getKmForecast } from '../odometer';
import { readFuelEntry } from './fuelLogs';
import { FUEL_SELECT, consumptionViews, loadConsumptionLogs, loadVehicleFuel, toEntry, type FuelRow } from './store';
import type {
  FuelConsumptionPoint,
  FuelFormDefaults,
  FuelLogEntry,
  FuelSummary,
  FuelTankSummary,
  FuelTypeTotals,
  ListFuelLogsOptions,
  SuggestedKm,
} from './types';

/** La scheda di un rifornimento (con il consumo del suo tratto); null se non esiste o e' nel cestino. */
export async function getFuelLog(d: Pick<Deps, 'db'>, id: string): Promise<FuelLogEntry | null> {
  return readFuelEntry(d.db, id);
}

/**
 * Il registro dei rifornimenti di un veicolo nel periodo (default: sempre), dal piu' recente. Ogni pieno porta il suo
 * consumo (calcolato sulla catena di tutti i rifornimenti, anche di prima del periodo). Vuoto se il veicolo non esiste.
 */
export async function listFuelLogs(
  d: Pick<Deps, 'db'>,
  vehicleId: string,
  period?: DatePeriod | null,
  opts: ListFuelLogsOptions = {},
): Promise<FuelLogEntry[]> {
  const p = resolvePeriod(period);
  const where = ['f.vehicle_id = ?', 'f.deleted_at IS NULL'];
  const params: SqlValue[] = [vehicleId];
  if (p.from) {
    where.push('f.filled_on >= ?');
    params.push(p.from);
  }
  if (p.to) {
    where.push('f.filled_on <= ?');
    params.push(p.to);
  }
  if (opts.fuelType) {
    where.push('f.fuel_type = ?');
    params.push(opts.fuelType);
  }
  const dir = opts.order === 'asc' ? 'ASC' : 'DESC';
  const limit = opts.limit !== undefined ? Math.max(1, Math.floor(opts.limit)) : -1; // -1 = nessun limite in SQLite
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const rows = await d.db.all<FuelRow>(
    `${FUEL_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY f.filled_on ${dir}, f.created_at ${dir}, f.id ${dir} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  if (rows.length === 0) return [];
  const views = consumptionViews(await loadConsumptionLogs(d.db, vehicleId));
  return rows.map((r) => toEntry(r, r.is_full === 1 ? (views.get(r.id) ?? null) : null));
}

interface PeriodFuelRow {
  id: string;
  filled_on: string;
  fuel_type: FuelType;
  quantity_milli: number;
  unit_price_milli: number | null;
  total_cents: number;
}

/**
 * Riepilogo dei consumi e della spesa in carburante nel periodo: per serbatoio (consumo medio, ultimo, migliore, peggiore,
 * costo per 100 km, serie per il grafico), per carburante (spesa, quantita', prezzo medio e serie dei prezzi) e il costo per
 * 100 km complessivo. Con un'auto bifuel i consumi sono PER carburante (SPEC 6.3.8) e `caveat` lo dichiara.
 * `null` se il veicolo non esiste.
 */
export async function getFuelSummary(d: Pick<Deps, 'db'>, vehicleId: string, period?: DatePeriod | null): Promise<FuelSummary | null> {
  if (!(await loadVehicleFuel(d.db, vehicleId))) return null;
  const p = resolvePeriod(period);
  const logs = await loadConsumptionLogs(d.db, vehicleId);
  const report = consumptionByTank(logs);
  const rows = (
    await d.db.all<PeriodFuelRow>(
      `SELECT id, filled_on, fuel_type, quantity_milli, unit_price_milli, total_cents FROM fuel_logs
       WHERE vehicle_id = ? AND deleted_at IS NULL ORDER BY filled_on, created_at, id`,
      [vehicleId],
    )
  ).filter((r) => inPeriod(r.filled_on, p));

  const byFuel: FuelTypeTotals[] = [];
  for (const fuelType of FUEL_TYPES) {
    const own = rows.filter((r) => r.fuel_type === fuelType);
    if (own.length === 0) continue;
    byFuel.push({
      fuelType,
      fuelLabel: fuelLabelIt(fuelType),
      unit: unitForFuel(fuelType),
      logCount: own.length,
      quantityMilli: own.reduce((s, r) => s + r.quantity_milli, 0),
      totalCents: own.reduce((s, r) => s + r.total_cents, 0),
      avgUnitPriceMilli: averageUnitPriceMilli(own.map((r) => ({ quantityMilli: r.quantity_milli, totalCents: r.total_cents }))),
      prices: own
        .filter((r) => r.unit_price_milli !== null)
        .map((r) => ({ id: r.id, on: r.filled_on, unitPriceMilli: r.unit_price_milli as number })),
    });
  }

  const tanks: FuelTankSummary[] = [];
  for (const t of report.tanks) {
    const points = t.points.filter((pt) => inPeriod(pt.on, p));
    const logCount = rows.filter((r) => tankOf(r.fuel_type) === t.tank).length;
    if (logCount === 0) continue;
    tanks.push(tankSummary(t.tank, t.unit, logCount, points));
  }
  const withCost = tanks.filter((t) => t.costPer100KmCents !== null);
  return {
    vehicleId,
    period: p,
    logCount: rows.length,
    totalCostCents: rows.reduce((s, r) => s + r.total_cents, 0),
    byFuel,
    tanks,
    bifuel: report.bifuel,
    caveat: report.caveat,
    combinedCostPer100KmCents: withCost.length > 0 ? withCost.reduce((s, t) => s + (t.costPer100KmCents as number), 0) : null,
    combinedComplete: tanks.length > 0 && withCost.length === tanks.length,
  };
}

function tankSummary(
  tank: TankKey,
  unit: FuelTankSummary['unit'],
  logCount: number,
  points: readonly ConsumptionPoint[],
): FuelTankSummary {
  const s = summarizeConsumption(points);
  const text = (v: number | null): string | null => (v === null ? null : formatConsumption(v, unit));
  const series: FuelConsumptionPoint[] = points.map((pt) => ({
    id: pt.id,
    on: pt.on,
    per100Centi: pt.per100Centi,
    text: formatConsumption(pt.per100Centi, unit),
    distanceKm: pt.distanceKm,
  }));
  return {
    tank,
    label: TANK_LABELS_IT[tank],
    unit,
    logCount,
    count: s.count,
    totalDistanceKm: s.totalDistanceKm,
    totalQuantityMilli: s.totalQuantityMilli,
    avgPer100Centi: s.avgPer100Centi,
    lastPer100Centi: s.lastPer100Centi,
    bestPer100Centi: s.bestPer100Centi,
    worstPer100Centi: s.worstPer100Centi,
    avgText: text(s.avgPer100Centi),
    lastText: text(s.lastPer100Centi),
    bestText: text(s.bestPer100Centi),
    worstText: text(s.worstPer100Centi),
    totalCostCents: s.totalCostCents,
    costPer100KmCents: s.costPer100KmCents,
    series,
  };
}

/**
 * Valori predefiniti del modulo «Rifornimento» (S-22, meno di 10 secondi): carburanti dell'auto, l'ultimo usato, l'ultimo
 * prezzo per carburante, l'ultima stazione e i km suggeriti (letti oggi, stimati con etichetta «stimato», o ultima lettura).
 * `null` se il veicolo non esiste.
 */
export async function getFuelFormDefaults(d: Pick<Deps, 'db' | 'clock'>, vehicleId: string): Promise<FuelFormDefaults | null> {
  const vehicle = await loadVehicleFuel(d.db, vehicleId);
  if (!vehicle) return null;
  const today = d.clock.todayLocal();
  const cfg = { fuelPrimary: vehicle.fuel_primary, fuelSecondary: vehicle.fuel_secondary };
  const recent = await d.db.all<{ fuel_type: FuelType; unit_price_milli: number | null; grade: string | null; station: string | null }>(
    `SELECT fuel_type, unit_price_milli, grade, station FROM fuel_logs WHERE vehicle_id = ? AND deleted_at IS NULL
     ORDER BY filled_on DESC, created_at DESC, id DESC LIMIT 200`,
    [vehicleId],
  );
  const lastUnitPriceMilli: FuelFormDefaults['lastUnitPriceMilli'] = {};
  const lastGrade: FuelFormDefaults['lastGrade'] = {};
  const stations: string[] = [];
  for (const r of recent) {
    if (r.unit_price_milli !== null && lastUnitPriceMilli[r.fuel_type] === undefined) lastUnitPriceMilli[r.fuel_type] = r.unit_price_milli;
    if (r.grade !== null && lastGrade[r.fuel_type] === undefined) lastGrade[r.fuel_type] = r.grade;
    if (r.station !== null && !stations.includes(r.station) && stations.length < 5) stations.push(r.station);
  }
  const fuelType = defaultFuelType(cfg, recent[0]?.fuel_type ?? null);

  let suggestedKm: SuggestedKm | null = null;
  const forecast = await getKmForecast(d, vehicleId);
  const cur = forecast?.currentKm ?? null;
  if (cur) {
    const base = { sourceLabel: cur.sourceLabel, source: cur.source, asOf: cur.readOn };
    if (cur.readOn === today) suggestedKm = { ...base, km: cur.km, estimated: false, basis: 'today', label: cur.sourceLabel };
    else if (forecast?.projectedKm != null) {
      suggestedKm = { ...base, km: forecast.projectedKm, estimated: true, basis: 'projected', label: 'stimato' };
    } else suggestedKm = { ...base, km: cur.km, estimated: false, basis: 'last', label: 'ultima lettura' };
  }

  return {
    vehicleId,
    today,
    fuelTypes: fuelTypesForVehicle(cfg),
    fuelType,
    quantityUnit: unitForFuel(fuelType),
    lastUnitPriceMilli,
    lastGrade,
    lastStation: stations[0] ?? null,
    recentStations: stations,
    suggestedKm,
    isFull: true,
    tankCapacityMl: vehicle.tank_capacity_ml,
  };
}
