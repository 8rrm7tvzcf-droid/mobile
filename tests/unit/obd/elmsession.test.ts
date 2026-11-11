import { describe, expect, it } from 'vitest';
import { ElmSession, KIND_DEFAULTS, commandKind, type SessionEvent } from '@/obd/session';
import { MockTransport } from '@/obd/transport/MockTransport';
import { parseVinResponse } from '@/obd/protocol';
import { loadTranscript } from './helpers';

function makeSession(entries: { cmd: string; rx: string[] }[], mock: ConstructorParameters<typeof MockTransport>[1] = {}, sess: ConstructorParameters<typeof ElmSession>[1] = {}) {
  const transport = new MockTransport(entries, mock);
  const session = new ElmSession(transport, { recoveryMs: 40, ...sess });
  return { transport, session };
}

describe('ElmSession: risposta e buffering', () => {
  it('accumula i chunk fino al prompt e normalizza (eco, righe vuote)', async () => {
    const fx = loadTranscript('vin-can-ath1.json');
    for (const size of [1, 3, 5, 20, null]) {
      const { session } = makeSession(fx.entries.slice(0, 1), { chunkSize: size });
      await session.open();
      const r = await session.send('0902');
      expect(r.status, `chunk ${String(size)}`).toBe('ok');
      expect(r.lines).toHaveLength(3);
      const vin = parseVinResponse(r, { protocol: '6' });
      expect(vin.ok && vin.value.value).toBe('ZFA19900001234567');
      await session.close();
    }
  });

  it("il prompt '>' puo' arrivare da solo nell'ultima notifica", async () => {
    const { session } = makeSession([{ cmd: '010D', rx: ['7E8 03 41 0D 3C 00 00 00\r', '\r', '>'] }], { chunkSize: null });
    await session.open();
    const r = await session.send('010D');
    expect(r.status).toBe('ok');
    expect(r.lines).toEqual(['7E8 03 41 0D 3C 00 00 00']);
  });

  it("toglie l'eco anche con spazi/minuscole e il NUL", async () => {
    const { session } = makeSession([{ cmd: '01 0C', rx: ['\u000001 0c\r\u00007E8 04 41 0C 1A F8 00 00\r\r>'] }]);
    await session.open();
    const r = await session.send('01 0C');
    expect(r.status).toBe('ok');
    expect(r.lines).toEqual(['7E8 04 41 0C 1A F8 00 00']);
  });

  it('classifica NO DATA, UNABLE TO CONNECT, ? e altri errori', async () => {
    const { session } = makeSession([
      { cmd: '010C', rx: ['NO DATA\r\r>'] },
      { cmd: '0100', rx: ['SEARCHING...\rUNABLE TO CONNECT\r\r>'] },
      { cmd: 'ATAMC', rx: ['?\r\r>'] },
      { cmd: '0105', rx: ['CAN ERROR\r\r>'] },
    ]);
    await session.open();
    expect((await session.send('010C', { retryNoData: 0 })).status).toBe('no_data');
    const unable = await session.send('0100', { kind: 'search' });
    expect(unable.status).toBe('unable');
    expect(unable.searched).toBe(true);
    expect((await session.send('ATAMC')).status).toBe('unknown');
    const err = await session.send('0105');
    expect(err.status).toBe('error');
    expect(err.error?.code).toBe('CAN_ERROR');
  });

  it('DATA ERROR con altre righe valide e\' un avviso, non un errore', async () => {
    const { session } = makeSession([{ cmd: '0105', rx: ['7E8 03 41 05 7B 00 00 00 00\r<DATA ERROR\r\r>'] }]);
    await session.open();
    const r = await session.send('0105');
    expect(r.status).toBe('ok');
    expect(r.warnings.map((w) => w.code)).toEqual(['DATA_ERROR']);
  });
});

