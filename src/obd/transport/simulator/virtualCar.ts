// Auto virtuale deterministica per il simulatore: valori plausibili che evolvono col tempo (ciclo di guida
// periodico), codifica dei PID, bitmask, DTC. Nessun Math.random, nessun orologio: il tempo e' un parametro.
import { encodePidSupport } from '@/obd/protocol';
import type { ScenarioConfig } from './scenarios';

export interface CarState {
  engineOn: boolean;
  speed: number;
  rpm: number;
  load: number;
  throttle: number;
  map: number;
  coolant: number;
  iat: number;
  maf: number;
  fuel: number;
  voltage: number;
  runTime: number;
  timing: number;
  oil: number;
}

/** Punti (secondi, km/h) del ciclo di guida; periodo 90 s. */
const CYCLE: readonly (readonly [number, number])[] = [
  [0, 0],
  [8, 0],
  [22, 48],
  [38, 48],
  [52, 82],
  [66, 82],
  [80, 0],
  [90, 0],
];
const PERIOD = 90;

function speedAt(t: number): number {
  const x = ((t % PERIOD) + PERIOD) % PERIOD;
  for (let i = 1; i < CYCLE.length; i++) {
    const [t1, v1] = CYCLE[i];
    const [t0, v0] = CYCLE[i - 1];
    if (x <= t1) return t1 === t0 ? v1 : v0 + ((v1 - v0) * (x - t0)) / (t1 - t0);
  }
  return 0;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Stato dell'auto dopo `t` secondi dall'avviamento. */
export function carStateAt(t: number, sc: Pick<ScenarioConfig, 'ignition' | 'idleRpm'>): CarState {
  const engineOn = sc.ignition;
  if (!engineOn) {
    return { engineOn: false, speed: 0, rpm: 0, load: 0, throttle: 0, map: 101, coolant: 24, iat: 22, maf: 0, fuel: 62, voltage: 12.4, runTime: 0, timing: 0, oil: 24 };
  }
  const speed = speedAt(t);
  const accel = speedAt(t + 1) - speed;
  const rpm = speed < 1 ? sc.idleRpm + 25 * Math.sin(t * 2.3) : 1000 + speed * 22 + 80 * Math.sin(t * 1.7);
  const load = clamp(15 + speed * 0.35 + Math.max(0, accel) * 4 + 3 * Math.sin(t), 5, 95);
  const coolant = Math.min(90, 60 + 30 * (1 - Math.exp(-t / 120)));
  return {
    engineOn: true,
    speed,
    rpm,
    load,
    throttle: clamp(11 + load * 0.45, 0, 100),
    map: 28 + load * 0.7,
    coolant,
    iat: 24 + 12 * (1 - Math.exp(-t / 300)),
    maf: 2.5 + load * 0.18 + rpm * 0.002,
    fuel: Math.max(5, 62 - t * 0.0015),
    voltage: 14.1 + 0.15 * Math.sin(t * 0.5),
    runTime: Math.floor(t),
    timing: 8 + load * 0.1,
    oil: coolant + 6,
  };
}

const two = (v: number) => {
  const n = clamp(Math.round(v), 0, 65535);
  return [n >> 8, n & 0xff];
};
const one = (v: number) => [clamp(Math.round(v), 0, 255)];

/** Byte dati (A, B, ...) di un PID Mode 01 per lo stato dato; null se il PID non e' modellato. */
export function pidBytes(pid: number, s: CarState, sc: ScenarioConfig): number[] | null {
  switch (pid) {
    case 0x04:
      return one((s.load * 255) / 100);
    case 0x05:
      return one(s.coolant + 40);
    case 0x06:
      return one(((2.5 + 100) * 128) / 100);
    case 0x07:
      return one(((-1.6 + 100) * 128) / 100);
    case 0x0b:
      return one(s.map);
    case 0x0c:
      return two(s.rpm * 4);
    case 0x0d:
      return one(s.speed);
    case 0x0e:
      return one((s.timing + 64) * 2);
    case 0x0f:
      return one(s.iat + 40);
    case 0x10:
      return two(s.maf * 100);
    case 0x11:
      return one((s.throttle * 255) / 100);
    case 0x1c:
      return [6];
    case 0x1f:
      return two(s.runTime);
    case 0x21:
      return two(sc.mil ? 120 : 0);
    case 0x2f:
      return one((s.fuel * 255) / 100);
    case 0x30:
      return [5];
    case 0x31:
      return two(1234);
    case 0x33:
      return [101];
    case 0x42:
      return two(s.voltage * 1000);
    case 0x46:
      return one(18 + 40);
    case 0x4d:
      return two(sc.mil ? 42 : 0);
    case 0x4e:
      return two(1500);
    case 0x51:
      return [sc.fuelType];
    case 0x5c:
      return one(s.oil + 40);
    case 0xa6: {
      if (sc.odometerKm === null) return null;
      const raw = Math.round(sc.odometerKm * 10);
      return [Math.floor(raw / 16777216) & 0xff, (raw >> 16) & 0xff, (raw >> 8) & 0xff, raw & 0xff];
    }
    default:
      return null;
  }
}

/** Bitmask del blocco `base` per un'ECU; null se l'ECU non risponde a quel blocco. */
export function supportMask(pids: readonly number[], base: number): number[] | null {
  if (pids.length === 0) return null;
  const maxPid = Math.max(...pids);
  if (base > 0 && maxPid <= base) return null; // l'ECU non ha PID oltre il blocco precedente
  const inBlock = pids.filter((p) => p > base && p <= base + 0x20);
  if (maxPid > base + 0x20) inBlock.push(base + 0x20); // bit 'puntatore' al blocco successivo
  return encodePidSupport(base, inBlock);
}

/** Inverso di decodeDtc: 'P0133' -> [0x01, 0x33]. */
export function encodeDtc(code: string): [number, number] {
  const letter = 'PCBU'.indexOf(code[0]);
  const d1 = Number(code[1]);
  const d2 = parseInt(code[2], 16);
  const rest = parseInt(code.slice(3, 5), 16);
  if (letter < 0 || !Number.isInteger(d1) || Number.isNaN(d2) || Number.isNaN(rest)) return [0, 0];
  return [(letter << 6) | (d1 << 4) | d2, rest];
}

/** Byte del freeze frame (Mode 02, frame 0) per PID; il PID 02 e' il codice che l'ha generato. */
export function freezeFrameBytes(pid: number, sc: ScenarioConfig): number[] | null {
  const snap: CarState = {
    engineOn: true,
    speed: 55,
    rpm: 2100,
    load: 62,
    throttle: 28,
    map: 70,
    coolant: 88,
    iat: 31,
    maf: 14,
    fuel: 40,
    voltage: 14.0,
    runTime: 900,
    timing: 14,
    oil: 94,
  };
  if (pid === 0x02) return sc.dtcStored.length > 0 ? Array.from(encodeDtc(sc.dtcStored[0])) : [0, 0];
  if (![0x04, 0x05, 0x0b, 0x0c, 0x0d, 0x0f, 0x11].includes(pid)) return null;
  return pidBytes(pid, snap, sc);
}
