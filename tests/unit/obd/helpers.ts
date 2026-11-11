// Utilita' comuni ai test OBD: caricamento delle trascrizioni e verifica «golden» di una voce.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  combineStatuses,
  parseDtcResponse,
  parseFreezeFramePidResponse,
  parseMultiPidResponse,
  parsePidResponse,
  parseStatusResponse,
  parseSupportResponse,
  parseVinResponse,
  type ObdError,
  type ParseOptions,
  type ResponseInput,
} from '@/obd/protocol';

export interface TranscriptEntry {
  cmd: string;
  rx: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  atteso?: any;
  note?: string;
}

export interface Transcript {
  name: string;
  source?: string;
  protocol?: string;
  headers?: boolean;
  entries: TranscriptEntry[];
}

export const FIXTURE_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'fixtures', 'obd');

export function loadTranscript(file: string): Transcript {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as Transcript;
}

/** Trascrizioni golden (formato {cmd, rx[], atteso}); i file `session-*.json` hanno un altro scopo. */
export function goldenFiles(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('session-'))
    .sort();
}

/** Verifica una voce golden dato l'ingresso gia' normalizzato. */
export function expectGolden(fx: Transcript, entry: TranscriptEntry, input: ResponseInput): void {
  const a = entry.atteso;
  if (!a) return;
  const opts: ParseOptions = { protocol: fx.protocol, headers: fx.headers };
  switch (a.kind) {
    case 'vin': {
      const r = parseVinResponse(input, opts);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) {
        expect(r.value.value).toBe(a.vin);
        if (a.ecu !== undefined) expect(r.value.ecu).toBe(a.ecu);
      }
      return;
    }
    case 'dtc': {
      const r = parseDtcResponse(input, a.mode, opts);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) {
        expect(r.value.all).toEqual(a.codes);
        if (a.ecus) expect(r.value.byEcu.map((e) => e.ecu)).toEqual(a.ecus);
      }
      return;
    }
    case 'support': {
      const r = parseSupportResponse(input, a.base, 0x01, opts);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) {
        expect(r.value.byEcu).toEqual(a.byEcu);
        expect(r.value.union).toEqual(a.union);
      }
      return;
    }
    case 'pid': {
      const r = parsePidResponse(input, a.pid, opts);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) {
        expect(r.value[0].value.value).toBeCloseTo(a.value, 6);
        expect(r.value[0].value.unit).toBe(a.unit);
      }
      return;
    }
    case 'multipid': {
      const r = parseMultiPidResponse(input, opts);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) {
        expect(r.value.map((v) => v.value.pid)).toEqual(a.values.map((v: { pid: number }) => v.pid));
        a.values.forEach((v: { pid: number; value: number }, i: number) => {
          expect(r.value[i].value.value).toBeCloseTo(v.value, 6);
        });
      }
      return;
    }
    case 'status': {
      const r = parseStatusResponse(input, opts);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) {
        const s = combineStatuses(r.value.map((x) => x.value));
        expect(s?.milOn).toBe(a.milOn);
        expect(s?.dtcCount).toBe(a.dtcCount);
        expect(s?.incomplete.map((m) => m.id)).toEqual(a.incomplete);
      }
      return;
    }
    case 'freeze': {
      const r = parseFreezeFramePidResponse(input, a.pid, opts);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) {
        if (a.dtc !== undefined) expect(r.value.value.dtc).toBe(a.dtc);
        if (a.value !== undefined) {
          expect(r.value.value.value?.value).toBeCloseTo(a.value, 6);
          expect(r.value.value.value?.unit).toBe(a.unit);
        }
      }
      return;
    }
    case 'error': {
      // Si sceglie il parser dal servizio del comando inviato.
      const cmdCompact = entry.cmd.replace(/\s+/g, '');
      const svc = /^[0-9A-Fa-f]{2}/.test(cmdCompact) ? parseInt(cmdCompact.slice(0, 2), 16) : 0x01;
      const r =
        svc === 0x09
          ? parseVinResponse(input, opts)
          : svc === 0x03 || svc === 0x07 || svc === 0x0a
            ? parseDtcResponse(input, svc, opts)
            : parsePidResponse(input, 0x0c, opts);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const e: ObdError = r.error;
        expect(e.code).toBe(a.code);
        if (a.nrc !== undefined) expect(e.nrc).toBe(a.nrc);
      }
      return;
    }
    default:
      throw new Error(`atteso.kind sconosciuto: ${String(a.kind)}`);
  }
}
