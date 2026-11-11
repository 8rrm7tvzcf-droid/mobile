import { describe, expect, it } from 'vitest';
import { isOkResponse, normalizeResponse } from '@/obd/protocol';

describe('normalizeResponse', () => {
  it('toglie eco, righe vuote e prompt', () => {
    const n = normalizeResponse('ATE0\rOK\r\r>', 'ATE0');
    expect(n.lines).toEqual(['OK']);
    expect(n.echoRemoved).toBe(true);
    expect(n.errors).toEqual([]);
    expect(isOkResponse(n)).toBe(true);
  });

  it('toglie i byte NUL e il rumore non ASCII', () => {
    const n = normalizeResponse('\u0000\u0000OKÿ\r\u0000\r>', 'ATL0');
    expect(n.lines).toEqual(['OK']);
  });

  it('riconosce l\'eco anche con spazi e minuscole', () => {
    const n = normalizeResponse('01 0c\r7E8 04 41 0C 1A F8 00 00\r\r>', '010C');
    expect(n.echoRemoved).toBe(true);
    expect(n.lines).toEqual(['7E8 04 41 0C 1A F8 00 00']);
  });

  it('non scambia una risposta per eco se differisce dal comando', () => {
    const n = normalizeResponse('7E8 03 41 05 7B 00 00 00 00\r\r>', '0105');
    expect(n.echoRemoved).toBe(false);
    expect(n.lines).toHaveLength(1);
  });

  it('toglie SEARCHING... e lo segnala', () => {
    const n = normalizeResponse('0100\rSEARCHING...\r7E8 06 41 00 BE 3E B8 11 00\r\r>', '0100');
    expect(n.searching).toBe(true);
    expect(n.lines).toEqual(['7E8 06 41 00 BE 3E B8 11 00']);
  });

  it('gestisce SEARCHING... attaccato alla riga successiva', () => {
    const n = normalizeResponse('SEARCHING...UNABLE TO CONNECT\r\r>', '0100');
    expect(n.searching).toBe(true);
    expect(n.errors.map((e) => e.code)).toEqual(['UNABLE_TO_CONNECT']);
    expect(n.lines).toEqual([]);
  });

  it('classifica le stringhe di errore', () => {
    const cases: [string, string][] = [
      ['NO DATA', 'NO_DATA'],
      ['UNABLE TO CONNECT', 'UNABLE_TO_CONNECT'],
      ['BUS INIT: ...ERROR', 'BUS_INIT_ERROR'],
      ['BUS INIT: ERROR', 'BUS_INIT_ERROR'],
      ['CAN ERROR', 'CAN_ERROR'],
      ['BUS ERROR', 'BUS_ERROR'],
      ['FB ERROR', 'FB_ERROR'],
      ['BUS BUSY', 'BUS_BUSY'],
      ['DATA ERROR', 'DATA_ERROR'],
      ['<DATA ERROR', 'DATA_ERROR'],
      ['<RX ERROR', 'RX_ERROR'],
      ['STOPPED', 'STOPPED'],
      ['BUFFER FULL', 'BUFFER_FULL'],
      ['LV RESET', 'LV_RESET'],
      ['ERR94', 'ERR94'],
      ['?', 'UNKNOWN_COMMAND'],
      ['no data', 'NO_DATA'],
    ];
    for (const [text, code] of cases) {
      const n = normalizeResponse(`${text}\r\r>`, 'X');
      expect(n.errors.map((e) => e.code), text).toEqual([code]);
      expect(n.lines, text).toEqual([]);
    }
  });

  it("'BUS INIT: OK' e' informativo", () => {
    const n = normalizeResponse('BUS INIT: ...OK\r48 6B 10 41 00 BE 3E B8 11 FA\r\r>', '0100');
    expect(n.busInitOk).toBe(true);
    expect(n.errors).toEqual([]);
    expect(n.lines).toHaveLength(1);
  });

  it('gli avvisi di basso consumo non sono errori', () => {
    const n = normalizeResponse('!ACT ALERT\rOK\r\r>', 'ATI');
    expect(n.alerts.map((a) => a.code)).toEqual(['ACT_ALERT']);
    expect(n.errors).toEqual([]);
    expect(n.lines).toEqual(['OK']);
    expect(normalizeResponse('LP ALERT\r\r>').alerts.map((a) => a.code)).toEqual(['LP_ALERT']);
  });

  it('mantiene le righe utili accanto a un errore morbido', () => {
    const n = normalizeResponse('7E8 03 41 05 7B 00 00 00 00\r<DATA ERROR\r\r>', '0105');
    expect(n.lines).toHaveLength(1);
    expect(n.errors.map((e) => e.code)).toEqual(['DATA_ERROR']);
  });

  it('tollera input vuoto e non-stringa', () => {
    expect(normalizeResponse('').lines).toEqual([]);
    expect(normalizeResponse('>').lines).toEqual([]);
    expect(normalizeResponse(undefined as unknown as string).lines).toEqual([]);
  });

  it('conserva maiuscole/minuscole di banner e versione', () => {
    const n = normalizeResponse('ATZ\r\r\rELM327 v1.5\r\r>', 'ATZ');
    expect(n.lines).toEqual(['ELM327 v1.5']);
  });
});
