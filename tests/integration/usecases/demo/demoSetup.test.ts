// Auto di esempio + «Imposta le scadenze» precompilato dallo storico: l'Oggi parte con i semafori colorati, non con voci «Da configurare».
import { describe, expect, it } from 'vitest';
import { createDemoVehicle } from '@/usecases/demo';
import { getVehicleDeadlines } from '@/usecases/queries';
import { setUpDemoDeadlines } from '@/ui/hooks/demoSetup';
import { makeHarness, unwrap } from '../vehicles/harness';

describe('setUpDemoDeadlines', () => {
  it('crea le scadenze dallo storico: nessuna voce «Da configurare» e semafori di piu stati', async () => {
    const h = await makeHarness();
    const { vehicleId } = unwrap(await createDemoVehicle(h.deps));
    expect(await setUpDemoDeadlines(h.deps as never, vehicleId)).toBe(true);

    const res = await getVehicleDeadlines(h.deps, vehicleId);
    const rows = res?.rows ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(10);
    const unknown = rows.filter((r) => r.state === 'unknown').map((r) => r.title);
    expect(unknown).toEqual([]);
    const states = new Set(rows.map((r) => r.state));
    expect(states.has('ok')).toBe(true);
    expect(states.has('overdue') || states.has('soon')).toBe(true);
    // i prossimi intervalli partono dai valori reali dello storico: il cambio olio e' stato fatto, non e' scaduto
    const oil = rows.find((r) => r.templateId === 'tpl_oil_change');
    expect(oil?.state).toBe('ok');
  });

  it('una seconda applicazione non duplica nulla', async () => {
    const h = await makeHarness();
    const { vehicleId } = unwrap(await createDemoVehicle(h.deps));
    await setUpDemoDeadlines(h.deps as never, vehicleId);
    const before = (await getVehicleDeadlines(h.deps, vehicleId))?.rows.length ?? 0;
    await setUpDemoDeadlines(h.deps as never, vehicleId).catch(() => false);
    expect((await getVehicleDeadlines(h.deps, vehicleId))?.rows.length).toBe(before);
  });
});
