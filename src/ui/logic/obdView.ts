// Presentazione dei dati OBD: formati italiani, codici guasto, VIN, checklist di compatibilita', dati live. Pura (niente React).
// I tipi arrivano da '@/bootstrap' (la UI non importa mai src/obd); i testi stanno tutti in i18n/it.ts.
import type { CapabilityReport, DecodedPid, DtcSection, LiveSample, ObdFailureCode, Provenance, Reading, ServiceProbe, Snapshot } from '@/bootstrap';
import { formatScaled } from '@/domain/units';
import { it } from '../i18n/it';
import type { IconName } from '../components/Icon';
import type { ToneKey } from '../theme/tokens';

// ----------------------------------------------------------------------------- numeri e date

/** Numero con virgola decimale e punto delle migliaia: 1234.5 con 1 decimale -> "1.234,5". */
export function formatDecimal(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '–';
  const d = Math.max(0, Math.min(3, Math.trunc(decimals)));
  return formatScaled(Math.round(value * 10 ** d), d);
}

const two = (n: number): string => String(n).padStart(2, '0');

/** Istante UTC (ISO) -> "08/10/2026 alle 12:34" nell'ora del telefono. Testo vuoto se non valido. */
export function formatReadAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} alle ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Istante UTC (ISO) -> "12:34:56" nell'ora del telefono. */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

// ----------------------------------------------------------------------------- provenienza e valori

export const provenanceLabel = (source: Provenance): string => it.obd.provenance[source];

export function pidName(d: Pick<DecodedPid, 'id' | 'name'>): string {
  return it.obd.pidNames[d.id] ?? d.name;
}

/** "1.250 giri/min", "92 °C", "Diesel". Le etichette dei PID enumerati (tipo di carburante) hanno la precedenza. */
export function pidValueText(d: DecodedPid): string {
  if (d.label) return d.label;
  const n = formatDecimal(d.value, d.decimals);
  return d.unit ? `${n} ${d.unit}` : n;
}

export function voltageText(volts: number): string {
  return `${formatDecimal(volts, 1)} V`;
}

/** Ordine di presentazione dei valori chiave: prima quelli che interessano di piu'. */
const VALUE_ORDER: readonly string[] = [
  'engine_rpm',
  'coolant_temp',
  'fuel_level',
  'control_module_voltage',
  'intake_temp',
  'engine_load',
  'vehicle_speed',
  'oil_temp',
  'odometer',
  'fuel_type',
  'baro_pressure',
  'ambient_temp',
];

/** Valori non mostrati tra i "valori chiave" (sono dati tecnici di contorno). */
const HIDDEN_VALUES: ReadonlySet<string> = new Set(['obd_standard', 'map', 'maf', 'throttle', 'run_time', 'distance_with_mil', 'distance_since_clear']);

export interface ValueRow {
  id: string;
  label: string;
  value: string;
  source: Provenance;
  readAt: string;
  /** Testo completo per i lettori di schermo. */
  a11y: string;
}

export function valueRows(snapshot: Snapshot): ValueRow[] {
  const entries = Object.entries(snapshot.pids).filter(([id]) => !HIDDEN_VALUES.has(id));
  const rank = (id: string): number => {
    const i = VALUE_ORDER.indexOf(id);
    return i < 0 ? VALUE_ORDER.length : i;
  };
  entries.sort((a, b) => rank(a[0]) - rank(b[0]) || (a[0] < b[0] ? -1 : 1));
  const rows: ValueRow[] = entries.map(([id, r]: [string, Reading<DecodedPid>]) => {
    const label = pidName(r.value);
    const value = pidValueText(r.value);
    return { id, label, value, source: r.source, readAt: r.readAt, a11y: `${label}: ${value}. ${provenanceLabel(r.source)}.` };
  });
  const v = snapshot.adapterVoltage;
  if (v) {
    const value = voltageText(v.value);
    rows.push({
      id: 'adapter_voltage',
      label: it.obd.snapshot.voltageAdapter,
      value,
      source: v.source,
      readAt: v.readAt,
      a11y: `${it.obd.snapshot.voltageAdapter}: ${value}. ${provenanceLabel(v.source)}.`,
    });
  }
  return rows;
}

