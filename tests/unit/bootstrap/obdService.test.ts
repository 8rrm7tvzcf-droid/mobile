// Facciata OBD per la UI (src/bootstrap/obdService.ts): trasporto simulato, nessun rendering.
import { describe, expect, it } from 'vitest';
import { createObdService, STATIONARY_LIVE_PLAN, type DemoScenario, type LiveSample, type ObdState } from '@/bootstrap/obdService';
import { SimulatedTransport } from '@/obd/transport/SimulatedTransport';

const clock = { nowIso: () => '2026-10-08T10:00:00.000Z' };
const FAST_INIT = { postResetDelayMs: 0, unableRetryDelayMs: 1, noDataRetryDelayMs: 1, searchTimeoutMs: 300 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function build() {
  const transports: SimulatedTransport[] = [];
  const service = createObdService({
    clock,
    session: { recoveryMs: 30, timeoutScale: 0.05 },
    init: FAST_INIT,
    createDemoTransport: (scenario: DemoScenario) => {
      const t = new SimulatedTransport({ scenario, latencyMs: 0, searchDelayMs: 0, chunkDelayMs: 0 });
      transports.push(t);
      return t;
    },
  });
  const states: ObdState[] = [];
  service.subscribe((s) => states.push(s));
  return { service, transports, states };
}

describe('createObdService: collegamento demo', () => {
  it('parte da fermo e, aperta la demo, passa da "connecting" a "ready" mostrando i passi di avvio', async () => {
    const { service, states } = build();
    expect(service.getState().phase).toBe('idle');
    expect(service.getState().demo).toBe(false);
    const r = await service.openDemo('petrol');
    expect(r.ok).toBe(true);
    const phases = states.map((s) => s.phase);
    expect(phases[0]).toBe('connecting');
    expect(phases[phases.length - 1]).toBe('ready');
    const steps = states.map((s) => s.connectStep).filter(Boolean);
    expect(steps).toContain('reset');
    expect(steps).toContain('search');
    const end = service.getState();
    expect(end.demo).toBe(true);
    expect(end.scenario).toBe('petrol');
    expect(end.failure).toBeNull();
    expect(end.connectStep).toBeNull();
    expect(end.protocolName).toBeTruthy();
    await service.close();
  });

  it('quadro spento: errore con "riprova" e motivo, poi un nuovo tentativo con l\'auto normale riesce', async () => {
    const { service } = build();
    const r = await service.openDemo('ignition-off');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.retryable).toBe(true);
    expect(r.error.hint).not.toBe('none');
    const s = service.getState();
    expect(s.phase).toBe('failed');
    expect(s.failure).toEqual(r.error);
    // il nuovo tentativo parte pulito
    const again = await service.openDemo('petrol');
    expect(again.ok).toBe(true);
    expect(service.getState().phase).toBe('ready');
    expect(service.getState().failure).toBeNull();
    await service.close();
  });

  it('senza collegamento le letture rispondono NOT_CONNECTED (mai eccezioni)', async () => {
    const { service } = build();
    for (const r of [await service.snapshot(), await service.capabilities(), await service.startLive(() => undefined)]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('NOT_CONNECTED');
    }
    expect(service.lastSnapshot()).toBeNull();
  });

  it('close riporta allo stato iniziale e svuota la cache; la lettura successiva non e\' piu\' possibile', async () => {
    const { service } = build();
    await service.openDemo('petrol');
    await service.snapshot();
    expect(service.lastSnapshot()).not.toBeNull();
    await service.close();
    expect(service.getState()).toMatchObject({ phase: 'idle', demo: false, live: false });
    expect(service.lastSnapshot()).toBeNull();
    expect(service.lastCapabilities()).toBeNull();
    const r = await service.snapshot();
    expect(r.ok).toBe(false);
  });

  it('riaprire la demo con un altro scenario chiude il trasporto precedente', async () => {
    const { service, transports } = build();
    await service.openDemo('petrol');
    await service.openDemo('mil-on');
    expect(transports).toHaveLength(2);
    expect(transports[0].isConnected).toBe(false);
    expect(transports[1].isConnected).toBe(true);
    expect(service.getState().scenario).toBe('mil-on');
    await service.close();
  });
});

