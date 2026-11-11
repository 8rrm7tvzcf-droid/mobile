// Validazione e calcolo degli importi di un rifornimento (SPEC 6.3.8 S-22; AC-07): due campi tra quantita', prezzo unitario
// e totale calcolano il terzo, in interi; il totale che non torna e' un AVVISO, mai un blocco. Funzioni pure.
import {
  FUEL_TYPES,
  completeFuelAmounts,
  fuelLabelIt,
  unitForFuel,
  validateFuelLog,
  type FuelAmountField,
  type FuelIssue,
  type FuelType,
  type QuantityUnit,
} from '@/domain/fuel';
import type { LocalDate } from '@/domain/ports';
import { fail, invalid, ok, type UsecaseResult } from '../context';

/** Gli importi di un rifornimento prima del completamento (ogni valore puo' mancare). */
export interface RawAmounts {
  quantityMilli: number | null;
  unitPriceMilli: number | null;
  totalCents: number | null;
}

export interface CompletedAmounts {
  quantityMilli: number;
  unitPriceMilli: number | null;
  totalCents: number;
  computed: FuelAmountField | null;
}

export interface PreparedFuel {
  amounts: CompletedAmounts;
  warnings: string[];
  expectedTotalCents: number | null;
}

const FIELD_OF: Record<string, string> = {
  INVALID_DATE: 'filledOn',
  INVALID_QUANTITY: 'quantityMilli',
  INVALID_UNIT: 'fuelType',
  INVALID_PRICE: 'unitPriceMilli',
  INVALID_TOTAL: 'totalCents',
  INVALID_KM: 'km',
};

const MSG_TWO_VALUES = 'Inserisci almeno due valori tra quantità, prezzo unitario e totale: il terzo si calcola da solo.';

/** Completa gli importi di un NUOVO rifornimento: servono due valori su tre; con tre restano quelli immessi. */
export function completeNewAmounts(a: RawAmounts): UsecaseResult<CompletedAmounts> {
  const r = completeFuelAmounts(a);
  if (r.quantityMilli === null || r.totalCents === null) {
    const given = [a.quantityMilli, a.unitPriceMilli, a.totalCents].filter((v) => v !== null && v !== undefined).length;
    if (given >= 2) {
      // due valori ma uno e' lo zero che impedisce la divisione
      return invalid('unitPriceMilli', 'Con un prezzo unitario pari a zero non si può calcolare la quantità o il totale: inserisci anche l’altro valore.');
    }
    return invalid(r.quantityMilli === null ? 'quantityMilli' : 'totalCents', MSG_TWO_VALUES);
  }
  return ok({ quantityMilli: r.quantityMilli, unitPriceMilli: r.unitPriceMilli, totalCents: r.totalCents, computed: r.computed });
}

/**
 * Importi di un rifornimento MODIFICATO: i campi indicati valgono come immessi, quello non indicato si ricalcola.
 * Cambiando la quantita' o il prezzo si ricalcola il totale; cambiando il totale si ricalcola il prezzo
 * (o la quantita' se l'utente ha indicato prezzo e totale insieme).
 */
