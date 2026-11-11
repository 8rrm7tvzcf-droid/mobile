// Emulatore ELM327 in TypeScript: macchina a stati (eco, linefeed, spazi, intestazioni, protocollo) + auto
// virtuale deterministica. Riferimento di formato: datasheet ELM327 (risposte, ATH0/ATH1, ISO-TP).
// Scritto da zero (nessun codice di ELM327-emulator, licenza CC BY-NC-SA). Nessun orologio, nessun
// Math.random: il tempo virtuale avanza di `stepMs` a ogni richiesta OBD (o segue `now` se fornito).
import {
  byteToHex,
  asciiToBytes,
  encodePidSupport,
  isCanProtocol,
  protocolInfo,
  type ProtocolId,
} from '@/obd/protocol';
import { getScenario, type EcuSpec, type ScenarioConfig, type ScenarioId } from './scenarios';
import { carStateAt, encodeDtc, freezeFrameBytes, pidBytes, supportMask, type CarState } from './virtualCar';

export interface ReplyPart {
  text: string;
  delayMs: number;
}

export interface EmulatorOptions {
  /** Istante in ms per l'evoluzione dei valori; se assente si usa il tempo virtuale a passi. */
  now?: () => number;
  /** Avanzamento del tempo virtuale per ogni richiesta OBD (default 60 ms). */
  stepMs?: number;
  /** Alterna i frame di ECU diverse come fa un bus reale (default true). */
  interleave?: boolean;
  latencyMs?: number;
  searchDelayMs?: number;
  resetDelayMs?: number;
}

export interface HandleResult {
  parts: ReplyPart[];
  /** Il collegamento va fatto cadere (scenario con cadute). */
  drop?: boolean;
}

interface Msg {
  ecu: EcuSpec;
  payload: number[];
}

const compact = (s: string) => s.replace(/\s+/g, '').toUpperCase();
const hex = (bytes: readonly number[], spaces: boolean) => bytes.map(byteToHex).join(spaces ? ' ' : '');

export class Elm327Emulator {
  readonly scenario: ScenarioConfig;
  private readonly opts: EmulatorOptions;

  // stato ELM
  private echo = true;
  private linefeed = true;
  private spaces = true;
  private headers = false;
  private protocol: ProtocolId = '0';
  private protocolAutoFallback = false;
  private found: ProtocolId | null = null;
  private foundAuto = false;

  // stato dell'auto
  ignition: boolean;
  private stored: string[];
  private pending: string[];
  private permanent: string[] | null;
  private mil: boolean;
  private monitorD: number;
  private freezeOn: boolean;

  private virtualMs = 0;
  private requestCount = 0;

  constructor(scenario: ScenarioId | ScenarioConfig, opts: EmulatorOptions = {}) {
    this.scenario = getScenario(scenario);
    this.opts = opts;
    this.ignition = this.scenario.ignition;
    this.stored = this.scenario.dtcStored.slice();
    this.pending = this.scenario.dtcPending.slice();
    this.permanent = this.scenario.dtcPermanent ? this.scenario.dtcPermanent.slice() : null;
    this.mil = this.scenario.mil;
    this.monitorD = this.scenario.monitorD;
    this.freezeOn = this.scenario.freezeFrame && this.stored.length > 0;
  }

  /** Tempo virtuale in secondi dall'avviamento. */
  get timeSeconds(): number {
    return (this.opts.now ? this.opts.now() : this.virtualMs) / 1000;
  }

  /** Stato attuale dell'auto virtuale (per i test e per la UI demo). */
  get carState(): CarState {
    return carStateAt(this.timeSeconds, { ignition: this.ignition, idleRpm: this.scenario.idleRpm });
  }

  advance(ms: number): void {
    this.virtualMs += ms;
  }

  /** Come togliere e ridare alimentazione all'adattatore. */
  powerCycle(): void {
    this.hardReset();
    this.requestCount = 0;
  }

  get requests(): number {
    return this.requestCount;
  }

  // ------------------------------------------------------------------ interfaccia

