// obd-02 / obd-03 / obd-04 / obd-06: casi di contorno delle correzioni (oltre alle prove originali spostate qui accanto).
import { describe, expect, it } from 'vitest';
import { createObdService } from '@/bootstrap/obdService';
import { ElmSession, ObdConnection, runAdapterInit, type ConnectionState } from '@/obd/session';
import { MockTransport, type TranscriptEntry } from '@/obd/transport/MockTransport';
import { SCENARIOS, type ScenarioConfig } from '@/obd/transport/simulator/scenarios';
import { SimulatedTransport } from '@/obd/transport/SimulatedTransport';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FAST = { session: { recoveryMs: 20, timeoutScale: 0.05 }, init: { postResetDelayMs: 1, unableRetryDelayMs: 1, noDataRetryDelayMs: 1 }, vehicle: { pendingDelayMs: 1 } };

async function open(scenario: ScenarioConfig | 'petrol' = 'petrol') {
  const t = new SimulatedTransport({ scenario, searchDelayMs: 0, latencyMs: 0, chunkDelayMs: 0 });
  const c = new ObdConnection({ transport: t, ...FAST });
  const states: ConnectionState[] = [];
  c.onState((s) => states.push(s));
  expect((await c.open()).ok).toBe(true);
  return { t, c, states };
}

describe("obd-03: reset dell'adattatore a link attivo", () => {
  it("ERR94 a meta' sessione: init completo una sola volta (un solo ATZ in piu'), stati reconnecting > initializing > ready", async () => {
    const { t, c, states } = await open();
    const atzBefore = t.received.filter((x) => x === 'ATZ').length;
    t.emulator.powerCycle();
    t.injectData('ERR94\r\r>');
    await wait(300);
    expect(states.slice(-3).join('>')).toBe('reconnecting>initializing>ready');
    expect(t.received.filter((x) => x === 'ATZ').length).toBe(atzBefore + 1);
    expect(c.reinitCount).toBe(1);
    expect((await c.vehicle!.readPid(0x0c)).ok).toBe(true);
    await c.close();
  });

  it('abortPending: le richieste in coda ricevono DISCONNECTED e la sessione resta aperta', async () => {
    const entries: TranscriptEntry[] = [{ cmd: '010C', rx: [] }, { cmd: '010D', rx: [] }, { cmd: '0105', rx: ['NO DATA\r\r>'] }];
    const transport = new MockTransport(entries);
    const session = new ElmSession(transport, { recoveryMs: 20, timeoutScale: 0.05 });
    await session.open();
    const a = session.send('010C', { timeoutMs: 5000, retries: 0 });
    const b = session.send('010D');
    const c = session.send('0105');
    await wait(5);
    session.abortPending();
    for (const r of await Promise.all([a, b, c])) expect(r.error?.code).toBe('DISCONNECTED');
    expect(session.isOpen).toBe(true);
    await session.close();
  });

  it("la facade passa da ready a reconnecting e torna ready; svuota la cache di capacita' e snapshot", async () => {
    const t = new SimulatedTransport({ scenario: 'petrol', searchDelayMs: 0, latencyMs: 0, chunkDelayMs: 0 });
    const svc = createObdService({ createDemoTransport: () => t, ...FAST });
    const phases: string[] = [];
    svc.subscribe((s) => {
      if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
    });
    expect((await svc.openDemo('petrol')).ok).toBe(true);
    expect((await svc.capabilities()).ok).toBe(true);
    expect((await svc.snapshot()).ok).toBe(true);
    expect(svc.lastCapabilities()).not.toBeNull();

    t.emulator.powerCycle();
    t.injectData('LV RESET\r\r>');
    await wait(300);
    expect(phases.slice(-3).join('>')).toBe('ready>reconnecting>ready');
    expect(svc.getState().connectStep).toBeNull();
    expect(svc.lastCapabilities()).toBeNull();
    expect(svc.lastSnapshot()).toBeNull();
    expect((await svc.capabilities()).ok).toBe(true);
    await svc.close();
  });
});

