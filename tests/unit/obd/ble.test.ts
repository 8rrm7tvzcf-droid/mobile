// BleTransport e selezione GATT, provati con un gestore BLE FINTO: NON equivale a una prova su dispositivo
// (nello spike SP-4 va provato con adattatori reali). Qui si verifica la logica: selezione per proprieta',
// notifiche prima del primo write, un write alla volta, backoff 1/2/4 s, init completo a ogni riconnessione.
import { describe, expect, it } from 'vitest';
import {
  BleTransport,
  BleTransportError,
  KNOWN_BLE_SERVICES,
  flattenProperties,
  normalizeUuid,
  selectBleConfigs,
  type BleCharacteristic,
  type BleConfig,
  type BleManagerLike,
} from '@/obd/transport';
import { chunkText, Emitter } from '@/obd/transport/chunking';
import type { Timers } from '@/obd/transport/types';

const SIG = (short: string) => `0000${short}-0000-1000-8000-00805f9b34fb`;
const NORDIC = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const dev = 'AA:BB:CC:DD:EE:FF';

function ch(service: string, characteristic: string, ...props: string[]): BleCharacteristic {
  return { service, characteristic, properties: Object.fromEntries(props.map((p) => [p, p])) };
}

const FFF0_LAYOUT = [ch(SIG('fff0'), SIG('fff1'), 'Read', 'Notify'), ch(SIG('fff0'), SIG('fff2'), 'Write', 'WriteWithoutResponse')];

describe('normalizeUuid / flattenProperties', () => {
  it('forma breve per gli UUID del Bluetooth SIG, 128 bit per gli altri', () => {
    expect(normalizeUuid(SIG('fff0'))).toBe('fff0');
    expect(normalizeUuid('FFF0')).toBe('fff0');
    expect(normalizeUuid('0xFFE1')).toBe('ffe1');
    expect(normalizeUuid('0000FFF0')).toBe('fff0');
    expect(normalizeUuid(NORDIC.toUpperCase())).toBe(NORDIC);
  });

  it('proprieta\' come oggetto (Android) o come elenco (iOS)', () => {
    expect([...flattenProperties({ Notify: 'Notify', WriteWithoutResponse: 'WriteWithoutResponse', Read: 'Read' })].sort()).toEqual(['notify', 'read', 'writeWithoutResponse']);
    expect([...flattenProperties(['write', 'indicate'])].sort()).toEqual(['indicate', 'write']);
    expect(flattenProperties(null).size).toBe(0);
    expect(flattenProperties(undefined).size).toBe(0);
  });
});