  /** Elabora una riga di comando (senza CR) e restituisce le parti di risposta con i loro ritardi. */
  handle(line: string): HandleResult {
    const cmdText = line.replace(/[\r\n]/g, '');
    const c = compact(cmdText);
    const echoWas = this.echo;
    const latency = this.opts.latencyMs ?? this.scenario.latencyMs;

    if (c.length === 0) return { parts: [{ text: this.eol() + '>', delayMs: 0 }] };

    if (c.startsWith('AT')) return { parts: this.handleAt(c, cmdText, echoWas, latency) };
    if (c === 'STI' || c.startsWith('ST')) {
      const sti = this.scenario.sti;
      const body = c === 'STI' && sti ? [sti] : ['?'];
      return { parts: [this.compose(cmdText, echoWas, body, latency)] };
    }
    return this.handleObd(cmdText, c, echoWas, latency);
  }

  // ------------------------------------------------------------------ formattazione

  private eol(): string {
    return this.linefeed ? '\r\n' : '\r';
  }

  private compose(cmdText: string, echoWas: boolean, lines: readonly string[], delayMs: number): ReplyPart {
    const eol = this.eol();
    let text = echoWas ? cmdText + eol : '';
    for (const l of lines) text += l + eol;
    text += eol + '>';
    return { text, delayMs };
  }

  // ------------------------------------------------------------------ comandi AT

  private hardReset(): void {
    this.echo = true;
    this.linefeed = true;
    this.spaces = true;
    this.headers = false;
    this.protocol = '0';
    this.protocolAutoFallback = false;
    this.found = null;
    this.foundAuto = false;
  }

  private voltage(): number {
    return this.carState.voltage;
  }

  private handleAt(c: string, cmdText: string, echoWas: boolean, latency: number): ReplyPart[] {
    const sc = this.scenario;
    const ok = () => [this.compose(cmdText, echoWas, ['OK'], latency)];
    const q = () => [this.compose(cmdText, echoWas, ['?'], latency)];
    const rest = c.slice(2);

    if (c === 'ATZ' || c === 'ATWS') {
      this.hardReset();
      const eol = this.eol();
      const noise = sc.nulNoise ? '\u0000\u0000' : '';
      const text = (echoWas ? cmdText + eol : '') + eol + noise + sc.elmVersion + eol + eol + '>';
      return [{ text, delayMs: this.opts.resetDelayMs ?? 0 }];
    }
    if (c === 'ATE0' || c === 'ATE1') {
      const parts = ok();
      this.echo = c === 'ATE1' ? true : sc.ignoresEchoOff ? true : false;
      return parts;
    }
    if (c === 'ATL0' || c === 'ATL1') {
      const parts = ok();
      this.linefeed = c === 'ATL1';
      return parts;
    }
    if (c === 'ATS0' || c === 'ATS1') {
      const parts = ok();
      this.spaces = c === 'ATS1';
      return parts;
    }
    if (c === 'ATH0' || c === 'ATH1') {
      const parts = ok();
      this.headers = c === 'ATH1';
      return parts;
    }
    if (/^ATSP[0-9A-C]$/.test(c) || /^ATTP[0-9A-C]$/.test(c) || /^ATTPA[0-9A-C]$/.test(c)) {
      const parts = ok();
      const id = c[c.length - 1];
      this.protocol = id;
      this.protocolAutoFallback = c.startsWith('ATTPA');
      this.found = null;
      return parts;
    }
    if (c === 'ATDPN') {
      const id = this.found ?? this.protocol;
      const text = this.found !== null ? (this.foundAuto ? 'A' : '') + id : this.protocol === '0' ? 'A0' : id;
      return [this.compose(cmdText, echoWas, [text], latency)];
    }
    if (c === 'ATDP') {
      const id = this.found ?? this.protocol;
      const name = protocolInfo(id)?.name ?? 'AUTO';
      return [this.compose(cmdText, echoWas, [(this.foundAuto || this.protocol === '0' ? 'AUTO, ' : '') + name], latency)];
    }
    if (c === 'ATRV') return [this.compose(cmdText, echoWas, [`${this.voltage().toFixed(1)}V`], latency)];
    if (c === 'ATI') return [this.compose(cmdText, echoWas, [sc.elmVersion], latency)];
    if (c === 'AT@1') return [this.compose(cmdText, echoWas, [sc.atDescription ?? '?'], latency)];
    if (c === 'ATAMC') return sc.amc ? [this.compose(cmdText, echoWas, ['00'], latency)] : q();
    if (c.startsWith('ATCRA') || c.startsWith('ATAMT') || c.startsWith('ATCTM')) return sc.rejectsCra ? q() : ok();
    if (c === 'ATFE') {
      return ok();
    }
    if (/^AT(AT[0-2]|CAF[01]|ST[0-9A-F]{1,2}|SH[0-9A-F]+|AR|AL|NL|D|M[01]|CF[0-9A-F]+|CM[0-9A-F]+|SW[0-9A-F]+|IB[0-9A-F]+|PC|BI|LP)$/.test(c) || rest === 'AR') {
      return ok();
    }
    return q();
  }