describe('obd-04: stati coerenti', () => {
  it('init post-riconnessione fallito (quadro spento): fase failed con UNABLE_TO_CONNECT e suggerimento ignition, senza cache', async () => {
    const t = new SimulatedTransport({ scenario: 'petrol', searchDelayMs: 0, latencyMs: 0, chunkDelayMs: 0, autoReconnect: true, reconnectDelayMs: 20 });
    const svc = createObdService({ createDemoTransport: () => t, ...FAST });
    expect((await svc.openDemo('petrol')).ok).toBe(true);
    expect((await svc.capabilities()).ok).toBe(true);
    t.setIgnition(false);
    t.dropConnection();
    await wait(800);
    const s = svc.getState();
    expect(s.phase).toBe('failed');
    expect(s.failure).toMatchObject({ code: 'UNABLE_TO_CONNECT', hint: 'ignition' });
    expect(s.connectStep).toBeNull();
    expect(svc.lastCapabilities()).toBeNull();
    const r = await svc.capabilities();
    expect(r.ok).toBe(false);
    await svc.close();
  });

  it("ObdConnection: dopo close() nessuna transizione (anche se il link cade durante l'init)", async () => {
    const t = new SimulatedTransport({ scenario: 'petrol', searchDelayMs: 200, latencyMs: 5, chunkDelayMs: 0 });
    const c = new ObdConnection({ transport: t });
    const states: ConnectionState[] = [];
    c.onState((s) => states.push(s));
    const opening = c.open();
    await wait(60);
    await c.close();
    t.dropConnection();
    await opening;
    await wait(50);
    expect(states[states.length - 1]).toBe('closed');
    expect(states.filter((s) => s === 'closed').length).toBe(1);
  });

  it("allowWrite non si puo' abilitare da ObdConnection: Mode 04 resta bloccato", async () => {
    const t = new SimulatedTransport({ scenario: 'mil-on', searchDelayMs: 0, latencyMs: 0, chunkDelayMs: 0 });
    const c = new ObdConnection({ transport: t, ...FAST, session: { ...FAST.session, allowWrite: true } });
    expect((await c.open()).ok).toBe(true);
    const r = await c.session.send('04');
    expect(r.error?.code).toBe('WRITE_BLOCKED');
    expect(t.received).not.toContain('04');
    await c.close();
  });
});

describe('obd-02: errori di comunicazione e link caduto', () => {
  it("errori di comunicazione persistenti: i PID restano 'non verificati', non 'non risponde'", async () => {
    const sc: ScenarioConfig = { ...SCENARIOS.petrol, glitches: [] };
    const { c } = await open(sc);
    sc.glitches = [{ every: 1, reply: '<DATA ERROR' }]; // da ora ogni richiesta OBD risponde DATA ERROR
    const caps = await c.vehicle!.discoverCapabilities();
    const probed = caps.pids.filter((p) => p.unverified);
    expect(probed.length).toBeGreaterThan(5);
    expect(probed.every((p) => !p.supported && !p.answered)).toBe(true);
    const rpm = caps.checklist.find((k) => k.key === 'engine_rpm');
    expect(rpm?.available).toBe(false);
    expect(rpm?.detail).toMatch(/non verificato/i);
    expect(caps.notes.join(' ')).toMatch(/non sono stati verificati/);
    await c.close();
  }, 15000);

  it('PID che l\'auto non ha (NO DATA) restano "non risponde" e non "non verificati"', async () => {
    const { c } = await open();
    const caps = await c.vehicle!.discoverCapabilities();
    for (const pid of [0x5c, 0xa6]) {
      const p = caps.pids.find((x) => x.pid === pid);
      expect(p?.unverified).toBeUndefined();
      expect(p?.answered).toBe(false);
    }
    await c.close();
  });

  it('link caduto durante capabilities()/snapshot(): NOT_CONNECTED e nulla in cache', async () => {
    const t = new SimulatedTransport({ scenario: 'petrol', searchDelayMs: 0, latencyMs: 15, chunkDelayMs: 0, autoReconnect: true, reconnectDelayMs: 50 });
    const svc = createObdService({ createDemoTransport: () => t, ...FAST });
    expect((await svc.openDemo('petrol')).ok).toBe(true);

    const caps = svc.capabilities();
    await wait(150);
    t.dropConnection();
    const r = await caps;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_CONNECTED');
    expect(svc.lastCapabilities()).toBeNull();
    await wait(1500);
    expect(svc.getState().phase).toBe('ready');

    const ok = await svc.capabilities();
    expect(ok.ok).toBe(true);
    const snap = svc.snapshot();
    await wait(100);
    t.dropConnection();
    const s = await snap;
    expect(s.ok).toBe(false);
    expect(svc.lastSnapshot()).toBeNull();
    expect(svc.lastCapabilities()).toBeNull();
    await svc.close();
  }, 15000);
});

describe('obd-06: un solo ritentativo sul primo 0100', () => {
  const e = (cmd: string, ...rx: string[]): TranscriptEntry => ({ cmd, rx });
  const OK = 'OK\r\r>';
  const prefix = (): TranscriptEntry[] => [
    e('ATZ', 'ATZ\r\n\r\nELM327 v2.1\r\n\r\n>'),
    e('ATE0', 'ATE0\r\nOK\r\n\r\n>'),
    e('ATL0', OK),
    e('ATS0', OK),
    e('ATH1', OK),
    e('ATAT1', OK),
    e('ATRV', '12.4V\r\r>'),
    e('ATSP0', OK),
  ];

  it('BUS BUSY due volte di fila: BUS_ERROR (un solo ritentativo)', async () => {
    const transport = new MockTransport([...prefix(), e('0100', 'BUS BUSY\r\r>'), e('0100', 'BUS BUSY\r\r>'), e('0100', '7E8064100BE3EB81100\r\r>')]);
    const session = new ElmSession(transport, { recoveryMs: 30, timeoutScale: 0.05 });
    await session.open();
    const r = await runAdapterInit(session, { postResetDelayMs: 0, searchTimeoutMs: 300, skipIdentification: true });
    await session.close();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BUS_ERROR');
    expect(transport.written.filter((w) => w === '0100\r').length).toBe(2);
  });
});
