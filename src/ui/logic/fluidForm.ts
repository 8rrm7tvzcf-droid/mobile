// Controllo livelli (S-24, F-44): valori del modulo in 3 tocchi, lettura dell'input, stato dei fluidi e righe di storico. Pura.
// Onesta': l'OBD standard non legge i livelli ne' la pressione dei pneumatici (testi in `it.fluid` e nel dominio).
import type { LocalDate } from '@/domain/dates';
import {
  FLUID_LEVELS,
  formatAddedAmount,
  levelLabelIt,
  parseAddedMl,
  type Fluid,
  type FluidLevel,
  type FluidStatusKind,
} from '@/domain/fluids';
import {
  formatDateIt,
  formatDistance,
  formatPressure,
  isValidTyreMillibar,
  parseDateIt,
  parsePressureToMillibar,
  toDisplayDistance,
  type DistanceUnit,
} from '@/domain/units';
import type { AddFluidCheckInput, FluidCheckEntry, FluidStatusEntry } from '@/usecases/fluids';
import type { DeadlineIcon, DeadlineTone } from '@/usecases/queries';
import type { ChoiceOption } from '../components/Choices';
import { it } from '../i18n/it';
import { parseKmField } from './odometer';

export interface FluidFormValues {
  fluid: Fluid;
  /** `null` finche' non scegli: e' il secondo tocco. */
  level: FluidLevel | null;
  /** Pressione in bar come scritta ("2,2"), solo per i pneumatici. */
  pressure: string;
  /** Quantita' aggiunta, solo con "rabboccato". */
  added: string;
  addedUnit: 'ml' | 'L';
  product: string;
  date: string;
  km: string;
  notes: string;
}

export interface FluidFormErrors {
  level?: string;
  pressure?: string;
  added?: string;
  date?: string;
  km?: string;
  form?: string;
}

export function initialFluidForm(fluid: Fluid, today: LocalDate): FluidFormValues {
  return { fluid, level: null, pressure: '', added: '', addedUnit: 'ml', product: '', date: formatDateIt(today), km: '', notes: '' };
}

/** Cambiando fluido l'esito si sceglie di nuovo (le etichette cambiano) e i campi specifici ripartono. */
export const switchFluid = (v: FluidFormValues, fluid: Fluid): FluidFormValues => ({ ...v, fluid, level: null, pressure: '', added: '', product: '' });

export const levelOptions = (fluid: Fluid): ChoiceOption<FluidLevel>[] => FLUID_LEVELS.map((value) => ({ value, label: levelLabelIt(fluid, value) }));

export const isPressure = (fluid: Fluid): boolean => fluid === 'tyre_pressure';

/** I campi della quantita' aggiunta compaiono solo con "rabboccato" e non per la pressione. */
export const showsAddedFields = (v: Pick<FluidFormValues, 'fluid' | 'level'>): boolean => v.level === 'topped_up' && v.fluid !== 'tyre_pressure';

export type FluidBuildResult = { ok: true; input: AddFluidCheckInput } | { ok: false; errors: FluidFormErrors };

export function buildAddFluidInput(vehicleId: string, v: FluidFormValues, ctx: { today: LocalDate; unit: DistanceUnit }): FluidBuildResult {
  const errors: FluidFormErrors = {};
  if (v.level === null) errors.level = it.fluid.levelLabel;

  const date = parseDateIt(v.date);
  if (date === null) errors.date = it.common.dateExample;
  else if (date > ctx.today) errors.date = it.common.futureDate;

  let km: number | null = null;
  if (v.km.trim() !== '') {
    km = parseKmField(v.km, ctx.unit);
    if (km === null) errors.km = it.km.invalidKm;
  }

  let valueMillibar: number | null = null;
  if (isPressure(v.fluid) && v.pressure.trim() !== '') {
    valueMillibar = parsePressureToMillibar(v.pressure, 'bar');
    if (valueMillibar === null || !isValidTyreMillibar(valueMillibar)) errors.pressure = it.fluid.invalidPressure;
  }

  let addedMl: number | null = null;
  if (showsAddedFields(v) && v.added.trim() !== '') {
    addedMl = parseAddedMl(v.added, v.addedUnit);
    if (addedMl === null) errors.added = it.fluid.invalidAdded;
  }

  if (Object.keys(errors).length > 0 || date === null || v.level === null) return { ok: false, errors };
  const product = showsAddedFields(v) && v.product.trim() !== '' ? v.product.trim() : null;
  const input: AddFluidCheckInput = {
    vehicleId,
    fluid: v.fluid,
    level: v.level,
    checkedOn: date,
    km,
    notes: v.notes.trim() === '' ? null : v.notes.trim(),
    ...(valueMillibar !== null ? { valueMillibar } : {}),
    ...(addedMl !== null ? { addedMl } : {}),
    ...(product !== null ? { product } : {}),
  };
  return { ok: true, input };
}

