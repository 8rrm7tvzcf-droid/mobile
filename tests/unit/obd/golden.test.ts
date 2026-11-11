// Test «golden» sulle trascrizioni {cmd, rx[], atteso} (SPEC 8.7): VIN CAN (ATH0/ATH1, 11/29 bit) e J1850,
// 1 e 3 codici, 0100 multi-ECU, NO DATA, UNABLE TO CONNECT, STOPPED...
import { describe, it } from 'vitest';
import { normalizeResponse } from '@/obd/protocol';
import { expectGolden, goldenFiles, loadTranscript } from './helpers';

function chunk(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

describe('trascrizioni golden', () => {
  for (const file of goldenFiles()) {
    const fx = loadTranscript(file);
    describe(`${file}: ${fx.name}`, () => {
      fx.entries.forEach((entry, i) => {
        it(`${i + 1}. ${entry.cmd}${entry.note ? ' (' + entry.note + ')' : ''}`, () => {
          const raw = entry.rx.join('');
          const n = normalizeResponse(raw, entry.cmd);
          expectGolden(fx, entry, { lines: n.lines, errors: n.errors });
        });

        it(`${i + 1}. ${entry.cmd}: stesso risultato se la risposta e' spezzata a 20 byte e riunita`, () => {
          const pieces = chunk(entry.rx.join(''), 20);
          const n = normalizeResponse(pieces.join(''), entry.cmd);
          expectGolden(fx, entry, { lines: n.lines, errors: n.errors });
        });
      });
    });
  }
});
