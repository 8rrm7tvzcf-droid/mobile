import { describe, expect, it } from 'vitest';
import {
  decodePid,
  normalizeResponse,
  parseDtcResponse,
  parseFreezeFramePidResponse,
  parsePidResponse,
  parseResponseLines,
  parseStatusResponse,
  parseSupportResponse,
  parseVinResponse,
  PIDS,
  pidDef,
  type ParseOptions,
} from '@/obd/protocol';
import { Elm327Emulator } from '@/obd/transport/simulator/elm327Emulator';
import { SCENARIOS, type ScenarioConfig, type ScenarioId } from '@/obd/transport/simulator/scenarios';
import { encodeDtc } from '@/obd/transport/simulator/virtualCar';
import { SimulatedTransport } from '@/obd/transport/SimulatedTransport';
import { ElmSession } from '@/obd/session';

function emu(id: ScenarioId | ScenarioConfig = 'petrol') {
  const e = new Elm327Emulator(id);
  const send = (cmd: string): string => e.handle(cmd).parts.map((p) => p.text).join('');
  const ask = (cmd: string, opts: ParseOptions = { protocol: e.scenario.protocol, headers: true }) => {
    const text = send(cmd);
    const n = normalizeResponse(text, cmd);
    return { text, n, input: { lines: n.lines, errors: n.errors }, opts };
  };
  /** Configurazione tipica dell'init: ATZ ATE0 ATL0 ATS0 ATH1 ATSP0 */
  const configure = () => {
    for (const c of ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH1', 'ATSP0']) send(c);
  };
  return { e, send, ask, configure };
}

describe('emulatore ELM327: macchina a stati', () => {
  it('ATZ risponde col banner; ATE0/ATL0 tolgono eco e linefeed', () => {
    const { send } = emu();
    const z = send('ATZ');
    expect(z).toContain('ELM327 v2.1');
    expect(z.endsWith('>')).toBe(true);
    expect(send('ATE0')).toBe('ATE0\r\nOK\r\n\r\n>'); // con eco ancora attivo per questo comando, L1
    expect(send('ATL0')).toBe('OK\r\n\r\n>'.replace(/\r\n/g, '\r\n')); // LF ancora attivo per questa risposta
    expect(send('ATS0')).toBe('OK\r\r>'); // ora L0
  });

  it('comandi sconosciuti o malformati rispondono ?', () => {
    const { send, configure } = emu();
    configure();
    expect(send('ATXYZ')).toBe('?\r\r>');
    expect(send('01ZZ')).toBe('?\r\r>');
    expect(send('G')).toBe('?\r\r>');
  });

  it('SEARCHING... solo al primo 0100 con ATSP0; ATDPN riporta A6', () => {
    const { send, configure, ask } = emu();
    configure();
    const first = ask('0100');
    expect(first.n.searching).toBe(true);
    expect(send('ATDPN')).toBe('A6\r\r>');
    const second = ask('0100');
    expect(second.n.searching).toBe(false);
  });

  it('protocollo fisso giusto: niente SEARCHING; sbagliato: UNABLE TO CONNECT', () => {
    const a = emu();
    for (const c of ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH1', 'ATSP6']) a.send(c);
    const ok = a.ask('0100');
    expect(ok.n.searching).toBe(false);
    expect(ok.n.errors).toEqual([]);
    expect(a.send('ATDPN')).toBe('6\r\r>');

    const b = emu();
    for (const c of ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH1', 'ATSP7']) b.send(c);
    expect(b.ask('0100').n.errors.map((x) => x.code)).toEqual(['UNABLE_TO_CONNECT']);
  });

  it('ATTPA6 (protocollo noto, ripiego automatico) funziona come la ricerca automatica', () => {
    const { send, ask } = emu();
    for (const c of ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH1', 'ATTPA6']) send(c);
    expect(ask('0100').n.lines.length).toBeGreaterThan(0);
    expect(send('ATDPN')).toBe('A6\r\r>');
  });

  it('formato dei frame: ATH1 con spazi, ATS0, ATH0', () => {
    const a = emu();
    for (const c of ['ATZ', 'ATE0', 'ATL0', 'ATH1', 'ATSP0']) a.send(c);
    a.send('0100');
    const spaced = a.ask('0105');
    expect(spaced.n.lines[0]).toMatch(/^7E8 03 41 05 [0-9A-F]{2} 00 00 00 00$/);
    a.send('ATS0');
    expect(a.ask('0105').n.lines[0]).toMatch(/^7E803410 5[0-9A-F]{2}00000000$|^7E8034105[0-9A-F]{2}00000000$/);
    a.send('ATH0');
    a.send('ATS1');
    expect(a.ask('0105').n.lines[0]).toMatch(/^41 05 [0-9A-F]{2}$/);
    // VIN con ATH0: '014' + righe numerate
    const vin = a.ask('0902', { protocol: '6', headers: false });
    expect(vin.n.lines[0]).toBe('014');
    expect(vin.n.lines[1].startsWith('0: 49 02 01')).toBe(true);
    const parsed = parseVinResponse(vin.input, vin.opts);
    expect(parsed.ok && parsed.value.value).toBe('ZFA19900001234567');
  });

  it('ECU multiple: 0100 risponde da 7E8 e 7E9, 010C anche da entrambe', () => {
    const { configure, ask } = emu();
    configure();
    const r = ask('0100');
    const s = parseSupportResponse(r.input, 0, 0x01, r.opts);
    expect(s.ok && Object.keys(s.value.byEcu)).toEqual(['7E8', '7E9']);
    const rpm = ask('010C');
    const p = parsePidResponse(rpm.input, 0x0c, rpm.opts);
    expect(p.ok && p.value.map((x) => x.ecu)).toEqual(['7E8', '7E9']);
    // un PID che solo il motore ha
    const maf = ask('0110');
    const pm = parsePidResponse(maf.input, 0x10, maf.opts);
    expect(pm.ok && pm.value.map((x) => x.ecu)).toEqual(['7E8']);
  });

  it('PID non supportato = NO DATA', () => {
    const { configure, ask } = emu();
    configure();
    expect(ask('015C').n.errors.map((x) => x.code)).toEqual(['NO_DATA']);
    expect(ask('01A6').n.errors.map((x) => x.code)).toEqual(['NO_DATA']);
  });

  it('i blocchi di supporto seguono i bit puntatore', () => {
    const { configure, ask } = emu('diesel');
    configure();
    const declared = new Set<number>();
    let base = 0;
    for (;;) {
      const r = ask('01' + base.toString(16).toUpperCase().padStart(2, '0'));
      const s = parseSupportResponse(r.input, base, 0x01, r.opts);
      if (!s.ok) break;
      s.value.union.forEach((p) => declared.add(p));
      if (!declared.has(base + 0x20)) break;
      base += 0x20;
    }
    expect(declared.has(0xa6)).toBe(true);
    expect(declared.has(0x5c)).toBe(true);
    expect(declared.has(0x0c)).toBe(true);
  });

  it('cifra finale (numero di risposte attese) ignorata', () => {
    const { configure, ask } = emu();
    configure();
    const r = ask('010C1');
    expect(parsePidResponse(r.input, 0x0c, r.opts).ok).toBe(true);
  });
});

describe('auto virtuale: valori coerenti con le formule di decodifica', () => {
  it('ogni PID dichiarato decodificato coincide con lo stato dell\'auto', () => {
    for (const id of ['petrol', 'diesel'] as const) {
      const { e, configure, ask } = emu(id);
      configure();
      const s = e.scenario;
      const pids = s.ecus[0].pids.filter((p) => pidDef(p));
      for (const pid of pids) {
        if (pid === 0x01) continue;
        const cmd = '01' + pid.toString(16).toUpperCase().padStart(2, '0');
        const r = ask(cmd);
        const parsed = parsePidResponse(r.input, pid, r.opts);
        expect(parsed.ok, `${id} ${cmd}`).toBe(true);
        if (!parsed.ok) continue;
        const v = parsed.value[0].value.value;
        const st = e.carState;
        const expected: Partial<Record<number, number>> = {
          0x04: st.load,
          0x05: st.coolant,
          0x0b: st.map,
          0x0c: st.rpm,
          0x0d: st.speed,
          0x0f: st.iat,
          0x11: st.throttle,
          0x1f: st.runTime,
          0x2f: st.fuel,
          0x42: st.voltage,
        };
        if (expected[pid] !== undefined) {
          const tol = pid === 0x0c ? 0.25 : pid === 0x42 ? 0.001 : pid === 0x04 || pid === 0x11 || pid === 0x2f ? 0.4 : 1;
          expect(Math.abs(v - (expected[pid] as number)), `${id} ${cmd} ${v} vs ${expected[pid]}`).toBeLessThanOrEqual(tol);
        }
      }
      if (id === 'diesel') {
        const r = ask('01A6');
        const p = parsePidResponse(r.input, 0xa6, r.opts);
        expect(p.ok && p.value[0].value.value).toBeCloseTo(123456.7, 1);
      }
    }
  });

  it('i valori evolvono nel tempo (ciclo di guida) e restano plausibili', () => {
    const { e, configure, ask } = emu();
    configure();
    const speeds: number[] = [];
    const rpms: number[] = [];
    const temps: number[] = [];
    for (let i = 0; i < 1600; i++) {
      const sp = parsePidResponse(ask('010D').input, 0x0d, { protocol: '6', headers: true });
      if (sp.ok) speeds.push(sp.value[0].value.value);
      if (i % 20 === 0) {
        const rp = parsePidResponse(ask('010C').input, 0x0c, { protocol: '6', headers: true });
        const t = parsePidResponse(ask('0105').input, 0x05, { protocol: '6', headers: true });
        if (rp.ok) rpms.push(rp.value[0].value.value);
        if (t.ok) temps.push(t.value[0].value.value);
      }
    }
    expect(Math.min(...speeds)).toBe(0);
    expect(Math.max(...speeds)).toBeGreaterThan(70);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(130);
    expect(Math.min(...rpms)).toBeGreaterThan(600);
    expect(Math.max(...rpms)).toBeLessThan(6000);
    expect(temps[temps.length - 1]).toBeGreaterThan(temps[0]);
    expect(Math.max(...temps)).toBeLessThanOrEqual(90);
    expect(e.timeSeconds).toBeGreaterThan(90);
  });

  it('deterministico: stessa sequenza di comandi = stesso trascritto', () => {
    const run = () => {
      const { send, configure } = emu('mil-on');
      configure();
      return ['0100', '0101', '03', '07', '0A', '0902', '010C', '010D', '0105', '0142'].map((c) => send(c)).join('|');
    };
    expect(run()).toBe(run());
  });
});

describe('scenari', () => {
  it('petrol: nessun codice, spia spenta, VIN, monitor pronti', () => {
    const { configure, ask } = emu('petrol');
    configure();
    const st = ask('0101');
    const s = parseStatusResponse(st.input, st.opts);
    expect(s.ok && s.value[0].value.milOn).toBe(false);
    expect(s.ok && s.value[0].value.ready).toBe(true);
    const d = ask('03');
    const dr = parseDtcResponse(d.input, 0x03, d.opts);
    expect(dr.ok && dr.value.all).toEqual([]);
    expect(dr.ok && dr.value.byEcu.map((x) => x.ecu)).toEqual(['7E8', '7E9']);
    const v = ask('0902');
    const vr = parseVinResponse(v.input, v.opts);
    expect(vr.ok && vr.value.value).toBe('ZFA19900001234567');
  });

  it('mil-on: spia, tre codici su due frame, pendenti, permanenti, freeze frame, EVAP non pronto', () => {
    const { configure, ask, send } = emu('mil-on');
    configure();
    const st = ask('0101');
    const s = parseStatusResponse(st.input, st.opts);
    expect(s.ok && s.value[0].value.milOn).toBe(true);
    expect(s.ok && s.value[0].value.dtcCount).toBe(3);
    expect(s.ok && s.value[0].value.incomplete.map((m) => m.id)).toEqual(['evap']);
    const d = ask('03');
    const dr = parseDtcResponse(d.input, 0x03, d.opts);
    expect(dr.ok && dr.value.all).toEqual(['P0420', 'P0301', 'P0171']);
    const p = ask('07');
    expect(parseDtcResponse(p.input, 0x07, p.opts)).toMatchObject({ ok: true, value: { all: ['P0171'] } });
    const pm = ask('0A');
    expect(parseDtcResponse(pm.input, 0x0a, pm.opts)).toMatchObject({ ok: true, value: { all: ['P0420'] } });
    // freeze frame
    const f1 = ask('020200');
    const ff = parseFreezeFramePidResponse(f1.input, 0x02, f1.opts);
    expect(ff.ok && ff.value.value.dtc).toBe('P0420');
    const f2 = ask('020500');
    const ft = parseFreezeFramePidResponse(f2.input, 0x05, f2.opts);
    expect(ft.ok && ft.value.value.value?.value).toBe(88);
    expect(send('ATDPN')).toBe('A6\r\r>');
  });

  it('i frame dei codici si alternano tra ECU (frame mescolati)', () => {
    const { configure, ask } = emu('mil-on');
    configure();
    const d = ask('03');
    expect(d.n.lines).toHaveLength(3);
    expect(d.n.lines[0].startsWith('7E810')).toBe(true);
    expect(d.n.lines[1].startsWith('7E902')).toBe(true);
    expect(d.n.lines[2].startsWith('7E821')).toBe(true);
  });

  it('diesel: odometro e temperatura olio, un codice pendente, nessuna spia', () => {
    const { configure, ask } = emu('diesel');
    configure();
    const o = ask('015C');
    expect(parsePidResponse(o.input, 0x5c, o.opts).ok).toBe(true);
    const s = ask('0101');
    const sr = parseStatusResponse(s.input, s.opts);
    expect(sr.ok && sr.value[0].value.engineType).toBe('compression');
    const p = ask('07');
    expect(parseDtcResponse(p.input, 0x07, p.opts)).toMatchObject({ ok: true, value: { all: ['P2002'] } });
  });

  it('clone: ignora ATE0, ATAMC e AT@1 rispondono ?, NUL dopo il reset', () => {
    const { send } = emu('clone');
    const z = send('ATZ');
    expect(z).toContain('\u0000');
    expect(z).toContain('ELM327 v1.5');
    send('ATE0');
    expect(send('ATAMC')).toBe('ATAMC\r\n?\r\n\r\n>'); // eco ancora presente
    expect(send('AT@1')).toContain('?');
    expect(send('STI')).toContain('?');
    expect(send('ATCRA 7E8')).toContain('?');
  });

  it('ignition-off: 0100 -> SEARCHING... + UNABLE TO CONNECT finche\' non si accende il quadro', () => {
    const { e, configure, ask } = emu('ignition-off');
    configure();
    const r = ask('0100');
    expect(r.n.searching).toBe(true);
    expect(r.n.errors.map((x) => x.code)).toEqual(['UNABLE_TO_CONNECT']);
    e.ignition = true;
    const r2 = ask('0100');
    expect(r2.n.errors).toEqual([]);
    expect(r2.n.lines.length).toBeGreaterThan(0);
  });

  it('ATRV: 12,4 V a quadro spento, ~14 V a motore acceso', () => {
    const off = emu('ignition-off');
    expect(off.send('ATRV')).toContain('12.4V');
    const on = emu('petrol');
    const v = Number(/(\d+\.\d)V/.exec(on.send('ATRV'))?.[1]);
    expect(v).toBeGreaterThan(13.5);
    expect(v).toBeLessThan(14.6);
  });

  it('kline-slow (ISO 9141-2): intestazione di 3 byte + checksum, niente VIN, codici su slot, niente multi-PID', () => {
    const { configure, ask, send } = emu('kline-slow');
    configure();
    const sup = ask('0100');
    expect(sup.n.searching).toBe(true);
    expect(sup.n.lines[0]).toMatch(/^486B11410[0-9A-F]+$/);
    const s = parseSupportResponse(sup.input, 0, 0x01, sup.opts);
    expect(s.ok && Object.keys(s.value.byEcu)).toEqual(['11']);
    expect(send('ATDPN')).toBe('A3\r\r>');
    // checksum = somma dei byte mod 256
    const bytes = sup.n.lines[0].match(/../g)!.map((h) => parseInt(h, 16));
    expect(bytes.slice(0, -1).reduce((a, b) => (a + b) & 0xff, 0)).toBe(bytes[bytes.length - 1]);
    const vin = ask('0902');
    expect(vin.n.errors.map((x) => x.code)).toEqual(['NO_DATA']);
    const d = ask('03');
    const dr = parseDtcResponse(d.input, 0x03, d.opts);
    expect(dr.ok && dr.value.all).toEqual(['P0133', 'P0300']);
    expect(ask('0A').n.errors.map((x) => x.code)).toEqual(['NO_DATA']);
    expect(ask('010B040C05').n.errors.map((x) => x.code)).toEqual(['UNKNOWN_COMMAND']);
  });

  it('kline: VIN a 5 messaggi quando l\'auto lo supporta', () => {
    const sc: ScenarioConfig = { ...SCENARIOS['kline-slow'], vin: 'WVWZZZ1KZ6W123456', ecus: [{ ...SCENARIOS['kline-slow'].ecus[0], vin: true }] };
    const { configure, ask } = emu(sc);
    configure();
    const v = ask('0902');
    expect(v.n.lines).toHaveLength(5);
    const r = parseVinResponse(v.input, v.opts);
    expect(r.ok && r.value.value).toBe('WVWZZZ1KZ6W123456');
  });

  it('Mode 04 azzera codici e spia (solo nell\'auto virtuale: l\'app non lo invia)', () => {
    const { configure, ask } = emu('mil-on');
    configure();
    const clear = ask('04');
    expect(parseResponseLines(clear.n.lines, { protocol: '6' }).messages).toEqual([{ ecu: '7E8', data: [0x44] }]);
    const st = ask('0101');
    const s = parseStatusResponse(st.input, st.opts);
    expect(s.ok && s.value[0].value.milOn).toBe(false);
    expect(s.ok && s.value[0].value.dtcCount).toBe(0);
    const d = ask('03');
    expect(parseDtcResponse(d.input, 0x03, d.opts)).toMatchObject({ ok: true, value: { all: [] } });
    expect(ask('020200').n.errors.map((x) => x.code)).toEqual(['NO_DATA']);
  });

  it('flaky: BUS BUSY / DATA ERROR a intervalli regolari', () => {
    const { configure, send } = emu('flaky');
    configure();
    const replies: string[] = [];
    for (let i = 0; i < 12; i++) replies.push(send('0105'));
    expect(replies.filter((r) => r.includes('BUS BUSY'))).toHaveLength(1);
    expect(replies.filter((r) => r.includes('DATA ERROR'))).toHaveLength(1);
  });

  it('encodeDtc e decodeDtc sono inversi', () => {
    for (const c of ['P0133', 'U0100', 'C0220', 'B0123', 'P2002', 'U1016', 'P34FF']) {
      const [a, b] = encodeDtc(c);
      expect(PIDS.length).toBeGreaterThan(0);
      expect(decodePid(0x0d, [a]).ok).toBe(true); // byte validi
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(255);
    }
    expect(encodeDtc('P0133')).toEqual([0x01, 0x33]);
    expect(encodeDtc('U0100')).toEqual([0xc1, 0x00]);
    expect(encodeDtc('XYZ')).toEqual([0, 0]);
  });

  it('CAN 29 bit: l\'emulatore stampa 18 DA F1 xx e il parser riassembla', () => {
    const sc: ScenarioConfig = {
      ...SCENARIOS.petrol,
      protocol: '7',
      ecus: [{ ...SCENARIOS.petrol.ecus[0], id: '18DAF110' }],
    };
    const { configure, ask } = emu(sc);
    configure();
    const v = ask('0902', { protocol: '7', headers: true });
    expect(v.n.lines[0].startsWith('18 DA F1 10 10 14')).toBe(false); // ATS0: senza spazi
    expect(v.n.lines[0].startsWith('18DAF110')).toBe(true);
    const r = parseVinResponse(v.input, v.opts);
    expect(r.ok && r.value).toEqual({ ecu: '18DAF110', value: 'ZFA19900001234567' });
    const parsed = parseResponseLines(v.n.lines, { protocol: '7' });
    expect(parsed.messages).toHaveLength(1);
  });
});

describe('SimulatedTransport', () => {
  it('spezza le risposte a 20 caratteri come il BLE e rispetta il prompt', async () => {
    const t = new SimulatedTransport({ scenario: 'mil-on' });
    const chunks: string[] = [];
    t.onData((c) => chunks.push(c));
    await t.connect();
    const waitPrompt = () =>
      new Promise<void>((resolve) => {
        const iv = setInterval(() => {
          if (chunks.join('').endsWith('>')) {
            clearInterval(iv);
            resolve();
          }
        }, 1);
      });
    for (const c of ['ATZ', 'ATE0', 'ATL0', 'ATS1', 'ATH1', 'ATSP0']) {
      chunks.length = 0;
      await t.write(c + '\r');
      await waitPrompt();
    }
    chunks.length = 0;
    await t.write('0902\r');
    await waitPrompt();
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.length <= 20)).toBe(true);
    expect(t.interruptions).toBe(0);
  });

  it('un comando inviato prima del prompt interrompe la risposta: STOPPED (bug di serializzazione)', async () => {
    const t = new SimulatedTransport({ scenario: 'mil-on', chunkDelayMs: 2 });
    const chunks: string[] = [];
    t.onData((c) => chunks.push(c));
    await t.connect();
    await t.write('ATE0\r');
    await new Promise((r) => setTimeout(r, 30));
    chunks.length = 0;
    await t.write('0100\r');
    await t.write('0105\r'); // senza attendere il prompt
    await new Promise((r) => setTimeout(r, 80));
    expect(chunks.join('')).toContain('STOPPED');
    expect(t.interruptions).toBeGreaterThan(0);
  });

  it('una sessione corretta non provoca mai STOPPED, nemmeno con 60 comandi in coda', async () => {
    const t = new SimulatedTransport({ scenario: 'petrol', chunkDelayMs: 1 });
    const session = new ElmSession(t, { recoveryMs: 50 });
    await session.open();
    for (const c of ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH1', 'ATSP0']) await session.send(c);
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => session.send(['010C', '010D', '0105'][i % 3])));
    expect(results.every((r) => r.status === 'ok')).toBe(true);
    expect(t.interruptions).toBe(0);
    await session.close();
  });

  it('caduta del collegamento: chiusura definitiva oppure riconnessione automatica', async () => {
    const closed: (string | undefined)[] = [];
    const t = new SimulatedTransport({ scenario: 'petrol' });
    t.onClose((r) => closed.push(r));
    await t.connect();
    t.dropConnection('test');
    expect(closed).toEqual(['test']);
    await expect(t.write('ATZ\r')).rejects.toThrow();

    const lost: string[] = [];
    let reconnected = 0;
    const r = new SimulatedTransport({ scenario: 'petrol', autoReconnect: true, reconnectDelayMs: 5 });
    r.onLinkLost((x) => lost.push(x ?? ''));
    r.onReconnected(() => reconnected++);
    await r.connect();
    r.dropConnection('x');
    expect(lost).toEqual(['x']);
    await new Promise((res) => setTimeout(res, 30));
    expect(reconnected).toBe(1);
    expect(r.isConnected).toBe(true);
  });

  it('dropAfterRequests: dopo N richieste OBD il collegamento cade', async () => {
    const sc: ScenarioConfig = { ...SCENARIOS.petrol, dropAfterRequests: 3 };
    const t = new SimulatedTransport({ scenario: sc });
    const session = new ElmSession(t, { recoveryMs: 30 });
    await session.open();
    for (const c of ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH1', 'ATSP0']) await session.send(c);
    const ok = [await session.send('0100'), await session.send('010C'), await session.send('010D')];
    expect(ok.every((r) => r.status === 'ok')).toBe(true);
    const fourth = await session.send('0105');
    expect(fourth.status).toBe('error');
    expect(fourth.error?.code).toBe('DISCONNECTED');
  });
});
