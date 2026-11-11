import { describe, expect, it } from 'vitest';
import {
  ObdConnection,
  PROVENANCE_LABEL_IT,
  enteredReading,
  estimatedReading,
  exportCapabilityReport,
  preferReading,
  readReading,
  type LiveSample,
  type LiveStopReason,
} from '@/obd/session';
import { SimulatedTransport } from '@/obd/transport/SimulatedTransport';
import { SCENARIOS, type ScenarioConfig, type ScenarioId } from '@/obd/transport/simulator/scenarios';

const clock = { nowIso: () => '2026-10-08T10:00:00.000Z' };
const FAST = { postResetDelayMs: 0, unableRetryDelayMs: 1, noDataRetryDelayMs: 1, searchTimeoutMs: 300 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connect(scenario: ScenarioId | ScenarioConfig, topts: ConstructorParameters<typeof SimulatedTransport>[0] = {}) {
  const transport = new SimulatedTransport({ scenario, latencyMs: 0, searchDelayMs: 0, chunkDelayMs: 0, ...topts });
  const conn = new ObdConnection({ transport, session: { recoveryMs: 30, timeoutScale: 0.05 }, init: FAST, clock });
  const r = await conn.open();
  if (!r.ok) throw new Error('init fallito: ' + JSON.stringify(r.error));
  const vehicle = conn.vehicle;
  if (!vehicle) throw new Error('nessun VehicleService');
  return { transport, conn, vehicle };
}

describe('provenienza dei dati', () => {
  it('etichette italiane e priorita\' inserito > letto > stimato', () => {
    expect(PROVENANCE_LABEL_IT.read).toBe("Letto dall'auto");
    expect(PROVENANCE_LABEL_IT.estimated).toBe('Stimato');
    expect(PROVENANCE_LABEL_IT.entered).toBe('Inserito da te');
    const read = readReading(1000, '2026-10-01T00:00:00.000Z', '7E8');
    const est = estimatedReading(1100, '2026-10-02T00:00:00.000Z', 'velocita integrata');
    const ent = enteredReading(900, '2026-09-01T00:00:00.000Z');
    expect(read.source).toBe('read');
    expect(est.basis).toBe('velocita integrata');
    expect(preferReading(est, ent)).toBe(ent);
    expect(preferReading(read, est)).toBe(read);
    expect(preferReading(read, ent)).toBe(ent);
    const later = readReading(1200, '2026-10-05T00:00:00.000Z');
    expect(preferReading(read, later)).toBe(later);
  });
});

describe('VehicleService.readSnapshot', () => {
  it('benzina: VIN, spia spenta, nessun codice, PID chiave, tensione; tutto "letto" e nessun problema', async () => {
    const { transport, vehicle, conn } = await connect('petrol');
    const steps: string[] = [];
    const snap = await vehicle.readSnapshot({ onProgress: (s) => steps.push(s) });
    expect(snap.vin?.value).toBe('ZFA19900001234567');
    expect(snap.vin?.source).toBe('read');
    expect(snap.vin?.ecu).toBe('7E8');
    expect(snap.vinStatus).toBe('ok');
    expect(snap.status?.value.milOn).toBe(false);
    expect(snap.status?.value.dtcCount).toBe(0);
    expect(snap.status?.value.ready).toBe(true);
    expect(snap.dtc.stored).toMatchObject({ status: 'ok', codes: [] });
    expect(snap.dtc.pending.status).toBe('ok');
    expect(snap.dtc.permanent.status).toBe('ok');
    expect(snap.freezeFrame).toBeNull();
    expect(snap.freezeFrameStatus).toBe('skipped');
    expect(Object.keys(snap.pids)).toEqual(expect.arrayContaining(['engine_rpm', 'vehicle_speed', 'coolant_temp', 'engine_load', 'fuel_level', 'control_module_voltage']));
    expect(snap.pids.coolant_temp.source).toBe('read');
    expect(snap.pids.engine_rpm.value.unit).toBe('giri/min');
    expect(snap.pids.odometer).toBeUndefined();
    expect(snap.adapterVoltage?.value).toBeGreaterThan(13);
    expect(snap.issues).toEqual([]);
    expect(snap.readAt).toBe(clock.nowIso());
    expect(steps[0]).toBe('VIN');
    // nessun comando di scrittura e una sola richiesta alla volta
    expect(transport.received.some((c) => /^(04|08|14|2E)/.test(c))).toBe(false);
    expect(transport.interruptions).toBe(0);
    await conn.close();
  });

  it('spia accesa: codici memorizzati/pendenti/permanenti per ECU, monitor EVAP non pronto, freeze frame', async () => {
    const { vehicle, conn } = await connect('mil-on');
    const snap = await vehicle.readSnapshot();
    expect(snap.status?.value.milOn).toBe(true);
    expect(snap.status?.value.dtcCount).toBe(3);
    expect(snap.status?.value.incomplete.map((m) => m.id)).toEqual(['evap']);
    expect(snap.dtc.stored.codes).toEqual(['P0420', 'P0301', 'P0171']);
    expect(snap.dtc.stored.byEcu.map((e) => e.ecu)).toEqual(['7E8', '7E9']);
    expect(snap.dtc.stored.byEcu[1].codes).toEqual([]);
    expect(snap.dtc.pending.codes).toEqual(['P0171']);
    expect(snap.dtc.permanent.codes).toEqual(['P0420']);
    expect(snap.freezeFrameStatus).toBe('ok');
    expect(snap.freezeFrame?.value.dtc).toBe('P0420');
    const ff = Object.fromEntries((snap.freezeFrame?.value.values ?? []).map((v) => [v.id, v.value]));
    expect(ff.coolant_temp).toBe(88);
    expect(ff.engine_rpm).toBe(2100);
    expect(ff.vehicle_speed).toBe(55);
    expect(snap.issues).toEqual([]);
    await conn.close();
  });

  it('auto datata (K-line): niente VIN ne\' codici permanenti, spia e due codici letti con intestazioni non CAN', async () => {
    const { vehicle, conn } = await connect('kline-slow');
    const snap = await vehicle.readSnapshot();
    expect(snap.vin).toBeNull();
    expect(snap.vinStatus).toBe('unsupported');
    expect(snap.status?.value.milOn).toBe(true);
    expect(snap.dtc.stored.codes).toEqual(['P0133', 'P0300']);
    expect(snap.dtc.permanent.status).toBe('unsupported');
    expect(snap.dtc.pending).toMatchObject({ status: 'ok', codes: [] });
    expect(snap.pids.engine_rpm).toBeDefined();
    expect(snap.pids.fuel_level).toBeUndefined(); // 2F non dichiarato
    expect(snap.issues).toEqual([]);
    await conn.close();
  });

  it('diesel: odometro e tipo di carburante con etichetta; i valori sono "letti"', async () => {
    const { vehicle, conn } = await connect('diesel');
    const snap = await vehicle.readSnapshot();
    expect(snap.pids.odometer.value.value).toBeCloseTo(123456.7, 1);
    expect(snap.pids.odometer.source).toBe('read');
    expect(snap.pids.fuel_type.value.label).toBe('Diesel');
    expect(snap.pids.oil_temp).toBeDefined();
    expect(snap.dtc.pending.codes).toEqual(['P2002']);
    await conn.close();
  });

  it('con il report di capacita\' salta cio\' che l\'auto non ha (meno richieste)', async () => {
    const { transport, vehicle, conn } = await connect('kline-slow');
    const caps = await vehicle.discoverCapabilities();
    const before = transport.received.length;
    const snap = await vehicle.readSnapshot({ capabilities: caps });
    const sent = transport.received.slice(before);
    expect(sent).not.toContain('0902'); // VIN: no_data nel report
    expect(sent).not.toContain('0A'); // permanenti: no_data nel report
    expect(snap.vinStatus).toBe('skipped');
    expect(snap.dtc.permanent.status).toBe('unsupported');
    await conn.close();
  });

  it('un passo che fallisce diventa un avviso, non interrompe lo snapshot', async () => {
    const sc: ScenarioConfig = { ...SCENARIOS.petrol, glitches: [{ every: 2, reply: 'CAN ERROR' }] };
    const { vehicle, conn } = await connect(sc);
    const snap = await vehicle.readSnapshot();
    expect(snap.issues.length).toBeGreaterThan(0);
    expect(snap.issues.every((i) => typeof i.error.code === 'string')).toBe(true);
    expect(snap.finishedAt).toBeDefined();
    await conn.close();
  });
});

describe('VehicleService.discoverCapabilities (F-59)', () => {
  it('benzina: dichiarato E risposto, gli altri no; checklist onesta', async () => {
    const { vehicle, conn } = await connect('petrol');
    const r = await vehicle.discoverCapabilities();
    expect(r.version).toBe(1);
    expect(r.protocol).toMatchObject({ id: '6', auto: true, headers: true });
    expect(r.ecus).toEqual(['7E8', '7E9']);
    expect(r.adapter.suspectedClone).toBe(false);
    const byPid = Object.fromEntries(r.pids.map((p) => [p.pid, p]));
    expect(byPid[0x0c]).toMatchObject({ declared: true, answered: true, supported: true, ecu: '7E8' });
    expect(byPid[0x2f]).toMatchObject({ declared: true, answered: true, supported: true });
    expect(byPid[0x5c]).toMatchObject({ declared: false, answered: false, supported: false });
    expect(byPid[0xa6]).toMatchObject({ declared: false, answered: false, supported: false });
    expect(r.services).toEqual({ vin: 'answers', status: 'answers', dtcStored: 'answers', dtcPending: 'answers', dtcPermanent: 'answers', freezeFrame: 'untested' });
    const item = (k: string) => r.checklist.find((c) => c.key === k);
    expect(item('vin')?.available).toBe(true);
    expect(item('engine_rpm')?.available).toBe(true);
    expect(item('fuel_level')?.available).toBe(true);
    expect(item('odometer')).toMatchObject({ available: false, detail: 'Non disponibile su questa auto.' });
    expect(item('oil_temp')?.available).toBe(false);
    expect(item('freeze_frame')?.available).toBe(false);
    expect(item('freeze_frame')?.detail).toMatch(/codice/);
    expect(item('adapter_voltage')?.available).toBe(true);
    expect(r.notes).toEqual([]);
    await conn.close();
  });

  it('spia accesa: il freeze frame risulta verificato', async () => {
    const { vehicle, conn } = await connect('mil-on');
    const r = await vehicle.discoverCapabilities();
    expect(r.services.freezeFrame).toBe('answers');
    expect(r.checklist.find((c) => c.key === 'freeze_frame')?.available).toBe(true);
    await conn.close();
  });

  it("dichiarato ma silenzioso: 'declared' senza 'supported' (alcune ECU dichiarano e poi rispondono NO DATA)", async () => {
    const sc: ScenarioConfig = {
      ...SCENARIOS.petrol,
      odometerKm: null, // l'ECU dichiara 01A6 ma non risponde
      ecus: [{ ...SCENARIOS.petrol.ecus[0], pids: [...SCENARIOS.petrol.ecus[0].pids, 0xa6] }, SCENARIOS.petrol.ecus[1]],
    };
    const { vehicle, conn } = await connect(sc);
    const r = await vehicle.discoverCapabilities();
    const odo = r.pids.find((p) => p.pid === 0xa6);
    expect(odo).toMatchObject({ declared: true, answered: false, supported: false });
    expect(r.checklist.find((c) => c.key === 'odometer')).toMatchObject({ available: false, detail: "L'auto lo dichiara ma non risponde." });
    await conn.close();
  });

  it('PID non dichiarato ma che risponde: risposto senza essere "supportato" (non si promette)', async () => {
    // Un'ECU che risponde a 012F senza dichiararlo: simulata togliendo 2F dalla maschera ma lasciandolo rispondere.
    const sc: ScenarioConfig = { ...SCENARIOS.petrol, ecus: [{ ...SCENARIOS.petrol.ecus[0], pids: SCENARIOS.petrol.ecus[0].pids.filter((p) => p !== 0x2f) }, SCENARIOS.petrol.ecus[1]] };
    const { vehicle, conn } = await connect(sc);
    const r = await vehicle.discoverCapabilities();
    const p = r.pids.find((x) => x.pid === 0x2f);
    expect(p?.declared).toBe(false);
    expect(p?.answered).toBe(false); // la sonda NO DATA: il simulatore risponde solo ai PID che ha
    expect(p?.supported).toBe(false);
    await conn.close();
  });

  it('K-line: VIN e permanenti no_data, checklist coerente; clone: avvertenza in italiano', async () => {
    const k = await connect('kline-slow');
    const r = await k.vehicle.discoverCapabilities();
    expect(r.services.vin).toBe('no_data');
    expect(r.services.dtcPermanent).toBe('no_data');
    expect(r.checklist.find((c) => c.key === 'vin')?.available).toBe(false);
    await k.conn.close();

    const c = await connect('clone');
    const rc = await c.vehicle.discoverCapabilities();
    expect(rc.adapter.suspectedClone).toBe(true);
    expect(rc.notes.join(' ')).toMatch(/clone/i);
    await c.conn.close();
  });

  it('il file di report non contiene VIN, targa ne\' valori letti', async () => {
    const { vehicle, conn } = await connect('diesel');
    const r = await vehicle.discoverCapabilities();
    expect(r.pids.find((p) => p.pid === 0xa6)?.sample).toBeCloseTo(123456.7, 1);
    const text = exportCapabilityReport(r);
    expect(text).not.toContain('WVWZZZ');
    expect(text).not.toContain('sample');
    expect(text).not.toContain('123456');
    const parsed = JSON.parse(text);
    expect(parsed.version).toBe(1);
    expect(parsed.pids.length).toBe(r.pids.length);
    expect(Object.keys(parsed)).not.toContain('vin');
    await conn.close();
  });
});

describe('VehicleService.liveStream (F-61)', () => {
  it('4-8 Hz: giri e velocita\' a ogni ciclo, le temperature ogni 10 cicli; tutto "letto"', async () => {
    const { vehicle, conn, transport } = await connect('petrol');
    const samples: LiveSample[] = [];
    const h = vehicle.liveStream({ hz: 8, onSample: (s) => samples.push(s) });
    expect(h.running).toBe(true);
    await wait(750);
    const reason = await h.stop();
    expect(reason).toBe('stopped');
    expect(h.running).toBe(false);
    expect(samples.length).toBeGreaterThanOrEqual(3);
    expect(samples.length).toBeLessThanOrEqual(7); // 8 Hz al massimo
    expect(samples.map((s) => s.cycle)).toEqual(samples.map((_, i) => i));
    expect(Object.keys(samples[0].values)).toEqual(expect.arrayContaining(['engine_rpm', 'vehicle_speed', 'coolant_temp', 'fuel_level']));
    expect(samples[0].adapterVoltage?.source).toBe('read');
    expect(Object.keys(samples[1].values)).toEqual(expect.arrayContaining(['engine_rpm', 'vehicle_speed']));
    expect(samples[1].values.coolant_temp).toBeUndefined();
    // distanza tra campioni >= 125 ms (8 Hz)
    for (let i = 1; i < samples.length; i++) expect(samples[i].elapsedMs - samples[i - 1].elapsedMs).toBeGreaterThanOrEqual(100);
    expect(transport.interruptions).toBe(0);
    await conn.close();
  });

  it('un comando utente passa avanti al polling senza interromperlo', async () => {
    const { vehicle, conn, transport } = await connect('petrol');
    const samples: LiveSample[] = [];
    const h = vehicle.liveStream({ hz: 8, onSample: (s) => samples.push(s) });
    await wait(150);
    const st = await vehicle.readStatus('user');
    expect(st.ok).toBe(true);
    const dtc = await vehicle.readDtcs(0x03, 'user');
    expect(dtc.ok).toBe(true);
    await h.stop();
    expect(transport.interruptions).toBe(0);
    await conn.close();
  });

  it('multi-PID (solo CAN): piu\' PID per richiesta, stessi valori', async () => {
    const single = await connect('petrol');
    const multi = await connect('petrol');
    const a: LiveSample[] = [];
    const b: LiveSample[] = [];
    const ha = single.vehicle.liveStream({ hz: 8, onSample: (s) => a.push(s) });
    const hb = multi.vehicle.liveStream({ hz: 8, multiPid: true, onSample: (s) => b.push(s) });
    await wait(450);
    await ha.stop();
    await hb.stop();
    expect(b.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(b[0].values).sort()).toEqual(Object.keys(a[0].values).sort());
    const multiRequests = multi.transport.received.filter((c) => /^01[0-9A-F]{4,}$/.test(c) && c.length > 4);
    expect(multiRequests.length).toBeGreaterThan(0);
    expect(multiRequests[0].length).toBeLessThanOrEqual(2 + 2 * 6);
    expect(b[0].values.engine_rpm.value.value).toBeGreaterThan(500);
    await single.conn.close();
    await multi.conn.close();
  });

  it('un PID che l\'auto non restituisce esce dal piano dopo qualche fallimento', async () => {
    const sc: ScenarioConfig = {
      ...SCENARIOS.petrol,
      odometerKm: null,
      ecus: [{ ...SCENARIOS.petrol.ecus[0], pids: [...SCENARIOS.petrol.ecus[0].pids, 0xa6] }, SCENARIOS.petrol.ecus[1]],
    };
    const { vehicle, conn } = await connect(sc);
    const samples: LiveSample[] = [];
    const h = vehicle.liveStream({
      hz: 8,
      maxFailures: 2,
      plan: [
        { pid: 0x0c, every: 1 },
        { pid: 0xa6, every: 1 },
      ],
      onSample: (s) => samples.push(s),
    });
    await wait(700);
    await h.stop();
    expect(samples.length).toBeGreaterThanOrEqual(3);
    expect(samples[0].values.odometer).toBeUndefined();
    expect(samples[samples.length - 1].dropped).toEqual([0xa6]);
    expect(samples[0].dropped).toEqual([]);
    await conn.close();
  });

  it('piano senza PID dichiarati: si ferma subito con no-pids', async () => {
    const { vehicle, conn } = await connect('petrol');
    let reason: LiveStopReason | undefined;
    const h = vehicle.liveStream({ plan: [{ pid: 0x5c, every: 1 }], onSample: () => undefined, onStop: (r) => (reason = r) });
    expect(await h.done).toBe('no-pids');
    expect(reason).toBe('no-pids');
    await conn.close();
  });

  it('sui protocolli J1850 il tetto scende e c\'e\' una pausa di 100 ms tra le richieste (datasheet p.32)', async () => {
    const sc: ScenarioConfig = {
      ...SCENARIOS['kline-slow'],
      protocol: '2',
      latencyMs: 0,
      searchDelayMs: 0,
      ecus: [{ ...SCENARIOS['kline-slow'].ecus[0], id: '10' }],
    };
    const { vehicle, conn } = await connect(sc);
    const samples: LiveSample[] = [];
    const h = vehicle.liveStream({ hz: 8, plan: [{ pid: 0x0c, every: 1 }, { pid: 0x0d, every: 1 }], onSample: (s) => samples.push(s) });
    await wait(650);
    await h.stop();
    expect(samples.length).toBeGreaterThanOrEqual(2);
    expect(samples.length).toBeLessThanOrEqual(3); // 2 richieste da 100 ms ciascuna per ciclo
    for (let i = 1; i < samples.length; i++) expect(samples[i].elapsedMs - samples[i - 1].elapsedMs).toBeGreaterThanOrEqual(190);
    await conn.close();
  });

  it('se il collegamento cade lo stream si ferma con link-lost', async () => {
    const sc: ScenarioConfig = { ...SCENARIOS.petrol, dropAfterRequests: 12 };
    const { vehicle, conn } = await connect(sc);
    const stops: string[] = [];
    const h = vehicle.liveStream({ hz: 8, onSample: () => undefined, onStop: (r) => stops.push(r) });
    const reason = await h.done;
    expect(reason).toBe('link-lost');
    expect(stops).toEqual(['link-lost']);
    await conn.close();
  });
});

describe('letture singole', () => {
  it('readPid sceglie l\'ECU motore anche se risponde il cambio; PID assente = unsupported', async () => {
    const { vehicle, conn } = await connect('petrol');
    const rpm = await vehicle.readPid(0x0c);
    expect(rpm.ok && rpm.ecu).toBe('7E8');
    const none = await vehicle.readPid(0x5c);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.kind).toBe('unsupported');
    const v = await vehicle.readAdapterVoltage();
    expect(v.ok).toBe(true);
    await conn.close();
  });

  it('i comandi di scrittura non sono raggiungibili dal servizio (la sessione li blocca)', async () => {
    const { conn, transport } = await connect('mil-on');
    const r = await conn.session.send('04');
    expect(r.error?.code).toBe('WRITE_BLOCKED');
    expect(transport.received).not.toContain('04');
    const status = await conn.vehicle?.readStatus();
    expect(status?.ok && status.value.dtcCount).toBe(3); // i codici sono ancora li'
    await conn.close();
  });

  it('errore di comunicazione = kind error, non unsupported', async () => {
    const sc: ScenarioConfig = { ...SCENARIOS.petrol, glitches: [{ every: 1, reply: 'CAN ERROR' }] };
    const transport = new SimulatedTransport({ scenario: sc, latencyMs: 0 });
    const conn = new ObdConnection({ transport, session: { recoveryMs: 30, timeoutScale: 0.05 }, init: FAST, clock });
    // l'init fallisce perche' 0100 da' sempre CAN ERROR
    const r = await conn.open();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BUS_ERROR');
    await conn.close();
  });
});
