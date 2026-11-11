// Lettura del testo di un libretto / Documento Unico (F-75, SPEC): dal testo copiato da una foto ai campi dell'auto.
// Pura (niente React Native) e prudente: tutto cio' che non si riconosce con sicurezza resta `null` (mai dati inventati) e
// l'utente controlla il risultato prima di usarlo. I campi sono quelli armonizzati UE stampati sul documento:
//   (A) targa · (B) prima immatricolazione · (D.1) marca · (D.3) denominazione commerciale · (E) telaio · (P.3) carburante.
// ATTENZIONE: scritta senza campioni reali di testo riconosciuto; la qualita' sui documenti veri va misurata (SPEC SP-11).
import { parseDateIt } from '@/domain/units';
import { isValidItalianPlate, isValidVin, normalizePlate, normalizeVin, type PrimaryFuel, type SecondaryFuel } from '@/usecases/vehicles';
import { it } from '../i18n/it';
import type { VehicleFormState } from './vehicleForm';
import { withPrimaryFuel, withSecondaryFuel } from './vehicleForm';

export interface ReadCard {
  plate: string | null;
  vin: string | null;
  /** gg/mm/aaaa */
  firstRegistration: string | null;
  make: string | null;
  model: string | null;
  fuelPrimary: PrimaryFuel | null;
  fuelSecondary: SecondaryFuel | null;
}

export const emptyCard = (): ReadCard => ({ plate: null, vin: null, firstRegistration: null, make: null, model: null, fuelPrimary: null, fuelSecondary: null });

const MAX_TEXT = 6000;

/** Righe pulite in maiuscolo: spazi unici, senza righe vuote. */
function toLines(text: string): string[] {
  return text
    .slice(0, MAX_TEXT)
    .replace(/ /g, ' ')
    .toUpperCase()
    .split(/[\r\n]+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');
}

/** Una riga che comincia con un'etichetta del documento, per non prendere come valore l'etichetta seguente. */
const LABEL_START = /^(?:\([A-Z]{1,2}\.?\d{0,2}\)|[A-Z]\.\d{1,2}(?=[\s:.)-])|[A-Z]\))/;

/**
 * Il valore scritto dopo un'etichetta (sulla stessa riga o, se la riga contiene solo l'etichetta, su quella dopo).
 * `descriptors`: le parole stampate accanto al codice («MARCA», «DENOMINAZIONE COMMERCIALE»...) da togliere.
 */
function valueAfter(lines: readonly string[], code: RegExp, descriptors: readonly RegExp[]): string | null {
  const head = new RegExp(`^\\(?${code.source}\\)?[\\s.:)\\-]*`);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const m = head.exec(line);
    if (!m) continue;
    let rest = line.slice(m[0].length);
    for (const d of descriptors) rest = rest.replace(new RegExp(`^${d.source}[\\s.:)\\-]*`), '');
    rest = rest.trim();
    if (rest !== '') return rest;
    const next = lines[i + 1];
    if (next !== undefined && !LABEL_START.test(next)) return next;
  }
  return null;
}

const PLATE = /\b[A-Z]{2}\s?\d{3}\s?[A-Z]{2}\b/g;

function findPlate(lines: readonly string[]): string | null {
  for (const line of lines) {
    for (const m of line.matchAll(PLATE)) {
      const plate = normalizePlate(m[0]);
      if (isValidItalianPlate(plate)) return plate;
    }
  }
  return null;
}

/** Nel VIN le lettere I, O, Q non esistono: il riconoscimento le confonde con 1, 0, 0, quindi si correggono prima di validare. */
const fixVinLetters = (s: string): string => s.replace(/I/g, '1').replace(/[OQ]/g, '0');

function findVin(lines: readonly string[]): string | null {
  for (const line of lines) {
    for (const token of line.split(/[^A-Z0-9]+/)) {
      if (token.length !== 17) continue;
      for (const candidate of [token, fixVinLetters(token)]) {
        const vin = normalizeVin(candidate);
        if (isValidVin(vin) && /\d/.test(vin) && /[A-Z]/.test(vin)) return vin;
      }
    }
  }
  return null;
}

const DATE = /\b(\d{1,2})\s?[./-]\s?(\d{1,2})\s?[./-]\s?(\d{4})\b/;

function dateIn(s: string | undefined): string | null {
  if (s === undefined) return null;
  const m = DATE.exec(s);
  if (!m) return null;
  const text = `${(m[1] as string).padStart(2, '0')}/${(m[2] as string).padStart(2, '0')}/${m[3]}`;
  return parseDateIt(text) === null ? null : text;
}

/** La prima immatricolazione: solo la data accanto a (B) o a «prima immatricolazione». Mai la prima data che capita. */
function findFirstRegistration(lines: readonly string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const labelled = /^\(?B\)?(?:[\s.:)-]|$)/.test(line) || /PRIMA IMMATRICOLAZIONE/.test(line);
    if (!labelled) continue;
    const found = dateIn(line) ?? dateIn(lines[i + 1]);
    if (found) return found;
  }
  return null;
}

