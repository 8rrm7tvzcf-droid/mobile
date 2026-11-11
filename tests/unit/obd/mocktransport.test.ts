import { describe, expect, it } from 'vitest';
import { MockTransport } from '@/obd/transport';
import { loadTranscript } from './helpers';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function collect(t: MockTransport): string[] {
  const chunks: string[] = [];
  t.onData((c) => chunks.push(c));
  return chunks;
}

describe('MockTransport', () => {
  it('riproduce la trascrizione spezzata a 20 caratteri (come le notifiche BLE) senza perdere nulla', async () => {
    const fx = loadTranscript('vin-can-ath1.json');
    const entry = fx.entries[0];
    const t = new MockTransport(fx);
    const chunks = collect(t);
    await t.connect();
    await t.write(`${entry.cmd}\r`);
    await wait(5);
    expect(chunks.join('')).toBe(entry.rx.join(''));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 20)).toBe(true);
  });

  it('chunkSize null: i chunk restano come registrati', async () => {
    const t = new MockTransport([{ cmd: '0100', rx: ['7E8 06 41 00 ', 'BE 3F A8 13\r\r>'] }], { chunkSize: null });
    const chunks = collect(t);
    await t.connect();
    await t.write('0100\r');
    await wait(5);
    expect(chunks).toEqual(['7E8 06 41 00 ', 'BE 3F A8 13\r\r>']);
  });

  it('il comando si riconosce senza badare a spazi e maiuscole; ogni voce si consuma una volta sola', async () => {
    const t = new MockTransport([{ cmd: '01 0c', rx: ['7E8 04 41 0C 1A F8\r\r>'] }]);
    const chunks = collect(t);
    await t.connect();
    await t.write('010C\r');
    await wait(5);
    expect(chunks.join('')).toContain('41 0C');
    expect(t.remaining()).toHaveLength(0);
    await t.write('010C\r'); // seconda volta: fuori trascrizione
    await wait(5);
    expect(t.unmatched).toEqual(['010C']);
    expect(chunks.join('')).toContain('?');
  });

  it("comando fuori trascrizione: '?' (default) oppure silenzio", async () => {
    const nak = new MockTransport([]);
    const a = collect(nak);
    await nak.connect();
    await nak.write('ATXX\r');
    await wait(5);
    expect(a.join('')).toBe('?\r\r>');

    const silent = new MockTransport([], { unmatched: 'silent' });
    const b = collect(silent);
    await silent.connect();
    await silent.write('ATXX\r');
    await wait(5);
    expect(b).toEqual([]);
  });

  it("un CR da solo (recupero dopo un timeout) e' confermato con '>' ma si puo' disattivare", async () => {
    const t = new MockTransport([]);
    const a = collect(t);
    await t.connect();
    await t.write('\r');
    await wait(5);
    expect(a.join('')).toContain('>');
    const q = new MockTransport([], { answerLoneCr: false });
    const b = collect(q);
    await q.connect();
    await q.write('\r');
    await wait(5);
    expect(b).toEqual([]);
  });

  it('voce senza rx: l\'adattatore tace (prova dei timeout)', async () => {
    const t = new MockTransport([{ cmd: '010C', rx: [] }]);
    const chunks = collect(t);
    await t.connect();
    await t.write('010C\r');
    await wait(10);
    expect(chunks).toEqual([]);
    expect(t.written).toEqual(['010C\r']);
  });

  it('write senza connessione o dopo la chiusura solleva; simulateDisconnect chiude con il motivo', async () => {
    const t = new MockTransport([]);
    await expect(t.write('ATZ\r')).rejects.toThrow(/non connesso/);
    await t.connect();
    const reasons: (string | undefined)[] = [];
    t.onClose((r) => reasons.push(r));
    t.simulateDisconnect('cavo staccato');
    expect(reasons).toEqual(['cavo staccato']);
    await expect(t.write('ATZ\r')).rejects.toThrow();
    await t.close(); // gia' chiuso: nessun secondo evento
    expect(reasons).toEqual(['cavo staccato']);
  });

  it('close() annulla le consegne in corso', async () => {
    const t = new MockTransport([{ cmd: '0100', rx: ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA>'] }], { chunkDelayMs: 20 });
    const chunks = collect(t);
    await t.connect();
    await t.write('0100\r');
    await t.close();
    await wait(80);
    expect(chunks).toEqual([]);
  });

  it('chunkDelayMs scagliona i chunk', async () => {
    const t = new MockTransport([{ cmd: '0100', rx: ['AB', 'CD', 'EF>'] }], { chunkSize: null, chunkDelayMs: 5 });
    const stamps: number[] = [];
    t.onData(() => stamps.push(Date.now()));
    await t.connect();
    await t.write('0100\r');
    await wait(60);
    expect(stamps).toHaveLength(3);
    expect(stamps[2]).toBeGreaterThanOrEqual(stamps[0]);
  });
});
