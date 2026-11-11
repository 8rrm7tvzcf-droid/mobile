// Helper dei test dei rifornimenti: DB migrato + auto + scorciatoia per registrare un rifornimento.
import type { FuelType } from '@/domain/fuel';
import { addFuelLog, type AddFuelLogInput, type AddFuelLogResult } from '@/usecases/fuel';
import { addVehicle } from '@/usecases/vehicles';
import { makeHarness, PANDA, unwrap, type Harness } from '../vehicles/harness';

export { count, errorCode, makeHarness, PANDA, unwrap, type Harness } from '../vehicles/harness';

export interface FuelWorld {
  h: Harness;
  vehicleId: string;
}

/** Un DB con una Panda a benzina (o l'alimentazione indicata); eventi azzerati. */
export async function makeFuelWorld(
  vehicle: Partial<Parameters<typeof addVehicle>[1]> = {},
  nowIso?: string,
): Promise<FuelWorld> {
  const h = await makeHarness(nowIso);
  const vehicleId = unwrap(await addVehicle(h.deps, { ...PANDA, ...vehicle })).id;
  h.clearEvents();
  return { h, vehicleId };
}

/** Registra un rifornimento (quantita' in litri decimali, prezzo in EUR/L decimali) e lo restituisce; fallisce se non riesce. */
export async function fill(
  w: FuelWorld,
  on: string,
  km: number | null,
  liters: number,
  extra: Partial<AddFuelLogInput> & { fuelType?: FuelType } = {},
): Promise<AddFuelLogResult> {
  return unwrap(
    await addFuelLog(w.h.deps, {
      vehicleId: w.vehicleId,
      filledOn: on,
      km,
      quantityMilli: Math.round(liters * 1000),
      unitPriceMilli: 1800,
      ...extra,
    }),
  );
}
