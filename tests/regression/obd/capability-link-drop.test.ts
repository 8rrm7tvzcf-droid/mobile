// Se il collegamento cade mentre si legge il report di capacita', discoverCapabilities non se ne accorge
// (tratta DISCONNECTED/WRITE_FAILED come 'l'auto non risponde'), obdService risponde ok:true con un report
// degenere e lo mette in cache per TUTTA la connessione (la cache non viene svuotata alla riconnessione):
// anche dopo il ripristino del link capabilities() restituisce il report sbagliato (3 PID su 17, VIN/stato 'error').
import { describe, expect, it } from 'vitest';
import { createObdService } from '@/bootstrap/obdService';
import { SimulatedTransport } from '@/obd/transport/SimulatedTransport';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('capabilities() con caduta del collegamento a meta\' lettura', () => {
  it("dopo la riconnessione il report e' quello vero dell'auto (non il risultato della lettura interrotta)", async () => {
    const t = new SimulatedTransport({ scenario: 'petrol', searchDelayMs: 0, latencyMs: 15, chunkDelayMs: 0, autoReconnect: true, reconnectDelayMs: 50 });
    const svc = createObdService({
      createDemoTransport: () => t,
      init: { unableRetryDelayMs: 1, noDataRetryDelayMs: 1, postResetDelayMs: 1 },
      session: { timeoutScale: 0.05, recoveryMs: 20 },
      vehicle: { pendingDelayMs: 1 },
    });
    expect((await svc.openDemo('petrol')).ok).toBe(true);

    const interrupted = svc.capabilities();
    await wait(150);
    t.dropConnection(); // BLE cade durante la sonda dei PID
    await interrupted; // ok:false oppure ok:true: qui non importa
    await wait(1500); // riconnessione + init completo
    expect(svc.getState().phase).toBe('ready');

    const r = await svc.capabilities();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.services.vin).toBe('answers');
    expect(r.value.services.status).toBe('answers');
    expect(r.value.pids.filter((p) => p.supported).length).toBeGreaterThanOrEqual(17);
    await svc.close();
  });
});
