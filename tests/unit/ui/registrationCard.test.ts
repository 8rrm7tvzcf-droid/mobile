import { describe, expect, it } from 'vitest';
import { applyCardToForm, cardRows, emptyCard, parseFuel, readRegistrationCard } from '@/ui/logic/registrationCard';
import { emptyVehicleForm } from '@/ui/logic/vehicleForm';

// Testi sintetici costruiti sui campi armonizzati UE del documento: NON sono letture di documenti veri (SPEC SP-11).
const DU_COMPACT = `
REPUBBLICA ITALIANA
CARTA DI CIRCOLAZIONE
A GH123AB
B 15.03.2024
C.1 ROSSI MARIO
D.1 RENAULT
D.2 5RJA00
D.3 CLIO
E VF15RJA0A12345678
F.1 1520
P.1 999
P.2 67
P.3 BENZINA
V.9 EURO 6
`;

const DU_DESCRIPTORS = `
(A) TARGA GH123AB
(B) DATA DI PRIMA IMMATRICOLAZIONE 03/09/2019
(D.1) MARCA FIAT
(D.3) DENOMINAZIONE COMMERCIALE PANDA
(E) NUMERO DI IDENTIFICAZIONE ZFA31200000123456
(P.3) TIPO DI CARBURANTE BENZINA/GPL
`;

describe('Libretto: lettura del testo', () => {
  it('Documento Unico con le sole etichette (A, B, D.1, D.3, E, P.3)', () => {
    expect(readRegistrationCard(DU_COMPACT)).toEqual({
      plate: 'GH123AB',
      vin: 'VF15RJA0A12345678',
      firstRegistration: '15/03/2024',
      make: 'Renault',
      model: 'Clio',
      fuelPrimary: 'petrol',
      fuelSecondary: null,
    });
  });

  it('etichette tra parentesi con le diciture stampate, doppia alimentazione benzina + GPL', () => {
    expect(readRegistrationCard(DU_DESCRIPTORS)).toEqual({
      plate: 'GH123AB',
      vin: 'ZFA31200000123456',
      firstRegistration: '03/09/2019',
      make: 'Fiat',
      model: 'Panda',
      fuelPrimary: 'petrol',
      fuelSecondary: 'lpg',
    });
  });

  it('il valore puo stare sulla riga dopo l etichetta', () => {
    const card = readRegistrationCard('D.1\nRENAULT\nD.3\nCLIO\nP.3\nGASOLIO\nB\n15/03/2024');
    expect(card).toMatchObject({ make: 'Renault', model: 'Clio', fuelPrimary: 'diesel', firstRegistration: '15/03/2024' });
  });

  it('le sigle corte restano in maiuscolo', () => {
    expect(readRegistrationCard('D.1 BMW\nD.3 SERIE 1').make).toBe('BMW');
    expect(readRegistrationCard('D.1 BMW\nD.3 SERIE 1').model).toBe('Serie 1');
  });

  it('la targa si riconosce anche con gli spazi e minuscola, ma non una parola qualsiasi', () => {
    expect(readRegistrationCard('targa: gh 123 ab').plate).toBe('GH123AB');
    expect(readRegistrationCard('D.3 FIAT 500 XL').plate).toBeNull();
  });

  it('VIN: I, O e Q non esistono, il riconoscimento le confonde con 1 e 0 e si correggono', () => {
    expect(readRegistrationCard('E VF15RJA0A1234567O').vin).toBe('VF15RJA0A12345670');
    expect(readRegistrationCard('E VF15RJA0A12345678').vin).toBe('VF15RJA0A12345678');
  });

  it('la lettera L del VIN e valida e non si tocca', () => {
    expect(readRegistrationCard('E VF15RJL0A12345678').vin).toBe('VF15RJL0A12345678');
  });

  it('la prima immatricolazione e solo la data accanto a (B): altre date non contano', () => {
    const noLabel = readRegistrationCard('A GH123AB\nI 20/04/2024\nQ 01/01/2025');
    expect(noLabel.firstRegistration).toBeNull();
    expect(readRegistrationCard('(B) 15/03/2024\nI 20/04/2025').firstRegistration).toBe('15/03/2024');
    expect(readRegistrationCard('B 31.02.2024').firstRegistration).toBeNull();
  });

  it('testo vuoto, spazzatura o troppo lungo: scheda vuota, niente errori', () => {
    expect(readRegistrationCard('')).toEqual(emptyCard());
    expect(readRegistrationCard('   \n  ')).toEqual(emptyCard());
    expect(readRegistrationCard('lorem ipsum dolor sit amet')).toEqual(emptyCard());
    expect(() => readRegistrationCard('A'.repeat(50000))).not.toThrow();
  });

  it('senza etichetta P.3 il carburante si riconosce solo se il testo ne indica una famiglia sola', () => {
    expect(readRegistrationCard('ALIMENTAZIONE BENZINA').fuelPrimary).toBe('petrol');
    expect(readRegistrationCard('BENZINA GASOLIO').fuelPrimary).toBeNull();
  });
});

