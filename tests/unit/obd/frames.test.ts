import { describe, expect, it } from 'vitest';
import {
  asciiToBytes,
  byteToHex,
  parseResponseLines,
  reassembleIsoTp,
  type CanFrame,
  type EcuMessage,
} from '@/obd/protocol';
import { mulberry32, randInt, randomBytes, shuffle } from './rng';

/** Segmenta un payload in frame ISO-TP a 8 byte (come farebbe una ECU), con padding 00. */
function segment(ecu: string, payload: number[]): CanFrame[] {
  if (payload.length <= 7) {
    const b = [payload.length, ...payload];
    while (b.length < 8) b.push(0);
    return [{ ecu, bytes: b }];
  }
  const frames: CanFrame[] = [];
  const first = [0x10 | ((payload.length >> 8) & 0x0f), payload.length & 0xff, ...payload.slice(0, 6)];
  frames.push({ ecu, bytes: first });
  let sn = 1;
  for (let i = 6; i < payload.length; i += 7) {
    const chunk = payload.slice(i, i + 7);
    const b = [0x20 | (sn & 0x0f), ...chunk];
    while (b.length < 8) b.push(0);
    frames.push({ ecu, bytes: b });
    sn++;
  }
  return frames;
}

function frameLine(f: CanFrame, spaces = true): string {
  return f.ecu + (spaces ? ' ' : '') + f.bytes.map(byteToHex).join(spaces ? ' ' : '');
}

describe('reassembleIsoTp: casi noti', () => {
  it('frame singolo con padding', () => {
    const r = reassembleIsoTp([{ ecu: '7E8', bytes: [0x03, 0x41, 0x05, 0x7b, 0, 0, 0, 0] }]);
    expect(r.messages).toEqual([{ ecu: '7E8', data: [0x41, 0x05, 0x7b] }]);
    expect(r.warnings).toEqual([]);
  });

  it('VIN: primo frame + 2 consecutivi', () => {
    const r = reassembleIsoTp([
      { ecu: '7E8', bytes: [0x10, 0x14, 0x49, 0x02, 0x01, 0x5a, 0x46, 0x41] },
      { ecu: '7E8', bytes: [0x21, 0x31, 0x39, 0x39, 0x30, 0x30, 0x30, 0x30] },
      { ecu: '7E8', bytes: [0x22, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37] },
    ]);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].data).toHaveLength(20);
    expect(String.fromCharCode(...r.messages[0].data.slice(3))).toBe('ZFA19900001234567');
  });

  it('ignora i frame di flow control', () => {
    const r = reassembleIsoTp([
      { ecu: '7E0', bytes: [0x30, 0, 0] },
      { ecu: '7E8', bytes: [0x02, 0x43, 0x00] },
    ]);
    expect(r.messages).toEqual([{ ecu: '7E8', data: [0x43, 0x00] }]);
    expect(r.messages).toHaveLength(1);
  });

  it('segnala un messaggio troncato senza lanciare', () => {
    const r = reassembleIsoTp([
      { ecu: '7E8', bytes: [0x10, 0x14, 0x49, 0x02, 0x01, 0x5a, 0x46, 0x41] },
      { ecu: '7E8', bytes: [0x21, 0x31, 0x39, 0x39, 0x30, 0x30, 0x30, 0x30] },
    ]);
    expect(r.messages).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['TRUNCATED_MESSAGE']);
  });

  it('segnala frame consecutivi orfani', () => {
    const r = reassembleIsoTp([{ ecu: '7E8', bytes: [0x21, 1, 2, 3, 4, 5, 6, 7] }]);
    expect(r.messages).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['ORPHAN_FRAME']);
  });

  it('frame singolo con lunghezza incoerente = frame malformato', () => {
    const r = reassembleIsoTp([{ ecu: '7E8', bytes: [0x07, 0x41, 0x05] }]);
    expect(r.messages).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['MALFORMED_FRAME']);
  });

  it('piu\' messaggi della stessa ECU in sequenza', () => {
    const a = segment('7E8', [0x41, 0x0c, 0x1a, 0xf8]);
    const b = segment('7E8', [0x41, 0x0d, 0x3c]);
    const r = reassembleIsoTp([...a, ...b]);
    expect(r.messages.map((m) => m.data)).toEqual([
      [0x41, 0x0c, 0x1a, 0xf8],
      [0x41, 0x0d, 0x3c],
    ]);
  });

  it('con 16+ frame consecutivi il numero di sequenza cicla 0-F', () => {
    const payload = Array.from({ length: 150 }, (_, i) => i & 0xff);
    const r = reassembleIsoTp(segment('7E8', payload));
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].data).toEqual(payload);
  });
});