describe('ElmSession: coda, un solo comando in volo', () => {
  it('serializza 30 comandi inviati insieme e rispetta l\'ordine FIFO', async () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({ cmd: '0105', rx: [`7E8 03 41 05 ${(40 + i).toString(16).toUpperCase().padStart(2, '0')} 00 00 00\r\r>`] }));
    const { transport, session } = makeSession(entries);
    await session.open();
    const promises = entries.map(() => session.send('0105'));
    const results = await Promise.all(promises);
    expect(results.every((r) => r.status === 'ok')).toBe(true);
    // ogni risposta arriva al suo comando, nell'ordine
    results.forEach((r, i) => {
      expect(r.lines[0]).toContain(`41 05 ${(40 + i).toString(16).toUpperCase().padStart(2, '0')}`);
    });
    expect(transport.written).toHaveLength(30);
    expect(transport.maxInFlight).toBe(1);
    expect(transport.unmatched).toEqual([]);
  });

  it('un comando utente passa avanti a quelli di polling in coda (non a quello in volo)', async () => {
    const order: string[] = [];
    const entries = ['010C', '010D', '0105', '0104'].map((cmd) => ({ cmd, rx: ['NO DATA\r\r>'] }));
    const { session } = makeSession(entries);
    await session.open();
    const a = session.send('010C', { priority: 'poll', retryNoData: 0 }).then(() => order.push('010C'));
    const b = session.send('010D', { priority: 'poll', retryNoData: 0 }).then(() => order.push('010D'));
    const c = session.send('0105', { priority: 'normal', retryNoData: 0 }).then(() => order.push('0105'));
    const d = session.send('0104', { priority: 'user', retryNoData: 0 }).then(() => order.push('0104'));
    await Promise.all([a, b, c, d]);
    // 010C era gia' in volo; poi utente, normale, poll
    expect(order).toEqual(['010C', '0104', '0105', '010D']);
  });

  it('stessa priorita\': FIFO', async () => {
    const order: number[] = [];
    const entries = Array.from({ length: 5 }, () => ({ cmd: '0105', rx: ['OK\r\r>'] }));
    const { session } = makeSession(entries);
    await session.open();
    await Promise.all(entries.map((_, i) => session.send('0105', { priority: 'poll' }).then(() => order.push(i))));
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it('comando vuoto o con CR incorporati non spedisce piu\' comandi', async () => {
    const { transport, session } = makeSession([{ cmd: '010C', rx: ['NO DATA\r\r>'] }]);
    await session.open();
    const empty = await session.send('   ');
    expect(empty.status).toBe('error');
    const r = await session.send('010C\r0105', { retryNoData: 0 });
    // i CR sono tolti: e' un unico comando '010C0105' non in trascrizione
    expect(transport.written).toEqual(['010C0105\r']);
    expect(r.status).toBe('unknown');
  });
});

describe('ElmSession: timeout, retry, recupero', () => {
  it('timeout: un CR di recupero riporta al prompt, stato timeout', async () => {
    const { transport, session } = makeSession([{ cmd: '010C', rx: [] }]);
    await session.open();
    const r = await session.send('010C', { timeoutMs: 30, retries: 0 });
    expect(r.status).toBe('timeout');
    expect(r.error?.code).toBe('TIMEOUT');
    expect(transport.written).toEqual(['010C\r', '\r']);
    expect(session.isDesynced).toBe(false);
  });

  it('retry dopo timeout: la seconda volta risponde', async () => {
    const { session } = makeSession([
      { cmd: '010C', rx: [] },
      { cmd: '010C', rx: ['7E8 04 41 0C 1A F8 00 00\r\r>'] },
    ]);
    await session.open();
    const r = await session.send('010C', { timeoutMs: 30, retries: 1 });
    expect(r.status).toBe('ok');
    expect(r.attempts).toBe(2);
  });

  it('senza prompt dopo il CR la sessione risulta sfasata (desync) e si recupera al prompt successivo', async () => {
    const events: SessionEvent[] = [];
    const { session } = makeSession([{ cmd: '010C', rx: [] }, { cmd: '0105', rx: ['7E8 03 41 05 7B 00 00 00 00\r\r>'] }], { answerLoneCr: false });
    session.onEvent((e) => events.push(e));
    await session.open();
    const r = await session.send('010C', { timeoutMs: 30, retries: 1 });
    expect(r.status).toBe('timeout');
    expect(r.attempts).toBe(1); // con la sessione sfasata non si ritenta
    expect(session.isDesynced).toBe(true);
    expect(events.some((e) => e.type === 'desync')).toBe(true);
    const ok = await session.send('0105');
    expect(ok.status).toBe('ok');
    expect(session.isDesynced).toBe(false);
  });

  it('NO DATA: un retry per i comandi Mode 01, poi no_data', async () => {
    const { session } = makeSession([
      { cmd: '010C', rx: ['NO DATA\r\r>'] },
      { cmd: '010C', rx: ['NO DATA\r\r>'] },
    ]);
    await session.open();
    const r = await session.send('010C');
    expect(r.status).toBe('no_data');
    expect(r.attempts).toBe(1 + KIND_DEFAULTS.mode01.retryNoData);
  });

  it('NO DATA seguito da una risposta valida al secondo tentativo', async () => {
    const { session } = makeSession([
      { cmd: '010C', rx: ['NO DATA\r\r>'] },
      { cmd: '010C', rx: ['7E8 04 41 0C 1A F8 00 00\r\r>'] },
    ]);
    await session.open();
    const r = await session.send('010C');
    expect(r.status).toBe('ok');
    expect(r.attempts).toBe(2);
  });

  it('BUS BUSY e DATA ERROR vengono ritentati', async () => {
    const { session } = makeSession([
      { cmd: '0105', rx: ['BUS BUSY\r\r>'] },
      { cmd: '0105', rx: ['<DATA ERROR\r\r>'] },
      { cmd: '0105', rx: ['7E8 03 41 05 7B 00 00 00 00\r\r>'] },
    ]);
    await session.open();
    const r = await session.send('0105', { retries: 2 });
    expect(r.status).toBe('ok');
    expect(r.attempts).toBe(3);
  });

  it('UNABLE TO CONNECT e \'?\' non si ritentano', async () => {
    const { transport, session } = makeSession([{ cmd: '0100', rx: ['SEARCHING...\rUNABLE TO CONNECT\r\r>'] }]);
    await session.open();
    const r = await session.send('0100', { kind: 'search' });
    expect(r.status).toBe('unable');
    expect(r.attempts).toBe(1);
    expect(transport.written).toHaveLength(1);
  });

  it('tipi di comando: timeout e retry per tipo (SPEC 8.7)', () => {
    expect(commandKind('ATZ')).toBe('reset');
    expect(commandKind('ATE0')).toBe('config');
    expect(commandKind('STI')).toBe('config');
    expect(commandKind('010C')).toBe('mode01');
    expect(commandKind('02 02 00')).toBe('mode02');
    expect(commandKind('03')).toBe('mode03');
    expect(commandKind('0A')).toBe('mode03');
    expect(commandKind('0902')).toBe('mode09');
    expect(KIND_DEFAULTS.reset.timeoutMs).toBe(5000);
    expect(KIND_DEFAULTS.config.timeoutMs).toBe(1000);
    expect(KIND_DEFAULTS.mode01.timeoutMs).toBe(2000);
    expect(KIND_DEFAULTS.search.timeoutMs).toBe(15000);
    expect(KIND_DEFAULTS.mode09.timeoutMs).toBeGreaterThanOrEqual(3000);
    expect(KIND_DEFAULTS.mode09.timeoutMs).toBeLessThanOrEqual(5000);
    expect(KIND_DEFAULTS.mode03.timeoutMs).toBeGreaterThanOrEqual(3000);
  });
});

