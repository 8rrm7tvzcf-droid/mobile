// Validazione e normalizzazione dei dati dell'auto (SPEC 6.3.2, AC-01). Funzioni pure, messaggi in italiano.
import { compareDates, isValidDate } from '@/domain/dates';
import { isValidKm } from '@/domain/units';
import type { LocalDate } from '@/domain/ports';
import {
  POWERTRAINS,
  PRIMARY_FUELS,
  SECONDARY_FUELS,
  TRANSMISSIONS,
  type Powertrain,
  type PrimaryFuel,
  type SecondaryFuel,
  type Transmission,
  type VehicleInput,
} from './types';

/** Targa/VIN: maiuscolo, senza spazi ne' separatori. */
export const normalizePlate = (raw: string): string => raw.toUpperCase().replace(/[\s\-.·_]/g, '');
export const normalizeVin = (raw: string): string => raw.toUpperCase().replace(/[\s\-.·_]/g, '');

export const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
export const isValidVin = (vin: string): boolean => VIN_RE.test(vin);

// Lettere ammesse nelle targhe italiane moderne (AA000AA, dal 1994): senza I, O, Q, U.
const PLATE_MODERN = /^[ABCDEFGHJKLMNPRSTVWXYZ]{2}\d{3}[ABCDEFGHJKLMNPRSTVWXYZ]{2}$/;
const PLATE_MODERN_SHAPE = /^[A-Z]{2}\d{3}[A-Z]{2}$/;
// Formati precedenti e speciali: sigla provinciale o di serie + 4-7 cifre (anche con una lettera), motocicli AA00000, CD/EE ecc.
const PLATE_LEGACY = /^[A-Z]{2}(?:\d{4,7}|[A-Z]\d{4,6}|\d[A-Z]\d{4,5})$/;

/** `plate` gia' normalizzata. Vero per il formato moderno e per i formati storici/speciali italiani. */
export function isValidItalianPlate(plate: string): boolean {
  if (PLATE_MODERN_SHAPE.test(plate)) return PLATE_MODERN.test(plate);
  return PLATE_LEGACY.test(plate);
}

export interface VehicleFields {
  nickname: string | null;
  plate: string | null;
  plateCountry: string;
  vin: string | null;
  make: string;
  model: string;
  trim: string | null;
  modelYear: number | null;
  firstRegistrationOn: LocalDate | null;
  powertrain: Powertrain;
  fuelPrimary: PrimaryFuel;
  fuelSecondary: SecondaryFuel | null;
  engineCc: number | null;
  powerKw: number | null;
  euroClass: string | null;
  color: string | null;
  transmission: Transmission | null;
  tankCapacityMl: number | null;
  distanceUnit: 'km' | 'mi';
  annualKmEstimate: number | null;
  purchaseOn: LocalDate | null;
  purchaseKm: number | null;
  purchasePriceCents: number | null;
  notes: string | null;
}

export type FieldsResult = { ok: true; value: VehicleFields } | { ok: false; field: string; message: string };

export interface ValidateContext {
  today: LocalDate;
  /** Unita' predefinita (impostazione `units.distance`) se l'input non la indica. */
  defaultDistanceUnit: 'km' | 'mi';
}

class FieldError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
  }
}
const bad = (field: string, message: string): never => {
  throw new FieldError(field, message);
};

function text(v: string | null | undefined, max: number, field: string, label: string): string | null {
  if (v == null) return null;
  const t = v.trim().replace(/\s+/g, ' ');
  if (t === '') return null;
  if (t.length > max) bad(field, `${label} può avere al massimo ${max} caratteri.`);
  return t;
}

function required(v: string | null | undefined, max: number, field: string, missing: string, label: string): string {
  const t = text(v, max, field, label);
  return t ?? bad(field, missing);
}

function int(v: number | null | undefined, min: number, max: number, field: string, message: string): number | null {
  if (v == null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) bad(field, message);
  return v;
}