describe('createObdService: snapshot e capacita\'', () => {
  it('benzina normale: VIN, spia spenta, nessun codice, valori chiave letti dall\'auto e passi di lettura', async () => {
    const { service, states } = build();
    await service.openDemo('petrol');
    const r = await service.snapshot();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const snap = r.value;
    expect(snap.vin?.value).toBe('ZFA19900001234567');
    expect(snap.vin?.source).toBe('read');
    expect(snap.vinStatus).toBe('ok');
    expect(snap.status?.value.milOn).toBe(false);
    expect(snap.dtc.stored.codes).toEqual([]);
    expect(snap.pids.engine_rpm.source).toBe('read');
    expect(snap.pids.coolant_temp).toBeDefined();
    expect(snap.adapterVoltage?.source).toBe('read');
    expect(service.lastSnapshot()).toBe(snap);

    const steps = new Set(states.map((s) => s.readStep).filter(Boolean));
    for (const s of ['capabilities', 'vin', 'status', 'dtc', 'data', 'voltage']) expect(steps.has(s as never)).toBe(true);
    expect(service.getState().readStep).toBeNull();
    await service.close();
  });

  it('spia accesa: codici memorizzati, pendenti e permanenti e freeze frame', async () => {
    const { service } = build();
    await service.openDemo('mil-on');
    const r = await service.snapshot();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const snap = r.value;
    expect(snap.status?.value.milOn).toBe(true);
    expect(snap.dtc.stored.codes).toEqual(['P0420', 'P0301', 'P0171']);
    expect(snap.dtc.pending.codes).toEqual(['P0171']);
    expect(snap.dtc.permanent.codes).toEqual(['P0420']);
    expect(snap.freezeFrameStatus).toBe('ok');
    expect(snap.freezeFrame?.value.dtc).toBe('P0420');
    await service.close();
  });

  it('il report di capacita\' viene messo in cache e riusato dallo snapshot', async () => {
    const { service } = build();
    await service.openDemo('petrol');
    const a = await service.capabilities();
    const b = await service.capabilities();
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.value).toBe(a.value);
    expect(a.value.services.vin).toBe('answers');
    expect(a.value.pids.some((p) => p.id === 'engine_rpm' && p.supported)).toBe(true);
    // niente chilometraggio sulla benzina di esempio: va inserito a mano
    expect(a.value.checklist.find((c) => c.key === 'odometer')?.available).toBe(false);
    const fresh = await service.capabilities({ refresh: true });
    expect(fresh.ok && fresh.value !== a.value).toBe(true);
    await service.close();
  });

  it('SOLA LETTURA: dopo una sessione completa non e\' stato inviato nessun Mode 04 (cancellazione codici)', async () => {
    const { service, transports } = build();
    await service.openDemo('mil-on');
    await service.snapshot();
    await service.startLive(() => undefined, { hz: 8 });
    await wait(150);
    await service.stopLive();
    const sent = transports[0].received.map((c) => c.replace(/\s+/g, '').toUpperCase());
    expect(sent.length).toBeGreaterThan(10);
    // le richieste OBD sono tutte Mode 01, 02, 03, 07, 09 o 0A; "04" da solo sarebbe la cancellazione dei codici
    expect(sent.filter((c) => c === '04')).toEqual([]);
    const obdRequests = sent.filter((c) => /^[0-9A-F]+$/.test(c));
    expect(obdRequests.every((c) => /^(01|02|03|07|09|0A)/.test(c))).toBe(true);
    await service.close();
  });
});

describe('createObdService: dati live ad auto ferma', () => {
  it('il piano comprende solo giri, temperatura liquido e tensioni', () => {
    const ids = STATIONARY_LIVE_PLAN.map((p) => p.pid);
    expect(ids).toEqual([0x0c, 0x05, 0x42, 'adapter-voltage']);
  });

  it('start/stop: arrivano campioni con giri e temperatura, lo stato "live" segue e onStop dice "stopped"', async () => {
    const { service } = build();
    await service.openDemo('petrol');
    const samples: LiveSample[] = [];
    const stops: string[] = [];
    const r = await service.startLive((s) => samples.push(s), { hz: 8, onStop: (reason) => stops.push(reason) });
    expect(r.ok).toBe(true);
    expect(service.getState().live).toBe(true);
    for (let i = 0; i < 40 && samples.length < 3; i++) await wait(50);
    await service.stopLive();
    expect(service.getState().live).toBe(false);
    expect(samples.length).toBeGreaterThanOrEqual(2);
    expect(samples[0].values.engine_rpm.source).toBe('read');
    expect(samples.some((s) => s.values.coolant_temp !== undefined)).toBe(true);
    expect(stops).toEqual(['stopped']);
    const n = samples.length;
    await wait(150);
    expect(samples.length).toBe(n);
    await service.close();
  });

  it('uno snapshot ferma il flusso live prima di leggere', async () => {
    const { service } = build();
    await service.openDemo('petrol');
    await service.startLive(() => undefined, { hz: 8 });
    expect(service.getState().live).toBe(true);
    const r = await service.snapshot();
    expect(r.ok).toBe(true);
    expect(service.getState().live).toBe(false);
    await service.close();
  });
});
