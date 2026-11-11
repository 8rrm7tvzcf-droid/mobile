// Denaro e quantita' senza virgola mobile (SPEC §8.1, data.md §7.3).
// Denaro in centesimi interi; prezzo unitario e quantita' in millesimi interi.
// I prodotti si fanno con BigInt: niente overflow ne' arrotondamenti binari.

/** Scarto massimo (centesimi) tra il totale dello scontrino e quantita' x prezzo prima di avvisare l'utente. */
export const TOTAL_TOLERANCE_CENTS = 2;

function toBig(n: number, name: string): bigint {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${name} deve essere un intero sicuro: ${n}`);
  return BigInt(n);
}

/** Divisione intera con arrotondamento "half up" in valore assoluto (b > 0): -2,5 -> -3. */
function divRound(a: bigint, b: bigint): bigint {
  return a < 0n ? -((-a + b / 2n) / b) : (a + b / 2n) / b;
}

/**
 * Totale atteso in centesimi = quantita' x prezzo, con BigInt.
 * 40,000 L x 1,859 EUR/L = 74,36 EUR -> 7436; 35,500 x 1,789 = 63,5095 -> 6351.
 * quantityMilli e unitPriceMilli sono millesimi (interi >= 0).
 */
export function expectedTotalCents(quantityMilli: number, unitPriceMilli: number): number {
  return Number(divRound(toBig(quantityMilli, 'quantityMilli') * toBig(unitPriceMilli, 'unitPriceMilli'), 10000n));
}

/** Quantita' (millesimi) da totale e prezzo unitario: totale / prezzo. `null` se il prezzo e' 0 o il risultato non e' sicuro. */
export function quantityFromTotal(totalCents: number, unitPriceMilli: number): number | null {
  if (!(unitPriceMilli > 0)) return null;
  const v = Number(divRound(toBig(totalCents, 'totalCents') * 10000n, toBig(unitPriceMilli, 'unitPriceMilli')));
  return Number.isSafeInteger(v) ? v : null;
}

/** Prezzo unitario (millesimi di euro) da totale e quantita'. `null` se la quantita' e' 0 o il risultato non e' sicuro. */
export function unitPriceFromTotal(totalCents: number, quantityMilli: number): number | null {
  if (!(quantityMilli > 0)) return null;
  const v = Number(divRound(toBig(totalCents, 'totalCents') * 10000n, toBig(quantityMilli, 'quantityMilli')));
  return Number.isSafeInteger(v) ? v : null;
}

/** Tolleranza di validazione: lo scontrino puo' differire di 1-2 centesimi dall'arrotondamento. */
export function totalLooksConsistent(
  totalCents: number,
  quantityMilli: number,
  unitPriceMilli: number,
  tolerance: number = TOTAL_TOLERANCE_CENTS,
): boolean {
  return Math.abs(totalCents - expectedTotalCents(quantityMilli, unitPriceMilli)) <= tolerance;
}

/** Somma di centesimi interi. */
export function sumCents(values: readonly number[]): number {
  let t = 0;
  for (const v of values) t += v;
  return t;
}

/** Costo per km in millesimi di euro al km (es. 0,348 EUR/km = 348), a partire da centesimi e km. `null` se km <= 0. */
export function perKmMilli(totalCents: number, km: number): number | null {
  if (!(km > 0)) return null;
  return Math.round((totalCents * 10) / km);
}

/** Costo per 100 km in centesimi (es. 7,50 EUR/100 km = 750). `null` se km <= 0. */
export function per100KmCents(totalCents: number, km: number): number | null {
  if (!(km > 0)) return null;
  return Math.round((totalCents * 100) / km);
}
