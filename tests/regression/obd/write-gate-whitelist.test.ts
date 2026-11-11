// obd-01 (seconda parte): il blocco anti-scrittura e' una WHITELIST, non una denylist. Qui le varianti di
// scrittura (minuscole, spazi, cifra finale, CR/LF, prefissi, AT PP, ST, KWP/UDS) e la prova che tutto cio' che
// l'app invia davvero (AdapterInit, VehicleService, sonda dei PID, live) passa ancora il filtro.
import { describe, expect, it } from 'vitest';
import { classifyCommand, isAllowedCommand, isWriteCommand, READ_SERVICES } from '@/obd/protocol';
import { ElmSession, ObdConnection } from '@/obd/session';
import { SimulatedTransport } from '@/obd/transport/SimulatedTransport';

const BLOCKED: string[] = [
  // Mode 04 in tutte le forme
  '04', '041', '0400', '04 1', ' 04 1 ', '04\t1', '04 1', '0410', 'O4', '4', '0 4', '0 4 1', '0\t4',
  // minuscole e AT PP
  'atpp 0c sv 62', 'atpp ff on', 'atpps', 'atwe', 'at pp 0c sv 62',
  // cifra finale su altri servizi di scrittura/controllo
  '081', '101', '111', '141', '271', '2E1', '2F1', '311', '341', '3B1', '3D1', '851', '301', '3001', '3101',
  // UDS/KWP: servizi non in whitelist (anche quelli di lettura non usati dall'app)
  '2E F1 90 00', '14FFFFFF', '1003', '1101', '2701', '2F0101', '3E00', '22F190', '1902AF', '18', '1A87', '2101', '3300', '3200', '8300',
  // CR/LF e piu' righe
  '04\r', '04\n', '\r04', '\n041\r\n', '0100\r04', '0100\n04', '0100\r\n041\r', '010C\rATPP FF ON', '0A1\r04', '04\r0100',
  // comandi AT/ST fuori whitelist
  'ATPP 0C SV 62', 'ATPP FF ON', 'ATPP FF OFF', 'ATPPS', 'ATPP', 'ATPP0C', 'AT@2', 'AT@3', 'AT @3 XYZ', 'ATSH 7E0', 'ATSH7DF', 'ATCRA 7E8',
  'ATMA', 'ATBD', 'ATBRD 23', 'ATBRT 20', 'ATIB 10', 'ATPB C0 01', 'ATSW 00', 'ATSD 00', 'ATRD', 'ATWM 1122', 'ATSS', 'ATIIA 01', 'ATCAF0',
  'ATTA 7E0', 'STPCP', 'STPCPD', 'STPO', 'STFAP 7E8,FFF', 'STCSEGT 1', 'STWBR', 'STPTO 100', 'STSLCS 1', 'STSATI 01', 'STSAVE', 'STP 33',
  'STPBR 500000', 'ATSP', 'ATSPD', 'ATSP00', 'ATE2', 'ATZ1', 'ATZ04', 'ATI04', 'ATRV1', 'ATDPN1', 'ATH', 'ATAT', 'ATAT3', 'STI04',
  // non riconosciuti / malformati / caratteri di controllo e Unicode
  '0', '1', 'X', 'ZZ', '01ZZ', '01;04', '01&04', '01,04', '01-04', '0100>04', '0100\u0000', '\u00000100', '０４', '04​', 'AT\u0000PP',
];

describe('whitelist dei comandi: varianti di scrittura bloccate', () => {
  it.each(BLOCKED)('bloccato: %j', (cmd) => {
    expect(classifyCommand(cmd)).toBe('blocked');
    expect(isAllowedCommand(cmd)).toBe(false);
    expect(isWriteCommand(cmd)).toBe(true);
  });

  it('un comando vuoto non e\' ammesso (ElmSession non lo spedisce comunque)', () => {
    expect(isAllowedCommand('')).toBe(false);
    expect(isAllowedCommand('   ')).toBe(false);
    expect(isAllowedCommand('\r')).toBe(false);
  });

  it('i servizi in whitelist sono solo quelli di lettura previsti (tutti gli altri 248 sono bloccati)', () => {
    expect([...READ_SERVICES].sort((a, b) => a - b)).toEqual([0x01, 0x02, 0x03, 0x05, 0x06, 0x07, 0x09, 0x0a]);
    for (let svc = 0; svc < 256; svc++) {
      const hex = svc.toString(16).padStart(2, '0');
      const expected = READ_SERVICES.includes(svc);
      for (const cmd of [hex, hex.toUpperCase(), hex + '00', hex + '1', hex.toUpperCase() + ' 1', ` ${hex} `]) {
        expect(isAllowedCommand(cmd), cmd).toBe(expected);
      }
    }
  });

  it('ElmSession: nessuna variante bloccata arriva al trasporto e i codici restano', async () => {
    const t = new SimulatedTransport({ scenario: 'mil-on', searchDelayMs: 0, latencyMs: 0, chunkDelayMs: 0 });
    const s = new ElmSession(t, { recoveryMs: 20, timeoutScale: 0.05 });
    await s.open();
    for (const c of ['ATZ', 'ATE0', 'ATH1', 'ATSP0']) expect((await s.send(c)).status).toBe('ok');
    expect((await s.send('0100', { kind: 'search', timeoutMs: 500 })).status).toBe('ok');
    const before = (await s.send('03')).lines.join(' ');
    const sent = t.received.length;
    // ElmSession toglie CR/LF prima del filtro (un solo comando per riga): le varianti che dopo la pulizia diventano
    // una richiesta di lettura lecita (es. 0100+CR+04 = 010004) viaggiano come UNA riga e non sono scritture.
    const stillBlocked = BLOCKED.filter((c) => !isAllowedCommand(c.replace(/[\r\n]/g, '').trim()));
    expect(stillBlocked.length).toBeGreaterThan(100);
    for (const cmd of stillBlocked) {
      const r = await s.send(cmd);
      expect(r.status, JSON.stringify(cmd)).toBe('error');
      expect(r.error?.code, JSON.stringify(cmd)).toMatch(/^(WRITE_BLOCKED|MALFORMED_FRAME)$/);
    }
    expect(t.received.length).toBe(sent); // nulla di nuovo sul trasporto
    expect((await s.send('03')).lines.join(' ')).toBe(before);
    expect(before).toContain('43');
    await s.close();
  });
});