/** «RENAULT» -> «Renault»; le sigle di 3 lettere o meno (BMW, KIA) restano in maiuscolo. */
function tidyName(raw: string | null): string | null {
  if (raw === null) return null;
  const cleaned = raw.replace(/[^A-Z0-9 .\-/+&']/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned === '' || cleaned.length > 40) return null;
  return cleaned
    .split(' ')
    .map((w) => (w.length <= 3 || /\d/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ');
}

/** Carburante dal testo: «BENZINA/GPL» -> benzina con doppia alimentazione GPL. Prudente: nei casi dubbi niente. */
export function parseFuel(text: string): { primary: PrimaryFuel | null; secondary: SecondaryFuel | null } {
  const s = text.toUpperCase();
  const petrol = /BENZINA/.test(s);
  const diesel = /GASOLIO|DIESEL/.test(s);
  const lpg = /\bGPL\b/.test(s);
  const cng = /METANO|\bCNG\b|\bGNC\b/.test(s);
  const electric = /ELETTRIC/.test(s);
  const hydrogen = /IDROGENO/.test(s);
  const families = [petrol, diesel, lpg, cng, hydrogen].filter(Boolean).length;
  if (diesel && !petrol && !lpg && !cng) return { primary: 'diesel', secondary: null };
  if (petrol && lpg && !diesel && !cng) return { primary: 'petrol', secondary: 'lpg' };
  if (petrol && cng && !diesel && !lpg) return { primary: 'petrol', secondary: 'cng' };
  if (petrol && families === 1) return { primary: 'petrol', secondary: null };
  if (lpg && families === 1) return { primary: 'lpg', secondary: null };
  if (cng && families === 1) return { primary: 'cng', secondary: null };
  if (hydrogen && families === 1) return { primary: 'hydrogen', secondary: null };
  if (electric && families === 0) return { primary: 'electric', secondary: null };
  return { primary: null, secondary: null };
}

/** Legge il testo del documento. Non lancia mai: un testo illeggibile da' una scheda vuota. */
export function readRegistrationCard(text: string): ReadCard {
  const lines = toLines(text);
  if (lines.length === 0) return emptyCard();

  const make = tidyName(valueAfter(lines, /D[.,]?\s?1/, [/MARCA/]));
  const model = tidyName(valueAfter(lines, /D[.,]?\s?3/, [/DENOMINAZIONE COMMERCIALE/, /DENOMINAZIONE/, /MODELLO/]));

  // Carburante: prima la riga (P.3); in mancanza, le parole chiave se il testo ne indica una sola famiglia.
  const fuelLine = valueAfter(lines, /P[.,]?\s?3/, [/TIPO DI CARBURANTE/, /ALIMENTAZIONE/, /CARBURANTE/]);
  let fuel = fuelLine === null ? { primary: null, secondary: null } : parseFuel(fuelLine);
  if (fuel.primary === null) fuel = parseFuel(lines.join(' '));

  return {
    plate: findPlate(lines),
    vin: findVin(lines),
    firstRegistration: findFirstRegistration(lines),
    make,
    model,
    fuelPrimary: fuel.primary,
    fuelSecondary: fuel.secondary,
  };
}

export interface CardRow {
  key: 'plate' | 'vin' | 'firstRegistration' | 'make' | 'model' | 'fuel';
  label: string;
  value: string;
}

/** Le righe da mostrare nell'anteprima: solo cio' che e' stato riconosciuto. */
export function cardRows(card: ReadCard): CardRow[] {
  const L = it.vehicleForm.card.fields;
  const rows: CardRow[] = [];
  if (card.make) rows.push({ key: 'make', label: L.make, value: card.make });
  if (card.model) rows.push({ key: 'model', label: L.model, value: card.model });
  if (card.plate) rows.push({ key: 'plate', label: L.plate, value: card.plate });
  if (card.vin) rows.push({ key: 'vin', label: L.vin, value: card.vin });
  if (card.firstRegistration) rows.push({ key: 'firstRegistration', label: L.firstRegistration, value: card.firstRegistration });
  if (card.fuelPrimary) {
    const fuel = it.vehicleForm.fuelOptions[card.fuelPrimary];
    rows.push({ key: 'fuel', label: L.fuel, value: card.fuelSecondary ? `${fuel} + ${it.vehicleForm.fuelOptions[card.fuelSecondary]}` : fuel });
  }
  return rows;
}

export interface ApplyResult {
  form: VehicleFormState;
  /** Campi riempiti con i dati letti. */
  filled: CardRow['key'][];
  /** Campi gia' compilati dall'utente: non toccati. */
  kept: CardRow['key'][];
}

/** Riempie SOLO i campi ancora vuoti: quello che l'utente ha gia' scritto non si sovrascrive mai. */
export function applyCardToForm(form: VehicleFormState, card: ReadCard): ApplyResult {
  let next = { ...form };
  const filled: CardRow['key'][] = [];
  const kept: CardRow['key'][] = [];
  const put = (key: CardRow['key'], current: string, value: string | null, set: (v: string) => void): void => {
    if (value === null) return;
    if (current.trim() === '') {
      set(value);
      filled.push(key);
    } else if (current.trim().toUpperCase() !== value.toUpperCase()) kept.push(key);
  };

  put('make', form.make, card.make, (v) => (next = { ...next, make: v }));
  put('model', form.model, card.model, (v) => (next = { ...next, model: v }));
  put('plate', form.plate, card.plate, (v) => (next = { ...next, plate: v }));
  put('vin', form.vin, card.vin, (v) => (next = { ...next, vin: v }));
  put('firstRegistration', form.firstRegistration, card.firstRegistration, (v) => (next = { ...next, firstRegistration: v }));

  if (card.fuelPrimary !== null) {
    if (form.fuelPrimary === null) {
      next = withPrimaryFuel(next, card.fuelPrimary);
      if (card.fuelSecondary !== null) next = withSecondaryFuel(next, card.fuelSecondary);
      filled.push('fuel');
    } else if (form.fuelPrimary !== card.fuelPrimary || (form.fuelSecondary ?? null) !== card.fuelSecondary) kept.push('fuel');
  }
  return { form: next, filled, kept };
}