/** Campo del caso d'uso -> campo del modulo. */
export function fluidErrorField(field: string | undefined): keyof FluidFormErrors {
  switch (field) {
    case 'checkedOn':
    case 'date':
      return 'date';
    case 'km':
      return 'km';
    case 'level':
      return 'level';
    case 'addedMl':
      return 'added';
    case 'valueMillibar':
      return 'pressure';
    default:
      return 'form';
  }
}

// ---------------------------------------------------------------- stato e storico

/** Semaforo di un fluido: sempre icona + testo (`labelIt` del dominio). */
export function fluidTone(kind: FluidStatusKind): { tone: DeadlineTone; icon: DeadlineIcon } {
  switch (kind) {
    case 'attention':
      return { tone: 'warning', icon: 'alert' };
    case 'overdue':
      return { tone: 'warning', icon: 'clock' };
    case 'ok':
      return { tone: 'ok', icon: 'check' };
    default:
      return { tone: 'unknown', icon: 'help' };
  }
}

/** Quanti fluidi vanno controllati o ricontrollati (mai controllati, esito basso/alto, ricontrollo dovuto). */
export const fluidsNeedingAttention = (list: readonly FluidStatusEntry[]): number => list.filter((s) => s.kind !== 'ok').length;

export function fluidNextCheckText(s: FluidStatusEntry, unit: DistanceUnit): string | null {
  if (s.nextCheckOn === null && s.nextCheckKm === null) return null;
  const parts: string[] = [];
  if (s.nextCheckOn) parts.push(it.fluid.nextCheck(formatDateIt(s.nextCheckOn)));
  if (s.nextCheckKm !== null) parts.push(s.nextCheckOn ? it.fluid.nextCheckKm(formatDistance(s.nextCheckKm, unit)) : it.fluid.nextCheck(formatDistance(s.nextCheckKm, unit)));
  return parts.join(' ');
}

export const fluidRowTitle = (c: FluidCheckEntry): string => `${c.fluidLabelIt} · ${c.levelLabelIt}`;

export function fluidRowSubtitle(c: FluidCheckEntry, unit: DistanceUnit): string {
  const parts: (string | null)[] = [
    formatDateIt(c.checkedOn),
    c.valueMillibar != null ? formatPressure(c.valueMillibar, 'bar') : null,
    c.addedMl != null ? it.fluid.amountLine(formatAddedAmount(c.addedMl)) : null,
    c.product,
    c.km != null ? formatDistance(c.km, unit) : null,
  ];
  return parts.filter((p): p is string => Boolean(p)).join(' · ');
}

export const fluidRowA11y = (c: FluidCheckEntry, unit: DistanceUnit): string => `${fluidRowTitle(c)}. ${fluidRowSubtitle(c, unit)}`;

/** Per "Annulla" dopo l'eliminazione: i dati con cui ricreare lo stesso controllo (i km non devono bloccare il ripristino). */
export function fluidRestoreInput(c: FluidCheckEntry): AddFluidCheckInput {
  return {
    vehicleId: c.vehicleId,
    fluid: c.fluid,
    level: c.level,
    checkedOn: c.checkedOn,
    km: c.km ?? null,
    notes: c.notes,
    ...(c.valueMillibar != null ? { valueMillibar: c.valueMillibar } : {}),
    ...(c.addedMl != null ? { addedMl: c.addedMl } : {}),
    ...(c.product ? { product: c.product } : {}),
    onOdometerConflict: 'skip_km',
  };
}

export const kmFieldText = (km: number, unit: DistanceUnit): string => String(toDisplayDistance(km, unit));
