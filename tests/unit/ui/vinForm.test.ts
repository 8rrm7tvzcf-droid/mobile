import { describe, expect, it } from 'vitest';
import { it as italian } from '@/ui/i18n/it';
import { describeError } from '@/ui/logic/errors';
import { buildAddInput, buildUpdateInput, emptyVehicleForm, formFieldOf, formFromVehicle, type VehicleFormState } from '@/ui/logic/vehicleForm';
import { dataRows } from '@/ui/logic/vehicleView';
import type { Vehicle } from '@/usecases/vehicles';

const ctx = { today: '2026-10-13', distanceUnit: 'km' as const };
const filled = (over: Partial<VehicleFormState> = {}): VehicleFormState => ({
  ...emptyVehicleForm(),
  make: 'Renault',
  model: 'Clio',
  fuelPrimary: 'petrol',
  ...over,
});

const VIN = 'VF15RJL0H12345678';

describe('campo VIN nel modulo dell\'auto', () => {
  it('e\' facoltativo: vuoto = nessun VIN', () => {
    const res = buildAddInput(filled(), ctx);
    expect(res.ok && res.input.vin).toBeNull();
    const spaces = buildUpdateInput(filled({ vin: '   ' }), ctx);
    expect(spaces.ok && spaces.input.vin).toBeNull();
  });

  it('accetta 17 caratteri e lo normalizza (maiuscolo, senza spazi e trattini)', () => {
    const res = buildAddInput(filled({ vin: ' vf15rjl0-h1234 5678 ' }), ctx);
    expect(res.ok && res.input.vin).toBe(VIN);
  });

  it('rifiuta lunghezze sbagliate e le lettere I, O, Q con un messaggio in italiano', () => {
    for (const bad of ['VF15RJL0H1234567', 'VF15RJL0H123456789', 'VF15RJL0H1234567I', 'VF15RJL0H1234567O', 'VF15RJL0H1234567Q', 'VF15RJL0H1234567!']) {
      const res = buildAddInput(filled({ vin: bad }), ctx);
      expect(res.ok, bad).toBe(false);
      if (!res.ok) expect(res.errors.vin, bad).toBe(italian.vehicleForm.vinInvalid);
    }
    expect(italian.vehicleForm.vinInvalid).toContain('I, O e Q');
  });

  it('in modifica si puo\' correggere o togliere il VIN salvato dall\'OBD', () => {
    const vehicle = { id: 'v', make: 'Renault', model: 'Clio', plate: null, vin: VIN, modelYear: null, firstRegistrationOn: null, fuelPrimary: 'petrol', fuelSecondary: null, powertrain: 'ice', nickname: null } as unknown as Vehicle;
    const form = formFromVehicle(vehicle);
    expect(form.vin).toBe(VIN);
    const kept = buildUpdateInput(form, ctx);
    expect(kept.ok && kept.input.vin).toBe(VIN);
    const cleared = buildUpdateInput({ ...form, vin: '' }, ctx);
    expect(cleared.ok && cleared.input.vin).toBeNull();
    const fixed = buildUpdateInput({ ...form, vin: 'VF15RJL0H12345679' }, ctx);
    expect(fixed.ok && fixed.input.vin).toBe('VF15RJL0H12345679');
  });

  it('l\'errore del VIN duplicato dei casi d\'uso finisce sotto il campo VIN', () => {
    expect(formFieldOf('vin')).toBe('vin');
    const e = describeError({ code: 'VALIDATION', field: 'vin', message: 'Questo VIN è già associato a un\'altra auto.' });
    expect(formFieldOf(e.field)).toBe('vin');
    expect(e.message).toContain('VIN');
  });

  it('la scheda auto mostra il VIN solo se c\'e\'', () => {
    const base = { id: 'v', make: 'Renault', model: 'Clio', trim: null, plate: 'AB123CD', modelYear: 2024, firstRegistrationOn: null, fuelPrimary: 'petrol', fuelSecondary: null, powertrain: 'ice' } as unknown as Vehicle;
    expect(dataRows({ ...base, vin: null } as Vehicle).some((r) => r.label === italian.vehicle.vin)).toBe(false);
    expect(dataRows({ ...base, vin: VIN } as Vehicle).find((r) => r.label === italian.vehicle.vin)?.value).toBe(VIN);
  });
});