  // ------------------------------------------------------------------ richieste OBD

  private connectOutcome(): { prefix: string[]; fail: string[] | null; searched: boolean } {
    const sc = this.scenario;
    if (this.found !== null) return { prefix: [], fail: null, searched: false };
    const can = isCanProtocol(sc.protocol);
    const auto = this.protocol === '0' || this.protocolAutoFallback;
    if (!this.ignition) {
      if (auto) return { prefix: ['SEARCHING...'], fail: ['UNABLE TO CONNECT'], searched: true };
      return { prefix: [], fail: can ? ['UNABLE TO CONNECT'] : ['BUS INIT: ...ERROR'], searched: false };
    }
    if (auto) {
      this.found = sc.protocol;
      this.foundAuto = true;
      return { prefix: ['SEARCHING...'], fail: null, searched: true };
    }
    if (this.protocol === sc.protocol) {
      this.found = sc.protocol;
      this.foundAuto = false;
      return { prefix: can ? [] : ['BUS INIT: ...OK'], fail: null, searched: false };
    }
    return { prefix: [], fail: can ? ['UNABLE TO CONNECT'] : ['BUS INIT: ...ERROR'], searched: false };
  }

  private handleObd(cmdText: string, c: string, echoWas: boolean, latency: number): HandleResult {
    const sc = this.scenario;
    this.requestCount++;
    if (sc.dropAfterRequests !== undefined && this.requestCount > sc.dropAfterRequests) return { parts: [], drop: true };
    if (!this.opts.now) this.virtualMs += this.opts.stepMs ?? 60;

    // cifra finale facoltativa = numero di risposte attese (ignorata)
    let hexText = c;
    if (hexText.length % 2 === 1) hexText = hexText.slice(0, -1);
    if (!/^[0-9A-F]+$/.test(hexText) || hexText.length < 2) {
      return { parts: [this.compose(cmdText, echoWas, ['?'], latency)] };
    }
    const bytes: number[] = [];
    for (let i = 0; i < hexText.length; i += 2) bytes.push(parseInt(hexText.slice(i, i + 2), 16));

    for (const g of sc.glitches ?? []) {
      if (g.every > 0 && this.requestCount % g.every === 0) {
        return { parts: [this.compose(cmdText, echoWas, [g.reply], latency)] };
      }
    }

    const conn = this.connectOutcome();
    const searchDelay = this.opts.searchDelayMs ?? sc.searchDelayMs;
    if (conn.fail) {
      return { parts: this.withSearch(cmdText, echoWas, conn.prefix, conn.fail, conn.searched, latency, searchDelay) };
    }

    const multi = bytes[0] === 0x01 && bytes.length > 2;
    if (multi && !isCanProtocol(this.found ?? sc.protocol)) {
      return { parts: this.withSearch(cmdText, echoWas, conn.prefix, ['?'], conn.searched, latency, searchDelay) };
    }

    const msgs = this.respond(bytes);
    const lines = msgs.length === 0 ? ['NO DATA'] : this.formatMessages(msgs);
    return { parts: this.withSearch(cmdText, echoWas, conn.prefix, lines, conn.searched, latency, searchDelay) };
  }