// ----------------------------------------------------------------------------- codici guasto

export type DtcLetter = 'P' | 'C' | 'B' | 'U';

export interface DtcView {
  code: string;
  system: string;
  generic: boolean;
  description: string | null;
  /** Descrizione, oppure il sistema e il rimando generico: sempre un testo da mostrare. */
  text: string;
  a11y: string;
}

const MISFIRE_RE = /^P03(0[1-9]|1[0-2])$/;

export function dtcView(code: string): DtcView {
  const letter = (code[0] ?? 'P') as DtcLetter;
  const system = it.obd.snapshot.dtcSystems[letter] ?? it.obd.snapshot.dtcSystems.P;
  const second = code[1] ?? '0';
  const generic = letter === 'P' ? second === '0' || second === '2' : second === '0';
  let description: string | null = it.obd.dtcDescriptions[code] ?? null;
  const m = MISFIRE_RE.exec(code);
  if (!description && m) description = it.obd.dtcMisfireCylinder(Number(m[1]));
  const text = description ?? it.obd.snapshot.dtcNoDescription;
  return { code, system, generic, description, text, a11y: it.obd.snapshot.dtcA11y(code, system, text) };
}

export type DtcSectionKind = 'ok' | 'empty' | 'unsupported' | 'error' | 'skipped';

export function dtcSectionKind(s: DtcSection): DtcSectionKind {
  if (s.status === 'ok') return s.codes.length === 0 ? 'empty' : 'ok';
  return s.status;
}

// ----------------------------------------------------------------------------- spia e riepilogo

export type MilKind = 'on' | 'off' | 'unknown';

export function milKind(snapshot: Snapshot): MilKind {
  if (!snapshot.status) return 'unknown';
  return snapshot.status.value.milOn ? 'on' : 'off';
}

/** Vero se almeno un dato e' arrivato: altrimenti si mostra "L'auto non ha risposto" con "Riprova". */
export function snapshotHasData(s: Snapshot): boolean {
  if (s.vin || s.status || s.freezeFrame || s.adapterVoltage) return true;
  if (Object.keys(s.pids).length > 0) return true;
  return [s.dtc.stored, s.dtc.pending, s.dtc.permanent].some((d) => d.status === 'ok');
}

/** Il collegamento e' caduto durante la lettura (il simulatore instabile o un adattatore vero). */
export function snapshotLinkLost(s: Snapshot): boolean {
  return s.issues.some((i) => i.error.code === 'DISCONNECTED' || i.error.code === 'WRITE_FAILED');
}

export function snapshotHasIssues(s: Snapshot): boolean {
  return s.issues.length > 0;
}

// ----------------------------------------------------------------------------- VIN

export type VinView =
  | { kind: 'read'; vin: string; compare: 'saved-none' | 'same' | 'differs'; saved: string | null }
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'error' };

export function vinView(snapshot: Snapshot, savedVin: string | null): VinView {
  if (snapshot.vin) {
    const vin = snapshot.vin.value.toUpperCase();
    const saved = savedVin ? savedVin.toUpperCase() : null;
    return { kind: 'read', vin, saved, compare: saved === null ? 'saved-none' : saved === vin ? 'same' : 'differs' };
  }
  switch (snapshot.vinStatus) {
    case 'invalid':
      return { kind: 'invalid' };
    case 'error':
      return { kind: 'error' };
    default:
      return { kind: 'missing' };
  }
}

// ----------------------------------------------------------------------------- errori

export function failureText(code: ObdFailureCode): { title: string; text: string } {
  return it.obd.failures[code] ?? it.obd.failures.READ_FAILED;
}

// ----------------------------------------------------------------------------- tabella "cosa si legge e cosa no"

export type Availability = 'yes' | 'sometimes' | 'no';

export interface AvailabilityStyle {
  tone: ToneKey;
  icon: IconName;
  label: string;
}

