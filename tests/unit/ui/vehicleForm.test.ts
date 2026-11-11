import { describe, expect, it } from 'vitest';
import { describeError } from '@/ui/logic/errors';
import {
  buildAddInput,
  buildUpdateInput,
  emptyVehicleForm,
  formFieldOf,
  formFromVehicle,
  powertrainOptions,
  primaryFuelOptions,
  secondaryFuelOptions,
  withPowertrain,
  withPrimaryFuel,
  withSecondaryFuel,
  type VehicleFormState,
} from '@/ui/logic/vehicleForm';
import { dataRows, fuelText, makeModelText } from '@/ui/logic/vehicleView';
import type { Vehicle } from '@/usecases/vehicles';

const ctx = { today: '2026-10-09', distanceUnit: 'km' as const };
const filled = (over: Partial<VehicleFormState> = {}): VehicleFormState => ({
  ...emptyVehicleForm(),
  make: 'Renault',
  model: 'Clio',
  fuelPrimary: 'petrol',
  ...over,
});

describe('buildAddInput', () => {
  it('chiede marca, modello e alimentazione', () => {
    const res = buildAddInput(emptyVehicleForm(), ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.make).toBe("Scrivi la marca dell'auto.");
      expect(res.errors.model).toBe("Scrivi il modello dell'auto.");
      expect(res.errors.fuelPrimary).toBe("Scegli l'alimentazione.");
    }
  });

  it('con solo i dati obbligatori produce un input valido con valori nulli per il resto', () => {
    const res = buildAddInput(filled(), ctx);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.input).toMatchObject({ make: 'Renault', model: 'Clio', fuelPrimary: 'petrol', plate: null, nickname: null, initialKm: null });
    }
  });

  it('legge km con il punto delle migliaia e la data gg/mm/aaaa', () => {
    const res = buildAddInput(filled({ currentKm: '45.200', firstRegistration: '15/03/2021', modelYear: '2021', plate: ' ab123cd ' }), ctx);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.input.initialKm).toBe(45200);
      expect(res.input.firstRegistrationOn).toBe('2021-03-15');
      expect(res.input.modelYear).toBe(2021);
      expect(res.input.initialKmOn).toBe('2026-10-09');
      expect(res.input.plate).toBe('ab123cd');
    }
  });

  it('segnala km, data e anno illeggibili con messaggi in italiano', () => {
    const res = buildAddInput(filled({ currentKm: 'tanti', firstRegistration: '31/02/2020', modelYear: '21' }), ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.currentKm).toBe('Scrivi i km con soli numeri, per esempio 45.200.');
      expect(res.errors.firstRegistration).toBe('Scrivi la data come gg/mm/aaaa, per esempio 15/03/2021.');
      expect(res.errors.modelYear).toBe("Scrivi l'anno con 4 cifre, per esempio 2021.");
    }
  });

  it('rifiuta una immatricolazione nel futuro e un anno troppo avanti', () => {
    const res = buildAddInput(filled({ firstRegistration: '01/01/2030', modelYear: '2040' }), ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.firstRegistration).toBe('La data non può essere nel futuro.');
      expect(res.errors.modelYear).toBe("L'anno non può essere troppo avanti nel futuro.");
    }
  });

  it('in miglia converte i km una volta sola', () => {
    const res = buildAddInput(filled({ currentKm: '1000' }), { ...ctx, distanceUnit: 'mi' });
    expect(res.ok && res.input.initialKm).toBe(1609);
  });
});

describe('buildUpdateInput', () => {
  it('non porta con se i km iniziali', () => {
    const res = buildUpdateInput(filled({ currentKm: '123' }), ctx);
    expect(res.ok).toBe(true);
    if (res.ok) expect('initialKm' in res.input).toBe(false);
  });
});

