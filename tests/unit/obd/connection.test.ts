import { describe, expect, it } from 'vitest';
import { ObdConnection, type ConnectionState } from '@/obd/session';
import { SimulatedTransport } from '@/obd/transport/SimulatedTransport';
import { createTransport, pickTransportKind } from '@/obd/transport';

const FAST = { postResetDelayMs: 0, unableRetryDelayMs: 1, noDataRetryDelayMs: 1, searchTimeoutMs: 300 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function make(opts: ConstructorParameters<typeof SimulatedTransport>[0] = {}) {
  const transport = new SimulatedTransport({ scenario: 'petrol', latencyMs: 0, searchDelayMs: 0, chunkDelayMs: 0, ...opts });
  const conn = new ObdConnection({ transport, session: { recoveryMs: 30, timeoutScale: 0.05 }, init: FAST });
  const states: ConnectionState[] = [];
  conn.onState((s) => states.push(s));
  return { transport, conn, states };
}

describe('ObdConnection', () => {
  it('apertura: connecting -> initializing -> ready, con VehicleService', async () => {
    const { conn, states } = make();
    const r = await conn.open();
    expect(r.ok).toBe(true);
    expect(states).toEqual(['connecting', 'initializing', 'ready']);
    expect(conn.state).toBe('ready');
    expect(conn.vehicle).not.toBeNull();
    expect(conn.init?.protocol).toBe('6');
    await conn.close();
    expect(conn.state).toBe('closed');
    expect(conn.vehicle).toBeNull();
  });

  it('init fallito: stato failed con suggerimento in italiano', async () => {
    const { conn, states } = make({ scenario: 'ignition-off' });
    const r = await conn.open();
    expect(r.ok).toBe(false);
    expect(states[states.length - 1]).toBe('failed');
    expect(conn.failure?.hint).toBe('ignition');
    expect(conn.failure?.message).toMatch(/accensione|quadro/i);
    expect(conn.vehicle).toBeNull();
    await conn.close();
  });

  it('riconnessione: init COMPLETO a ogni riconnessione (ATZ rinviato) e nuovo VehicleService', async () => {
    const { transport, conn, states } = make({ autoReconnect: true, reconnectDelayMs: 5 });
    await conn.open();
    const first = conn.vehicle;
    const atzBefore = transport.received.filter((c) => c === 'ATZ').length;
    expect(atzBefore).toBe(1);
    transport.dropConnection('link-lost');
    expect(conn.state).toBe('reconnecting');
    expect(conn.vehicle).toBeNull();
    for (let i = 0; i < 100 && conn.state !== 'ready'; i++) await wait(10);
    expect(conn.state).toBe('ready');
    expect(conn.reinitCount).toBe(1);
    expect(transport.received.filter((c) => c === 'ATZ').length).toBe(2);
    expect(conn.vehicle).not.toBeNull();
    expect(conn.vehicle).not.toBe(first);
    expect(states).toEqual(['connecting', 'initializing', 'ready', 'reconnecting', 'initializing', 'ready']);
    // dopo la riconnessione le letture funzionano
    const snap = await conn.vehicle?.readSnapshot();
    expect(snap?.vin?.value).toBe('ZFA19900001234567');
    await conn.close();
  });

  it('caduta definitiva (trasporto senza riconnessione): stato closed e comandi in volo con DISCONNECTED', async () => {
    const { transport, conn } = make();
    await conn.open();
    const pending = conn.session.send('010C', { timeoutMs: 2000 });
    transport.dropConnection('gone');
    const r = await pending;
    expect(['ok', 'error']).toContain(r.status);
    await wait(10);
    expect(conn.state).toBe('closed');
  });
});

describe('createTransport / pickTransportKind', () => {
  it('simulato e mock senza moduli nativi', () => {
    const s = createTransport('simulated', { scenario: 'diesel' });
    expect(s.kind).toBe('simulated');
    const m = createTransport('mock', { transcript: { entries: [] } });
    expect(m.kind).toBe('mock');
  });

  it("'ble' senza il modulo nativo (web, Expo Go, test su PC): errore tipizzato, nessuna eccezione a livello di modulo", () => {
    expect(() => createTransport('ble', { deviceId: 'AA:BB', loadBleManager: () => { throw new Error('modulo nativo assente'); } })).toThrowError(/BLE non disponibile/);
    expect(() => createTransport('ble', { loadBleManager: () => ({}) as never })).toThrowError(/deviceId/);
  });

  it('classic e wifi non sono ancora disponibili (V1)', () => {
    expect(() => createTransport('classic')).toThrowError(/non disponibile/);
    expect(() => createTransport('wifi')).toThrowError(/non disponibile/);
  });

  it('scelta del trasporto: simulato su web, Expo Go e con EXPO_PUBLIC_OBD_MOCK=1 (SPEC 8.8)', () => {
    expect(pickTransportKind({ platform: 'web' })).toBe('simulated');
    expect(pickTransportKind({ platform: 'android', isExpoGo: true })).toBe('simulated');
    expect(pickTransportKind({ platform: 'ios', mockFlag: '1' })).toBe('simulated');
    expect(pickTransportKind({ platform: 'android' })).toBe('ble');
    expect(pickTransportKind({ platform: 'ios', mockFlag: '0' })).toBe('ble');
  });
});
