import { describe, expect, it } from 'vitest';
import {
  ElmSession,
  assessClone,
  parseElmVersion,
  parseVoltage,
  runAdapterInit,
  type InitOptions,
  type InitProgress,
} from '@/obd/session';
import { MockTransport, type TranscriptEntry } from '@/obd/transport/MockTransport';
import { SimulatedTransport } from '@/obd/transport/SimulatedTransport';
import { SCENARIOS, type ScenarioConfig, type ScenarioId } from '@/obd/transport/simulator/scenarios';
import { loadTranscript } from './helpers';

const FAST: InitOptions = { postResetDelayMs: 0, unableRetryDelayMs: 1, noDataRetryDelayMs: 1, searchTimeoutMs: 300 };

function mockInit(entries: TranscriptEntry[], opts: InitOptions = {}, sessionScale = 0.05) {
  const transport = new MockTransport(entries);
  const session = new ElmSession(transport, { recoveryMs: 30, timeoutScale: sessionScale });
  return { transport, session, run: async () => { await session.open(); return runAdapterInit(session, { ...FAST, ...opts }); } };
}

function simInit(scenario: ScenarioId | ScenarioConfig, opts: InitOptions = {}) {
  const transport = new SimulatedTransport({ scenario, latencyMs: 0, searchDelayMs: 0, chunkDelayMs: 0 });
  const session = new ElmSession(transport, { recoveryMs: 30, timeoutScale: 0.05 });
  return { transport, session, run: async () => { await session.open(); return runAdapterInit(session, { ...FAST, ...opts }); } };
}

const e = (cmd: string, ...rx: string[]): TranscriptEntry => ({ cmd, rx });
const OK = 'OK\r\r>';

/** Prefisso di init con risposte positive fino a ATSP0. */
function prefix(): TranscriptEntry[] {
  return [e('ATZ', 'ATZ\r\n\r\nELM327 v2.1\r\n\r\n>'), e('ATE0', 'ATE0\r\nOK\r\n\r\n>'), e('ATL0', 'OK\r\n\r\n>'), e('ATS0', OK), e('ATH1', OK), e('ATAT1', OK), e('ATRV', '12.4V\r\r>'), e('ATSP0', OK)];
}

const SUP_OK = '7E8064100BE3EB81100\r\r>';

describe('funzioni di supporto', () => {
  it('parseElmVersion', () => {
    expect(parseElmVersion(['ELM327 v1.5'])).toEqual({ banner: 'ELM327 v1.5', versionNumber: '1.5' });
    expect(parseElmVersion(['ELM327 v2.1'])).toMatchObject({ versionNumber: '2.1' });
    expect(parseElmVersion(['ELM327 v1.4b'])).toMatchObject({ versionNumber: '1.4b' });
    expect(parseElmVersion(['STN1110 v4.2.0'])).toEqual({});
    expect(parseElmVersion([])).toEqual({});
  });

  it('parseVoltage', () => {
    expect(parseVoltage(['12.4V'])).toBe(12.4);
    expect(parseVoltage(['14V'])).toBe(14);
    expect(parseVoltage(['12,4 V'])).toBe(12.4);
    expect(parseVoltage(['?'])).toBeUndefined();
    expect(parseVoltage([])).toBeUndefined();
  });

  it('assessClone: la v1.5 non esiste; v2.x senza ATAMC e\' un clone; i chip STN non lo sono', () => {
    expect(assessClone({ versionNumber: '1.5', isStn: false, amcSupported: false })).toEqual(['VERSION_1_5_DOES_NOT_EXIST']);
    expect(assessClone({ versionNumber: '2.1', isStn: false, amcSupported: false })).toEqual(['V2_WITHOUT_ATAMC']);
    expect(assessClone({ versionNumber: '2.1', isStn: false, amcSupported: true })).toEqual([]);
    expect(assessClone({ versionNumber: '1.4b', isStn: true, amcSupported: false })).toEqual([]);
    expect(assessClone({ versionNumber: '1.5', isStn: true, amcSupported: false })).toEqual([]);
    expect(assessClone({ versionNumber: undefined, isStn: false, amcSupported: null })).toEqual([]);
  });
});

