// Validazione e normalizzazione dell'auto: targa italiana, VIN, combinazioni di alimentazioni (funzioni pure).
import { describe, expect, it } from 'vitest';
import {
  derivePowertrain,
  fuelCombinationError,
  isValidItalianPlate,
  isValidVin,
  normalizePlate,
  normalizeVin,
  validateVehicleInput,
} from '@/usecases/vehicles';

const ctx = { today: '2026-10-08', defaultDistanceUnit: 'km' as const };
const base = { make: 'Fiat', model: 'Panda', fuelPrimary: 'petrol' } as const;

describe('targa', () => {
  it('si normalizza: maiuscolo, senza spazi ne separatori', () => {
    expect(normalizePlate(' ab 123-cd ')).toBe('AB123CD');
    expect(normalizePlate('b.ab·1234')).toBe('BAB1234');
  });

  it.each(['AB123CD', 'ZZ999ZZ', 'MI1234567', 'RM123456', 'CD1234', 'AB12345', 'MI1A2345'])('accetta %s', (p) => {
    expect(isValidItalianPlate(p)).toBe(true);
  });

  it.each(['IO123AA', 'AB123QU', 'A123CD', 'ABC12CD', 'AB12CD', '1234', 'AB123'])('rifiuta %s', (p) => {
    expect(isValidItalianPlate(p)).toBe(false);
  });

  it('con un altro Paese non si controlla il formato italiano', () => {
    const r = validateVehicleInput({ ...base, plate: 'B AB 1234', plateCountry: 'de' }, ctx);
    expect(r.ok && r.value.plate).toBe('BAB1234');
    expect(r.ok && r.value.plateCountry).toBe('DE');
  });

  it('una targa non italiana con Paese IT da errore sul campo plate', () => {
    const r = validateVehicleInput({ ...base, plate: 'IO123AA' }, ctx);
    expect(r).toMatchObject({ ok: false, field: 'plate' });
    expect(!r.ok && r.message).toContain('non sembra italiana');
  });

  it('caratteri non ammessi o lunghezza fuori misura', () => {
    expect(validateVehicleInput({ ...base, plate: 'AB123CD!', plateCountry: 'DE' }, ctx)).toMatchObject({ ok: false, field: 'plate' });
    expect(validateVehicleInput({ ...base, plate: 'A', plateCountry: 'DE' }, ctx)).toMatchObject({ ok: false, field: 'plate' });
    expect(validateVehicleInput({ ...base, plate: 'ABCDEFGHIJK', plateCountry: 'DE' }, ctx)).toMatchObject({ ok: false, field: 'plate' });
  });

  it('una targa vuota o di soli spazi equivale a nessuna targa (auto senza targa e valida)', () => {
    const r = validateVehicleInput({ ...base, plate: '   ' }, ctx);
    expect(r.ok && r.value.plate).toBeNull();
  });
});

describe('VIN', () => {
  it('si normalizza e deve avere 17 caratteri senza I, O, Q', () => {
    expect(normalizeVin('zfa 31200 003 456 789')).toBe('ZFA31200003456789');
    expect(isValidVin('ZFA31200003456789')).toBe(true);
    expect(isValidVin('ZFA3120000345678')).toBe(false); // 16
    expect(isValidVin('ZFA312000034567890')).toBe(false); // 18
    expect(isValidVin('ZFA3120000O456789')).toBe(false); // O
    expect(isValidVin('ZFA3120000I456789')).toBe(false); // I
    expect(isValidVin('ZFA3120000Q456789')).toBe(false); // Q
  });

  it('il check digit non si impone: un VIN europeo con la nona cifra qualsiasi e valido', () => {
    expect(validateVehicleInput({ ...base, vin: 'zfa 31200 003 456 789' }, ctx)).toMatchObject({ ok: true });
  });

  it('un VIN sbagliato da errore sul campo vin', () => {
    const r = validateVehicleInput({ ...base, vin: 'ZFA3120000O456789' }, ctx);
    expect(r).toMatchObject({ ok: false, field: 'vin' });
  });
});

