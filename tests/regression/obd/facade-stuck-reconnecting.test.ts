// obdService ascolta ObdConnection.onState ma ignora 'failed': se dopo una riconnessione l'init completo
// fallisce (es. quadro spento nel frattempo) la fase resta 'reconnecting' per sempre, senza errore.
import { describe, expect, it } from 'vitest';
import { createObdService } from '@/bootstrap/obdService';
import { SimulatedTransport } from '@/obd/transport/SimulatedTransport';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('facade OBD dopo una riconnessione con init fallito', () => {
  it("la fase non resta 'reconnecting' quando l'init post-riconnessione fallisce: diventa 'failed' con un errore", async () => {
    const t = new SimulatedTransport({ scenario: 'petrol', searchDelayMs: 0, latencyMs: 0, chunkDelayMs: 0, autoReconnect: true, reconnectDelayMs: 20 });
    const svc = createObdService({
      createDemoTransport: () => t,
      init: { unableRetryDelayMs: 1, noDataRetryDelayMs: 1, postResetDelayMs: 1 },
      session: { timeoutScale: 0.05, recoveryMs: 20 },
      vehicle: { pendingDelayMs: 1 },
    });
    const opened = await svc.openDemo('petrol');
    expect(opened.ok).toBe(true);

    t.setIgnition(false); // l'utente spegne il quadro; il link BLE cade e torna
    t.dropConnection();
    await wait(800); // riconnessione (20 ms) + init completo che fallisce con UNABLE TO CONNECT

    const s = svc.getState();
    expect(s.phase, JSON.stringify(s)).toBe('failed');
    expect(s.failure).not.toBeNull();
    await svc.close();
  });
});