describe('AdapterInit su trascrizioni', () => {
  it('adattatore genuino: sequenza ATZ ATE0 ATL0 ATS0 ATH1 ATAT1 ATRV ATSP0 0100 ATDPN ATI AT@1 STI ATAMC', async () => {
    const fx = loadTranscript('session-init-genuine.json');
    const progress: InitProgress[] = [];
    const { transport, run } = mockInit(fx.entries, { onProgress: (p) => progress.push(p) });
    const r = await run();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const v = r.value;
    expect(transport.written).toEqual(['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH1', 'ATAT1', 'ATRV', 'ATSP0', '0100', 'ATDPN', 'ATI', 'AT@1', 'STI', 'ATAMC'].map((c) => c + '\r'));
    expect(transport.unmatched).toEqual([]);
    expect(transport.maxInFlight).toBe(1);
    expect(v.protocol).toBe('6');
    expect(v.protocolAuto).toBe(true);
    expect(v.protocolName).toContain('CAN');
    expect(v.headers).toBe(true);
    expect(v.voltage).toBe(12.4);
    expect(v.ecus).toEqual(['7E8', '7E9']);
    expect(v.declared).toEqual([1, 3, 4, 5, 6, 7, 11, 12, 13, 14, 15, 17, 19, 20, 21, 28, 32]);
    expect(v.declaredByEcu['7E9']).toEqual([1, 4, 5, 12, 13, 32]);
    expect(v.adapter).toMatchObject({ versionNumber: '2.1', isStn: false, amcSupported: true, suspectedClone: false, description: 'OBDII to RS232 Interpreter' });
    expect(v.warnings).toEqual([]);
    expect(progress.map((p) => p.step)).toContain('search');
    expect(progress.every((p) => p.message.length > 0)).toBe(true);
  });

  it('clone v1.5: eco che resta, NUL, ATAMC/AT@1/STI = ?: sospetto clone', async () => {
    const fx = loadTranscript('session-init-clone.json');
    const { run } = mockInit(fx.entries);
    const r = await run();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.value.voltage).toBe(12.1);
    expect(r.value.ecus).toEqual(['7E8']);
    expect(r.value.adapter.suspectedClone).toBe(true);
    expect(r.value.adapter.cloneReasons).toEqual(['VERSION_1_5_DOES_NOT_EXIST']);
    expect(r.value.adapter.amcSupported).toBe(false);
    expect(r.value.adapter.description).toBeUndefined();
    expect(r.value.adapter.isStn).toBe(false);
  });

  it("ATH1 non supportato: ripiego ATH0, avviso e ECU non distinguibili", async () => {
    const entries = [
      e('ATZ', 'ELM327 v1.5\r\r>'),
      e('ATE0', OK),
      e('ATL0', OK),
      e('ATS0', OK),
      e('ATH1', '?\r\r>'),
      e('ATAT1', OK),
      e('ATRV', '12.4V\r\r>'),
      e('ATSP0', OK),
      e('0100', 'SEARCHING...\r41 00 BE 3E B8 11\r\r>'),
      e('ATDPN', 'A6\r\r>'),
    ];
    const { run } = mockInit(entries, { skipIdentification: true });
    const r = await run();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.value.headers).toBe(false);
    expect(r.value.warnings).toContain('HEADERS_UNSUPPORTED');
    expect(r.value.ecus).toEqual(['?']);
    expect(r.value.declared).toContain(0x0c);
  });

  it("comandi di configurazione che rispondono ? non abortiscono (ATL0, ATS0, ATAT1, ATRV)", async () => {
    const entries = [
      e('ATZ', 'ELM327 v1.4\r\r>'),
      e('ATE0', OK),
      e('ATL0', '?\r\r>'),
      e('ATS0', '?\r\r>'),
      e('ATH1', OK),
      e('ATAT1', '?\r\r>'),
      e('ATRV', '?\r\r>'),
      e('ATSP0', OK),
      e('0100', '7E8 06 41 00 BE 3E B8 11 00\r\r>'),
      e('ATDPN', 'A6\r\r>'),
    ];
    const { run } = mockInit(entries, { skipIdentification: true });
    const r = await run();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.value.warnings).toEqual(expect.arrayContaining(['LINEFEED_NOT_DISABLED', 'SPACES_NOT_DISABLED', 'VOLTAGE_UNAVAILABLE']));
    expect(r.value.voltage).toBeUndefined();
    expect(r.value.ecus).toEqual(['7E8']); // con spazi attivi il formato resta valido
  });

  it("UNABLE TO CONNECT: riprova al massimo 'unableRetries' volte, poi errore con suggerimento 'quadro'", async () => {
    const unable = 'SEARCHING...\rUNABLE TO CONNECT\r\r>';
    const entries = [...prefix(), e('0100', unable), e('0100', unable)];
    const { transport, run } = mockInit(entries, { unableRetries: 1 });
    const r = await run();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNABLE_TO_CONNECT');
    expect(r.error.hint).toBe('ignition');
    expect(r.error.step).toBe('search');
    expect(r.error.message).toMatch(/accensione|quadro/i);
    expect(transport.written.filter((w) => w === '0100\r')).toHaveLength(2);
  });

  it('UNABLE TO CONNECT poi successo al secondo tentativo', async () => {
    const entries = [...prefix(), e('0100', 'SEARCHING...\rUNABLE TO CONNECT\r\r>'), e('0100', 'SEARCHING...\r' + SUP_OK), e('ATDPN', 'A6\r\r>')];
    const { run } = mockInit(entries, { skipIdentification: true, unableRetries: 1 });
    const r = await run();
    expect(r.ok).toBe(true);
  });

  it('NO DATA su 0100: un solo tentativo in piu\' (ECU in sleep), poi NO_DATA', async () => {
    const entries = [...prefix(), e('0100', 'NO DATA\r\r>'), e('0100', 'NO DATA\r\r>')];
    const { transport, run } = mockInit(entries, { skipIdentification: true });
    const r = await run();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('NO_DATA');
      expect(r.error.hint).toBe('ignition');
    }
    expect(transport.written.filter((w) => w === '0100\r').length).toBe(2);
  });

  it('ERR94: ATFE e un nuovo tentativo; se persiste, adattatore da ricollegare', async () => {
    const ok = [...prefix(), e('0100', 'ERR94\r\r>'), e('ATFE', OK), e('0100', SUP_OK), e('ATDPN', 'A6\r\r>')];
    const a = mockInit(ok, { skipIdentification: true });
    const ra = await a.run();
    expect(ra.ok).toBe(true);
    expect(a.transport.written).toContain('ATFE\r');

    const bad = [...prefix(), e('0100', 'ERR94\r\r>'), e('ATFE', OK), e('0100', 'ERR94\r\r>')];
    const b = mockInit(bad, { skipIdentification: true });
    const rb = await b.run();
    expect(rb.ok).toBe(false);
    if (!rb.ok) {
      expect(rb.error.code).toBe('ADAPTER_RESET');
      expect(rb.error.hint).toBe('unplug');
    }
  });

  it('LV RESET: nessun ritentativo, adattatore da ricollegare', async () => {
    const { run } = mockInit([...prefix(), e('0100', 'LV RESET\r\r>')], { skipIdentification: true });
    const r = await run();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ADAPTER_RESET');
  });

  it("l'adattatore non risponde ad ATZ: NO_RESPONSE", async () => {
    const { run } = mockInit([e('ATZ'), e('ATZ')]);
    const r = await run();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('NO_RESPONSE');
      expect(r.error.step).toBe('reset');
      expect(r.error.hint).toBe('adapter');
    }
  });

  it('protocollo ripiego opt-in: ATTP6 dopo UNABLE TO CONNECT', async () => {
    const entries = [...prefix(), e('0100', 'SEARCHING...\rUNABLE TO CONNECT\r\r>'), e('ATTP6', OK), e('0100', SUP_OK), e('ATDPN', '6\r\r>')];
    const { transport, run } = mockInit(entries, { skipIdentification: true, unableRetries: 0, tryFallbackProtocols: true, fallbackProtocols: ['6'] });
    const r = await run();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) {
      expect(r.value.protocol).toBe('6');
      expect(r.value.protocolAuto).toBe(false);
    }
    expect(transport.written).toContain('ATTP6\r');
  });

  it('nessun comando di scrittura nella sequenza di init', async () => {
    const fx = loadTranscript('session-init-genuine.json');
    const { transport, run } = mockInit(fx.entries);
    await run();
    for (const w of transport.written) {
      const c = w.replace(/\r/g, '');
      expect(/^(04|08|14|2E|31|10|11|27)/.test(c), c).toBe(false);
    }
  });
});

