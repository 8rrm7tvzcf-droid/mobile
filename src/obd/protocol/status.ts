// Decodifica del PID 0101: spia MIL, numero di DTC, monitor di prontezza (OBD §11, SPEC 5.1). Puro.
// Layout confermato da Wikipedia; l'ordine per-bit misfire/fuel/components e' coerente con J1979 ma
// resta da provare su auto reale (SP-8), quindi la confidenza dichiarata e' media-alta.
import { fail, ok, obdError, type ObdResult } from './errors';

export type EngineType = 'spark' | 'compression';

export interface MonitorStatus {
  id: string;
  /** Nome per l'utente (italiano). */
  name: string;
  /** Il costruttore dichiara che il monitor esiste su questa auto. */
  available: boolean;
  /** Il test e' stato completato (vale solo se `available`). */
  complete: boolean;
}

export interface Mode01Status {
  milOn: boolean;
  /** Numero di DTC emissioni confermati (0-127). */
  dtcCount: number;
  engineType: EngineType;
  /** Monitor comuni + specifici del tipo di motore, solo quelli disponibili e non. */
  monitors: MonitorStatus[];
  /** Tutti i monitor disponibili sono completi. */
  ready: boolean;
  /** Monitor disponibili ma non ancora completi. */
  incomplete: MonitorStatus[];
}

const COMMON: readonly { id: string; name: string; bit: number }[] = [
  { id: 'misfire', name: 'Mancate accensioni', bit: 0 },
  { id: 'fuel_system', name: 'Sistema di alimentazione', bit: 1 },
  { id: 'components', name: 'Componenti', bit: 2 },
];

const SPARK: readonly { id: string; name: string; bit: number }[] = [
  { id: 'catalyst', name: 'Catalizzatore', bit: 0 },
  { id: 'heated_catalyst', name: 'Catalizzatore riscaldato', bit: 1 },
  { id: 'evap', name: 'Sistema EVAP (vapori di carburante)', bit: 2 },
  { id: 'secondary_air', name: 'Aria secondaria', bit: 3 },
  { id: 'gpf', name: 'Filtro antiparticolato benzina (GPF)', bit: 4 },
  { id: 'o2_sensor', name: 'Sonda lambda', bit: 5 },
  { id: 'o2_heater', name: 'Riscaldatore sonda lambda', bit: 6 },
  { id: 'egr_vvt', name: 'EGR / fasatura variabile', bit: 7 },
];

const COMPRESSION: readonly { id: string; name: string; bit: number }[] = [
  { id: 'nmhc', name: 'Catalizzatore NMHC', bit: 0 },
  { id: 'nox_scr', name: 'Post-trattamento NOx / SCR', bit: 1 },
  { id: 'boost_pressure', name: 'Pressione di sovralimentazione', bit: 3 },
  { id: 'exhaust_gas_sensor', name: 'Sensore gas di scarico', bit: 5 },
  { id: 'pm_filter', name: 'Filtro antiparticolato (DPF)', bit: 6 },
  { id: 'egr_vvt', name: 'EGR / fasatura variabile', bit: 7 },
];

/**
 * @param data byte dopo '41 01': A, B, C, D (servono almeno 4)
 */
export function decodeStatus0101(data: readonly number[]): ObdResult<Mode01Status> {
  if (!Array.isArray(data)) return fail(obdError('MALFORMED_FRAME'));
  if (data.length < 4) return fail(obdError('TOO_SHORT', `0101: attesi 4 byte, ricevuti ${data.length}`));
  const [a, b, c, d] = data;
  if ([a, b, c, d].some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return fail(obdError('MALFORMED_FRAME'));

  const milOn = (a & 0x80) !== 0;
  const dtcCount = a & 0x7f;
  const engineType: EngineType = (b & 0x08) !== 0 ? 'compression' : 'spark';

  const monitors: MonitorStatus[] = [];
  for (const m of COMMON) {
    const available = (b & (1 << m.bit)) !== 0;
    const notComplete = (b & (1 << (m.bit + 4))) !== 0; // logica invertita: 1 = non completo
    monitors.push({ id: m.id, name: m.name, available, complete: available && !notComplete });
  }
  for (const m of engineType === 'spark' ? SPARK : COMPRESSION) {
    const available = (c & (1 << m.bit)) !== 0;
    const notComplete = (d & (1 << m.bit)) !== 0;
    monitors.push({ id: m.id, name: m.name, available, complete: available && !notComplete });
  }
  const incomplete = monitors.filter((m) => m.available && !m.complete);
  return ok({ milOn, dtcCount, engineType, monitors, ready: incomplete.length === 0, incomplete });
}
