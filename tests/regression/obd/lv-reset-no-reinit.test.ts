// Dopo un LV RESET (o ERR94) l'adattatore torna ai valori di fabbrica (eco acceso, intestazioni spente, spazi),
// ma il collegamento BLE NON cade: nessun onReconnected, quindi ObdConnection non rifa' l'init e VehicleService
// continua a interpretare le risposte con headers:true. ElmSession emette l'evento 'adapter-reset' ma nessuno lo ascolta.
import { describe, expect, it } from 'vitest';
import { ObdConnection } from '@/obd/session';
import { SimulatedTransport } from '@/obd/transport/SimulatedTransport';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('LV RESET a meta\' sessione', () => {
  it("la connessione ripristina l'adattatore (init completo) e le letture tornano a funzionare", async () => {
    const t = new SimulatedTransport({ scenario: 'petrol', searchDelayMs: 0, latencyMs: 0, chunkDelayMs: 0 });
    const c = new ObdConnection({
      transport: t,
      session: { timeoutScale: 0.05, recoveryMs: 20 },
      init: { postResetDelayMs: 1, unableRetryDelayMs: 1, noDataRetryDelayMs: 1 },
      vehicle: { pendingDelayMs: 1 },
    });
    const opened = await c.open();
    expect(opened.ok).toBe(true);
    expect((await c.vehicle!.readPid(0x0c)).ok).toBe(true);

    // Cala la tensione: l'adattatore si riavvia da solo (valori di fabbrica) e lo segnala.
    t.emulator.powerCycle();
    t.injectData('LV RESET\r\r>');
    await wait(300); // tempo piu' che sufficiente per un init completo con questi tempi ridotti

    const after = c.vehicle ? await c.vehicle.readPid(0x0c) : null;
    expect(after?.ok, JSON.stringify(after)).toBe(true);
    await c.close();
  });
});
