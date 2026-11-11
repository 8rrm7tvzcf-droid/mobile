// Modulo "Aggiungi/modifica auto" (SPEC 6.3.2): da testo scritto a mano a input dei casi d'uso, con messaggi in italiano.
// La validazione vera resta nei casi d'uso (addVehicle/updateVehicle): qui si legge solo l'input dell'utente.
import { parseDateIt, parseDistanceInput, type DistanceUnit } from '@/domain/units';
import { isValidVin, normalizeVin } from '@/usecases/vehicles';
import type {
  AddVehicleInput,
  Powertrain,
  PrimaryFuel,
  SecondaryFuel,
  UpdateVehicleInput,
  Vehicle,
} from '@/usecases/vehicles';
import { it } from '../i18n/it';

export interface VehicleFormState {
  nickname: string;
  make: string;
  model: string;
  plate: string;
  /** Numero di telaio: 17 caratteri senza I, O, Q. Vuoto = nessun VIN (si puo' correggere o togliere quello letto dall'OBD). */
  vin: string;
  modelYear: string;
  /** gg/mm/aaaa */
  firstRegistration: string;
  fuelPrimary: PrimaryFuel | null;
  fuelSecondary: SecondaryFuel | null;
  powertrain: Powertrain;
  /** Solo in aggiunta: i km di oggi creano la prima lettura. */
  currentKm: string;
}

export type VehicleFormErrors = Partial<Record<keyof VehicleFormState, string>>;

export const emptyVehicleForm = (): VehicleFormState => ({
  nickname: '',
  make: '',
  model: '',
  plate: '',
  vin: '',
  modelYear: '',
  firstRegistration: '',
  fuelPrimary: null,
  fuelSecondary: null,
  powertrain: 'ice',
  currentKm: '',
});

/** 'YYYY-MM-DD' -> 'gg/mm/aaaa' (senza dipendere dal formattatore: serve per riempire un campo di testo). */
function toFieldDate(ymd: string | null): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}

export function formFromVehicle(v: Vehicle): VehicleFormState {
  return {
    nickname: v.nickname ?? '',
    make: v.make,
    model: v.model,
    plate: v.plate ?? '',
    vin: v.vin ?? '',
    modelYear: v.modelYear === null ? '' : String(v.modelYear),
    firstRegistration: toFieldDate(v.firstRegistrationOn),
    fuelPrimary: v.fuelPrimary,
    fuelSecondary: v.fuelSecondary,
    powertrain: v.powertrain,
    currentKm: '',
  };
}

export interface Option<T extends string> {
  value: T;
  label: string;
}

/** Alimentazioni proposte: l'idrogeno solo se l'auto lo ha gia' (non e' tra quelle comuni). */
export function primaryFuelOptions(current: PrimaryFuel | null): Option<PrimaryFuel>[] {
  const base: PrimaryFuel[] = ['petrol', 'diesel', 'lpg', 'cng', 'electric'];
  if (current === 'hydrogen') base.push('hydrogen');
  return base.map((value) => ({ value, label: it.vehicleForm.fuelOptions[value] }));
}

/** "Doppia alimentazione": solo benzina + GPL o benzina + metano; l'ibrida plug-in ha l'elettrico implicito. */
export function secondaryFuelOptions(primary: PrimaryFuel | null, powertrain: Powertrain): Option<SecondaryFuel | 'none'>[] {
  if (primary !== 'petrol' || powertrain === 'phev') return [];
  return [
    { value: 'none', label: it.vehicleForm.secondaryOptions.none },
    { value: 'lpg', label: it.vehicleForm.secondaryOptions.lpg },
    { value: 'cng', label: it.vehicleForm.secondaryOptions.cng },
  ];
}

/** Tipo di motore: l'elettrica non ha scelta; GPL e metano da soli sono sempre non ibridi. */
export function powertrainOptions(primary: PrimaryFuel | null): Option<Powertrain>[] {
  if (primary === 'petrol' || primary === 'diesel') {
    return (['ice', 'mhev', 'hev', 'phev'] as const).map((value) => ({ value, label: it.vehicleForm.powertrainOptions[value] }));
  }
  return [];
}

/** Cambio di alimentazione: riallinea doppia alimentazione e tipo di motore perche' la combinazione resti valida. */
export function withPrimaryFuel(form: VehicleFormState, fuel: PrimaryFuel): VehicleFormState {
  const next: VehicleFormState = { ...form, fuelPrimary: fuel };
  if (fuel === 'electric') {
    next.powertrain = 'bev';
    next.fuelSecondary = null;
  } else if (fuel === 'hydrogen') {
    next.powertrain = 'fcev';
    next.fuelSecondary = null;
  } else {
    if (fuel !== 'petrol') next.fuelSecondary = null;
    if (next.powertrain === 'bev' || next.powertrain === 'fcev') next.powertrain = 'ice';
    if (fuel !== 'petrol' && fuel !== 'diesel') next.powertrain = 'ice';
    if (next.powertrain === 'phev') next.fuelSecondary = 'electric';
    else if (next.fuelSecondary === 'electric') next.fuelSecondary = null;
  }
  return next;
}

