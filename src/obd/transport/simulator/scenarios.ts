// Scenari del simulatore ELM327 (F-56): auto virtuali deterministiche. I VIN sono fittizi.
import type { ProtocolId } from '@/obd/protocol';

export type ScenarioId = 'petrol' | 'mil-on' | 'diesel' | 'clone' | 'kline-slow' | 'ignition-off' | 'flaky';

export interface EcuSpec {
  /** Identificatore di risposta CAN ('7E8') o, nei protocolli non CAN, indirizzo sorgente ('11'). */
  id: string;
  /** PID Mode 01 a cui l'ECU risponde (i PID 'puntatore' si deducono). */
  pids: number[];
  /** Risponde a Mode 03/07/0A con i codici dello scenario (solo l'ECU motore ha i codici). */
  dtc: 'engine' | 'empty' | 'none';
  /** Risponde a 0902. */
  vin: boolean;
  /** Mode 02 (freeze frame). */
  freezeFrame: boolean;
  /** Mode 01 PID 01 (stato, monitor). */
  status: boolean;
}

export interface Glitch {
  /** Ogni N richieste OBD (non AT) la risposta e' sostituita. */
  every: number;
  reply: string;
}

export interface ScenarioConfig {
  id: ScenarioId;
  /** Nome per l'utente (italiano). */
  label: string;
  description: string;
  protocol: ProtocolId;
  /** Intestazione dei messaggi non CAN: 3 byte (formato, destinazione, sorgente = ecu.id). */
  legacyHeader?: [number, number];
  elmVersion: string;
  /** Risposta a AT@1; null = '?'. */
  atDescription: string | null;
  /** Risposta a STI; null = '?'. */
  sti: string | null;
  /** ATAMC supportato (firmware >= 2.0). */
  amc: boolean;
  /** Il clone ignora ATE0 (l'eco resta). */
  ignoresEchoOff: boolean;
  /** Il clone risponde '?' a ATCRA/ATCTM5/ATAMT. */
  rejectsCra: boolean;
  /** Byte NUL spuri dopo il reset. */
  nulNoise: boolean;
  ignition: boolean;
  engineType: 'spark' | 'compression';
  mil: boolean;
  vin: string | null;
  dtcStored: string[];
  dtcPending: string[];
  /** null = Mode 0A non supportato (NO DATA). */
  dtcPermanent: string[] | null;
  /** Freeze frame presente se ci sono codici memorizzati. */
  freezeFrame: boolean;
  /** Byte B, C, D di 0101 (A si calcola). */
  monitorB: number;
  monitorC: number;
  monitorD: number;
  ecus: EcuSpec[];
  odometerKm: number | null;
  fuelType: number;
  idleRpm: number;
  /** Ritardo di risposta per comando (ms). */
  latencyMs: number;
  /** Durata della ricerca del protocollo (ms) prima del primo 0100. */
  searchDelayMs: number;
  /** Cade il collegamento dopo N richieste OBD (opzionale). */
  dropAfterRequests?: number;
  glitches?: Glitch[];
}

const PETROL_PIDS = [
  0x01, 0x04, 0x05, 0x06, 0x07, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x1c, 0x1f, 0x21, 0x2f, 0x30, 0x31, 0x33, 0x42, 0x46, 0x51,
];

const TRANSMISSION_PIDS = [0x04, 0x0c, 0x0d];

const CAN_ECUS = (enginePids: number[]): EcuSpec[] => [
  { id: '7E8', pids: enginePids, dtc: 'engine', vin: true, freezeFrame: true, status: true },
  { id: '7E9', pids: TRANSMISSION_PIDS, dtc: 'empty', vin: false, freezeFrame: false, status: false },
];

const base: Omit<ScenarioConfig, 'id' | 'label' | 'description'> = {
  protocol: '6',
  elmVersion: 'ELM327 v2.1',
  atDescription: 'OBDII to RS232 Interpreter',
  sti: null,
  amc: true,
  ignoresEchoOff: false,
  rejectsCra: false,
  nulNoise: false,
  ignition: true,
  engineType: 'spark',
  mil: false,
  vin: 'ZFA19900001234567',
  dtcStored: [],
  dtcPending: [],
  dtcPermanent: [],
  freezeFrame: false,
  monitorB: 0x07,
  monitorC: 0x65,
  monitorD: 0x00,
  ecus: CAN_ECUS(PETROL_PIDS),
  odometerKm: null,
  fuelType: 1,
  idleRpm: 780,
  latencyMs: 0,
  searchDelayMs: 0,
};

