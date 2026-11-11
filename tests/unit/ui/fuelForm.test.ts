import { describe, expect, it } from 'vitest';
import type { FuelFormDefaults, FuelLogEntry } from '@/usecases/fuel';
import { it as italian } from '@/ui/i18n/it';
import {
  buildAddFuelInput,
  buildUpdateFuelInput,
  consumptionNote,
  formFromEntry,
  fuelErrorField,
  fuelRowSubtitle,
  fuelRowTitle,
  initialFuelForm,
  quantityText,
  resolveAmounts,
  switchFuelType,
  tankLines,
  type AmountState,
} from '@/ui/logic/fuelForm';

const state = (over: Partial<AmountState> = {}): AmountState => ({ quantity: '', unitPrice: '', total: '', edited: [], ...over });

describe('Rifornimento: due valori su tre calcolano il terzo', () => {
  it('litri + totale: il prezzo si calcola e non tocca i campi scritti', () => {
    const r = resolveAmounts(state({ quantity: '40', total: '74,36', unitPrice: '1,700', edited: ['quantity', 'total'] }), 'new');
    expect(r.computed).toBe('unitPrice');
    expect(r.shown).toEqual({ quantity: '40', unitPrice: '1,859', total: '74,36' });
    expect(r.payload).toEqual({ quantityMilli: 40000, totalCents: 7436 });
    expect(r.incomplete).toBe(false);
  });

  it('solo i litri con il prezzo dell\'ultima volta: calcola il totale e manda anche il prezzo', () => {
    const r = resolveAmounts(state({ quantity: '40', unitPrice: '1,859', edited: ['quantity'] }), 'new');
    expect(r.computed).toBe('total');
    expect(r.shown.total).toBe('74,36');
    expect(r.payload).toEqual({ quantityMilli: 40000, unitPriceMilli: 1859 });
  });

  it('solo il totale con il prezzo dell\'ultima volta: calcola i litri (senza zeri inutili)', () => {
    const r = resolveAmounts(state({ total: '50', unitPrice: '2,000', edited: ['total'] }), 'new');
    expect(r.computed).toBe('quantity');
    expect(r.shown.quantity).toBe('25');
    expect(r.payload).toEqual({ totalCents: 5000, unitPriceMilli: 2000 });
  });

  it('prezzo e totale scritti: calcola i litri', () => {
    const r = resolveAmounts(state({ unitPrice: '1,859', total: '74,36', edited: ['unitPrice', 'total'] }), 'new');
    expect(r.computed).toBe('quantity');
    expect(r.shown.quantity).toBe('40');
  });

  it('un solo valore e nessun prezzo noto: servono due valori', () => {
    const r = resolveAmounts(state({ quantity: '40', edited: ['quantity'] }), 'new');
    expect(r.computed).toBeNull();
    expect(r.incomplete).toBe(true);
    expect(resolveAmounts(state({ unitPrice: '1,859', edited: ['unitPrice'] }), 'new').incomplete).toBe(true);
  });

  it('con tutti e tre scritti restano quelli scritti; avvisa se il totale non torna', () => {
    const ok = resolveAmounts(state({ quantity: '40', unitPrice: '1,859', total: '74,36', edited: ['quantity', 'unitPrice', 'total'] }), 'new');
    expect(ok.computed).toBeNull();
    expect(ok.mismatch).toBe(false);
    const bad = resolveAmounts(state({ quantity: '40', unitPrice: '1,859', total: '80,00', edited: ['quantity', 'unitPrice', 'total'] }), 'new');
    expect(bad.mismatch).toBe(true);
    expect(bad.payload).toEqual({ quantityMilli: 40000, unitPriceMilli: 1859, totalCents: 8000 });
  });

  it('input illeggibile o nullo: errore in italiano sul campo giusto', () => {
    const r = resolveAmounts(state({ quantity: 'abc', total: '0', edited: ['quantity', 'total'] }), 'new');
    expect(r.errors.quantity).toBe(italian.fuel.invalidQuantity);
    expect(r.errors.total).toBe(italian.fuel.invalidTotal);
    expect(r.computed).toBeNull();
  });

  it('accetta virgola e punto decimali', () => {
    expect(resolveAmounts(state({ quantity: '35.5', unitPrice: '1.859', edited: ['quantity', 'unitPrice'] }), 'new').shown.total).toBe('65,99');
    expect(resolveAmounts(state({ quantity: '35,5', unitPrice: '1,859', edited: ['quantity', 'unitPrice'] }), 'new').shown.total).toBe('65,99');
  });

  it('in modifica: cambiare il totale ricalcola il prezzo, cambiare i litri ricalcola il totale', () => {
    const loaded = { quantity: '40', unitPrice: '1,859', total: '74,36' };
    const t = resolveAmounts(state({ ...loaded, total: '80', edited: ['total'] }), 'edit');
    expect(t.computed).toBe('unitPrice');
    expect(t.shown.unitPrice).toBe('2,000');
    expect(t.payload).toEqual({ totalCents: 8000 });
    const q = resolveAmounts(state({ ...loaded, quantity: '30', edited: ['quantity'] }), 'edit');
    expect(q.computed).toBe('total');
    expect(q.shown.total).toBe('55,77');
    expect(q.payload).toEqual({ quantityMilli: 30000 });
    expect(resolveAmounts(state(loaded), 'edit').payload).toEqual({});
  });

  it('quantityText toglie gli zeri finali', () => {
    expect(quantityText(35500)).toBe('35,5');
    expect(quantityText(40000)).toBe('40');
    expect(quantityText(12345)).toBe('12,345');
  });
});

