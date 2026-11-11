// discoverCapabilities sonda ogni PID con retries: 0 / retryNoData: 0 e tratta QUALSIASI esito non riuscito
// (BUS BUSY, DATA ERROR, STOPPED, timeout...) come "non risponde": supported = declared && answered.
// Il report resta in cache per tutta la connessione (obdService) e la checklist dice all'utente
// "L'auto lo dichiara ma non risponde" anche per i giri motore. Qui l'auto (scenario 'flaky': ogni tanto
// BUS BUSY / <DATA ERROR, per il resto risponde a tutto) risponde a ogni PID che dichiara.
import { describe, expect, it } from 'vitest';
import { ObdConnection } from '@/obd/session';
import { SNAPSHOT_PIDS } from '@/obd/session/VehicleService';
import { SimulatedTransport } from '@/obd/transport/SimulatedTransport';

describe('report di capacita\' con errori transitori del bus', () => {
  it("un singolo BUS BUSY / DATA ERROR durante la sonda non deve far risultare 'non risponde' un PID che l'auto supporta", async () => {
    const t = new SimulatedTransport({ scenario: 'flaky', searchDelayMs: 0, latencyMs: 0, chunkDelayMs: 0 });
    const c = new ObdConnection({
      transport: t,
      session: { recoveryMs: 30, timeoutScale: 0.05 },
      init: { postResetDelayMs: 1, unableRetryDelayMs: 1, noDataRetryDelayMs: 1 },
      vehicle: { pendingDelayMs: 1 },
    });
    expect((await c.open()).ok).toBe(true);
    const caps = await c.vehicle!.discoverCapabilities();

    const declaredSnapshot = caps.pids.filter((p) => p.declared && SNAPSHOT_PIDS.includes(p.pid));
    const wronglyDemoted = declaredSnapshot.filter((p) => !p.supported).map((p) => '0x' + p.pid.toString(16));
    expect(wronglyDemoted, 'PID dichiarati e supportati dall\'auto ma segnati come non rispondenti').toEqual([]);

    const rpm = caps.checklist.find((k) => k.key === 'engine_rpm');
    expect(rpm?.available).toBe(true);
    await c.close();
  });
});
