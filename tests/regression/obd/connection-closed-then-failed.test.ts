// ObdConnection.close() durante l'init: lo stato 'closed' dovrebbe essere terminale. Invece runInit(), tornando
// con DISCONNECTED, chiama setState('failed') e notifica un errore "collegamento perso" DOPO la chiusura voluta.
import { describe, expect, it } from 'vitest';
import { ObdConnection } from '@/obd/session';
import { SimulatedTransport } from '@/obd/transport/SimulatedTransport';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ObdConnection: close() durante l\'init', () => {
  it("lo stato resta 'closed' (nessuna transizione a 'failed' dopo la chiusura)", async () => {
    const t = new SimulatedTransport({ scenario: 'petrol', searchDelayMs: 300, latencyMs: 5, chunkDelayMs: 0 });
    const c = new ObdConnection({ transport: t });
    const states: string[] = [];
    c.onState((s) => states.push(s));
    const opening = c.open();
    await wait(100);
    await c.close();
    await opening;
    expect(states.join('>')).toBe('connecting>initializing>closed');
    expect(c.state).toBe('closed');
  });
});