const defaults: FuelFormDefaults = {
  vehicleId: 'v1',
  today: '2026-10-08',
  fuelTypes: ['petrol', 'lpg'],
  fuelType: 'petrol',
  quantityUnit: 'L',
  lastUnitPriceMilli: { petrol: 1859, lpg: 749 },
  lastGrade: { petrol: '100 ottani' },
  lastStation: 'Eni via Roma',
  recentStations: ['Eni via Roma', 'Q8'],
  suggestedKm: { km: 45200, estimated: true, basis: 'projected', sourceLabel: 'inserita a mano', source: 'manual', asOf: '2026-10-01', label: 'stimato' },
  isFull: true,
  tankCapacityMl: 40000,
};

describe('Rifornimento: valori predefiniti e costruzione dei dati', () => {
  it('parte da ultimo carburante, ultimo prezzo, ultima stazione e km suggeriti', () => {
    const f = initialFuelForm(defaults, 'km');
    expect(f).toMatchObject({ fuelType: 'petrol', date: '08/10/2026', unitPrice: '1,859', km: '45200', station: 'Eni via Roma', grade: '100 ottani', isFull: true, edited: [] });
  });

  it('in miglia i km suggeriti si mostrano in miglia', () => {
    expect(initialFuelForm(defaults, 'mi').km).toBe('28086');
  });

  it('cambiando carburante il prezzo segue il carburante, ma non se l\'hai scritto tu', () => {
    const f = initialFuelForm(defaults, 'km');
    expect(switchFuelType(f, defaults, 'lpg')).toMatchObject({ fuelType: 'lpg', unitPrice: '0,749', grade: '' });
    expect(switchFuelType({ ...f, unitPrice: '1,9', edited: ['unitPrice'] }, defaults, 'lpg').unitPrice).toBe('1,9');
  });

  it('costruisce il nuovo rifornimento dai due valori scritti', () => {
    const f = { ...initialFuelForm(defaults, 'km'), quantity: '40', total: '74,36', edited: ['quantity', 'total'] as const };
    const b = buildAddFuelInput('v1', { ...f, edited: [...f.edited] }, { today: defaults.today, unit: 'km' });
    expect(b.ok).toBe(true);
    if (b.ok) {
      expect(b.input).toMatchObject({ vehicleId: 'v1', filledOn: '2026-10-08', fuelType: 'petrol', quantityMilli: 40000, totalCents: 7436, isFull: true, km: 45200, station: 'Eni via Roma' });
      expect(b.input.unitPriceMilli).toBeUndefined();
    }
  });

  it('segnala in italiano data nel futuro, km illeggibili e valori mancanti', () => {
    const base = initialFuelForm(defaults, 'km');
    const ctx = { today: defaults.today, unit: 'km' as const };
    const future = buildAddFuelInput('v1', { ...base, date: '09/10/2026', quantity: '40', total: '70', edited: ['quantity', 'total'] }, ctx);
    expect(future).toMatchObject({ ok: false, errors: { date: italian.common.futureDate } });
    const badKm = buildAddFuelInput('v1', { ...base, km: 'abc', quantity: '40', total: '70', edited: ['quantity', 'total'] }, ctx);
    expect(badKm).toMatchObject({ ok: false, errors: { km: italian.km.invalidKm } });
    const none = buildAddFuelInput('v1', { ...base, unitPrice: '', edited: [] }, ctx);
    expect(none).toMatchObject({ ok: false, errors: { form: italian.fuel.needTwoValues } });
  });

  it('senza km il rifornimento si salva comunque (km nulli)', () => {
    const base = { ...initialFuelForm(defaults, 'km'), km: '', quantity: '40', total: '70', edited: ['quantity', 'total'] as ('quantity' | 'total')[] };
    const b = buildAddFuelInput('v1', base, { today: defaults.today, unit: 'km' });
    expect(b.ok && b.input.km).toBeNull();
  });

  it('in modifica i km si mandano solo se cambiati', () => {
    const entry = {
      id: 'f1', vehicleId: 'v1', filledOn: '2026-09-10', fuelType: 'petrol', fuelLabel: 'Benzina', grade: null, tank: 'petrol', quantityMilli: 40000,
      quantityUnit: 'L', unitPriceMilli: 1859, totalCents: 7436, isFull: true, missedBefore: false, station: null, notes: null, km: 16000,
      odometerReadingId: 'r1', kmIgnored: false, consumption: null, createdAt: '', updatedAt: '',
    } as FuelLogEntry;
    const original = formFromEntry(entry, 'km');
    expect(original).toMatchObject({ quantity: '40', unitPrice: '1,859', total: '74,36', km: '16000', date: '10/09/2026' });
    const ctx = { today: '2026-10-08', unit: 'km' as const };
    const same = buildUpdateFuelInput({ ...original, station: 'Q8' }, original, ctx);
    expect(same.ok && 'km' in same.input).toBe(false);
    const moved = buildUpdateFuelInput({ ...original, km: '16100' }, original, ctx);
    expect(moved.ok && moved.input.km).toBe(16100);
    const cleared = buildUpdateFuelInput({ ...original, km: '' }, original, ctx);
    expect(cleared.ok && cleared.input.km).toBeNull();
  });

  it('mappa i campi dei casi d\'uso sui campi del modulo', () => {
    expect(fuelErrorField('quantityMilli')).toBe('quantity');
    expect(fuelErrorField('unitPriceMilli')).toBe('unitPrice');
    expect(fuelErrorField('totalCents')).toBe('total');
    expect(fuelErrorField('filledOn')).toBe('date');
    expect(fuelErrorField('km')).toBe('km');
    expect(fuelErrorField('fuelType')).toBe('form');
    expect(fuelErrorField(undefined)).toBe('form');
  });
});

