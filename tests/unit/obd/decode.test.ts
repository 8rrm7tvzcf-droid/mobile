import { describe, expect, it } from 'vitest';
import {
  PIDS,
  buildFreezeFrame,
  combineStatuses,
  decodeDtc,
  decodeDtcList,
  decodeFreezeFrameMessage,
  decodePid,
  decodePidSupport,
  decodeStatus0101,
  decodeVin,
  decodeVinFromMessages,
  dtcSystem,
  encodePidSupport,
  hasNextBlock,
  isUnsupportedNrc,
  isValidDtc,
  isValidVin,
  isWriteCommand,
  mergeSupport,
  pidDef,
  pidDefById,
  protocolInfo,
  parseProtocolNumber,
  request01,
  request01Multi,
  request02,
  splitByService,
  splitMode01Payload,
  withoutPointers,
} from '@/obd/protocol';

function val(pid: number, data: number[]): number {
  const r = decodePid(pid, data);
  if (!r.ok) throw new Error(`decode fallita: ${r.error.code}`);
  return r.value.value;
}

describe('tabella dei PID (formule ricalcolate dalla verifica)', () => {
  it('esempi numerici di OBD §12', () => {
    expect(val(0x04, [0x80])).toBeCloseTo(50.196, 2); // 50.2 %
    expect(val(0x05, [0x7b])).toBe(83);
    expect(val(0x0c, [0x1a, 0xf8])).toBe(1726);
    expect(val(0x0d, [0x3c])).toBe(60);
    expect(val(0x0f, [0x41])).toBe(25);
    expect(val(0x10, [0x03, 0xe8])).toBe(10);
    expect(val(0x11, [0xff])).toBe(100);
    expect(val(0x1f, [0x01, 0x2c])).toBe(300);
    expect(val(0x2f, [0x80])).toBeCloseTo(50.196, 2);
    expect(val(0x31, [0xff, 0xff])).toBe(65535);
    expect(val(0x42, [0x38, 0xa4])).toBe(14.5);
    expect(val(0x5c, [0x5a])).toBe(50);
    expect(val(0x5e, [0x01, 0xf4])).toBe(25);
    expect(val(0xa6, [0x00, 0x01, 0xe2, 0x40])).toBeCloseTo(12345.6, 6);
  });

  it('altre formule: correzioni, MAP, anticipo, pressione carburante, tempi', () => {
    expect(val(0x06, [0x80])).toBe(0);
    expect(val(0x06, [0x00])).toBe(-100);
    expect(val(0x06, [0xff])).toBeCloseTo(99.21875, 5);
    expect(val(0x0b, [0x21])).toBe(33);
    expect(val(0x0a, [0x20])).toBe(96);
    expect(val(0x0e, [0x80])).toBe(0);
    expect(val(0x21, [0x00, 0x0a])).toBe(10);
    expect(val(0x4d, [0x00, 0x05])).toBe(5);
    expect(val(0x33, [0x65])).toBe(101);
    expect(val(0x46, [0x3c])).toBe(20);
  });

  it('PID enumerati portano un\'etichetta italiana', () => {
    const fuel = decodePid(0x51, [4]);
    expect(fuel.ok && fuel.value.label).toBe('Diesel');
    const std = decodePid(0x1c, [6]);
    expect(std.ok && std.value.label).toBe('EOBD (Europa)');
    const unknown = decodePid(0x51, [99]);
    expect(unknown.ok && unknown.value.label).toBe('Codice 99');
  });

  it('lunghezza attesa verificata: piu\' corta = scartata, piu\' lunga = troncata', () => {
    const short = decodePid(0x0c, [0x1a]);
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error.code).toBe('TOO_SHORT');
    const long = decodePid(0x0d, [0x3c, 0, 0, 0]);
    expect(long.ok && long.value.raw).toEqual([0x3c]);
    const none = decodePid(0x0d, []);
    expect(none.ok).toBe(false);
  });

  it('PID sconosciuto = errore tipizzato', () => {
    const r = decodePid(0x7e, [1]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNKNOWN_PID');
  });

  it('odometro 0xFFFFFFFF = non disponibile', () => {
    const r = decodePid(0xa6, [0xff, 0xff, 0xff, 0xff]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_AVAILABLE');
  });

  it('byte fuori intervallo non producono valori', () => {
    const r = decodePid(0x0d, [300]);
    expect(r.ok).toBe(false);
  });

  it('i PID dichiarati hanno id univoci e lunghezza coerente con la formula', () => {
    expect(new Set(PIDS.map((p) => p.id)).size).toBe(PIDS.length);
    expect(new Set(PIDS.map((p) => p.pid)).size).toBe(PIDS.length);
    for (const p of PIDS) {
      expect(pidDef(p.pid)).toBe(p);
      expect(pidDefById(p.id)).toBe(p);
      const v = p.decode(new Array(p.bytes).fill(0x10));
      expect(Number.isFinite(v as number), p.id).toBe(true);
    }
    // PID richiesti dalla SPEC
    for (const pid of [0x0c, 0x0d, 0x05, 0x0f, 0x11, 0x04, 0x1f, 0x2f, 0x42, 0x5c, 0x5e, 0x31, 0x21, 0xa6]) {
      expect(pidDef(pid), pid.toString(16)).toBeDefined();
    }
  });
});

describe('multi-PID', () => {
  it('scompone 41 0B 21 04 3F 0C 17 B8 05 44 (datasheet p.45)', () => {
    const { entries, leftover } = splitMode01Payload([0x41, 0x0b, 0x21, 0x04, 0x3f, 0x0c, 0x17, 0xb8, 0x05, 0x44]);
    expect(entries.map((e) => e.pid)).toEqual([0x0b, 0x04, 0x0c, 0x05]);
    expect(leftover).toBe(0);
    expect(val(0x0b, entries[0].bytes)).toBe(33);
    expect(val(0x04, entries[1].bytes)).toBeCloseTo(24.7, 1);
    expect(val(0x0c, entries[2].bytes)).toBe(1518);
    expect(val(0x05, entries[3].bytes)).toBe(28);
  });

  it('l\'ordine nella risposta puo\' differire da quello richiesto: conta il PID scritto', () => {
    const { entries } = splitMode01Payload([0x41, 0x05, 0x44, 0x0c, 0x17, 0xb8]);
    expect(entries.map((e) => e.pid)).toEqual([0x05, 0x0c]);
  });

  it('si ferma su PID ignoto o dati mancanti senza lanciare', () => {
    expect(splitMode01Payload([0x41, 0x7e, 1, 2]).entries).toEqual([]);
    expect(splitMode01Payload([0x41, 0x0c, 0x17]).entries).toEqual([]);
    expect(splitMode01Payload([]).entries).toEqual([]);
    expect(splitMode01Payload([0x42, 0x05, 0x44]).entries).toEqual([]);
  });

  it('richieste', () => {
    expect(request01(0x0c)).toBe('010C');
    expect(request01(0x5c)).toBe('015C');
    expect(request01Multi([0x0b, 0x04, 0x0c, 0x05])).toBe('010B040C05');
    expect(request01Multi([1, 2, 3, 4, 5, 6, 7, 8])).toBe('01010203040506');
    expect(request02(0x02)).toBe('020200');
  });
});

describe('bitmap dei PID supportati', () => {
  it('esempio 41 00 BE 3E B8 11', () => {
    const pids = decodePidSupport(0x00, [0xbe, 0x3e, 0xb8, 0x11]);
    expect(pids).toEqual([0x01, 0x03, 0x04, 0x05, 0x06, 0x07, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x11, 0x13, 0x14, 0x15, 0x1c, 0x20]);
    expect(hasNextBlock(0x00, pids)).toBe(true);
    expect(hasNextBlock(0x20, pids)).toBe(false);
    expect(withoutPointers(pids)).not.toContain(0x20);
  });

  it('blocchi successivi usano la base', () => {
    expect(decodePidSupport(0x20, [0x80, 0, 0, 0x01])).toEqual([0x21, 0x40]);
    expect(decodePidSupport(0xa0, [0x04, 0, 0, 0])).toEqual([0xa6]);
  });

  it('Mode 09: 0900 -> 49 00 55 40 00 00 = 02 04 06 08 0A', () => {
    expect(decodePidSupport(0x00, [0x55, 0x40, 0x00, 0x00])).toEqual([0x02, 0x04, 0x06, 0x08, 0x0a]);
  });

  it('codifica e decodifica sono inverse', () => {
    for (const base of [0x00, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0]) {
      const pids = [base + 1, base + 5, base + 12, base + 32];
      expect(decodePidSupport(base, encodePidSupport(base, pids))).toEqual(pids);
    }
  });

  it('unione tra ECU senza duplicati, ordinata; dati corti non lanciano', () => {
    expect(mergeSupport([[3, 1], [2, 3]])).toEqual([1, 2, 3]);
    expect(decodePidSupport(0, [0xff])).toHaveLength(8);
    expect(decodePidSupport(0, [])).toEqual([]);
  });
});

describe('0101: spia, codici, monitor', () => {
  it('esempio 41 01 82 07 65 04 (OBD §11)', () => {
    const r = decodeStatus0101([0x82, 0x07, 0x65, 0x04]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.value;
    expect(s.milOn).toBe(true);
    expect(s.dtcCount).toBe(2);
    expect(s.engineType).toBe('spark');
    const byId = Object.fromEntries(s.monitors.map((m) => [m.id, m]));
    expect(byId.misfire).toMatchObject({ available: true, complete: true });
    expect(byId.fuel_system).toMatchObject({ available: true, complete: true });
    expect(byId.components).toMatchObject({ available: true, complete: true });
    expect(byId.catalyst).toMatchObject({ available: true, complete: true });
    expect(byId.evap).toMatchObject({ available: true, complete: false });
    expect(byId.o2_sensor).toMatchObject({ available: true, complete: true });
    expect(byId.o2_heater).toMatchObject({ available: true, complete: true });
    expect(byId.heated_catalyst.available).toBe(false);
    expect(s.incomplete.map((m) => m.id)).toEqual(['evap']);
    expect(s.ready).toBe(false);
  });

  it('spia spenta, nessun codice, tutto pronto', () => {
    const r = decodeStatus0101([0x00, 0x07, 0x65, 0x00]);
    expect(r.ok && r.value.milOn).toBe(false);
    expect(r.ok && r.value.dtcCount).toBe(0);
    expect(r.ok && r.value.ready).toBe(true);
  });

  it('completezza della parte comune: B6-B4 con logica invertita', () => {
    const r = decodeStatus0101([0x00, 0x77, 0x00, 0x00]); // disponibili 0-2, non completi 4-6
    expect(r.ok && r.value.monitors.filter((m) => m.id === 'misfire' || m.id === 'fuel_system' || m.id === 'components').every((m) => m.available && !m.complete)).toBe(true);
  });

  it('diesel: B3 = 1 e monitor specifici', () => {
    const r = decodeStatus0101([0x81, 0x0c, 0xc3, 0x40]); // diesel; C: NMHC, NOx, EGR... ; D: DPF incompleto
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.engineType).toBe('compression');
    const byId = Object.fromEntries(r.value.monitors.map((m) => [m.id, m]));
    expect(byId.pm_filter).toMatchObject({ available: true, complete: false });
    expect(byId.nox_scr).toMatchObject({ available: true, complete: true });
    expect(byId.evap).toBeUndefined();
  });

  it('meno di 4 byte = TOO_SHORT; dati non validi = errore, non eccezione', () => {
    const r = decodeStatus0101([0x82, 0x07]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('TOO_SHORT');
    expect(decodeStatus0101([999, 0, 0, 0]).ok).toBe(false);
    expect(decodeStatus0101(null as unknown as number[]).ok).toBe(false);
  });

  it('combineStatuses: spia in OR, codici sommati, monitor completi solo se completi ovunque', () => {
    const a = decodeStatus0101([0x01, 0x07, 0x65, 0x00]);
    const b = decodeStatus0101([0x81, 0x07, 0x65, 0x04]);
    if (!a.ok || !b.ok) throw new Error('setup');
    const c = combineStatuses([a.value, b.value]);
    expect(c?.milOn).toBe(true);
    expect(c?.dtcCount).toBe(2);
    expect(c?.incomplete.map((m) => m.id)).toEqual(['evap']);
    expect(combineStatuses([])).toBeUndefined();
  });
});

describe('DTC', () => {
  it('decodifica P/C/B/U (OBD §15)', () => {
    expect(decodeDtc(0x01, 0x33)).toBe('P0133');
    expect(decodeDtc(0xc1, 0x00)).toBe('U0100');
    expect(decodeDtc(0xd0, 0x16)).toBe('U1016');
    expect(decodeDtc(0x81, 0x23)).toBe('B0123');
    expect(decodeDtc(0x41, 0x23)).toBe('C0123');
    expect(decodeDtc(0x42, 0x20)).toBe('C0220');
    expect(decodeDtc(0x03, 0x00)).toBe('P0300');
    expect(decodeDtc(0x34, 0xff)).toBe('P34FF');
  });

  it('sistema di appartenenza e validita\'', () => {
    expect(dtcSystem('P0133')).toBe('powertrain');
    expect(dtcSystem('U0100')).toBe('network');
    expect(isValidDtc('P0133')).toBe(true);
    expect(isValidDtc('X0133')).toBe(false);
    expect(isValidDtc('P4133')).toBe(false);
  });

  it('CAN: 43 + conteggio + coppie; padding ignorato', () => {
    const r = decodeDtcList([0x43, 0x03, 0x01, 0x33, 0xc1, 0x00, 0x42, 0x20], true, 0x03);
    expect(r.ok && r.value).toEqual({ codes: ['P0133', 'U0100', 'C0220'], declaredCount: 3 });
    const none = decodeDtcList([0x43, 0x00], true, 0x03);
    expect(none.ok && none.value).toEqual({ codes: [], declaredCount: 0 });
    const padded = decodeDtcList([0x43, 0x01, 0x01, 0x33, 0x00, 0x00, 0x00], true, 0x03);
    expect(padded.ok && padded.value.codes).toEqual(['P0133']);
  });

  it('CAN: messaggio piu\' corto del conteggio dichiarato -> si leggono i codici presenti', () => {
    const r = decodeDtcList([0x43, 0x03, 0x01, 0x33], true, 0x03);
    expect(r.ok && r.value).toEqual({ codes: ['P0133'], declaredCount: 3 });
  });

  it('non CAN: 3 slot da 2 byte, 00 00 = vuoto', () => {
    const r = decodeDtcList([0x43, 0x01, 0x33, 0xc1, 0x00, 0x00, 0x00], false, 0x03);
    expect(r.ok && r.value.codes).toEqual(['P0133', 'U0100']);
  });

  it('servizi 07 e 0A', () => {
    expect(decodeDtcList([0x47, 0x01, 0x03, 0x00], true, 0x07).ok).toBe(true);
    expect(decodeDtcList([0x4a, 0x00], true, 0x0a).ok).toBe(true);
    const wrong = decodeDtcList([0x43, 0x00], true, 0x07);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe('UNEXPECTED_SERVICE');
  });

  it('input vuoto o corto = errore tipizzato', () => {
    expect(decodeDtcList([], true).ok).toBe(false);
    const short = decodeDtcList([0x43], true);
    expect(short.ok).toBe(false);
    expect(decodeDtcList([0x43], false).ok).toBe(true); // non CAN: nessuno slot
  });
});

describe('VIN', () => {
  const vinBytes = [...'ZFA19900001234567'].map((c) => c.charCodeAt(0));

  it('CAN: 49 02 01 + 17 byte', () => {
    const r = decodeVinFromMessages([{ ecu: '7E8', data: [0x49, 0x02, 0x01, ...vinBytes] }]);
    expect(r.ok && r.value).toBe('ZFA19900001234567');
  });

  it('J1850: 5 messaggi con indice, ordinati, filler 00 scartato (anche in ordine inverso)', () => {
    const msgs = [
      [0x49, 0x02, 0x01, 0x00, 0x00, 0x00, 0x5a],
      [0x49, 0x02, 0x02, 0x46, 0x41, 0x31, 0x39],
      [0x49, 0x02, 0x03, 0x39, 0x30, 0x30, 0x30],
      [0x49, 0x02, 0x04, 0x30, 0x31, 0x32, 0x33],
      [0x49, 0x02, 0x05, 0x34, 0x35, 0x36, 0x37],
    ].map((data) => ({ ecu: '10', data }));
    expect(decodeVinFromMessages(msgs).ok).toBe(true);
    expect(decodeVinFromMessages(msgs.slice().reverse())).toEqual({ ok: true, value: 'ZFA19900001234567' });
  });

  it('validazione: 17 caratteri, niente I, O, Q', () => {
    expect(isValidVin('ZFA19900001234567')).toBe(true);
    expect(isValidVin('ZFA1990000123456')).toBe(false);
    expect(isValidVin('ZFA1990000123456I')).toBe(false);
    expect(isValidVin('ZFA1990000123456O')).toBe(false);
    expect(isValidVin('ZFA1990000123456Q')).toBe(false);
    const r = decodeVinFromMessages([{ ecu: '7E8', data: [0x49, 0x02, 0x01, ...vinBytes.slice(0, 16), 0x49] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_VIN');
  });

  it('VIN tutto a zero o vuoto = non valido', () => {
    expect(decodeVinFromMessages([{ ecu: '7E8', data: [0x49, 0x02, 0x01, ...new Array(17).fill(0)] }]).ok).toBe(false);
    expect(decodeVinFromMessages([]).ok).toBe(false);
  });

  it('piu\' ECU: si sceglie il primo VIN valido', () => {
    const r = decodeVin([
      { ecu: '7E9', data: [0x49, 0x02, 0x01, ...new Array(17).fill(0)] },
      { ecu: '7E8', data: [0x49, 0x02, 0x01, ...vinBytes] },
    ]);
    expect(r.ok && r.value).toBe('ZFA19900001234567');
  });
});

describe('freeze frame (Mode 02)', () => {
  it('02 02 00 -> codice che ha generato il freeze frame', () => {
    const r = decodeFreezeFrameMessage([0x42, 0x02, 0x00, 0x01, 0x33]);
    expect(r.ok && r.value).toEqual({ pid: 2, frame: 0, dtc: 'P0133' });
    const none = decodeFreezeFrameMessage([0x42, 0x02, 0x00, 0x00, 0x00]);
    expect(none.ok && none.value.dtc).toBeNull();
  });

  it('stesse formule del Mode 01', () => {
    const r = decodeFreezeFrameMessage([0x42, 0x05, 0x00, 0x7b]);
    expect(r.ok && r.value.value?.value).toBe(83);
    const rpm = decodeFreezeFrameMessage([0x42, 0x0c, 0x00, 0x1a, 0xf8]);
    expect(rpm.ok && rpm.value.value?.value).toBe(1726);
  });

  it('errori tipizzati e costruzione del freeze frame', () => {
    expect(decodeFreezeFrameMessage([0x41, 0x05, 0x00, 0x7b]).ok).toBe(false);
    expect(decodeFreezeFrameMessage([0x42]).ok).toBe(false);
    expect(decodeFreezeFrameMessage([]).ok).toBe(false);
    const a = decodeFreezeFrameMessage([0x42, 0x02, 0x00, 0x01, 0x33]);
    const b = decodeFreezeFrameMessage([0x42, 0x05, 0x00, 0x7b]);
    if (!a.ok || !b.ok) throw new Error('setup');
    const ff = buildFreezeFrame([a.value, b.value]);
    expect(ff.dtc).toBe('P0133');
    expect(ff.values.map((v) => v.id)).toEqual(['coolant_temp']);
  });
});

describe('servizi, risposte negative, comandi di scrittura', () => {
  it('splitByService separa positivi, negativi e altri', () => {
    const s = splitByService(
      [
        { ecu: '7E8', data: [0x41, 0x0c, 0x1a, 0xf8] },
        { ecu: '7E9', data: [0x7f, 0x01, 0x11] },
        { ecu: '7EA', data: [0x7f, 0x01, 0x78] },
        { ecu: '7EB', data: [0x7f, 0x09, 0x11] },
        { ecu: '7EC', data: [0x43, 0x00] },
        { ecu: '7ED', data: [] },
      ],
      0x01,
    );
    expect(s.positive.map((m) => m.ecu)).toEqual(['7E8']);
    expect(s.negatives.map((n) => n.error.code)).toEqual(['NEGATIVE_RESPONSE', 'RESPONSE_PENDING']);
    expect(s.negatives[0].error.nrc).toBe(0x11);
    expect(s.other.map((m) => m.ecu)).toEqual(['7EB', '7EC']);
    expect(isUnsupportedNrc(0x11)).toBe(true);
    expect(isUnsupportedNrc(0x22)).toBe(false);
  });

  it('isWriteCommand: whitelist (obd-01), blocca Mode 04 e UDS di scrittura ma non le letture usate dall\'app', () => {
    for (const c of ['04', '04 ', '0400', '08', '14FFFFFF', '2E F1 90 00', '3101', '11 01']) {
      expect(isWriteCommand(c), c).toBe(true);
    }
    for (const c of ['0100', '010C', '03', '07', '0A', '0902', '02 02 00', 'ATZ', 'ATSP0', 'ATDPN', 'STI', '']) {
      expect(isWriteCommand(c), c).toBe(false);
    }
    // 22 e 19 (UDS di lettura) non sono usati da nessun percorso dell\'app: con la whitelist restano bloccati finche\' non servono.
    for (const c of ['22 F1 90', '19 02 AF']) expect(isWriteCommand(c), c).toBe(true);
  });
});

describe('protocolli', () => {
  it('ATDPN: A6 = automatico + CAN 11 bit 500k', () => {
    expect(parseProtocolNumber('A6')).toEqual({ id: '6', auto: true });
    expect(parseProtocolNumber('6')).toEqual({ id: '6', auto: false });
    expect(parseProtocolNumber('A')).toEqual({ id: 'A', auto: false });
    expect(parseProtocolNumber('AA')).toEqual({ id: 'A', auto: true });
    expect(parseProtocolNumber('?')).toBeUndefined();
    expect(parseProtocolNumber('')).toBeUndefined();
    expect(parseProtocolNumber('XYZ')).toBeUndefined();
  });

  it('informazioni sul protocollo', () => {
    expect(protocolInfo('6')).toMatchObject({ can: true, canBits: 11 });
    expect(protocolInfo('7')).toMatchObject({ can: true, canBits: 29 });
    expect(protocolInfo('3')).toMatchObject({ can: false, legacy: true });
    expect(protocolInfo('Z')).toBeUndefined();
    expect(protocolInfo(undefined)).toBeUndefined();
  });
});