  private withSearch(
    cmdText: string,
    echoWas: boolean,
    prefix: string[],
    lines: string[],
    searched: boolean,
    latency: number,
    searchDelay: number,
  ): ReplyPart[] {
    if (searched && searchDelay > 0 && prefix.length > 0) {
      const eol = this.eol();
      const first = (echoWas ? cmdText + eol : '') + prefix.map((p) => p + eol).join('');
      const second = this.compose('', false, lines, searchDelay);
      return [{ text: first, delayMs: latency }, second];
    }
    return [this.compose(cmdText, echoWas, prefix.concat(lines), latency)];
  }

  // ------------------------------------------------------------------ servizi

  private respond(bytes: number[]): Msg[] {
    const sc = this.scenario;
    const svc = bytes[0];
    const out: Msg[] = [];
    const state = this.carState;

    switch (svc) {
      case 0x01: {
        const pids = bytes.slice(1, 7);
        if (pids.length === 0) return [];
        for (const ecu of sc.ecus) {
          const payload: number[] = [0x41];
          for (const pid of pids) {
            if ((pid & 0x1f) === 0) {
              const mask = supportMask(ecu.pids.filter((p) => p !== 0x01).concat(ecu.status ? [0x01] : []), pid);
              if (mask) payload.push(pid, ...mask);
            } else if (pid === 0x01) {
              if (ecu.status) payload.push(pid, ...this.statusBytes());
            } else if (ecu.pids.includes(pid)) {
              const b = pidBytes(pid, state, sc);
              if (b) payload.push(pid, ...b);
            }
          }
          if (payload.length > 1) out.push({ ecu, payload });
        }
        return out;
      }
      case 0x02: {
        const pid = bytes[1];
        const frame = bytes[2] ?? 0;
        if (pid === undefined || frame !== 0 || !this.freezeOn) return [];
        for (const ecu of sc.ecus) {
          if (!ecu.freezeFrame) continue;
          if (pid === 0x00) {
            out.push({ ecu, payload: [0x42, 0x00, frame, ...encodePidSupport(0, [0x02, 0x04, 0x05, 0x0b, 0x0c, 0x0d, 0x0f, 0x11])] });
            continue;
          }
          const data = freezeFrameBytes(pid, { ...sc, dtcStored: this.stored });
          if (data) out.push({ ecu, payload: [0x42, pid, frame, ...data] });
        }
        return out;
      }
      case 0x03:
      case 0x07:
      case 0x0a: {
        const list = svc === 0x03 ? this.stored : svc === 0x07 ? this.pending : this.permanent;
        if (list === null) return [];
        const can = isCanProtocol(this.found ?? sc.protocol);
        for (const ecu of sc.ecus) {
          if (ecu.dtc === 'none') continue;
          const codes = ecu.dtc === 'engine' ? list : [];
          const pairs = codes.map((code) => encodeDtc(code));
          if (can) {
            out.push({ ecu, payload: [svc + 0x40, pairs.length, ...pairs.flat()] });
          } else if (pairs.length === 0) {
            out.push({ ecu, payload: [svc + 0x40, 0, 0, 0, 0, 0, 0] });
          } else {
            for (let i = 0; i < pairs.length; i += 3) {
              const slice = pairs.slice(i, i + 3);
              while (slice.length < 3) slice.push([0, 0]);
              out.push({ ecu, payload: [svc + 0x40, ...slice.flat()] });
            }
          }
        }
        return out;
      }
      case 0x04: {
        // Cancellazione (solo il simulatore dell'auto: l'app NON la invia nell'MVP).
        this.stored = [];
        this.pending = [];
        this.mil = false;
        this.freezeOn = false;
        this.monitorD = 0xff;
        const engine = sc.ecus.find((e) => e.dtc === 'engine');
        return engine ? [{ ecu: engine, payload: [0x44] }] : [];
      }
      case 0x09: {
        const pid = bytes[1];
        if (sc.vin === null) return [];
        if (pid === 0x00) {
          return sc.ecus.filter((e) => e.vin).map((ecu) => ({ ecu, payload: [0x49, 0x00, ...encodePidSupport(0, [0x02])] }));
        }
        if (pid !== 0x02) return [];
        const vin = asciiToBytes(sc.vin);
        for (const ecu of sc.ecus) {
          if (!ecu.vin) continue;
          if (isCanProtocol(this.found ?? sc.protocol)) {
            out.push({ ecu, payload: [0x49, 0x02, 0x01, ...vin] });
          } else {
            const stream = [0, 0, 0, ...vin];
            for (let i = 0, n = 1; i < stream.length; i += 4, n++) out.push({ ecu, payload: [0x49, 0x02, n, ...stream.slice(i, i + 4)] });
          }
        }
        return out;
      }
      default:
        return [];
    }
  }

