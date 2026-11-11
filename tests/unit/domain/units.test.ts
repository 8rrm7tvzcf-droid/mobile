import { describe, expect, it } from 'vitest';
import {
  KM_PER_MI,
  MAX_KM,
  expectedTotalCents,
  formatConsumption,
  formatDateIt,
  formatDateLongIt,
  formatDateWithWeekdayIt,
  formatDistance,
  formatEuro,
  formatEuroPerKm,
  formatEuroWhole,
  formatInt,
  formatKm,
  formatMonthYearIt,
  formatPressure,
  formatPriceWithUnit,
  formatPricePerUnit,
  formatQuantity,
  formatQuantityWithUnit,
  formatScaled,
  fromDisplayDistance,
  isValidKm,
  isValidTyreMillibar,
  kmToMi,
  miToKm,
  parseDateIt,
  parseDistanceInput,
  parseEuroToCents,
  parseMilli,
  parsePressureToMillibar,
  parseScaled,
  per100KmCents,
  per100ToKmPerL,
  per100ToMpgUK,
  per100ToMpgUS,
  perKmMilli,
  plural,
  psiToMillibar,
  quantityFromTotal,
  toDisplayDistance,
  totalLooksConsistent,
  unitPriceFromTotal,
} from '@/domain/units';

describe('units: distanze', () => {
  it('1 miglia = 1,609344 km, arrotondato al km intero', () => {
    expect(KM_PER_MI).toBe(1.609344);
    expect(miToKm(0)).toBe(0);
    expect(miToKm(1)).toBe(2);
    expect(miToKm(10000)).toBe(16093);
    expect(kmToMi(16093)).toBe(10000);
    expect(kmToMi(100)).toBe(62);
  });

  it('round-trip esatto miglia -> km -> miglia per ogni intero fino a 500.000', () => {
    let errors = 0;
    for (let mi = 0; mi <= 500000; mi++) if (kmToMi(miToKm(mi)) !== mi) errors++;
    expect(errors).toBe(0);
  });

  it('il round-trip inverso (km -> mi -> km) NON e esatto: per questo non si risalva mai il valore convertito', () => {
    let changed = 0;
    for (let km = 0; km <= 20000; km++) if (miToKm(kmToMi(km)) !== km) changed++;
    expect(changed).toBeGreaterThan(0);
  });

  it('conversione per la visualizzazione e per l input', () => {
    expect(toDisplayDistance(10000, 'km')).toBe(10000);
    expect(toDisplayDistance(10000, 'mi')).toBe(6214);
    expect(fromDisplayDistance(10000, 'mi')).toBe(16093);
    expect(fromDisplayDistance(123.6, 'km')).toBe(124);
  });

  it('km validi: interi tra 0 e 2.000.000', () => {
    expect(MAX_KM).toBe(2_000_000);
    expect(isValidKm(0)).toBe(true);
    expect(isValidKm(2_000_000)).toBe(true);
    expect(isValidKm(2_000_001)).toBe(false);
    expect(isValidKm(-1)).toBe(false);
    expect(isValidKm(12.5)).toBe(false);
    expect(isValidKm(Number.NaN)).toBe(false);
  });
});

describe('units: denaro e totali', () => {
  it('totale atteso = quantita x prezzo in centesimi, con BigInt', () => {
    expect(expectedTotalCents(40000, 1859)).toBe(7436); // 40,000 L x 1,859 = 74,36
    expect(expectedTotalCents(35500, 1789)).toBe(6351); // 63,5095 -> 63,51
    expect(expectedTotalCents(0, 1859)).toBe(0);
    expect(expectedTotalCents(999_999_999, 100_000_000)).toBe(Number((999_999_999n * 100_000_000n + 5000n) / 10000n));
  });

  it('i non interi sono un errore di programmazione', () => {
    expect(() => expectedTotalCents(1.5, 1000)).toThrow(RangeError);
  });

  it('coerenza dello scontrino con tolleranza di 2 centesimi', () => {
    expect(totalLooksConsistent(7436, 40000, 1859)).toBe(true);
    expect(totalLooksConsistent(7438, 40000, 1859)).toBe(true);
    expect(totalLooksConsistent(7439, 40000, 1859)).toBe(false);
    expect(totalLooksConsistent(7430, 40000, 1859)).toBe(false);
    expect(totalLooksConsistent(7439, 40000, 1859, 3)).toBe(true);
  });

  it('quantita e prezzo si ricavano dagli altri due', () => {
    expect(quantityFromTotal(7436, 1859)).toBe(40000);
    expect(unitPriceFromTotal(7436, 40000)).toBe(1859);
    expect(quantityFromTotal(7436, 0)).toBeNull();
    expect(unitPriceFromTotal(7436, 0)).toBeNull();
    // il ricalcolo torna entro un centesimo dal totale
    const q = quantityFromTotal(6351, 1789)!;
    expect(Math.abs(expectedTotalCents(q, 1789) - 6351)).toBeLessThanOrEqual(1);
  });

  it('costo al km in millesimi di euro e per 100 km in centesimi', () => {
    expect(perKmMilli(34800, 1000)).toBe(348); // 348 EUR / 1000 km = 0,348 EUR/km
    expect(perKmMilli(100000, 2500)).toBe(400); // 1000 EUR / 2500 km = 0,40 EUR/km
    expect(perKmMilli(100, 0)).toBeNull();
    expect(per100KmCents(75000, 10000)).toBe(750); // 750 EUR / 10.000 km = 7,50 EUR/100 km
    expect(per100KmCents(75000, 0)).toBeNull();
  });
});

