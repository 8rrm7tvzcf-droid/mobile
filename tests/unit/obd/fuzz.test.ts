// Fuzz con dati casuali (seme fisso): il parsing non lancia mai, restituisce errori tipizzati (SPEC 8.7).
import { describe, expect, it } from 'vitest';
import {
  asciiToBytes,
  bytesToHex,
  decodeDtcList,
  decodeFreezeFrameMessage,
  decodePid,
  decodePidSupport,
  decodeStatus0101,
  decodeVin,
  normalizeResponse,
  parseDtcResponse,
  parseFreezeFramePidResponse,
  parseMultiPidResponse,
  parsePidResponse,
  parseResponseLines,
  parseStatusResponse,
  parseSupportResponse,
  parseVinResponse,
  reassembleIsoTp,
  splitByService,
  splitMode01Payload,
  PIDS,
} from '@/obd/protocol';
import { mulberry32, randInt, randomBytes } from './rng';

const ALPHABET = '0123456789ABCDEFabcdef \r\n>:<?.-SEARCHINGNODATAUNABLETOCONNECTBUSINIT7E8:ERROR\u0000';

function randomText(rng: () => number, maxLen: number): string {
  const n = randInt(rng, 0, maxLen);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[randInt(rng, 0, ALPHABET.length - 1)];
  return s;
}

function randomHexLine(rng: () => number): string {
  const kind = randInt(rng, 0, 5);
  const bytes = randomBytes(rng, randInt(rng, 0, 12));
  switch (kind) {
    case 0:
      return '7E8 ' + bytesToHex(bytes);
    case 1:
      return '7E8' + bytesToHex(bytes, '');
    case 2:
      return '18 DA F1 10 ' + bytesToHex(bytes);
    case 3:
      return bytesToHex(bytes);
    case 4:
      return `${randInt(rng, 0, 15).toString(16)}: ${bytesToHex(bytes)}`;
    default:
      return randInt(rng, 0, 4095).toString(16).toUpperCase().padStart(3, '0');
  }
}

describe('fuzz: il parsing non lancia mai', () => {
  it('normalizeResponse su testo casuale', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 2000; i++) {
      const raw = randomText(rng, 120);
      expect(() => normalizeResponse(raw, randomText(rng, 6))).not.toThrow();
    }
  });

  it('parseResponseLines / reassembleIsoTp su righe casuali, con e senza intestazioni, con ogni protocollo', () => {
    const rng = mulberry32(2);
    const protocols = [undefined, '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'Z'];
    for (let i = 0; i < 3000; i++) {
      const lines = Array.from({ length: randInt(rng, 0, 8) }, () => (rng() < 0.7 ? randomHexLine(rng) : randomText(rng, 30)));
      const protocol = protocols[randInt(rng, 0, protocols.length - 1)];
      const headers = rng() < 0.8;
      expect(() => parseResponseLines(lines, { protocol, headers })).not.toThrow();
    }
    for (let i = 0; i < 2000; i++) {
      const frames = Array.from({ length: randInt(rng, 0, 10) }, () => ({
        ecu: ['7E8', '7E9', '7EA'][randInt(rng, 0, 2)],
        bytes: randomBytes(rng, randInt(rng, 0, 8)),
      }));
      const r = reassembleIsoTp(frames);
      expect(Array.isArray(r.messages)).toBe(true);
    }
  });

  it('i parser di alto livello restituiscono sempre un Result', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 2500; i++) {
      const raw = rng() < 0.5 ? randomText(rng, 100) : Array.from({ length: randInt(rng, 0, 6) }, () => randomHexLine(rng)).join('\r');
      const n = normalizeResponse(raw, '0100');
      const input = { lines: n.lines, errors: n.errors };
      const opts = { protocol: [undefined, '6', '7', '2', '5'][randInt(rng, 0, 4)], headers: rng() < 0.8 };
      const results = [
        parsePidResponse(input, PIDS[randInt(rng, 0, PIDS.length - 1)].pid, opts),
        parseMultiPidResponse(input, opts),
        parseSupportResponse(input, 0, 0x01, opts),
        parseSupportResponse(input, 0, 0x09, opts),
        parseStatusResponse(input, opts),
        parseDtcResponse(input, 0x03, opts),
        parseDtcResponse(input, 0x07, opts),
        parseDtcResponse(input, 0x0a, opts),
        parseVinResponse(input, opts),
        parseFreezeFramePidResponse(input, 0x05, opts),
      ];
      for (const r of results) {
        expect(typeof r.ok).toBe('boolean');
        if (!r.ok) expect(typeof r.error.code).toBe('string');
      }
    }
  });

  it('decodificatori su byte casuali (anche fuori intervallo o NaN)', () => {
    const rng = mulberry32(4);
    for (let i = 0; i < 5000; i++) {
      const data = rng() < 0.9 ? randomBytes(rng, randInt(rng, 0, 40)) : [NaN, -1, 256, 1.5, Infinity].slice(0, randInt(rng, 0, 5));
      const pid = randInt(rng, 0, 255);
      expect(() => decodePid(pid, data)).not.toThrow();
      expect(() => decodeStatus0101(data)).not.toThrow();
      expect(() => decodePidSupport(0, data)).not.toThrow();
      expect(() => decodeDtcList(data, rng() < 0.5, [0x03, 0x07, 0x0a][randInt(rng, 0, 2)] as 0x03 | 0x07 | 0x0a)).not.toThrow();
      expect(() => decodeFreezeFrameMessage(data)).not.toThrow();
      expect(() => splitMode01Payload(data)).not.toThrow();
      expect(() => splitByService([{ ecu: 'X', data }], randInt(rng, 0, 255))).not.toThrow();
      expect(() => decodeVin([{ ecu: 'X', data: [0x49, 0x02, ...data] }])).not.toThrow();
    }
  });

  it('un VIN con byte casuali e\' valido solo se rispetta l\'alfabeto', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 1000; i++) {
      const r = decodeVin([{ ecu: 'X', data: [0x49, 0x02, 0x01, ...randomBytes(rng, 17)] }]);
      if (r.ok) expect(r.value).toMatch(/^[A-HJ-NPR-Z0-9]{17}$/);
    }
    const good = decodeVin([{ ecu: 'X', data: [0x49, 0x02, 0x01, ...asciiToBytes('ZFA19900001234567')] }]);
    expect(good.ok).toBe(true);
  });
});
