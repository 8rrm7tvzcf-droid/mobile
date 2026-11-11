// Interpretazione di alto livello delle risposte gia' normalizzate (righe) per servizio.
// Mette insieme: righe -> frame -> messaggi per ECU -> decodifica. Puro; NON lancia mai eccezioni:
// ogni funzione pubblica restituisce ObdResult e ha una rete di sicurezza finale (guard).
import { fail, ok, obdError, type ObdError, type ObdResult } from './errors';
import { parseResponseLines, type EcuMessage, type ParseOptions, type ParsedResponse } from './frames';
import { decodeDtcMessages, type DtcMode, type EcuDtcs } from './dtc';
import { buildFreezeFrame, decodeFreezeFrameMessage, type FreezeFrame, type FreezeFrameEntry } from './freeze';
import { decodePid, splitMode01Payload, type DecodedPid } from './pids';
import { protocolInfo } from './protocols';
import { splitByService } from './service';
import { decodePidSupport, mergeSupport } from './support';
import { decodeStatus0101, type Mode01Status, type MonitorStatus } from './status';
import { decodeVin } from './vin';

/** Ingresso: righe normalizzate (+ errori classificati da normalizeResponse). */
export interface ResponseInput {
  lines: readonly string[];
  errors?: readonly ObdError[];
}

export interface EcuValue<T> {
  ecu: string;
  value: T;
}

function guard<T>(fn: () => ObdResult<T>): ObdResult<T> {
  try {
    return fn();
  } catch (e) {
    return fail(obdError('MALFORMED_FRAME', e instanceof Error ? e.message : 'errore imprevisto'));
  }
}

function firstHardError(input: ResponseInput): ObdError | undefined {
  const errs = input.errors ?? [];
  return errs.find((e) => e.code !== 'DATA_ERROR' && e.code !== 'RX_ERROR') ?? errs[0];
}

interface Parsed {
  parsed: ParsedResponse;
  can: boolean;
}

function toMessages(input: ResponseInput, opts: ParseOptions): ObdResult<Parsed> {
  if (input.lines.length === 0) {
    return fail(firstHardError(input) ?? obdError('EMPTY_RESPONSE'));
  }
  const parsed = parseResponseLines(input.lines, opts);
  if (parsed.messages.length === 0) {
    return fail(firstHardError(input) ?? parsed.warnings[0] ?? obdError('EMPTY_RESPONSE'));
  }
  const proto = opts.protocol !== '0' ? protocolInfo(opts.protocol) : undefined;
  const can = proto ? proto.can : (parsed.can ?? guessCanFromData(parsed.messages));
  return ok({ parsed, can });
}

/** Con ATH0 e protocollo ignoto: i messaggi non-CAN dei DTC hanno sempre 7 byte (dispari). */
function guessCanFromData(messages: readonly EcuMessage[]): boolean {
  return messages.every((m) => m.data.length % 2 === 0);
}

/** Primo errore utile quando non c'e' alcun messaggio positivo per il servizio richiesto. */
function noPositiveError(input: ResponseInput, split: ReturnType<typeof splitByService>): ObdError {
  const pending = split.negatives.find((n) => n.error.code === 'RESPONSE_PENDING');
  if (pending) return pending.error;
  if (split.negatives.length > 0) return split.negatives[0].error;
  return firstHardError(input) ?? obdError('UNEXPECTED_SERVICE', 'nessuna risposta positiva');
}

// ---------------------------------------------------------------------------

/** Mode 01 PID singolo: tutte le ECU che hanno risposto. */
export function parsePidResponse(input: ResponseInput, pid: number, opts: ParseOptions = {}): ObdResult<EcuValue<DecodedPid>[]> {
  return guard(() => {
    const m = toMessages(input, opts);
    if (!m.ok) return fail(m.error);
    const split = splitByService(m.value.parsed.messages, 0x01);
    const out: EcuValue<DecodedPid>[] = [];
    let firstError: ObdError | undefined;
    for (const msg of split.positive) {
      if (msg.data.length < 2 || msg.data[1] !== pid) continue;
      const r = decodePid(pid, msg.data.slice(2));
      if (r.ok) out.push({ ecu: msg.ecu, value: r.value });
      else firstError = firstError ?? r.error;
    }
    if (out.length > 0) return ok(out);
    return fail(firstError ?? noPositiveError(input, split));
  });
}

/** Mode 01 multi-PID (solo CAN): una risposta '41 PID dati PID dati ...' per ECU. */
export function parseMultiPidResponse(input: ResponseInput, opts: ParseOptions = {}): ObdResult<EcuValue<DecodedPid>[]> {
  return guard(() => {
    const m = toMessages(input, opts);
    if (!m.ok) return fail(m.error);
    const split = splitByService(m.value.parsed.messages, 0x01);
    const out: EcuValue<DecodedPid>[] = [];
    let firstError: ObdError | undefined;
    for (const msg of split.positive) {
      const { entries } = splitMode01Payload(msg.data);
      for (const e of entries) {
        const r = decodePid(e.pid, e.bytes);
        if (r.ok) out.push({ ecu: msg.ecu, value: r.value });
        else firstError = firstError ?? r.error;
      }
    }
    if (out.length > 0) return ok(out);
    return fail(firstError ?? noPositiveError(input, split));
  });
}

export interface SupportResult {
  byEcu: Record<string, number[]>;
  union: number[];
}