function date(v: LocalDate | null | undefined, today: LocalDate, field: string, label: string): LocalDate | null {
  if (v == null || v === '') return null;
  if (!isValidDate(v)) bad(field, `${label} non è valida.`);
  if (compareDates(v, today) > 0) bad(field, `${label} è nel futuro.`);
  return v;
}

/** Powertrain di partenza ricavato dall'alimentazione. */
export function derivePowertrain(primary: PrimaryFuel, secondary: SecondaryFuel | null): Powertrain {
  if (primary === 'electric') return 'bev';
  if (primary === 'hydrogen') return 'fcev';
  if (secondary === 'electric') return 'phev';
  return 'ice';
}

/** Messaggio se la combinazione alimentazione/tipo di motorizzazione non ha senso, altrimenti null. */
export function fuelCombinationError(primary: PrimaryFuel, secondary: SecondaryFuel | null, powertrain: Powertrain): string | null {
  if (secondary === primary) return "L'alimentazione secondaria deve essere diversa dalla primaria.";
  if (primary === 'electric' && (powertrain !== 'bev' || secondary !== null)) {
    return "Un'auto elettrica non ha un'alimentazione secondaria.";
  }
  if (primary === 'hydrogen' && (powertrain !== 'fcev' || secondary !== null)) {
    return "Un'auto a idrogeno non ha un'alimentazione secondaria.";
  }
  if (powertrain === 'bev' && primary !== 'electric') return "Un'auto elettrica deve avere l'alimentazione elettrica.";
  if (powertrain === 'fcev' && primary !== 'hydrogen') return "Un'auto a idrogeno deve avere l'alimentazione a idrogeno.";
  if (secondary === 'electric') {
    if (primary !== 'petrol' && primary !== 'diesel') return "L'ibrida plug-in ha benzina o gasolio come alimentazione primaria.";
    if (powertrain !== 'phev') return "L'alimentazione elettrica secondaria è tipica dell'ibrida plug-in.";
  }
  if (powertrain === 'phev' && secondary !== 'electric') return "L'ibrida plug-in ha l'elettrico come alimentazione secondaria.";
  if (secondary === 'lpg' || secondary === 'cng') {
    if (primary !== 'petrol') return 'La doppia alimentazione è benzina + GPL o benzina + metano.';
  }
  if (secondary === 'petrol' && primary !== 'lpg' && primary !== 'cng') {
    return 'La doppia alimentazione è benzina + GPL o benzina + metano.';
  }
  return null;
}