describe('units: formattazione italiana', () => {
  it('interi con punto delle migliaia', () => {
    expect(formatInt(0)).toBe('0');
    expect(formatInt(999)).toBe('999');
    expect(formatInt(1000)).toBe('1.000');
    expect(formatInt(1234567)).toBe('1.234.567');
    expect(formatInt(-1234)).toBe('-1.234');
    expect(formatInt(12.9)).toBe('12');
    expect(formatInt(Number.NaN)).toBe('–');
  });

  it('euro: 1.234,56 €', () => {
    expect(formatEuro(123456)).toBe('1.234,56 €');
    expect(formatEuro(5)).toBe('0,05 €');
    expect(formatEuro(0)).toBe('0,00 €');
    expect(formatEuro(100000000000)).toBe('1.000.000.000,00 €');
    expect(formatEuro(-50)).toBe('-0,50 €');
    expect(formatEuro(Number.NaN)).toBe('–');
  });

  it('niente NBSP: solo spazio normale prima del simbolo', () => {
    expect(formatEuro(123456)).not.toMatch(/ /);
    expect(formatEuro(123456)).toBe(`1.234,56${' '}€`);
  });

  it('euro interi arrotondati', () => {
    expect(formatEuroWhole(123456)).toBe('1.235 €');
    expect(formatEuroWhole(49)).toBe('0 €');
    expect(formatEuroWhole(50)).toBe('1 €');
    expect(formatEuroWhole(-150)).toBe('-2 €');
  });

  it('prezzo al litro e quantita in millesimi, senza migliaia', () => {
    expect(formatPricePerUnit(1859)).toBe('1,859');
    expect(formatPriceWithUnit(1859, 'L')).toBe('1,859 €/L');
    expect(formatQuantity(40000)).toBe('40,000');
    expect(formatQuantityWithUnit(12350, 'kWh')).toBe('12,350 kWh');
    expect(formatQuantityWithUnit(9100, 'kg')).toBe('9,100 kg');
    expect(formatQuantity(5)).toBe('0,005');
  });

  it('formatScaled: scale 0, negativi, raggruppamento', () => {
    expect(formatScaled(1234, 0)).toBe('1.234');
    expect(formatScaled(-5, 3)).toBe('-0,005');
    expect(formatScaled(1234567, 3)).toBe('1.234,567');
    expect(formatScaled(1234567, 3, { grouping: false })).toBe('1234,567');
  });

  it('km e distanze nell unita del veicolo', () => {
    expect(formatKm(12345)).toBe('12.345 km');
    expect(formatDistance(10000, 'km')).toBe('10.000 km');
    expect(formatDistance(10000, 'mi')).toBe('6.214 mi');
    expect(formatEuroPerKm(348)).toBe('0,35 €/km');
    expect(formatEuroPerKm(400)).toBe('0,40 €/km');
  });

  it('date gg/mm/aaaa e testi lunghi con formattazione manuale', () => {
    expect(formatDateIt('2026-10-07')).toBe('07/10/2026');
    expect(formatDateIt('2026-02-30')).toBe('2026-02-30'); // non valida: torna invariata
    expect(formatDateLongIt('2026-10-07')).toBe('7 ottobre 2026');
    expect(formatDateWithWeekdayIt('2026-10-07')).toBe('mercoledì 7 ottobre 2026');
    expect(formatDateWithWeekdayIt('2026-10-04')).toBe('domenica 4 ottobre 2026');
    expect(formatMonthYearIt('2026-03')).toBe('marzo 2026');
    expect(formatMonthYearIt('2026-03-15')).toBe('marzo 2026');
    expect(formatMonthYearIt('boh')).toBe('boh');
  });

  it('plurali', () => {
    expect(plural(1, 'giorno', 'giorni')).toBe('1 giorno');
    expect(plural(0, 'giorno', 'giorni')).toBe('0 giorni');
    expect(plural(1500, 'chilometro', 'chilometri')).toBe('1.500 chilometri');
  });
});

