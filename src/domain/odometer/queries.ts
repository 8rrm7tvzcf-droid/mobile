// Interrogazioni sul registro km (F-02, F-03, F-42): km attuali con provenienza, intervallo ammesso per una data,
// incoerenze in un registro importato, km percorsi in un periodo. Funzioni pure sugli array di letture.
import { compareDates } from '@/domain/dates';
import type { LocalDate } from '@/domain/ports';
import { MAX_KM } from '@/domain/units';
import type { OdometerReading, OdometerSource } from './types';
import { validReadings } from './validate';

export const SOURCE_LABELS_IT: Record<OdometerSource, string> = {
  manual: 'Inserito a mano',
  obd: "Letto dall'auto",
  fuel: 'Da un rifornimento',
  service: 'Da un intervento',
  fluid_check: 'Da un controllo livelli',
  import: 'Importato',
};

export const sourceLabelIt = (source: OdometerSource): string => SOURCE_LABELS_IT[source];

/** I km attuali: l'ultima lettura valida (data piu' recente; a parita' di data i km piu' alti). `null` se non ce ne sono. */
export function latestReading(readings: readonly OdometerReading[]): OdometerReading | null {
  const v = validReadings(readings);
  return v.length > 0 ? v[v.length - 1]! : null;
}

/** L'ultima lettura valida fino a `date` compresa (per «precompilato con l'ultimo noto»). */
export function latestReadingOnOrBefore(readings: readonly OdometerReading[], date: LocalDate): OdometerReading | null {
  const v = validReadings(readings).filter((r) => compareDates(r.readOn, date) <= 0);
  return v.length > 0 ? v[v.length - 1]! : null;
}

export interface CurrentKm {
  km: number;
  readOn: LocalDate;
  source: OdometerSource;
  sourceLabel: string;
}

/** Km attuali con provenienza e data (scheda auto). */
export function currentKm(readings: readonly OdometerReading[]): CurrentKm | null {
  const r = latestReading(readings);
  return r ? { km: r.km, readOn: r.readOn, source: r.source, sourceLabel: sourceLabelIt(r.source) } : null;
}

/**
 * Intervallo di km ammesso per una lettura in `date`: da max(km dei giorni precedenti) a min(km dei giorni successivi).
 * Nello stesso giorno nessun vincolo. Serve a mostrare «tra X e Y km» e a vincolare l'input.
 */
export function allowedKmRange(
  readings: readonly OdometerReading[],
  date: LocalDate,
  excludeId?: string,
): { min: number; max: number } {
  let min = 0;
  let max = MAX_KM;
  for (const r of validReadings(readings)) {
    if (r.id === excludeId) continue;
    const c = compareDates(r.readOn, date);
    if (c < 0) min = Math.max(min, r.km);
    else if (c > 0) max = Math.min(max, r.km);
  }
  return { min, max };
}

export interface InconsistentReading {
  reading: OdometerReading;
  /** Letture valide con cui la monotonia non regge. */
  conflictsWith: OdometerReading[];
}

/**
 * Letture valide che violano la monotonia con altre letture valide (dati importati, modifiche fuori dall'app).
 * Con N letture costa O(N log N): scorre i giorni con il massimo corrente dei giorni precedenti
 * e con il minimo dei giorni successivi.
 */
export function findInconsistentReadings(readings: readonly OdometerReading[]): InconsistentReading[] {
  const v = validReadings(readings);
  const n = v.length;
  // indice di fine/inizio del gruppo di ogni giorno
  const out: InconsistentReading[] = [];
  const dayStart: number[] = new Array<number>(n);
  const dayEnd: number[] = new Array<number>(n);
  for (let i = 0; i < n; ) {
    let j = i;
    while (j < n && v[j]!.readOn === v[i]!.readOn) j++;
    for (let k = i; k < j; k++) {
      dayStart[k] = i;
      dayEnd[k] = j;
    }
    i = j;
  }
  // massimo (con indice) dei giorni precedenti e minimo dei giorni successivi
  const prefMax: number[] = new Array<number>(n + 1); // prefMax[i] = indice del max tra v[0..i-1]
  prefMax[0] = -1;
  for (let i = 0; i < n; i++) {
    const p = prefMax[i]!;
    prefMax[i + 1] = p < 0 || v[i]!.km > v[p]!.km ? i : p;
  }
  const sufMin: number[] = new Array<number>(n + 1); // sufMin[i] = indice del min tra v[i..n-1]
  sufMin[n] = -1;
  for (let i = n - 1; i >= 0; i--) {
    const s = sufMin[i + 1]!;
    sufMin[i] = s < 0 || v[i]!.km < v[s]!.km ? i : s;
  }
  for (let k = 0; k < n; k++) {
    const r = v[k]!;
    const conflictsWith: OdometerReading[] = [];
    const pm = prefMax[dayStart[k]!]!; // max dei giorni PRECEDENTI
    if (pm >= 0 && v[pm]!.km > r.km) conflictsWith.push(v[pm]!);
    const sm = sufMin[dayEnd[k]!]!; // min dei giorni SUCCESSIVI
    if (sm >= 0 && v[sm]!.km < r.km) conflictsWith.push(v[sm]!);
    if (conflictsWith.length > 0) out.push({ reading: r, conflictsWith });
  }
  return out;
}

export interface KmTravelled {
  /** Km tra la prima e l'ultima lettura valida dell'intervallo. */
  km: number;
  from: OdometerReading;
  to: OdometerReading;
  /** Quante letture valide cadono nell'intervallo. */
  readings: number;
}

/**
 * Km percorsi in un periodo: differenza tra l'ultima e la prima lettura valida con data in [from, to] (estremi inclusi).
 * E' la definizione della SPEC §6.3.8 per il costo al km. `null` se nel periodo c'e' meno di due letture
 * (o se le due letture estreme sono nello stesso giorno con gli stessi km: nulla da dividere).
 */
export function kmTravelled(readings: readonly OdometerReading[], from: LocalDate, to: LocalDate): KmTravelled | null {
  const v = validReadings(readings).filter((r) => compareDates(r.readOn, from) >= 0 && compareDates(r.readOn, to) <= 0);
  if (v.length < 2) return null;
  const first = v[0]!;
  const last = v[v.length - 1]!;
  return { km: Math.max(0, last.km - first.km), from: first, to: last, readings: v.length };
}

/** Come `kmTravelled` ma su tutto il registro (dall'acquisto a oggi). */
export function kmTravelledAllTime(readings: readonly OdometerReading[]): KmTravelled | null {
  const v = validReadings(readings);
  if (v.length < 2) return null;
  const first = v[0]!;
  const last = v[v.length - 1]!;
  return { km: Math.max(0, last.km - first.km), from: first, to: last, readings: v.length };
}