/** Valida e normalizza i dati dell'auto. Il primo errore trovato e' restituito con il campo e il messaggio in italiano. */
export function validateVehicleInput(input: VehicleInput, ctx: ValidateContext): FieldsResult {
  try {
    const nickname = text(input.nickname, 60, 'nickname', 'Il soprannome');
    const make = required(input.make, 40, 'make', 'Indica la marca.', 'La marca');
    const model = required(input.model, 60, 'model', 'Indica il modello.', 'Il modello');
    const trim = text(input.trim, 80, 'trim', "L'allestimento");

    const plateCountry = (input.plateCountry ?? 'IT').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(plateCountry)) bad('plateCountry', 'Il Paese della targa va indicato con due lettere (per esempio IT).');
    let plate: string | null = null;
    if (input.plate != null && input.plate.trim() !== '') {
      plate = normalizePlate(input.plate);
      if (!/^[A-Z0-9]{2,10}$/.test(plate)) bad('plate', 'La targa può contenere solo lettere e numeri (da 2 a 10 caratteri).');
      if (plateCountry === 'IT' && !isValidItalianPlate(plate)) {
        bad('plate', 'La targa non sembra italiana (per esempio AB123CD). Controllala oppure indica un altro Paese.');
      }
    }
    let vin: string | null = null;
    if (input.vin != null && input.vin.trim() !== '') {
      vin = normalizeVin(input.vin);
      if (!isValidVin(vin)) {
        bad('vin', 'Il VIN ha 17 caratteri tra lettere e numeri; le lettere I, O e Q non si usano. Controlla di averlo copiato bene.');
      }
    }

    const yearMax = Number(ctx.today.slice(0, 4)) + 1;
    const modelYear = int(input.modelYear, 1900, yearMax, 'modelYear', `L'anno del modello deve essere tra 1900 e ${yearMax}.`);
    const firstRegistrationOn = date(input.firstRegistrationOn, ctx.today, 'firstRegistrationOn', 'La data di prima immatricolazione');

    const fuelPrimary = input.fuelPrimary;
    if (!(PRIMARY_FUELS as readonly string[]).includes(fuelPrimary)) bad('fuelPrimary', "Scegli l'alimentazione.");
    const fuelSecondary = input.fuelSecondary ?? null;
    if (fuelSecondary !== null && !(SECONDARY_FUELS as readonly string[]).includes(fuelSecondary)) {
      bad('fuelSecondary', "L'alimentazione secondaria non è valida.");
    }
    if (input.powertrain !== undefined && !(POWERTRAINS as readonly string[]).includes(input.powertrain)) {
      bad('powertrain', 'Il tipo di motorizzazione non è valido.');
    }
    const powertrain = input.powertrain ?? derivePowertrain(fuelPrimary, fuelSecondary);
    const combo = fuelCombinationError(fuelPrimary, fuelSecondary, powertrain);
    if (combo) bad(fuelSecondary !== null ? 'fuelSecondary' : 'fuelPrimary', combo);

    const engineCc = int(input.engineCc, 50, 20000, 'engineCc', 'La cilindrata deve essere tra 50 e 20.000 cm³.');
    const powerKw = int(input.powerKw, 1, 2000, 'powerKw', 'La potenza deve essere tra 1 e 2.000 kW.');
    const euroClass = text(input.euroClass, 10, 'euroClass', 'La classe Euro');
    const color = text(input.color, 30, 'color', 'Il colore');
    const transmission = input.transmission ?? null;
    if (transmission !== null && !(TRANSMISSIONS as readonly string[]).includes(transmission)) {
      bad('transmission', 'Il tipo di cambio non è valido.');
    }
    const tankCapacityMl = int(input.tankCapacityMl, 1000, 1_000_000, 'tankCapacityMl', 'Il serbatoio deve essere tra 1 e 1.000 litri.');
    const distanceUnit = input.distanceUnit ?? ctx.defaultDistanceUnit;
    if (distanceUnit !== 'km' && distanceUnit !== 'mi') bad('distanceUnit', "L'unità di misura deve essere km o mi.");
    const annualKmEstimate = int(
      input.annualKmEstimate,
      100,
      200000,
      'annualKmEstimate',
      'I km annui stimati devono essere tra 100 e 200.000.',
    );
    const purchaseOn = date(input.purchaseOn, ctx.today, 'purchaseOn', "La data d'acquisto");
    let purchaseKm: number | null = null;
    if (input.purchaseKm != null) {
      if (!isValidKm(input.purchaseKm)) bad('purchaseKm', 'I km all’acquisto devono essere un numero intero tra 0 e 2.000.000.');
      purchaseKm = input.purchaseKm;
    }
    const purchasePriceCents = int(
      input.purchasePriceCents,
      0,
      100_000_000_000,
      'purchasePriceCents',
      'Il prezzo d’acquisto non è valido.',
    );
    const notes = input.notes == null || input.notes.trim() === '' ? null : input.notes.trim();

    return {
      ok: true,
      value: {
        nickname,
        plate,
        plateCountry,
        vin,
        make,
        model,
        trim,
        modelYear,
        firstRegistrationOn,
        powertrain,
        fuelPrimary,
        fuelSecondary,
        engineCc,
        powerKw,
        euroClass,
        color,
        transmission,
        tankCapacityMl,
        distanceUnit,
        annualKmEstimate,
        purchaseOn,
        purchaseKm,
        purchasePriceCents,
        notes,
      },
    };
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, field: e.field, message: e.message };
    throw e;
  }
}