/** Bitmask dei PID supportati: 0100/0120/... (service 0x01) o 0900 (service 0x09). */
export function parseSupportResponse(
  input: ResponseInput,
  base: number,
  service: 0x01 | 0x09,
  opts: ParseOptions = {},
): ObdResult<SupportResult> {
  return guard(() => {
    const m = toMessages(input, opts);
    if (!m.ok) return fail(m.error);
    const split = splitByService(m.value.parsed.messages, service);
    const byEcu: Record<string, number[]> = {};
    for (const msg of split.positive) {
      if (msg.data.length < 6 || msg.data[1] !== base) continue;
      const pids = decodePidSupport(base, msg.data.slice(2, 6));
      byEcu[msg.ecu] = mergeSupport([byEcu[msg.ecu] ?? [], pids]);
    }
    const lists = Object.values(byEcu);
    if (lists.length === 0) return fail(noPositiveError(input, split));
    return ok({ byEcu, union: mergeSupport(lists) });
  });
}

/** PID 0101 per ECU. */
export function parseStatusResponse(input: ResponseInput, opts: ParseOptions = {}): ObdResult<EcuValue<Mode01Status>[]> {
  return guard(() => {
    const m = toMessages(input, opts);
    if (!m.ok) return fail(m.error);
    const split = splitByService(m.value.parsed.messages, 0x01);
    const out: EcuValue<Mode01Status>[] = [];
    let firstError: ObdError | undefined;
    for (const msg of split.positive) {
      if (msg.data.length < 2 || msg.data[1] !== 0x01) continue;
      const r = decodeStatus0101(msg.data.slice(2));
      if (r.ok) out.push({ ecu: msg.ecu, value: r.value });
      else firstError = firstError ?? r.error;
    }
    if (out.length > 0) return ok(out);
    return fail(firstError ?? noPositiveError(input, split));
  });
}

/** Unisce lo stato 0101 di piu' ECU: spia accesa se accesa su una, codici sommati, monitor in OR/AND. */
export function combineStatuses(list: readonly Mode01Status[]): Mode01Status | undefined {
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  const byId = new Map<string, MonitorStatus>();
  for (const s of list) {
    for (const mon of s.monitors) {
      const cur = byId.get(mon.id);
      if (!cur) {
        byId.set(mon.id, { ...mon });
      } else {
        // 'available' in OR; 'complete' vale solo se tutte le ECU che lo dichiarano lo hanno completato.
        const available = cur.available || mon.available;
        const complete = (!cur.available || cur.complete) && (!mon.available || mon.complete) && available;
        cur.available = available;
        cur.complete = complete;
      }
    }
  }
  const monitors = Array.from(byId.values());
  const incomplete = monitors.filter((x) => x.available && !x.complete);
  return {
    milOn: list.some((s) => s.milOn),
    dtcCount: list.reduce((a, s) => a + s.dtcCount, 0),
    engineType: list[0].engineType,
    monitors,
    ready: incomplete.length === 0,
    incomplete,
  };
}

export interface DtcResponse {
  byEcu: EcuDtcs[];
  all: string[];
  warnings: ObdError[];
}

/** Mode 03 / 07 / 0A. '43 00' (nessun codice) e' un successo con lista vuota. */
export function parseDtcResponse(input: ResponseInput, mode: DtcMode, opts: ParseOptions = {}): ObdResult<DtcResponse> {
  return guard(() => {
    const m = toMessages(input, opts);
    if (!m.ok) return fail(m.error);
    const split = splitByService(m.value.parsed.messages, mode);
    if (split.positive.length === 0) return fail(noPositiveError(input, split));
    const r = decodeDtcMessages(split.positive, m.value.can, mode);
    if (r.byEcu.length === 0) return fail(r.errors[0] ?? obdError('EMPTY_RESPONSE'));
    return ok({ byEcu: r.byEcu, all: r.all, warnings: r.errors });
  });
}

/** VIN (0902). */
export function parseVinResponse(input: ResponseInput, opts: ParseOptions = {}): ObdResult<EcuValue<string>> {
  return guard(() => {
    const m = toMessages(input, opts);
    if (!m.ok) return fail(m.error);
    const split = splitByService(m.value.parsed.messages, 0x09);
    if (split.positive.length === 0) return fail(noPositiveError(input, split));
    const r = decodeVin(split.positive);
    if (!r.ok) return fail(r.error);
    // ECU di provenienza: la prima che ha prodotto il VIN
    const ecu = split.positive.find((p) => p.data[1] === 0x02)?.ecu ?? '?';
    return ok({ ecu, value: r.value });
  });
}

/** Freeze frame (Mode 02) per un PID. */
export function parseFreezeFramePidResponse(input: ResponseInput, pid: number, opts: ParseOptions = {}): ObdResult<EcuValue<FreezeFrameEntry>> {
  return guard(() => {
    const m = toMessages(input, opts);
    if (!m.ok) return fail(m.error);
    const split = splitByService(m.value.parsed.messages, 0x02);
    let firstError: ObdError | undefined;
    for (const msg of split.positive) {
      if (msg.data.length < 2 || msg.data[1] !== pid) continue;
      const r = decodeFreezeFrameMessage(msg.data);
      if (r.ok) return ok({ ecu: msg.ecu, value: r.value });
      firstError = firstError ?? r.error;
    }
    return fail(firstError ?? noPositiveError(input, split));
  });
}

export { buildFreezeFrame };
export type { FreezeFrame };