describe('units: consumi', () => {
  it('conversioni (6,43 L/100 km)', () => {
    expect(Math.round(per100ToMpgUS(6.43) * 10) / 10).toBe(36.6);
    expect(Math.round(per100ToMpgUK(6.43) * 10) / 10).toBe(43.9);
    expect(Math.round(per100ToKmPerL(6.43) * 100) / 100).toBe(15.55);
  });

  it('testo del consumo per unita e modalita', () => {
    expect(formatConsumption(643, 'L')).toBe('6,43 L/100 km');
    expect(formatConsumption(643, 'L', 'kmPerUnit')).toBe('15,55 km/L');
    expect(formatConsumption(643, 'L', 'mpgUS')).toBe('36,6 mpg (US)');
    expect(formatConsumption(643, 'L', 'mpgUK')).toBe('43,9 mpg (UK)');
    expect(formatConsumption(1520, 'kWh')).toBe('15,20 kWh/100 km');
    expect(formatConsumption(450, 'kg')).toBe('4,50 kg/100 km');
    // mpg solo per i litri: per kWh ripiega sul consumo per 100 km
    expect(formatConsumption(1520, 'kWh', 'mpgUS')).toBe('15,20 kWh/100 km');
    expect(formatConsumption(Number.NaN, 'L')).toBe('–');
  });
});

describe('units: parsing di euro (data.md 7.3)', () => {
  it.each([
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['1234,56', 123456],
    ['1234.56', 123456],
    ['12', 1200],
    ['12,5', 1250],
    ['12.5', 1250],
    ['EUR 12,50', 1250],
    ['12,50 €', 1250],
    ['€12,50', 1250],
    ['euro 12,50', 1250],
    ['  1 234,56 ', 123456],
    ['1 234,56', 123456],
    ['1 234,56', 123456],
    ['-12,50', -1250],
    ['0,05', 5],
    ['0', 0],
    ['-0', 0],
    ['1.234', 123400], // all'italiana: milleduecentotrentaquattro euro
    ['1.234.567,89', 123456789],
    ['12,', 1200],
    [',5', 50],
  ])('%j -> %j', (input, expected) => {
    expect(parseEuroToCents(input)).toBe(expected);
  });

  it.each([
    ['12,345'], // troppi decimali: niente arrotondamento silenzioso
    ['1.2.3'],
    ['12,5,5'],
    ['abc'],
    [''],
    ['.'],
    [','],
    ['-'],
    ['0.500'], // 0 davanti: non sono migliaia
    ['1.23.456,00'],
    ['1,2.3'],
    ['12 euro e 5'],
    ['99999999999999999999'],
  ])('%j -> null', (input) => {
    expect(parseEuroToCents(input)).toBeNull();
  });

  it('null e undefined', () => {
    expect(parseEuroToCents(null)).toBeNull();
    expect(parseEuroToCents(undefined)).toBeNull();
  });
});

describe('units: parsing di millesimi (prezzo al litro e quantita)', () => {
  it('il punto e sempre decimale', () => {
    expect(parseMilli('1.859')).toBe(1859);
    expect(parseMilli('1,859')).toBe(1859);
    expect(parseMilli('45.500')).toBe(45500);
    expect(parseMilli('45,5')).toBe(45500);
    expect(parseMilli('40')).toBe(40000);
    expect(parseMilli('0,005')).toBe(5);
  });

  it('rifiuta troppi decimali e testo', () => {
    expect(parseMilli('1,8591')).toBeNull();
    expect(parseMilli('1.234.567')).toBeNull();
    expect(parseMilli('litri')).toBeNull();
  });

  it('parseScaled con scale personalizzata', () => {
    expect(parseScaled('2,5', 1)).toBe(25);
    expect(parseScaled('2,55', 1)).toBeNull();
    expect(parseScaled('7', 0)).toBe(7);
    expect(parseScaled('7,5', 0)).toBeNull();
  });
});