describe('selectBleConfigs', () => {
  it('FFF0: FFF1 notify, FFF2 scrittura; senza risposta per prima, con risposta come alternativa', () => {
    const cfgs = selectBleConfigs(FFF0_LAYOUT);
    expect(cfgs.length).toBe(2);
    expect(cfgs[0]).toMatchObject({ service: SIG('fff0'), notify: SIG('fff1'), write: SIG('fff2'), writeType: 'withoutResponse', origin: 'known' });
    expect(cfgs[1]).toMatchObject({ notify: SIG('fff1'), write: SIG('fff2'), writeType: 'withResponse' });
  });

  it('sceglie per PROPRIETA\' anche con FFF1/FFF2 invertiti (alcune fonti li scambiano)', () => {
    const swapped = [ch('FFF0', 'FFF1', 'Write'), ch('FFF0', 'FFF2', 'Notify')];
    const [first] = selectBleConfigs(swapped);
    expect(first).toMatchObject({ notify: 'FFF2', write: 'FFF1', writeType: 'withResponse' });
  });

  it('stile HM-10: un\'unica caratteristica FFE1 con notify e scrittura senza risposta', () => {
    const [first] = selectBleConfigs([ch('FFE0', 'FFE1', 'Notify', 'WriteWithoutResponse', 'Write')]);
    expect(first).toMatchObject({ service: 'FFE0', notify: 'FFE1', write: 'FFE1', writeType: 'withoutResponse', origin: 'known' });
  });

  it('ordine: FFF0, FFE0, 18F0, Nordic UART, poi i servizi sconosciuti (greedy); i servizi standard sono esclusi', () => {
    const chars = [
      ch('1800', '2A00', 'Read', 'Notify', 'Write'), // Generic Access: da ignorare
      ch('180A', '2A29', 'Read'),
      ch('deadbeef-0000-1000-8000-00805f9b34fb', 'deadbeef-0001-1000-8000-00805f9b34fb', 'Notify'),
      ch('abcd1234-0000-1000-8000-00805f9b34fb', 'abcd1235-0000-1000-8000-00805f9b34fb', 'Notify'),
      ch('abcd1234-0000-1000-8000-00805f9b34fb', 'abcd1236-0000-1000-8000-00805f9b34fb', 'Write'),
      ch(NORDIC, '6e400003-b5a3-f393-e0a9-e50e24dcca9e', 'Notify'),
      ch(NORDIC, '6e400002-b5a3-f393-e0a9-e50e24dcca9e', 'Write', 'WriteWithoutResponse'),
      ch('18F0', '2AF0', 'Notify'),
      ch('18F0', '2AF1', 'Write'),
      ch('FFE0', 'FFE1', 'Notify', 'WriteWithoutResponse'),
      ch('FFF0', 'FFF1', 'Notify'),
      ch('FFF0', 'FFF2', 'WriteWithoutResponse'),
    ];
    const services = selectBleConfigs(chars).map((c) => c.service);
    const order = services.filter((s, i) => services.indexOf(s) === i);
    expect(order).toEqual(['FFF0', 'FFE0', '18F0', NORDIC, 'abcd1234-0000-1000-8000-00805f9b34fb']);
    expect(selectBleConfigs(chars).at(-1)?.origin).toBe('greedy');
    expect(order.some((s) => s === '1800' || s === '180A')).toBe(false);
  });

  it('nessun candidato senza una caratteristica notify E una di scrittura nello stesso servizio', () => {
    expect(selectBleConfigs([ch('FFF0', 'FFF1', 'Notify')])).toEqual([]);
    expect(selectBleConfigs([ch('FFF0', 'FFF2', 'Write')])).toEqual([]);
    expect(selectBleConfigs([])).toEqual([]);
    expect(selectBleConfigs([ch('1800', '2A00', 'Notify', 'Write')])).toEqual([]);
  });

  it('indicate vale come notify quando non c\'e\' altro', () => {
    const [c] = selectBleConfigs([ch('FFF0', 'FFF1', 'Indicate'), ch('FFF0', 'FFF2', 'Write')]);
    expect(c).toMatchObject({ notify: 'FFF1', notifyMode: 'indicate' });
  });

  it('la configurazione salvata passa in testa (origin saved) solo se esiste ancora', () => {
    const chars = [...FFF0_LAYOUT, ch('FFE0', 'FFE1', 'Notify', 'WriteWithoutResponse')];
    const saved = { service: 'ffe0', notify: 'ffe1', write: 'ffe1', writeType: 'withoutResponse' as const };
    const cfgs = selectBleConfigs(chars, saved);
    expect(cfgs[0]).toMatchObject({ service: 'FFE0', origin: 'saved' });
    expect(cfgs.filter((c) => c.service === 'FFE0')).toHaveLength(1); // nessun duplicato
    const gone = selectBleConfigs(FFF0_LAYOUT, saved);
    expect(gone[0].origin).toBe('known');
  });

  it('i servizi non verificati sono segnalati come tali nella lista', () => {
    const fff0 = KNOWN_BLE_SERVICES.find((k) => k.uuid === 'fff0');
    expect(fff0?.verified).toBe(true);
    expect(KNOWN_BLE_SERVICES.filter((k) => !k.verified).length).toBeGreaterThan(0);
    expect(KNOWN_BLE_SERVICES.map((k) => k.uuid).slice(0, 3)).toEqual(['fff0', 'ffe0', '18f0']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Gestore BLE finto

interface FakeOptions {
  chars?: BleCharacteristic[];
  /** Quali coppie (servizio, caratteristica di scrittura) fanno rispondere l'adattatore ad ATZ. */
  answers?: (service: string, writeChar: string) => boolean;
  failConnect?: boolean;
  failRetrieve?: boolean;
  holdWrites?: boolean;
}

class FakeBle implements BleManagerLike {
  log: string[] = [];
  writes: { service: string; char: string; text: string; withoutResponse: boolean; max?: number }[] = [];
  chars: BleCharacteristic[];
  opts: FakeOptions;
  private valueCb: ((e: { peripheral: string; characteristic: string; service?: string; value: number[] }) => void) | null = null;
  private discCb: ((e: { peripheral: string; status?: number }) => void) | null = null;
  private notifying: { service: string; char: string }[] = [];
  removed = 0;
  /** Scritture sospese (holdWrites). */
  held: (() => void)[] = [];
  inFlightWrites = 0;
  maxInFlightWrites = 0;

  constructor(opts: FakeOptions = {}) {
    this.opts = opts;
    this.chars = opts.chars ?? FFF0_LAYOUT;
  }

  async isStarted() {
    this.log.push('isStarted');
    return true;
  }
  async start() {
    this.log.push('start');
  }
  async connect(id: string) {
    this.log.push(`connect:${id}`);
    if (this.opts.failConnect) throw new Error('connect failed');
  }
  async disconnect(id: string) {
    this.log.push(`disconnect:${id}`);
  }
  async retrieveServices() {
    this.log.push('retrieveServices');
    if (this.opts.failRetrieve) throw new Error('retrieve failed');
    return { characteristics: this.chars };
  }
  async startNotification(_id: string, service: string, char: string) {
    this.log.push(`startNotification:${char}`);
    this.notifying.push({ service, char });
  }
  async stopNotification(_id: string, service: string, char: string) {
    this.log.push(`stopNotification:${char}`);
    this.notifying = this.notifying.filter((n) => !(n.service === service && n.char === char));
  }
  async write(_id: string, service: string, char: string, data: number[], max?: number) {
    return this.doWrite(service, char, data, false, max);
  }
  async writeWithoutResponse(_id: string, service: string, char: string, data: number[], max?: number) {
    return this.doWrite(service, char, data, true, max);
  }
  onDidUpdateValueForCharacteristic(cb: (e: { peripheral: string; characteristic: string; service?: string; value: number[] }) => void) {
    this.valueCb = cb;
    return { remove: () => { this.removed++; this.valueCb = null; } };
  }
  onDisconnectPeripheral(cb: (e: { peripheral: string; status?: number }) => void) {
    this.discCb = cb;
    return { remove: () => { this.removed++; this.discCb = null; } };
  }

  private async doWrite(service: string, char: string, data: number[], withoutResponse: boolean, max?: number) {
    const text = String.fromCharCode(...data);
    this.log.push(`write:${text.replace(/\r/g, '\\r')}`);
    this.writes.push({ service, char, text, withoutResponse, max });
    this.inFlightWrites++;
    this.maxInFlightWrites = Math.max(this.maxInFlightWrites, this.inFlightWrites);
    try {
      if (this.opts.holdWrites) await new Promise<void>((resolve) => this.held.push(resolve));
      const answers = this.opts.answers ?? (() => true);
      if (text.startsWith('ATZ') && answers(service, char)) this.reply(service, '\r\rELM327 v1.5\r\r>');
    } finally {
      this.inFlightWrites--;
    }
  }

  /** Emette una notifica (spezzata a 20 byte) su tutte le caratteristiche notify del servizio. */
  reply(service: string, text: string, chunk = 20) {
    for (const n of this.notifying.filter((x) => x.service === service)) {
      for (const part of chunkText(text, chunk)) {
        this.valueCb?.({ peripheral: dev, characteristic: n.char, service, value: [...part].map((c) => c.charCodeAt(0)) });
      }
    }
  }

  emitRaw(e: { peripheral: string; characteristic: string; text: string }) {
    this.valueCb?.({ peripheral: e.peripheral, characteristic: e.characteristic, value: [...e.text].map((c) => c.charCodeAt(0)) });
  }

  dropLink(status = 8) {
    this.notifying = []; // la caduta del collegamento annulla le sottoscrizioni
    this.discCb?.({ peripheral: dev, status });
  }

  get hasListeners() {
    return this.valueCb !== null || this.discCb !== null;
  }
}

/** Timer che registrano il ritardo richiesto e scattano subito (test veloci e deterministici). */
function recordingTimers() {
  const delays: number[] = [];
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      delays.push(ms);
      return setTimeout(fn, 0);
    },
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  return { timers, delays };
}

function once<A extends unknown[]>(subscribe: (fn: (...a: A) => void) => () => void): Promise<A> {
  return new Promise((resolve) => {
    const off = subscribe((...a: A) => {
      off();
      resolve(a);
    });
  });
}

function make(fake: FakeBle, extra: Partial<ConstructorParameters<typeof BleTransport>[0]> = {}) {
  const { timers, delays } = recordingTimers();
  const resolved: BleConfig[] = [];
  const transport = new BleTransport({ deviceId: dev, manager: fake, timers, onConfigResolved: (c) => resolved.push(c), ...extra });
  return { transport, delays, resolved };
}

describe('BleTransport (gestore BLE finto, NON provato su dispositivo)', () => {
  it('connessione: notifiche abilitate PRIMA del primo write, poi ATZ di verifica', async () => {
    const fake = new FakeBle();
    const { transport, resolved } = make(fake);
    await transport.connect();
    const iNotify = fake.log.findIndex((l) => l.startsWith('startNotification'));
    const iWrite = fake.log.findIndex((l) => l.startsWith('write'));
    expect(iNotify).toBeGreaterThan(-1);
    expect(iWrite).toBeGreaterThan(iNotify);
    expect(fake.log.indexOf(`connect:${dev}`)).toBeLessThan(fake.log.indexOf('retrieveServices'));
    expect(fake.log.indexOf('retrieveServices')).toBeLessThan(iNotify);
    expect(fake.log[iWrite]).toBe('write:ATZ\\r');
    expect(transport.isConnected).toBe(true);
    expect(transport.kind).toBe('ble');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ notify: SIG('fff1'), write: SIG('fff2') });
    expect(transport.activeConfig).toEqual(resolved[0]);
    await transport.close();
  });

  it('il materiale di verifica (risposta ad ATZ) non arriva a onData; le notifiche successive si', async () => {
    const fake = new FakeBle();
    const { transport } = make(fake);
    const got: string[] = [];
    transport.onData((c) => got.push(c));
    await transport.connect();
    expect(got).toEqual([]);
    fake.reply(SIG('fff0'), '7E8 03 41 0D 3C\r\r>');
    expect(got.join('')).toBe('7E8 03 41 0D 3C\r\r>');
    // altri periferici o altre caratteristiche vanno ignorati
    fake.emitRaw({ peripheral: 'ALTRO', characteristic: SIG('fff1'), text: 'XXX' });
    fake.emitRaw({ peripheral: dev, characteristic: SIG('2a00'), text: 'YYY' });
    expect(got.join('')).not.toContain('XXX');
    expect(got.join('')).not.toContain('YYY');
    await transport.close();
  });

  it('write: byte ASCII, senza risposta quando la caratteristica lo consente, 20 byte per scrittura', async () => {
    const fake = new FakeBle();
    const { transport } = make(fake);
    await transport.connect();
    await transport.write('010C\r');
    const last = fake.writes.at(-1)!;
    expect(last.text).toBe('010C\r');
    expect(last.withoutResponse).toBe(true);
    expect(last.max).toBe(20);
    await transport.close();
    const { transport: t2 } = make(new FakeBle(), { maxWriteBytes: 100 });
    await t2.connect();
    await t2.write('0100\r');
    await t2.close();
  });

  it('un solo write alla volta (catena di promesse)', async () => {
    const fake = new FakeBle();
    const { transport } = make(fake);
    await transport.connect();
    fake.opts.holdWrites = true;
    const p1 = transport.write('0100\r');
    const p2 = transport.write('0105\r');
    await new Promise((r) => setTimeout(r, 5));
    expect(fake.writes.filter((w) => w.text !== 'ATZ\r').map((w) => w.text)).toEqual(['0100\r']); // il secondo attende
    fake.held.shift()!();
    await p1;
    await new Promise((r) => setTimeout(r, 5));
    expect(fake.writes.filter((w) => w.text !== 'ATZ\r').map((w) => w.text)).toEqual(['0100\r', '0105\r']);
    fake.held.shift()!();
    await p2;
    expect(fake.maxInFlightWrites).toBe(1);
    await transport.close();
  });

  it('configurazione successiva se la prima non risponde ad ATZ; quella che non risponde viene disattivata', async () => {
    const chars = [...FFF0_LAYOUT, ch('FFE0', 'FFE1', 'Notify', 'WriteWithoutResponse')];
    // FFF0 non risponde, FFE0 si'
    const fake = new FakeBle({ chars, answers: (service) => service === 'FFE0' });
    const { transport, resolved, delays } = make(fake);
    await transport.connect();
    expect(resolved[0]).toMatchObject({ service: 'FFE0', notify: 'FFE1', write: 'FFE1' });
    // le due varianti FFF0 (senza e con risposta) sono state provate prima di passare a FFE0
    const atzTargets = fake.writes.filter((w) => w.text === 'ATZ\r').map((w) => `${w.service}/${w.char}/${w.withoutResponse}`);
    expect(atzTargets[0]).toBe(`${SIG('fff0')}/${SIG('fff2')}/true`);
    expect(atzTargets.at(-1)).toBe('FFE0/FFE1/true');
    expect(fake.log.some((l) => l === `stopNotification:${SIG('fff1')}`)).toBe(true);
    expect(delays).toContain(3000); // finestra di verifica di default
    await transport.close();
  });

  it('usa per prima la configurazione salvata', async () => {
    const chars = [...FFF0_LAYOUT, ch('FFE0', 'FFE1', 'Notify', 'WriteWithoutResponse')];
    const fake = new FakeBle({ chars });
    const { transport, resolved } = make(fake, { savedConfig: { service: 'FFE0', notify: 'FFE1', write: 'FFE1', writeType: 'withoutResponse' } });
    await transport.connect();
    expect(resolved[0]).toMatchObject({ service: 'FFE0', origin: 'saved' });
    expect(fake.writes[0].service).toBe('FFE0');
    await transport.close();
  });

  it('NO_COMPATIBLE_SERVICE: nessuna caratteristica notify+write, e si scollega', async () => {
    const fake = new FakeBle({ chars: [ch('1800', '2A00', 'Read')] });
    const { transport } = make(fake);
    await expect(transport.connect()).rejects.toMatchObject({ name: 'BleTransportError', code: 'NO_COMPATIBLE_SERVICE' });
    expect(fake.log).toContain(`disconnect:${dev}`);
    expect(transport.isConnected).toBe(false);
    expect(fake.hasListeners).toBe(false);
  });

  it('NO_RESPONSE: l\'adattatore non risponde mai ad ATZ', async () => {
    const fake = new FakeBle({ answers: () => false });
    const { transport } = make(fake);
    const err = await transport.connect().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BleTransportError);
    expect((err as BleTransportError).code).toBe('NO_RESPONSE');
    expect(transport.isConnected).toBe(false);
  });

  it('errori del gestore (connect/retrieveServices) si propagano alla connect', async () => {
    await expect(make(new FakeBle({ failConnect: true })).transport.connect()).rejects.toThrow('connect failed');
    await expect(make(new FakeBle({ failRetrieve: true })).transport.connect()).rejects.toThrow('retrieve failed');
  });

  it('write senza connessione: NOT_CONNECTED', async () => {
    const { transport } = make(new FakeBle());
    await expect(transport.write('ATZ\r')).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });

  it('caduta del collegamento: onLinkLost, backoff 1 s, riconnessione con scoperta, selezione e verifica COMPLETE', async () => {
    const fake = new FakeBle();
    const { transport, delays, resolved } = make(fake);
    await transport.connect();
    const atzBefore = fake.writes.filter((w) => w.text === 'ATZ\r').length;
    const lost: (string | undefined)[] = [];
    transport.onLinkLost((r) => lost.push(r));
    const closed: (string | undefined)[] = [];
    transport.onClose((r) => closed.push(r));
    const reconnected = once((fn: () => void) => transport.onReconnected(fn));
    delays.length = 0;
    fake.dropLink(8);
    expect(lost).toEqual(['status 8']);
    expect(transport.isConnected).toBe(false);
    await expect(transport.write('0100\r')).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    await reconnected;
    expect(delays[0]).toBe(1000);
    expect(transport.isConnected).toBe(true);
    expect(closed).toEqual([]); // onClose solo alla chiusura definitiva
    expect(fake.writes.filter((w) => w.text === 'ATZ\r').length).toBe(atzBefore + 1);
    expect(fake.log.filter((l) => l === 'retrieveServices').length).toBe(2);
    expect(resolved.length).toBe(2);
    // dopo la riconnessione si scrive e si riceve
    const got: string[] = [];
    transport.onData((c) => got.push(c));
    await transport.write('0100\r');
    fake.reply(SIG('fff0'), '41 00 BE 3F\r\r>');
    expect(got.join('')).toBe('41 00 BE 3F\r\r>');
    await transport.close();
  });

  it('riconnessione fallita: ritardi 1, 2, 4 s e poi onClose definitivo', async () => {
    const fake = new FakeBle();
    const { transport, delays } = make(fake);
    await transport.connect();
    delays.length = 0;
    fake.opts.failConnect = true;
    const closed = once((fn: (r?: string) => void) => transport.onClose(fn));
    fake.dropLink(133);
    const [reason] = await closed;
    expect(delays).toEqual([1000, 2000, 4000]);
    expect(reason).toMatch(/^reconnect-failed/);
    expect(transport.isConnected).toBe(false);
  });

  it('autoReconnect=false: la caduta chiude subito', async () => {
    const fake = new FakeBle();
    const { transport } = make(fake, { autoReconnect: false });
    await transport.connect();
    const closed = once((fn: (r?: string) => void) => transport.onClose(fn));
    fake.dropLink();
    const [reason] = await closed;
    expect(reason).toBe('status 8');
  });

  it('close(): ferma le notifiche, si scollega, toglie gli ascoltatori; una caduta successiva non riconnette', async () => {
    const fake = new FakeBle();
    const { transport } = make(fake);
    await transport.connect();
    const closed: (string | undefined)[] = [];
    transport.onClose((r) => closed.push(r));
    let lostCount = 0;
    transport.onLinkLost(() => lostCount++);
    await transport.close();
    expect(fake.log).toContain(`stopNotification:${SIG('fff1')}`);
    expect(fake.log.at(-1)).toBe(`disconnect:${dev}`);
    expect(fake.removed).toBe(2);
    expect(closed).toEqual(['closed']);
    fake.dropLink();
    expect(lostCount).toBe(0);
    await transport.close(); // idempotente
    expect(closed).toEqual(['closed']);
    await expect(transport.write('x')).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });
});

describe('chunkText / Emitter', () => {
  it('spezza a N caratteri e ricompone senza perdite', () => {
    const text = '7E8 10 14 49 02 01 5A 46 41\r7E8 21 31 39 39 30 30 30 30\r\r>';
    for (const n of [1, 2, 3, 7, 20, 100]) expect(chunkText(text, n).join('')).toBe(text);
    expect(chunkText(text, 20).every((c) => c.length <= 20)).toBe(true);
    expect(chunkText('', 20)).toEqual([]);
    expect(chunkText('abc', 0)).toEqual(['abc']);
  });

  it('un ascoltatore che solleva un\'eccezione non ferma gli altri e si puo\' rimuovere', () => {
    const e = new Emitter<[number]>();
    const seen: number[] = [];
    e.on(() => {
      throw new Error('boom');
    });
    const off = e.on((n) => seen.push(n));
    e.emit(1);
    off();
    e.emit(2);
    expect(seen).toEqual([1]);
    expect(e.size).toBe(1);
    e.clear();
    expect(e.size).toBe(0);
  });
});
