// AdapterInit: un 'BUS BUSY' (o 'DATA ERROR' / 'STOPPED') transitorio sul primo 0100 fa fallire l'init con
// BUS_ERROR ("controlla che l'adattatore sia inserito bene"), mentre la ricerca potrebbe riuscire al secondo colpo.
// La ricerca (kind 'search') ha retries = 0 e AdapterInit non gestisce questi codici nel suo ciclo.
// Fonte: docs/research/obd.md (§7): BUS BUSY -> pausa 100-300 ms e retry; DATA ERROR -> retry una volta.
import { describe, expect, it } from 'vitest';
import { ElmSession, runAdapterInit } from '@/obd/session';
import { MockTransport, type TranscriptEntry } from '@/obd/transport/MockTransport';

const e = (cmd: string, ...rx: string[]): TranscriptEntry => ({ cmd, rx });
const OK = 'OK\r\r>';
const prefix = (): TranscriptEntry[] => [
  e('ATZ', 'ATZ\r\n\r\nELM327 v2.1\r\n\r\n>'),
  e('ATE0', 'ATE0\r\nOK\r\n\r\n>'),
  e('ATL0', OK),
  e('ATS0', OK),
  e('ATH1', OK),
  e('ATAT1', OK),
  e('ATRV', '12.4V\r\r>'),
  e('ATSP0', OK),
];
const SUP_OK = '7E8064100BE3EB81100\r\r>';

async function runWithFirstProbe(firstReply: string) {
  const transport = new MockTransport([...prefix(), e('0100', firstReply), e('0100', SUP_OK), e('ATDPN', 'A6\r\r>')]);
  const session = new ElmSession(transport, { recoveryMs: 30, timeoutScale: 0.05 });
  await session.open();
  const r = await runAdapterInit(session, { postResetDelayMs: 0, unableRetryDelayMs: 1, noDataRetryDelayMs: 1, searchTimeoutMs: 300, skipIdentification: true });
  await session.close();
  return r;
}

describe('AdapterInit: errori transitori sul primo 0100', () => {
  it.each(['BUS BUSY', 'DATA ERROR', 'STOPPED', 'BUFFER FULL'])("%s sul primo 0100: si riprova e l'init riesce", async (err) => {
    const r = await runWithFirstProbe(`${err}\r\r>`);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});