/** Semaforo con icona e testo (mai solo colore). */
export function availabilityStyle(v: Availability): AvailabilityStyle {
  switch (v) {
    case 'yes':
      return { tone: 'ok', icon: 'check', label: it.obd.table.yes };
    case 'sometimes':
      return { tone: 'warning', icon: 'help', label: it.obd.table.sometimes };
    default:
      return { tone: 'unknown', icon: 'x', label: it.obd.table.no };
  }
}

// ----------------------------------------------------------------------------- report di compatibilita'

export interface ChecklistRow {
  key: string;
  label: string;
  available: boolean;
  detail: string | null;
}

function probeDetail(p: ServiceProbe, key: string): string | null {
  switch (p) {
    case 'answers':
      return null;
    case 'no_data':
      return it.obd.compat.serviceNoData;
    case 'error':
      return it.obd.compat.serviceError;
    default:
      return key === 'freeze_frame' ? it.obd.compat.freezeUntested : it.obd.compat.untested;
  }
}

/** Righe della checklist con testi nostri: il report dice cosa e' disponibile, qui si decide come dirlo. */
export function checklistRows(report: CapabilityReport): ChecklistRow[] {
  const s = report.services;
  const serviceOf: Record<string, ServiceProbe> = {
    vin: s.vin,
    mil: s.status,
    monitors: s.status,
    dtc_stored: s.dtcStored,
    dtc_pending: s.dtcPending,
    dtc_permanent: s.dtcPermanent,
    freeze_frame: s.freezeFrame,
  };
  return report.checklist.map((c) => {
    const label = it.obd.compat.checklist[c.key] ?? c.label;
    if (c.available) return { key: c.key, label, available: true, detail: null };
    const probe = serviceOf[c.key];
    if (probe !== undefined) return { key: c.key, label, available: false, detail: probeDetail(probe, c.key) };
    if (c.key === 'adapter_voltage') return { key: c.key, label, available: false, detail: it.obd.compat.adapterVoltageMissing };
    const pid = report.pids.find((p) => p.id === c.key);
    return { key: c.key, label, available: false, detail: pid?.declared ? it.obd.compat.declaredNoAnswer : it.obd.compat.notDeclared };
  });
}

export interface CompatSummary {
  noEcu: boolean;
  suspectedClone: boolean;
  noPid: boolean;
  ecus: string;
  declared: number;
  answered: number;
}

export function compatSummary(report: CapabilityReport): CompatSummary {
  const answered = report.pids.filter((p) => p.supported).length;
  return {
    noEcu: report.ecus.length === 0,
    suspectedClone: report.adapter.suspectedClone,
    noPid: report.pids.length > 0 && answered === 0,
    ecus: report.ecus.join(', '),
    declared: report.declared.length,
    answered,
  };
}

// ----------------------------------------------------------------------------- dati live

export interface LiveValues {
  rpm: Reading<DecodedPid> | null;
  coolant: Reading<DecodedPid> | null;
  moduleVoltage: Reading<DecodedPid> | null;
  adapterVoltage: Reading<number> | null;
  /** PID usciti dal piano perche' l'auto non risponde. */
  dropped: number[];
  samples: number;
  lastAt: string | null;
}

export const EMPTY_LIVE: LiveValues = { rpm: null, coolant: null, moduleVoltage: null, adapterVoltage: null, dropped: [], samples: 0, lastAt: null };

/** Ogni campione porta solo i PID letti in quel ciclo: si tiene l'ultimo valore noto di ciascuno. */
export function mergeLive(prev: LiveValues, sample: LiveSample): LiveValues {
  return {
    rpm: sample.values.engine_rpm ?? prev.rpm,
    coolant: sample.values.coolant_temp ?? prev.coolant,
    moduleVoltage: sample.values.control_module_voltage ?? prev.moduleVoltage,
    adapterVoltage: sample.adapterVoltage ?? prev.adapterVoltage,
    dropped: sample.dropped,
    samples: prev.samples + 1,
    lastAt: sample.readAt,
  };
}