describe('Libretto: carburante', () => {
  it.each([
    ['GASOLIO', 'diesel', null],
    ['DIESEL', 'diesel', null],
    ['BENZINA', 'petrol', null],
    ['BENZINA/GPL', 'petrol', 'lpg'],
    ['BENZINA E METANO', 'petrol', 'cng'],
    ['GPL', 'lpg', null],
    ['METANO', 'cng', null],
    ['ELETTRICO', 'electric', null],
    ['IBRIDO BENZINA ELETTRICO', 'petrol', null],
    ['IDROGENO', 'hydrogen', null],
    ['BENZINA GASOLIO', null, null],
    ['', null, null],
  ])('%s', (text, primary, secondary) => {
    expect(parseFuel(text)).toEqual({ primary, secondary });
  });
});

describe('Libretto: anteprima e applicazione al modulo', () => {
  it('l anteprima elenca solo cio che e stato riconosciuto', () => {
    expect(cardRows(emptyCard())).toEqual([]);
    const rows = cardRows(readRegistrationCard(DU_DESCRIPTORS));
    expect(rows.map((r) => r.key)).toEqual(['make', 'model', 'plate', 'vin', 'firstRegistration', 'fuel']);
    expect(rows.find((r) => r.key === 'fuel')?.value).toBe('Benzina + GPL');
  });

  it('riempie i campi vuoti e imposta l alimentazione in modo coerente', () => {
    const { form, filled, kept } = applyCardToForm(emptyVehicleForm(), readRegistrationCard(DU_DESCRIPTORS));
    expect(form).toMatchObject({ make: 'Fiat', model: 'Panda', plate: 'GH123AB', firstRegistration: '03/09/2019', fuelPrimary: 'petrol', fuelSecondary: 'lpg', powertrain: 'ice' });
    expect(filled).toEqual(['make', 'model', 'plate', 'vin', 'firstRegistration', 'fuel']);
    expect(kept).toEqual([]);
  });

  it('non sovrascrive mai cio che l utente ha gia scritto e lo segnala se e diverso', () => {
    const start = { ...emptyVehicleForm(), make: 'Renault', model: 'Twingo', plate: 'gh123ab', fuelPrimary: 'diesel' as const };
    const { form, filled, kept } = applyCardToForm(start, readRegistrationCard(DU_COMPACT));
    expect(form.make).toBe('Renault');
    expect(form.model).toBe('Twingo');
    expect(form.fuelPrimary).toBe('diesel');
    expect(form.vin).toBe('VF15RJA0A12345678');
    expect(filled).toEqual(['vin', 'firstRegistration']);
    // La targa e uguale (a parte maiuscole): non e un conflitto. Il modello e il carburante invece sono diversi.
    expect(kept).toEqual(['model', 'fuel']);
  });
});