export function withPowertrain(form: VehicleFormState, powertrain: Powertrain): VehicleFormState {
  const next: VehicleFormState = { ...form, powertrain };
  if (powertrain === 'phev') next.fuelSecondary = 'electric';
  else if (next.fuelSecondary === 'electric') next.fuelSecondary = null;
  return next;
}

export function withSecondaryFuel(form: VehicleFormState, value: SecondaryFuel | 'none'): VehicleFormState {
  return { ...form, fuelSecondary: value === 'none' ? null : value };
}

type Built<T> = { ok: true; input: T } | { ok: false; errors: VehicleFormErrors };

interface Context {
  today: string;
  distanceUnit: DistanceUnit;
}

function readCommon(form: VehicleFormState, ctx: Context): Built<Omit<AddVehicleInput, 'initialKm' | 'initialKmOn'>> {
  const errors: VehicleFormErrors = {};
  const make = form.make.trim();
  const model = form.model.trim();
  if (make === '') errors.make = it.vehicleForm.makeRequired;
  if (model === '') errors.model = it.vehicleForm.modelRequired;
  if (form.fuelPrimary === null) errors.fuelPrimary = it.vehicleForm.fuelRequired;

  let vin: string | null = null;
  if (form.vin.trim() !== '') {
    const normalized = normalizeVin(form.vin);
    if (isValidVin(normalized)) vin = normalized;
    else errors.vin = it.vehicleForm.vinInvalid;
  }

  let modelYear: number | null = null;
  const yearText = form.modelYear.trim();
  if (yearText !== '') {
    if (!/^\d{4}$/.test(yearText)) errors.modelYear = it.vehicleForm.yearInvalid;
    else {
      modelYear = Number(yearText);
      const maxYear = Number(ctx.today.slice(0, 4)) + 1;
      if (modelYear < 1900 || modelYear > maxYear) errors.modelYear = it.vehicleForm.yearFuture;
    }
  }

  let firstRegistrationOn: string | null = null;
  const regText = form.firstRegistration.trim();
  if (regText !== '') {
    const parsed = parseDateIt(regText);
    if (parsed === null) errors.firstRegistration = it.common.dateExample;
    else if (parsed > ctx.today) errors.firstRegistration = it.common.futureDate;
    else firstRegistrationOn = parsed;
  }

  if (Object.keys(errors).length > 0 || form.fuelPrimary === null) return { ok: false, errors };

  const input: Omit<AddVehicleInput, 'initialKm' | 'initialKmOn'> = {
    nickname: form.nickname.trim() === '' ? null : form.nickname.trim(),
    make,
    model,
    plate: form.plate.trim() === '' ? null : form.plate.trim(),
    vin,
    modelYear,
    firstRegistrationOn,
    fuelPrimary: form.fuelPrimary,
    fuelSecondary: form.fuelSecondary,
    powertrain: form.powertrain,
  };
  return { ok: true, input };
}

export function buildAddInput(form: VehicleFormState, ctx: Context): Built<AddVehicleInput> {
  const common = readCommon(form, ctx);
  const errors: VehicleFormErrors = common.ok ? {} : { ...common.errors };
  let initialKm: number | null = null;
  const kmText = form.currentKm.trim();
  if (kmText !== '') {
    initialKm = parseDistanceInput(kmText, ctx.distanceUnit);
    if (initialKm === null) errors.currentKm = it.common.kmExample;
  }
  if (!common.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { ...common.input, initialKm, initialKmOn: ctx.today } };
}

export function buildUpdateInput(form: VehicleFormState, ctx: Context): Built<UpdateVehicleInput> {
  const common = readCommon(form, ctx);
  if (!common.ok) return common;
  return { ok: true, input: common.input };
}

/** Il campo del modulo a cui riferire un errore dei casi d'uso (i nomi dei campi dei casi d'uso sono diversi). */
export function formFieldOf(useCaseField: string | undefined): keyof VehicleFormState | null {
  switch (useCaseField) {
    case 'nickname':
    case 'make':
    case 'model':
    case 'plate':
    case 'vin':
    case 'modelYear':
      return useCaseField;
    case 'firstRegistrationOn':
      return 'firstRegistration';
    case 'fuelPrimary':
    case 'fuelSecondary':
    case 'powertrain':
      return useCaseField;
    case 'initialKm':
      return 'currentKm';
    default:
      return null;
  }
}