describe('Rifornimento: consumo e righe', () => {
  const entry = {
    id: 'f1', vehicleId: 'v1', filledOn: '2026-09-25', fuelType: 'petrol', fuelLabel: 'Benzina', quantityUnit: 'L', quantityMilli: 35500, totalCents: 6600,
    isFull: true, station: 'Q8', km: 16600, kmIgnored: false, consumption: null,
  } as unknown as FuelLogEntry;

  it('dice il consumo del tratto subito dopo il salvataggio', () => {
    const computed = { computed: true, tank: 'petrol', unit: 'L', per100Centi: 643, text: '6,43 L/100 km', distanceKm: 600, quantityMilli: 38580, costCents: 7000 } as const;
    expect(consumptionNote(entry, 'km', computed)).toEqual({ value: '6,43 L/100 km', detail: 'su 600 km' });
    expect(consumptionNote(entry, 'km', { computed: false, reason: 'FIRST_FULL', text: 'Primo pieno registrato: il consumo si calcola dal secondo pieno in poi.' })).toEqual({
      value: null,
      detail: 'Primo pieno registrato: il consumo si calcola dal secondo pieno in poi.',
    });
    expect(consumptionNote({ ...entry, isFull: false }, 'km', null).detail).toBe(italian.fuel.partialNote);
    expect(consumptionNote({ ...entry, fuelType: 'adblue' }, 'km', null).detail).toBe(italian.fuel.adblueNote);
  });

  it('titolo e sottotitolo della riga', () => {
    expect(fuelRowTitle(entry)).toBe('66,00 € · 35,500 L');
    expect(fuelRowSubtitle(entry, 'km')).toBe('25/09/2026 · Benzina · pieno · Q8 · 16.600 km');
  });

  it('riepilogo del serbatoio: solo le righe calcolate', () => {
    const base = { avgText: '6,50 L/100 km', lastText: '6,43 L/100 km', bestText: '6,10 L/100 km', worstText: '7,00 L/100 km', count: 3 };
    expect(tankLines(base as never).map((l) => l.label)).toEqual(['Consumo medio', 'Ultimo pieno', 'Migliore', 'Peggiore']);
    expect(tankLines({ ...base, count: 1, bestText: '6,43 L/100 km', worstText: '6,43 L/100 km' } as never).map((l) => l.label)).toEqual(['Consumo medio', 'Ultimo pieno']);
    expect(tankLines({ avgText: null, lastText: null, bestText: null, worstText: null, count: 0 } as never)).toEqual([]);
  });
});