describe('alimentazioni', () => {
  it('il tipo di motorizzazione si ricava dall alimentazione', () => {
    expect(derivePowertrain('petrol', null)).toBe('ice');
    expect(derivePowertrain('petrol', 'lpg')).toBe('ice');
    expect(derivePowertrain('electric', null)).toBe('bev');
    expect(derivePowertrain('hydrogen', null)).toBe('fcev');
    expect(derivePowertrain('diesel', 'electric')).toBe('phev');
  });

  it('ammette benzina + GPL e benzina + metano (anche invertiti) e l ibrida plug-in', () => {
    expect(fuelCombinationError('petrol', 'lpg', 'ice')).toBeNull();
    expect(fuelCombinationError('petrol', 'cng', 'ice')).toBeNull();
    expect(fuelCombinationError('lpg', 'petrol', 'ice')).toBeNull();
    expect(fuelCombinationError('cng', 'petrol', 'ice')).toBeNull();
    expect(fuelCombinationError('petrol', 'electric', 'phev')).toBeNull();
    expect(fuelCombinationError('diesel', 'electric', 'phev')).toBeNull();
    expect(fuelCombinationError('electric', null, 'bev')).toBeNull();
  });

  it('rifiuta le combinazioni senza senso', () => {
    expect(fuelCombinationError('petrol', 'petrol', 'ice')).not.toBeNull();
    expect(fuelCombinationError('diesel', 'lpg', 'ice')).not.toBeNull();
    expect(fuelCombinationError('lpg', 'cng', 'ice')).not.toBeNull();
    expect(fuelCombinationError('electric', 'petrol', 'bev')).not.toBeNull();
    expect(fuelCombinationError('petrol', null, 'bev')).not.toBeNull();
    expect(fuelCombinationError('petrol', null, 'phev')).not.toBeNull();
    expect(fuelCombinationError('electric', null, 'ice')).not.toBeNull();
  });
});

describe('campi', () => {
  it('servono solo marca, modello e alimentazione primaria', () => {
    expect(validateVehicleInput({ make: ' ', model: 'Panda', fuelPrimary: 'petrol' }, ctx)).toMatchObject({ ok: false, field: 'make' });
    expect(validateVehicleInput({ make: 'Fiat', model: '', fuelPrimary: 'petrol' }, ctx)).toMatchObject({ ok: false, field: 'model' });
    expect(validateVehicleInput({ make: 'Fiat', model: 'Panda', fuelPrimary: 'steam' as never }, ctx)).toMatchObject({
      ok: false,
      field: 'fuelPrimary',
    });
    const ok = validateVehicleInput(base, ctx);
    expect(ok).toMatchObject({ ok: true, value: { powertrain: 'ice', distanceUnit: 'km', plateCountry: 'IT', nickname: null } });
  });

  it('rifiuta valori fuori intervallo con il campo giusto', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ modelYear: 1899 }, 'modelYear'],
      [{ modelYear: 2028 }, 'modelYear'],
      [{ firstRegistrationOn: '2026-13-01' }, 'firstRegistrationOn'],
      [{ firstRegistrationOn: '2026-10-09' }, 'firstRegistrationOn'],
      [{ engineCc: 10 }, 'engineCc'],
      [{ powerKw: 0 }, 'powerKw'],
      [{ powerKw: 51.5 }, 'powerKw'],
      [{ euroClass: 'Euro 6d-TEMP-EVAP' }, 'euroClass'],
      [{ transmission: 'sequenziale' }, 'transmission'],
      [{ tankCapacityMl: 500 }, 'tankCapacityMl'],
      [{ annualKmEstimate: 50 }, 'annualKmEstimate'],
      [{ purchaseKm: -1 }, 'purchaseKm'],
      [{ purchasePriceCents: -5 }, 'purchasePriceCents'],
      [{ nickname: 'x'.repeat(61) }, 'nickname'],
      [{ distanceUnit: 'yd' }, 'distanceUnit'],
    ];
    for (const [patch, field] of cases) {
      expect(validateVehicleInput({ ...base, ...patch } as never, ctx), field).toMatchObject({ ok: false, field });
    }
  });

  it('i testi si ripuliscono dagli spazi in eccesso e l unita predefinita viene dal contesto', () => {
    const r = validateVehicleInput({ ...base, nickname: '  Panda   di  Marco ', make: ' Fiat ' }, { ...ctx, defaultDistanceUnit: 'mi' });
    expect(r).toMatchObject({ ok: true, value: { nickname: 'Panda di Marco', make: 'Fiat', distanceUnit: 'mi' } });
  });
});
