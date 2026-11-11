// Regola di sicurezza (SPEC 5.5 / 8.7): nell'MVP la sessione NON deve poter spedire Mode 04 ne' altri comandi
// che modificano lo stato. Il filtro `isWriteCommand` scarta in silenzio tutti i comandi di lunghezza dispari:
// '041' = Mode 04 + cifra finale facoltativa 'numero di risposte attese' (l'ELM327 la accetta; l'emulatore del
// progetto la ignora allo stesso modo) passa il filtro, arriva all'adattatore e cancella i codici.
import { describe, expect, it } from 'vitest';
import { isWriteCommand } from '@/obd/protocol';
import { ElmSession } from '@/obd/session';
import { SimulatedTransport } from '@/obd/transport/SimulatedTransport';

async function open() {
  const t = new SimulatedTransport({ scenario: 'mil-on', searchDelayMs: 0, latencyMs: 0, chunkDelayMs: 0 });
  const s = new ElmSession(t, { recoveryMs: 20, timeoutScale: 0.05 });
  await s.open();
  // init minimo: ATZ, ATE0, ATH1 + 0100 per collegare il protocollo
  for (const c of ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH1', 'ATSP0']) await s.send(c);
  await s.send('0100', { kind: 'search', timeoutMs: 500 });
  return { t, s };
}

describe('filtro dei comandi di scrittura', () => {
  it("Mode 04 con la cifra finale '1' ('041') deve essere bloccato e non arrivare all'adattatore", async () => {
    const { t, s } = await open();
    const before = await s.send('03');
    expect(before.lines.join(' ')).toContain('43'); // ci sono codici memorizzati

    const r = await s.send('041');
    expect(r.error?.code).toBe('WRITE_BLOCKED');
    expect(t.received).not.toContain('041');

    const after = await s.send('03');
    expect(after.lines.join(' ')).toBe(before.lines.join(' ')); // i codici sono ancora tutti li'
    await s.close();
  });

  it.each(['041', '04 1', '081', '141', '101'])("isWriteCommand(%j) e' vero", (cmd) => {
    expect(isWriteCommand(cmd)).toBe(true);
  });

  it("AT PP (scrittura dei parametri programmabili in EEPROM) e' bloccato", () => {
    expect(isWriteCommand('ATPP 0C SV 62')).toBe(true);
    expect(isWriteCommand('ATPP FF ON')).toBe(true);
  });

  it("KWP 0x30 (InputOutputControlByLocalIdentifier) e' trattato come scrittura", () => {
    expect(isWriteCommand('3001')).toBe(true);
  });
});