  private statusBytes(): number[] {
    const sc = this.scenario;
    const count = Math.min(127, this.stored.length);
    return [(this.mil ? 0x80 : 0) | count, sc.monitorB, sc.monitorC, this.monitorD];
  }

  // ------------------------------------------------------------------ formato delle righe

  private formatMessages(msgs: Msg[]): string[] {
    const proto = this.found ?? this.scenario.protocol;
    return isCanProtocol(proto) ? this.formatCan(msgs) : this.formatLegacy(msgs, proto);
  }

  private segment(payload: number[]): number[][] {
    if (payload.length <= 7) {
      const b = [payload.length, ...payload];
      while (b.length < 8) b.push(0);
      return [b];
    }
    const frames: number[][] = [[0x10 | ((payload.length >> 8) & 0x0f), payload.length & 0xff, ...payload.slice(0, 6)]];
    let sn = 1;
    for (let i = 6; i < payload.length; i += 7) {
      const b = [0x20 | (sn & 0x0f), ...payload.slice(i, i + 7)];
      while (b.length < 8) b.push(0);
      frames.push(b);
      sn++;
    }
    return frames;
  }

  private idText(id: string): string {
    if (id.length === 8) {
      const bytes = [0, 2, 4, 6].map((i) => id.slice(i, i + 2));
      return bytes.join(this.spaces ? ' ' : '');
    }
    return id;
  }

  private formatCan(msgs: Msg[]): string[] {
    const sp = this.spaces;
    if (!this.headers) {
      // ATH0 + CAF1: l'ELM327 riassembla; frame singolo = byte dati, multi-frame = '014' + righe '0:' '1:'...
      const lines: string[] = [];
      for (const m of msgs) {
        if (m.payload.length <= 7) {
          lines.push(hex(m.payload, sp));
        } else {
          lines.push(m.payload.length.toString(16).toUpperCase().padStart(3, '0'));
          lines.push('0:' + (sp ? ' ' : '') + hex(m.payload.slice(0, 6), sp));
          for (let i = 6, n = 1; i < m.payload.length; i += 7, n++) {
            lines.push((n % 16).toString(16).toUpperCase() + ':' + (sp ? ' ' : '') + hex(m.payload.slice(i, i + 7), sp));
          }
        }
      }
      return lines;
    }
    const perMsg = msgs.map((m) => ({ id: this.idText(m.ecu.id), frames: this.segment(m.payload) }));
    const lines: string[] = [];
    const interleave = this.opts.interleave !== false;
    if (interleave) {
      const max = Math.max(...perMsg.map((p) => p.frames.length));
      for (let i = 0; i < max; i++) {
        for (const p of perMsg) if (i < p.frames.length) lines.push(p.id + (sp ? ' ' : '') + hex(p.frames[i], sp));
      }
    } else {
      for (const p of perMsg) for (const f of p.frames) lines.push(p.id + (sp ? ' ' : '') + hex(f, sp));
    }
    return lines;
  }

  private formatLegacy(msgs: Msg[], _proto: ProtocolId): string[] {
    const sp = this.spaces;
    const [fmt, target] = this.scenario.legacyHeader ?? [0x48, 0x6b];
    return msgs.map((m) => {
      if (!this.headers) return hex(m.payload, sp);
      const src = parseInt(m.ecu.id, 16) & 0xff;
      const all = [fmt, target, src, ...m.payload];
      const checksum = all.reduce((a, b) => (a + b) & 0xff, 0);
      return hex([...all, checksum], sp);
    });
  }
}
