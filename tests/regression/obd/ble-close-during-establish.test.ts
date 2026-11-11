// BleTransport.close() chiamato mentre una (ri)connessione e' in corso: la connessione in corso NON viene
// annullata, completa dopo la chiusura, riattacca i listener e lascia l'adattatore collegato.
import { describe, expect, it } from 'vitest';
import { BleTransport, type BleCharacteristic, type BleManagerLike } from '@/obd/transport';
import type { Timers } from '@/obd/transport/types';
import { ElmSession } from '@/obd/session';

const dev = 'AA:BB:CC:DD:EE:FF';
const SIG = (s: string) => `0000${s}-0000-1000-8000-00805f9b34fb`;
const CHARS: BleCharacteristic[] = [
  { service: SIG('fff0'), characteristic: SIG('fff1'), properties: { Notify: 'Notify' } },
  { service: SIG('fff0'), characteristic: SIG('fff2'), properties: { WriteWithoutResponse: 'WriteWithoutResponse' } },
];

class FakeBle implements BleManagerLike {
  log: string[] = [];
  connectCalls = 0;
  gate: Promise<void> | null = null;
  private valueCb: ((e: { peripheral: string; characteristic: string; value: number[] }) => void) | null = null;
  private discCb: ((e: { peripheral: string; status?: number }) => void) | null = null;
  private notifying = false;
  linkUp = false;
  async isStarted() { return true; }
  async start() {}
  async connect(id: string) {
    this.connectCalls++;
    this.log.push('connect');
    if (this.gate) await this.gate;
    this.linkUp = true;
    void id;
  }
  async disconnect() { this.log.push('disconnect'); this.linkUp = false; this.notifying = false; }
  async retrieveServices() { return { characteristics: CHARS }; }
  async startNotification() { this.log.push('startNotification'); this.notifying = true; }
  async stopNotification() { this.log.push('stopNotification'); this.notifying = false; }
  async write(_i: string, _s: string, _c: string, data: number[]) { await this.wr(data); }
  async writeWithoutResponse(_i: string, _s: string, _c: string, data: number[]) { await this.wr(data); }
  private async wr(data: number[]) {
    const text = String.fromCharCode(...data);
    if (text.startsWith('ATZ') && this.notifying) {
      const t = '\r\rELM327 v1.5\r\r>';
      this.valueCb?.({ peripheral: dev, characteristic: SIG('fff1'), value: [...t].map((c) => c.charCodeAt(0)) });
    }
  }
  onDidUpdateValueForCharacteristic(cb: (e: { peripheral: string; characteristic: string; value: number[] }) => void) {
    this.valueCb = cb;
    return { remove: () => { this.valueCb = null; } };
  }
  onDisconnectPeripheral(cb: (e: { peripheral: string; status?: number }) => void) {
    this.discCb = cb;
    return { remove: () => { this.discCb = null; } };
  }
  dropLink() { this.linkUp = false; this.notifying = false; this.discCb?.({ peripheral: dev, status: 8 }); }
  get hasListeners() { return this.valueCb !== null || this.discCb !== null; }
}

const fastTimers: Timers = {
  setTimeout: (fn) => setTimeout(fn, 0),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('BleTransport.close() durante una connessione in corso', () => {
  it('riconnessione automatica in corso + close(): alla fine l\'adattatore deve essere scollegato e senza listener', async () => {
    const fake = new FakeBle();
    const transport = new BleTransport({ deviceId: dev, manager: fake, timers: fastTimers });
    await transport.connect();
    expect(transport.isConnected).toBe(true);

    let release!: () => void;
    fake.gate = new Promise<void>((r) => (release = r));
    fake.dropLink(); // parte il ciclo di riconnessione
    await tick();
    expect(fake.connectCalls).toBe(2); // tentativo di riconnessione fermo su connect()

    await transport.close(); // l'utente chiude mentre si riconnette
    release();
    await tick(60);

    expect(transport.isConnected).toBe(false);
    expect(fake.hasListeners).toBe(false);
    expect(fake.linkUp).toBe(false);
  });

  it('close() durante la prima connect(): la connessione non deve completarsi dopo la chiusura', async () => {
    const fake = new FakeBle();
    let release!: () => void;
    fake.gate = new Promise<void>((r) => (release = r));
    const transport = new BleTransport({ deviceId: dev, manager: fake, timers: fastTimers });
    const connecting = transport.connect().catch(() => undefined);
    await tick();
    await transport.close();
    release();
    await connecting;
    await tick(60);

    expect(transport.isConnected).toBe(false);
    expect(fake.hasListeners).toBe(false);
    expect(fake.linkUp).toBe(false);
  });

  it('chiusura definitiva decisa dal trasporto (autoReconnect: false): chiudere la sessione deve rilasciare i listener del gestore BLE', async () => {
    const fake = new FakeBle();
    const transport = new BleTransport({ deviceId: dev, manager: fake, timers: fastTimers, autoReconnect: false });
    const session = new ElmSession(transport, { recoveryMs: 20 });
    await session.open();
    fake.dropLink(); // il trasporto emette onClose definitivo, la sessione passa a 'closed'
    await tick();
    expect(session.isOpen).toBe(false);

    await session.close(); // chi ha creato la sessione la chiude: deve liberare il trasporto
    expect(fake.hasListeners).toBe(false);
  });
});