export function mergeUpdatedAmounts(
  row: { quantityMilli: number; unitPriceMilli: number | null; totalCents: number },
  patch: { quantityMilli?: number; unitPriceMilli?: number | null; totalCents?: number },
): UsecaseResult<CompletedAmounts> {
  const qs = patch.quantityMilli !== undefined;
  const ps = patch.unitPriceMilli != null;
  const pClear = patch.unitPriceMilli === null;
  const ts = patch.totalCents !== undefined;
  let quantity: number | null = qs ? (patch.quantityMilli as number) : row.quantityMilli;
  let price: number | null = ps ? (patch.unitPriceMilli as number) : pClear ? null : row.unitPriceMilli;
  let total: number | null = ts ? (patch.totalCents as number) : row.totalCents;
  let computed: FuelAmountField | null = null;

  if (qs && ps && ts) {
    // tre valori immessi: restano cosi' (l'eventuale scarto e' un avviso)
  } else if (ts && ps && !qs) {
    quantity = null;
  } else if (ts && qs && !ps) {
    price = null;
  } else if (ts) {
    price = null; // solo il totale e' cambiato: il prezzo segue
  } else if (qs || ps) {
    // cambiata la quantita' o il prezzo: il totale segue; senza prezzo il totale resta e il prezzo si ricava da totale e quantita'
    if (price !== null) total = null;
  } else if (pClear) {
    price = null; // «ricalcola il prezzo dal totale»
  }
  const touched = qs || ps || pClear || ts;
  if (touched && (quantity === null || total === null || price === null)) {
    const r = completeFuelAmounts({ quantityMilli: quantity, unitPriceMilli: price, totalCents: total });
    if (r.quantityMilli === null || r.totalCents === null) {
      return invalid('unitPriceMilli', 'Con un prezzo unitario pari a zero non si può calcolare la quantità: inserisci la quantità.');
    }
    quantity = r.quantityMilli;
    total = r.totalCents;
    price = r.unitPriceMilli;
    computed = r.computed;
  }
  // nessun importo toccato: restano com'erano (anche un prezzo storico mancante)
  return ok({ quantityMilli: quantity as number, unitPriceMilli: price, totalCents: total as number, computed });
}

export interface FuelContext {
  today: LocalDate;
  /** Capacita' del serbatoio in ml, se nota: serve all'avviso «piu' della capacita'» (solo per i carburanti in litri). */
  tankCapacityMl: number | null;
  /** `true` se il carburante e' quello primario dell'auto (la capacita' si riferisce al suo serbatoio). */
  isPrimaryFuel: boolean;
}

const ERROR_ORDER = ['INVALID_DATE', 'FUTURE_DATE', 'INVALID_UNIT', 'INVALID_QUANTITY', 'INVALID_PRICE', 'INVALID_TOTAL', 'INVALID_KM'];

/** Applica `validateFuelLog` del dominio: il primo errore bloccante diventa errore tipizzato, gli avvisi tornano come testo. */
export function validateFuelFields(
  f: { filledOn: LocalDate; fuelType: FuelType; unit: QuantityUnit; amounts: CompletedAmounts; km: number | null },
  ctx: FuelContext,
): UsecaseResult<PreparedFuel> {
  if (!FUEL_TYPES.includes(f.fuelType)) return invalid('fuelType', 'Carburante non riconosciuto.');
  const maxQuantityMilli =
    ctx.tankCapacityMl !== null && ctx.isPrimaryFuel && unitForFuel(f.fuelType) === 'L' ? Math.round(ctx.tankCapacityMl * 1.1) : null;
  const v = validateFuelLog(
    {
      filledOn: f.filledOn,
      fuelType: f.fuelType,
      quantityUnit: f.unit,
      quantityMilli: f.amounts.quantityMilli,
      unitPriceMilli: f.amounts.unitPriceMilli,
      totalCents: f.amounts.totalCents,
      km: f.km,
    },
    { today: ctx.today, maxQuantityMilli },
  );
  if (!v.ok) {
    const sorted = [...v.errors].sort((a: FuelIssue, b: FuelIssue) => ERROR_ORDER.indexOf(a.code) - ERROR_ORDER.indexOf(b.code));
    const e = sorted[0]!;
    if (e.code === 'FUTURE_DATE') return fail({ code: 'FUTURE_DATE' });
    return invalid(FIELD_OF[e.code] ?? 'fuelType', e.message);
  }
  return ok({ amounts: f.amounts, warnings: v.warnings.map((w) => w.message), expectedTotalCents: v.expectedTotalCents });
}

/** Avviso (non bloccante) se il carburante non e' tra quelli dell'auto. */
export function fuelNotOfVehicleWarning(fuel: FuelType, allowed: readonly FuelType[]): string | null {
  return allowed.includes(fuel)
    ? null
    : `${fuelLabelIt(fuel)} non è tra i carburanti di quest’auto: controlla di aver scelto quello giusto.`;
}