export const SCENARIOS: Readonly<Record<ScenarioId, ScenarioConfig>> = {
  petrol: {
    ...base,
    id: 'petrol',
    label: 'Benzina, tutto a posto',
    description: 'Auto a benzina su CAN 11 bit: spia spenta, nessun codice, monitor tutti pronti.',
  },
  'mil-on': {
    ...base,
    id: 'mil-on',
    label: 'Spia motore accesa',
    description: 'Benzina su CAN con spia accesa, tre codici memorizzati, uno pendente, uno permanente e freeze frame; monitor EVAP non pronto.',
    mil: true,
    dtcStored: ['P0420', 'P0301', 'P0171'],
    dtcPending: ['P0171'],
    dtcPermanent: ['P0420'],
    freezeFrame: true,
    monitorD: 0x04,
  },
  diesel: {
    ...base,
    id: 'diesel',
    label: 'Diesel con odometro',
    description: 'Diesel su CAN 11 bit: risponde anche al chilometraggio (01A6) e alla temperatura olio (015C); un codice pendente.',
    engineType: 'compression',
    vin: 'WVWZZZ1KZ6W123456',
    dtcPending: ['P2002'],
    monitorB: 0x0f,
    monitorC: 0xc3,
    monitorD: 0x00,
    ecus: CAN_ECUS([0x01, 0x04, 0x05, 0x0b, 0x0c, 0x0d, 0x0f, 0x10, 0x11, 0x1c, 0x1f, 0x21, 0x2f, 0x31, 0x33, 0x42, 0x46, 0x4d, 0x4e, 0x51, 0x5c, 0xa6]),
    odometerKm: 123456.7,
    fuelType: 4,
    idleRpm: 830,
  },
  clone: {
    ...base,
    id: 'clone',
    label: 'Adattatore clone difettoso',
    description: "Clone 'v1.5': ignora ATE0 (l'eco resta), risponde '?' ad ATAMC, AT@1, STI e ATCRA, byte NUL spuri.",
    elmVersion: 'ELM327 v1.5',
    atDescription: null,
    amc: false,
    ignoresEchoOff: true,
    rejectsCra: true,
    nulNoise: true,
    ecus: [{ id: '7E8', pids: [0x01, 0x04, 0x05, 0x0c, 0x0d, 0x0f, 0x11], dtc: 'engine', vin: true, freezeFrame: false, status: true }],
    dtcStored: ['P0133'],
    mil: true,
    monitorD: 0x04,
  },
  'kline-slow': {
    ...base,
    id: 'kline-slow',
    label: 'Auto datata con K-line lenta',
    description: 'ISO 9141-2: una sola centralina, risposte lente, niente VIN, due codici memorizzati su due slot; nessun multi-PID.',
    protocol: '3',
    legacyHeader: [0x48, 0x6b],
    vin: null,
    mil: true,
    dtcStored: ['P0133', 'P0300'],
    dtcPending: [],
    dtcPermanent: null,
    freezeFrame: false,
    monitorB: 0x07,
    monitorC: 0x65,
    monitorD: 0x00,
    ecus: [{ id: '11', pids: [0x01, 0x04, 0x05, 0x0b, 0x0c, 0x0d, 0x0f, 0x11], dtc: 'engine', vin: false, freezeFrame: false, status: true }],
    latencyMs: 120,
    searchDelayMs: 3000,
  },
  'ignition-off': {
    ...base,
    id: 'ignition-off',
    label: 'Quadro spento',
    description: 'Adattatore collegato ma accensione spenta: 0100 risponde UNABLE TO CONNECT finche non si accende il quadro.',
    ignition: false,
  },
  flaky: {
    ...base,
    id: 'flaky',
    label: 'Collegamento instabile',
    description: 'Ogni tanto il bus risponde BUS BUSY o DATA ERROR; dopo 400 richieste cade il collegamento.',
    glitches: [
      { every: 7, reply: 'BUS BUSY' },
      { every: 11, reply: '<DATA ERROR' },
    ],
    dropAfterRequests: 400,
  },
};

export function getScenario(id: ScenarioId | ScenarioConfig): ScenarioConfig {
  return typeof id === 'string' ? SCENARIOS[id] : id;
}