describe('units: parsing di distanze e date', () => {
  it('km con migliaia, spazi e un decimale', () => {
    expect(parseDistanceInput('12345')).toBe(12345);
    expect(parseDistanceInput('12.345')).toBe(12345);
    expect(parseDistanceInput('12 345 km')).toBe(12345);
    expect(parseDistanceInput('123456,4')).toBe(123456);
    expect(parseDistanceInput('123456,6')).toBe(123457);
    expect(parseDistanceInput('1.500.000')).toBe(1500000);
    expect(parseDistanceInput('0')).toBe(0);
  });

  it('km rifiutati: negativi, fuori scala, testo, troppi decimali', () => {
    expect(parseDistanceInput('-5')).toBeNull();
    expect(parseDistanceInput('2.000.001')).toBeNull();
    expect(parseDistanceInput('abc')).toBeNull();
    expect(parseDistanceInput('')).toBeNull();
    expect(parseDistanceInput('12,34')).toBeNull();
    expect(parseDistanceInput(null)).toBeNull();
  });

  it('miglia convertite una volta sola in km interi', () => {
    expect(parseDistanceInput('10.000', 'mi')).toBe(16093);
    expect(parseDistanceInput('10000 mi', 'mi')).toBe(16093);
    expect(parseDistanceInput('1.500.000', 'mi')).toBeNull(); // oltre 2.000.000 km
    // round-trip: scrivo X miglia, il DB tiene i km, mostro X miglia
    for (const mi of [0, 1, 99, 12345, 100000, 400000]) {
      expect(kmToMi(parseDistanceInput(String(mi), 'mi')!)).toBe(mi);
    }
  });

  it('date italiane e ISO', () => {
    expect(parseDateIt('07/10/2026')).toBe('2026-10-07');
    expect(parseDateIt('7/10/2026')).toBe('2026-10-07');
    expect(parseDateIt('7-1-2026')).toBe('2026-01-07');
    expect(parseDateIt('07.10.2026')).toBe('2026-10-07');
    expect(parseDateIt(' 2026-10-07 ')).toBe('2026-10-07');
    expect(parseDateIt('29/02/2024')).toBe('2024-02-29');
  });

  it('date rifiutate', () => {
    expect(parseDateIt('29/02/2025')).toBeNull();
    expect(parseDateIt('31/04/2026')).toBeNull();
    expect(parseDateIt('7/10/26')).toBeNull();
    expect(parseDateIt('13/13/2026')).toBeNull();
    expect(parseDateIt('boh')).toBeNull();
    expect(parseDateIt('')).toBeNull();
    expect(parseDateIt(undefined)).toBeNull();
  });
});

describe('units: pressione dei pneumatici', () => {
  it('formattazione in bar e psi', () => {
    expect(formatPressure(2200, 'bar')).toBe('2,2 bar');
    expect(formatPressure(2250, 'bar')).toBe('2,25 bar');
    expect(formatPressure(2000, 'bar')).toBe('2,0 bar');
    expect(formatPressure(2200, 'psi')).toBe('31,9 psi');
    expect(formatPressure(Number.NaN, 'bar')).toBe('–');
  });

  it('input in bar e psi -> millibar interi', () => {
    expect(parsePressureToMillibar('2,2', 'bar')).toBe(2200);
    expect(parsePressureToMillibar('2.25', 'bar')).toBe(2250);
    expect(parsePressureToMillibar('2,2 bar', 'bar')).toBe(2200);
    expect(parsePressureToMillibar('32', 'psi')).toBe(2206);
    expect(parsePressureToMillibar('32,5 psi', 'psi')).toBe(2241);
    expect(parsePressureToMillibar('2,2345', 'bar')).toBeNull();
    expect(parsePressureToMillibar('due', 'bar')).toBeNull();
    expect(psiToMillibar(32)).toBe(2206);
  });

  it('intervallo del CHECK di fluid_checks.value_millibar (500..6000)', () => {
    expect(isValidTyreMillibar(500)).toBe(true);
    expect(isValidTyreMillibar(6000)).toBe(true);
    expect(isValidTyreMillibar(499)).toBe(false);
    expect(isValidTyreMillibar(6001)).toBe(false);
    expect(isValidTyreMillibar(2200.5)).toBe(false);
  });
});