describe('reassembleIsoTp: proprieta\' con ordine casuale (seme fisso)', () => {
  function makeScenario(rng: () => number) {
    const nEcu = randInt(rng, 1, 4);
    const ecus: string[] = [];
    for (let i = 0; i < nEcu; i++) ecus.push((0x7e8 + i).toString(16).toUpperCase());
    const payloads = new Map<string, number[]>();
    for (const e of ecus) {
      const len = randInt(rng, 1, 100); // da frame singolo a 15 CF
      payloads.set(e, [0x49, 0x04, ...randomBytes(rng, len)]);
    }
    return { ecus, payloads };
  }

  /** Interleaving casuale tra ECU conservando l'ordine interno di ogni ECU. */
  function interleave(rng: () => number, lists: CanFrame[][]): CanFrame[] {
    const idx = lists.map(() => 0);
    const out: CanFrame[] = [];
    let remaining = lists.reduce((a, l) => a + l.length, 0);
    while (remaining > 0) {
      const candidates = lists.map((l, i) => (idx[i] < l.length ? i : -1)).filter((i) => i >= 0);
      const pick = candidates[Math.floor(rng() * candidates.length)];
      out.push(lists[pick][idx[pick]++]);
      remaining--;
    }
    return out;
  }

  it('ordine intra-ECU rispettato, ECU mescolate: ogni payload si ricostruisce', () => {
    const rng = mulberry32(20261008);
    for (let iter = 0; iter < 300; iter++) {
      const { ecus, payloads } = makeScenario(rng);
      const lists = ecus.map((e) => segment(e, payloads.get(e) as number[]));
      const frames = interleave(rng, lists);
      const r = reassembleIsoTp(frames);
      expect(r.warnings).toEqual([]);
      expect(r.messages).toHaveLength(ecus.length);
      for (const e of ecus) {
        const m = r.messages.find((x) => x.ecu === e) as EcuMessage;
        expect(m.data).toEqual(payloads.get(e));
      }
    }
  });

  it('anche con i frame consecutivi mescolati dentro ogni messaggio (fino a 15 CF)', () => {
    const rng = mulberry32(777);
    for (let iter = 0; iter < 300; iter++) {
      const { ecus, payloads } = makeScenario(rng);
      const lists = ecus.map((e) => {
        const fr = segment(e, payloads.get(e) as number[]);
        if (fr.length <= 2) return fr;
        // il primo frame resta davanti; i consecutivi si mescolano
        return [fr[0], ...shuffle(rng, fr.slice(1))];
      });
      const frames = interleave(rng, lists);
      const r = reassembleIsoTp(frames);
      expect(r.warnings).toEqual([]);
      for (const e of ecus) {
        const m = r.messages.find((x) => x.ecu === e) as EcuMessage;
        expect(m.data).toEqual(payloads.get(e));
      }
    }
  });

  it('anche con i consecutivi arrivati prima del primo frame (un messaggio per ECU)', () => {
    const rng = mulberry32(31337);
    for (let iter = 0; iter < 200; iter++) {
      const { ecus, payloads } = makeScenario(rng);
      const lists = ecus.map((e) => shuffle(rng, segment(e, payloads.get(e) as number[])));
      const frames = interleave(rng, lists);
      const r = reassembleIsoTp(frames);
      expect(r.warnings).toEqual([]);
      for (const e of ecus) {
        const m = r.messages.find((x) => x.ecu === e) as EcuMessage;
        expect(m.data).toEqual(payloads.get(e));
      }
    }
  });
});

describe('parseResponseLines', () => {
  it('CAN 11 bit con spazi e senza (ATS0) danno lo stesso risultato', () => {
    const f = segment('7E8', [0x49, 0x02, 0x01, ...asciiToBytes('ZFA19900001234567')]);
    const withSpaces = parseResponseLines(f.map((x) => frameLine(x, true)), { protocol: '6' });
    const noSpaces = parseResponseLines(f.map((x) => frameLine(x, false)), { protocol: '6' });
    expect(noSpaces.messages).toEqual(withSpaces.messages);
    expect(withSpaces.messages[0].data).toHaveLength(20);
  });

  it('CAN 29 bit: l\'ECU e\' l\'id a 8 cifre', () => {
    const r = parseResponseLines(['18 DA F1 10 03 41 05 7B 00 00 00 00'], { protocol: '7' });
    expect(r.messages).toEqual([{ ecu: '18DAF110', data: [0x41, 0x05, 0x7b] }]);
    const r2 = parseResponseLines(['18DAF110034105 7B00000000'], { protocol: '7' });
    expect(r2.messages).toEqual(r.messages);
  });

  it('senza protocollo deduce 11 bit, 29 bit e non-CAN', () => {
    expect(parseResponseLines(['7E8 03 41 05 7B 00 00 00 00']).messages[0].ecu).toBe('7E8');
    expect(parseResponseLines(['18 DA F1 10 03 41 05 7B 00 00 00 00']).messages[0].ecu).toBe('18DAF110');
    const legacy = parseResponseLines(['48 6B 10 41 00 BE 3E B8 11 FA']);
    expect(legacy.messages).toEqual([{ ecu: '10', data: [0x41, 0x00, 0xbe, 0x3e, 0xb8, 0x11] }]);
  });

  it('non-CAN: due ECU (10 motore, 18 cambio)', () => {
    const r = parseResponseLines(['48 6B 10 41 00 BE 3E B8 11 FA', '48 6B 18 41 00 98 18 00 01 3C'], { protocol: '2' });
    expect(r.messages.map((m) => m.ecu)).toEqual(['10', '18']);
  });

  it('ATH0: righe 014 / 0: / 1: / 2:', () => {
    const r = parseResponseLines(
      ['014', '0: 49 02 01 5A 46 41', '1: 31 39 39 30 30 30 30', '2: 31 32 33 34 35 36 37'],
      { headers: false },
    );
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].data).toHaveLength(20);
    expect(r.ambiguousEcu).toBe(false);
  });

  it('ATH0 con piu\' messaggi e\' marcato ambiguo', () => {
    const r = parseResponseLines(['41 00 BE 3E B8 11', '41 00 98 18 00 01'], { headers: false });
    expect(r.messages).toHaveLength(2);
    expect(r.ambiguousEcu).toBe(true);
  });

  it('righe non esadecimali o dispari diventano avvisi, non eccezioni', () => {
    const r = parseResponseLines(['ELM327 v1.5', '7E8 0', 'ZZZ'], { protocol: '6' });
    expect(r.messages).toEqual([]);
    expect(r.warnings.length).toBeGreaterThanOrEqual(3);
    expect(r.warnings.every((w) => w.code === 'MALFORMED_FRAME')).toBe(true);
  });
});