describe("whitelist dei comandi: i comandi che l'app invia davvero passano", () => {
  it("comandi AT/ST dell'init e di VehicleService", () => {
    const cmds = ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH1', 'ATAT1', 'ATRV', 'ATSP0', 'ATDPN', 'ATI', 'AT@1', 'STI', 'ATAMC', 'ATFE', 'ATWS', 'atdpn', 'at z'];
    for (const p of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C']) cmds.push('ATSP' + p, 'ATTP' + p, 'ATTPA' + p);
    for (const c of cmds) expect(classifyCommand(c), c).toBe('adapter-config');
  });

  it('richieste OBD di lettura, anche con spazi, minuscole, CR finale e cifra finale', () => {
    for (const c of ['0100', '0120', '01C0', '010C', '01 0C', '01 0c', '010C1', '0105 1', '010B040C05', '0200', '020200', '03', '07', '0A', '0902', '0900', '0600', '0500', '0100\r', '0100\n']) {
      expect(classifyCommand(c), c).toBe('obd-read');
    }
  });

  it("tutti i comandi inviati da init, capacita', snapshot e live (anche con protocollo salvato e ricerca) sono ammessi", async () => {
    const written: string[] = [];
    const blockedByGate: string[] = [];
    const run = async (scenario: 'mil-on' | 'ignition-off', init: { savedProtocol?: string; tryFallbackProtocols?: boolean; unableRetries?: number }) => {
      const t = new SimulatedTransport({ scenario, searchDelayMs: 0, latencyMs: 0, chunkDelayMs: 0 });
      const c = new ObdConnection({
        transport: t,
        session: { recoveryMs: 20, timeoutScale: 0.05 },
        init: { unableRetryDelayMs: 1, noDataRetryDelayMs: 1, postResetDelayMs: 1, ...init },
        vehicle: { pendingDelayMs: 1 },
      });
      const orig = c.session.send.bind(c.session);
      c.session.send = async (cmd, opts) => {
        const r = await orig(cmd, opts);
        if (r.error?.code === 'WRITE_BLOCKED') blockedByGate.push(cmd);
        return r;
      };
      const opened = await c.open();
      if (opened.ok) {
        const v = c.vehicle!;
        const caps = await v.discoverCapabilities();
        await v.readSnapshot({ capabilities: caps });
        await v.readSnapshot();
        await v.readAdapterVoltage();
        const live = v.liveStream({ hz: 8, multiPid: true, onSample: () => undefined });
        await new Promise((r) => setTimeout(r, 400));
        await live.stop();
      }
      written.push(...t.received);
      await c.close();
      return opened;
    };
    expect((await run('mil-on', {})).ok).toBe(true);
    expect((await run('mil-on', { savedProtocol: '6' })).ok).toBe(true);
    await run('ignition-off', { tryFallbackProtocols: true, unableRetries: 0 });

    expect(blockedByGate).toEqual([]);
    expect(written.length).toBeGreaterThan(40);
    for (const w of written) {
      const cmd = w.replace(/[\r\n]/g, '');
      if (cmd.trim() === '') continue; // CR di recupero: ripete solo l'ultimo comando gia' ammesso
      expect(isAllowedCommand(cmd), JSON.stringify(w)).toBe(true);
    }
    const distinct = new Set(written.map((w) => w.replace(/[\r\n]/g, '')));
    for (const must of ['ATZ', 'ATSP0', '0100', '010C', '0902', '03', '07', '0A', 'ATRV', 'ATTPA6']) expect(distinct.has(must), must).toBe(true);
  });
});
