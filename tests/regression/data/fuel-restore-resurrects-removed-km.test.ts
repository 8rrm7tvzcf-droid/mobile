// Prova di riproduzione: «Annulla» dell'eliminazione di un rifornimento non ripristina ESATTAMENTE lo stato.
// L'utente toglie i km dal rifornimento (la lettura collegata va nel cestino), poi elimina il rifornimento e annulla:
// restoreFuelLog riesuma QUALSIASI lettura nel cestino collegata al rifornimento, anche quella tolta prima a mano.
// Atteso (corretto): dopo elimina+ripristina il rifornimento torna com'era prima dell'eliminazione, cioe' senza km.
/// <reference types="node" />
import { beforeEach, describe, expect, it } from 'vitest';
import { addFuelLog, deleteFuelLog, restoreFuelLog, updateFuelLog } from '@/usecases/fuel';
import { listOdometerReadings } from '@/usecases/odometer';
import { insertRow, openBootedDb, vehicleRow, type TestDb } from '../../support/db';
import { sequentialIds } from '../../support/fakes';
import type { Deps } from '@/usecases/context';

let t: TestDb;
let deps: Deps;
let vehicleId: string;
beforeEach(async () => {
  t = await openBootedDb();
  t.clock.set('2026-10-08T07:30:00.000Z');
  deps = { db: t.db, clock: t.clock, ids: sequentialIds(700_000), events: { emit: () => undefined, on: () => () => undefined } };
  vehicleId = await insertRow(t.db, 'vehicles', vehicleRow({ plate: 'REV0001' }));
});

describe('rifornimenti: elimina + ripristina', () => {
  it('non fa ricomparire dei km che l\'utente aveva tolto prima di eliminare', async () => {
    const added = await addFuelLog(deps, { vehicleId, filledOn: '2026-10-01', quantityMilli: 30000, totalCents: 5500, km: 20000 });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const id = added.value.fuelLog.id;

    // 1) l'utente toglie i km dal rifornimento
    const noKm = await updateFuelLog(deps, id, { km: null });
    expect(noKm.ok).toBe(true);
    expect(await listOdometerReadings(deps, vehicleId)).toHaveLength(0);

    // 2) elimina il rifornimento e poi preme «Annulla»
    t.clock.set('2026-10-08T07:31:00.000Z');
    expect((await deleteFuelLog(deps, id)).ok).toBe(true);
    const restored = await restoreFuelLog(deps, id);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;

    // stato atteso = quello di prima dell'eliminazione: nessun km, nessuna lettura nel registro
    expect(restored.value.fuelLog.km).toBeNull();
    expect(await listOdometerReadings(deps, vehicleId)).toHaveLength(0);
  });
});