describe('combinazioni di alimentazione', () => {
  it('l\'elettrica azzera doppia alimentazione e imposta il motore', () => {
    const next = withPrimaryFuel(filled({ fuelSecondary: 'lpg' }), 'electric');
    expect(next.powertrain).toBe('bev');
    expect(next.fuelSecondary).toBeNull();
    expect(powertrainOptions('electric')).toEqual([]);
  });

  it('la doppia alimentazione e\' proposta solo per la benzina', () => {
    expect(secondaryFuelOptions('petrol', 'ice').map((o) => o.value)).toEqual(['none', 'lpg', 'cng']);
    expect(secondaryFuelOptions('diesel', 'ice')).toEqual([]);
    expect(secondaryFuelOptions('lpg', 'ice')).toEqual([]);
    expect(secondaryFuelOptions('petrol', 'phev')).toEqual([]);
  });

  it('l\'ibrida plug-in porta l\'elettrico come secondaria e si toglie tornando indietro', () => {
    const phev = withPowertrain(filled(), 'phev');
    expect(phev.fuelSecondary).toBe('electric');
    expect(withPowertrain(phev, 'ice').fuelSecondary).toBeNull();
  });

  it('passare da benzina a gasolio toglie GPL e metano', () => {
    const lpg = withSecondaryFuel(filled(), 'lpg');
    expect(lpg.fuelSecondary).toBe('lpg');
    expect(withPrimaryFuel(lpg, 'diesel').fuelSecondary).toBeNull();
    expect(withSecondaryFuel(lpg, 'none').fuelSecondary).toBeNull();
  });

  it('le alimentazioni proposte sono le cinque comuni (idrogeno solo se gia\' presente)', () => {
    expect(primaryFuelOptions(null).map((o) => o.label)).toEqual(['Benzina', 'Gasolio', 'GPL', 'Metano', 'Elettrica']);
    expect(primaryFuelOptions('hydrogen').map((o) => o.value)).toContain('hydrogen');
  });
});

describe('errori dei casi d\'uso', () => {
  it('targa duplicata: messaggio chiaro sul campo targa', () => {
    expect(describeError({ code: 'DUPLICATE_PLATE' })).toEqual({ message: 'Questa targa è già nel tuo garage.', field: 'plate' });
    expect(formFieldOf('plate')).toBe('plate');
  });

  it('non mostra mai testi tecnici', () => {
    const e = describeError({ code: 'ODO_NON_MONOTONIC', message: 'trigger trg_odo_mono_ins failed' });
    expect(e.message).not.toContain('trigger');
    expect(describeError({ code: 'ITEM_NOT_FOUND' }).message).toContain('Non trovo più');
  });

  it('i campi dei casi d\'uso trovano il campo del modulo', () => {
    expect(formFieldOf('firstRegistrationOn')).toBe('firstRegistration');
    expect(formFieldOf('initialKm')).toBe('currentKm');
    expect(formFieldOf('vin')).toBe('vin'); // il VIN e' un campo del modulo (si puo' correggere o togliere)
    expect(formFieldOf(undefined)).toBeNull();
  });
});

describe('vista dell\'auto', () => {
  const vehicle = {
    nickname: 'Clio di Samuele',
    make: 'Renault',
    model: 'Clio',
    trim: 'Eco-G',
    plate: 'AB123CD',
    modelYear: 2024,
    firstRegistrationOn: '2024-05-06',
    fuelPrimary: 'petrol',
    fuelSecondary: 'lpg',
    powertrain: 'ice',
  } as unknown as Vehicle;

  it('descrive alimentazione e marca/modello', () => {
    expect(fuelText(vehicle)).toBe('Benzina + GPL');
    expect(fuelText({ fuelPrimary: 'petrol', fuelSecondary: 'electric', powertrain: 'phev' })).toBe('Benzina + elettrica (ibrida plug-in)');
    expect(fuelText({ fuelPrimary: 'diesel', fuelSecondary: null, powertrain: 'mhev' })).toBe('Gasolio · ibrida leggera');
    expect(makeModelText(vehicle)).toBe('Renault Clio Eco-G');
  });

  it('l\'elenco dati usa date italiane e "Non indicato" dove manca', () => {
    const rows = dataRows(vehicle);
    expect(rows.find((r) => r.label === 'Prima immatricolazione')?.value).toBe('06/05/2024');
    expect(dataRows({ ...vehicle, plate: null } as Vehicle).find((r) => r.label === 'Targa')?.value).toBe('Non indicato');
  });

  it('il modulo di modifica riparte dai dati dell\'auto', () => {
    const form = formFromVehicle(vehicle);
    expect(form.firstRegistration).toBe('06/05/2024');
    expect(form.modelYear).toBe('2024');
    expect(form.fuelSecondary).toBe('lpg');
    expect(form.currentKm).toBe('');
  });
});