describe('AdapterInit contro SimulatedTransport', () => {
  it('petrol: init riuscito in pochi comandi, CAN 11 bit, due ECU, adattatore genuino', async () => {
    const { transport, run } = simInit('petrol');
    const r = await run();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.value.protocol).toBe('6');
    expect(r.value.headers).toBe(true);
    expect(r.value.ecus).toEqual(['7E8', '7E9']);
    expect(r.value.adapter.suspectedClone).toBe(false);
    expect(r.value.adapter.amcSupported).toBe(true);
    expect(r.value.voltage).toBeGreaterThan(13);
    expect(transport.interruptions).toBe(0);
    expect(transport.received.slice(0, 3)).toEqual(['ATZ', 'ATE0', 'ATL0']);
  });

  it('clone: init riuscito con eco residuo e NUL; riconosciuto come clone', async () => {
    const { transport, run } = simInit('clone');
    const r = await run();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.value.adapter.suspectedClone).toBe(true);
    expect(r.value.adapter.amcSupported).toBe(false);
    expect(r.value.ecus).toEqual(['7E8']);
    expect(transport.interruptions).toBe(0);
  });

  it('kline-slow (ISO 9141-2): protocollo 3, messaggi con intestazione non CAN', async () => {
    const { run } = simInit('kline-slow');
    const r = await run();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.value.protocol).toBe('3');
    expect(r.value.protocolName).toContain('9141');
    expect(r.value.ecus).toEqual(['11']);
  });

  it('quadro spento: UNABLE_TO_CONNECT con suggerimento; acceso il quadro, il secondo tentativo riesce', async () => {
    const a = simInit('ignition-off');
    const r = await a.run();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('UNABLE_TO_CONNECT');
      expect(r.error.hint).toBe('ignition');
    }
    a.transport.setIgnition(true);
    const again = await runAdapterInit(a.session, { ...FAST });
    expect(again.ok, JSON.stringify(again)).toBe(true);
  });

  it('protocollo salvato: ATTPA6 al posto di ATSP0 (non scrive in EEPROM a ogni sessione)', async () => {
    const { transport, run } = simInit('petrol', { savedProtocol: '6' });
    const r = await run();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(transport.received).toContain('ATTPA6');
    expect(transport.received).not.toContain('ATSP0');
    if (r.ok) expect(r.value.protocol).toBe('6');
  });

  it("protocollo salvato diverso da quello dell'auto: ATTPA ripiega da solo sulla ricerca automatica", async () => {
    const sc: ScenarioConfig = { ...SCENARIOS.petrol };
    const transport = new SimulatedTransport({ scenario: sc });
    const session = new ElmSession(transport, { recoveryMs: 30, timeoutScale: 0.05 });
    await session.open();
    // ATTP7 senza ripiego automatico non e' selezionabile da AdapterInit: si prova 'A7' = automatico; l'auto e' 11 bit
    const r = await runAdapterInit(session, { ...FAST, savedProtocol: '7' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.value.protocol).toBe('6');
  });

  it('init ripetibile (riconnessione): ATZ riporta tutto ai valori iniziali', async () => {
    const { session, run } = simInit('petrol');
    const first = await run();
    const second = await runAdapterInit(session, { ...FAST });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.value.declared).toEqual(first.value.declared);
  });
});