describe('ElmSession: nessuna scrittura nell\'MVP', () => {
  it('blocca Mode 04 e i servizi di scrittura senza toccare il trasporto', async () => {
    const { transport, session } = makeSession([{ cmd: '04', rx: ['44\r\r>'] }]);
    await session.open();
    for (const cmd of ['04', '0400', '14FFFFFF', '2E F1 90 00', '3101']) {
      const r = await session.send(cmd);
      expect(r.status).toBe('error');
      expect(r.error?.code).toBe('WRITE_BLOCKED');
    }
    expect(transport.written).toEqual([]);
  });

  it('con allowWrite esplicito il comando passa (riservato alla V1)', async () => {
    const { transport, session } = makeSession([{ cmd: '04', rx: ['44\r\r>'] }], {}, { allowWrite: true });
    await session.open();
    const r = await session.send('04');
    expect(r.status).toBe('ok');
    expect(transport.written).toEqual(['04\r']);
  });
});

describe('ElmSession: chiusura, log, trascrizioni', () => {
  it('la chiusura risolve i comandi in coda con DISCONNECTED', async () => {
    const { session } = makeSession([{ cmd: '010C', rx: [] }, { cmd: '010D', rx: ['OK\r\r>'] }]);
    await session.open();
    const a = session.send('010C', { timeoutMs: 5000, retries: 0 });
    const b = session.send('010D');
    await new Promise((r) => setTimeout(r, 10));
    await session.close();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.error?.code).toBe('DISCONNECTED');
    expect(rb.error?.code).toBe('DISCONNECTED');
    const later = await session.send('0100');
    expect(later.error?.code).toBe('DISCONNECTED');
  });

  it('la caduta del trasporto fa fallire il comando in volo e segnala la chiusura', async () => {
    const events: SessionEvent[] = [];
    const { transport, session } = makeSession([{ cmd: '010C', rx: [] }]);
    session.onEvent((e) => events.push(e));
    await session.open();
    const p = session.send('010C', { timeoutMs: 5000, retries: 0 });
    setTimeout(() => transport.simulateDisconnect('link-lost'), 10);
    const r = await p;
    expect(r.error?.code).toBe('DISCONNECTED');
    expect(events.some((e) => e.type === 'closed')).toBe(true);
  });

  it('il log grezzo si esporta come trascrizione {cmd, rx[]} riutilizzabile', async () => {
    const { session } = makeSession([{ cmd: '0902', rx: ['7E8 10 14 49 02 01 5A 46 41\r7E8 21 31 39 39 30 30 30 30\r7E8 22 31 32 33 34 35 36 37\r\r>'] }]);
    await session.open();
    await session.send('0902');
    const tr = session.exportTranscript();
    expect(tr).toHaveLength(1);
    expect(tr[0].cmd).toBe('0902');
    expect(tr[0].rx.length).toBeGreaterThan(1); // chunk da 20 caratteri
    expect(tr[0].rx.join('')).toContain('7E8 22 31 32');
    // la trascrizione registrata, rigiocata, da' lo stesso risultato
    const again = makeSession(tr);
    await again.session.open();
    const r = await again.session.send('0902');
    const vin = parseVinResponse(r, { protocol: '6' });
    expect(vin.ok && vin.value.value).toBe('ZFA19900001234567');
    expect(session.getLog().every((e) => typeof e.t === 'number')).toBe(true);
  });
});
