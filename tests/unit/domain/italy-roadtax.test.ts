import { describe, expect, it } from 'vitest';
import {
  ROAD_TAX_LEAD_DAYS,
  ROAD_TAX_RULES,
  daysLateFrom,
  isWeekend,
  lateRegularisationCents,
  lateRegularisationPct,
  nextBusinessDay,
  reminderDates,
  roadTaxExemption2027Hint,
  roadTaxFirstDue,
  roadTaxIsPrescribed,
  roadTaxNextDue,
  roadTaxPrescriptionEnd,
  roadTaxRegionForProvince,
  roadTaxRenewalDue,
  selectRule,
} from '@/domain/italy';

// Vettori B1-B14 di REG §2.7 / SPEC §7.3, ricalcolati a mano.
describe('bollo: primo pagamento', () => {
  it('B2: immatricolazione a inizio mese, altra Regione -> fine dello stesso mese', () => {
    const r = roadTaxFirstDue({ registeredOn: '2026-03-05', region: 'OTHER' });
    expect(r.dueOn).toBe('2026-03-31');
    expect(r.ruleId).toBe('it.road_tax.first_payment.until_2027');
    expect(r.basis).toBe('first_payment');
  });

  it('B3: ultimi 10 giorni del mese (25 > 31 - 10) -> mese successivo', () => {
    expect(roadTaxFirstDue({ registeredOn: '2026-03-25', region: 'OTHER' }).dueOn).toBe('2026-04-30');
  });

  it('B4: Lombardia -> sempre il mese successivo; B14: Trento e Bolzano come Lombardia', () => {
    expect(roadTaxFirstDue({ registeredOn: '2026-03-05', region: 'LOMBARDIA' }).dueOn).toBe('2026-04-30');
    expect(roadTaxFirstDue({ registeredOn: '2026-03-05', region: 'PIEMONTE' }).dueOn).toBe('2026-04-30');
    expect(roadTaxFirstDue({ registeredOn: '2026-03-05', region: 'TRENTO' }).dueOn).toBe('2026-04-30');
    expect(roadTaxFirstDue({ registeredOn: '2026-03-05', region: 'BOLZANO' }).dueOn).toBe('2026-04-30');
  });

  it('B5: regime 2028 (D.Lgs. 147/2026) -> fine del mese successivo, anche per le altre Regioni', () => {
    const r = roadTaxFirstDue({ registeredOn: '2028-02-10', region: 'OTHER' });
    expect(r.dueOn).toBe('2028-03-31');
    expect(r.ruleId).toBe('it.road_tax.first_payment.from_2028');
  });

  it('B6: febbraio di 28 giorni: 20 > 28 - 10 -> mese successivo', () => {
    expect(roadTaxFirstDue({ registeredOn: '2026-02-20', region: 'OTHER' }).dueOn).toBe('2026-03-31');
  });

  it('B7: giorno 21 di marzo non e negli ultimi 10 giorni (21 > 21 e falso)', () => {
    expect(roadTaxFirstDue({ registeredOn: '2026-03-21', region: 'OTHER' }).dueOn).toBe('2026-03-31');
    expect(roadTaxFirstDue({ registeredOn: '2026-03-22', region: 'OTHER' }).dueOn).toBe('2026-04-30');
  });

  it('dicembre: il mese successivo passa all anno dopo', () => {
    expect(roadTaxFirstDue({ registeredOn: '2026-12-28', region: 'OTHER' }).dueOn).toBe('2027-01-31');
  });

  it('la versione della regola si sceglie con la data di immatricolazione (validFrom/validTo)', () => {
    expect(selectRule(ROAD_TAX_RULES.firstPayment, '2027-12-31')?.id).toBe('it.road_tax.first_payment.until_2027');
    expect(selectRule(ROAD_TAX_RULES.firstPayment, '2028-01-01')?.id).toBe('it.road_tax.first_payment.from_2028');
    expect(roadTaxFirstDue({ registeredOn: '2027-12-31', region: 'OTHER' }).dueOn).toBe('2028-01-31'); // ultimi 10 giorni
    expect(roadTaxFirstDue({ registeredOn: '2028-01-01', region: 'OTHER' }).dueOn).toBe('2028-02-29');
  });

  it('nessun importo nel risultato: solo scadenza e metadati', () => {
    const r = roadTaxFirstDue({ registeredOn: '2026-03-05', region: 'OTHER' });
    expect(Object.keys(r).sort()).toEqual(
      ['basis', 'caveats', 'confidence', 'dueOn', 'reasonCode', 'rule', 'ruleId', 'verifiedOn', 'warningText'].sort(),
    );
  });
});

describe('bollo: rinnovo e mese di pagamento', () => {
  it('B1: rinnovo 2026, immatricolato a marzo -> 2026-03-31', () => {
    const r = roadTaxRenewalDue(2026, { registeredOn: '2022-03-15' });
    expect(r.dueOn).toBe('2026-03-31');
    expect(r.basis).toBe('renewal_registration_month');
  });

  it('B13: «mese di pagamento» = 5 nel 2027 -> 2027-05-31', () => {
    const r = roadTaxRenewalDue(2027, { registeredOn: '2022-03-15', paymentMonth: 5 });
    expect(r.dueOn).toBe('2027-05-31');
    expect(r.basis).toBe('renewal_payment_month');
    expect(r.ruleId).toBe('it.road_tax.payment_month_manual');
    // se 5 fosse il mese di FINE VALIDITA' ACI, il termine di versamento sarebbe il mese dopo: 2027-06-30
    expect(roadTaxRenewalDue(2027, { registeredOn: '2022-03-15', paymentMonth: 6 }).dueOn).toBe('2027-06-30');
  });

  it('febbraio bisestile e mese non valido', () => {
    expect(roadTaxRenewalDue(2028, { registeredOn: '2022-02-10' }).dueOn).toBe('2028-02-29');
    expect(() => roadTaxRenewalDue(2027, { registeredOn: '2022-02-10', paymentMonth: 13 })).toThrow(RangeError);
    expect(() => roadTaxRenewalDue(2027, { registeredOn: '2022-02-10', paymentMonth: 0 })).toThrow(RangeError);
  });

  it('prossima scadenza: dopo il primo pagamento seguono i rinnovi annuali', () => {
    const input = { registeredOn: '2022-03-15', region: 'OTHER' } as const;
    expect(roadTaxNextDue('2026-10-07', input).dueOn).toBe('2027-03-31');
    expect(roadTaxNextDue('2026-03-31', input).dueOn).toBe('2026-03-31'); // inclusa
    expect(roadTaxNextDue('2026-04-01', input).dueOn).toBe('2027-03-31');
    expect(roadTaxNextDue('2026-10-07', input).basis).toBe('renewal_registration_month');
  });

  it('prossima scadenza: auto appena immatricolata -> primo pagamento', () => {
    const r = roadTaxNextDue('2026-10-07', { registeredOn: '2026-10-03', region: 'OTHER' });
    expect(r.dueOn).toBe('2026-10-31');
    expect(r.basis).toBe('first_payment');
    // passato il primo pagamento: prossimo rinnovo l'anno dopo
    expect(roadTaxNextDue('2026-11-01', { registeredOn: '2026-10-03', region: 'OTHER' }).dueOn).toBe('2027-10-31');
  });

  it('prossima scadenza con mese di pagamento inserito: serie annuale di quel mese', () => {
    const input = { registeredOn: '2022-03-15', region: 'OTHER', paymentMonth: 10 } as const;
    expect(roadTaxNextDue('2026-10-07', input).dueOn).toBe('2026-10-31');
    expect(roadTaxNextDue('2026-10-31', input).dueOn).toBe('2026-10-31');
    expect(roadTaxNextDue('2026-11-01', input).dueOn).toBe('2027-10-31');
  });

  it('Regione da sigla di provincia', () => {
    expect(roadTaxRegionForProvince('MI')).toBe('LOMBARDIA');
    expect(roadTaxRegionForProvince(' mb ')).toBe('LOMBARDIA');
    expect(roadTaxRegionForProvince('TO')).toBe('PIEMONTE');
    expect(roadTaxRegionForProvince('TN')).toBe('TRENTO');
    expect(roadTaxRegionForProvince('BZ')).toBe('BOLZANO');
    expect(roadTaxRegionForProvince('RM')).toBe('OTHER');
    expect(roadTaxRegionForProvince('??')).toBe('OTHER');
  });

  it('preavvisi del catalogo: 30, 15, 7, 0 giorni', () => {
    expect(ROAD_TAX_LEAD_DAYS).toEqual([30, 15, 7, 0]);
    expect(reminderDates('2026-03-31', ROAD_TAX_LEAD_DAYS)).toEqual(['2026-03-01', '2026-03-16', '2026-03-24', '2026-03-31']);
  });
});

describe('bollo: slittamento (non applicato di default, B8)', () => {
  it('B8: 2026-05-31 e una domenica -> primo giorno lavorativo 2026-06-01', () => {
    expect(isWeekend('2026-05-31')).toBe(true);
    expect(nextBusinessDay('2026-05-31')).toBe('2026-06-01');
  });

  it('un giorno feriale non cambia; i festivi sono un parametro', () => {
    expect(nextBusinessDay('2026-06-03')).toBe('2026-06-03');
    expect(nextBusinessDay('2026-06-03', (d) => d === '2026-06-03')).toBe('2026-06-04');
    // sabato -> lunedi
    expect(nextBusinessDay('2026-05-30')).toBe('2026-06-01');
  });

  it('il calcolo della scadenza NON applica lo slittamento (SPEC 7.3)', () => {
    // 2026-05-31 e domenica: la scadenza resta il 31, prudenziale
    expect(roadTaxRenewalDue(2026, { registeredOn: '2022-05-10' }).dueOn).toBe('2026-05-31');
  });
});

describe('bollo: etichetta informativa 2027 (D.L. 162/2026)', () => {
  it('benzina/gasolio fino a 80 kW con scadenza 2027: etichetta, promemoria non cancellato', () => {
    const h = roadTaxExemption2027Hint({ dueOn: '2027-03-31', powerKw: 66, petrolOrDiesel: true });
    expect(h.applies).toBe(true);
    expect(h.label).toBe('Possibile esenzione 2027 (D.L. 162/2026): verifica i requisiti');
    expect(h.dueOn).toBe('2027-03-31'); // la scadenza resta
    expect(roadTaxExemption2027Hint({ dueOn: '2027-03-31', powerKw: 80, petrolOrDiesel: true }).applies).toBe(true);
  });

  it('niente etichetta oltre 80 kW, fuori dal 2027, senza benzina/gasolio o con potenza ignota', () => {
    expect(roadTaxExemption2027Hint({ dueOn: '2027-03-31', powerKw: 81, petrolOrDiesel: true }).applies).toBe(false);
    expect(roadTaxExemption2027Hint({ dueOn: '2026-12-31', powerKw: 66, petrolOrDiesel: true }).applies).toBe(false);
    expect(roadTaxExemption2027Hint({ dueOn: '2028-01-31', powerKw: 66, petrolOrDiesel: true }).applies).toBe(false);
    expect(roadTaxExemption2027Hint({ dueOn: '2027-03-31', powerKw: 66, petrolOrDiesel: false }).applies).toBe(false);
    const unknown = roadTaxExemption2027Hint({ dueOn: '2027-03-31', powerKw: null, petrolOrDiesel: true });
    expect(unknown.applies).toBe(false);
    expect(unknown.label).toBeNull();
  });
});

describe('bollo: ravvedimento e prescrizione (accessori)', () => {
  it('B9: 200 EUR dopo 10 giorni -> 0,8333% = 1,67 EUR (non 1,60 con l arrotondamento 0,08%)', () => {
    expect(lateRegularisationPct(10)).toBeCloseTo(0.8333, 4);
    expect(lateRegularisationCents(20000, 10)).toBe(167);
  });

  it('B10: 200 EUR dopo 20 giorni -> 1,25% = 2,50 EUR', () => {
    expect(lateRegularisationPct(20)).toBeCloseTo(1.25, 6);
    expect(lateRegularisationCents(20000, 20)).toBe(250);
  });

  it('B11: 200 EUR dopo 400 giorni -> 1/7 di 25% = 3,5714% = 7,14 EUR (non 3,75%)', () => {
    expect(lateRegularisationPct(400)).toBeCloseTo(3.5714, 4);
    expect(lateRegularisationCents(20000, 400)).toBe(714);
  });

  it('fasce continue: 2 gg = 0,17%; 15 gg = 1,25%; 16-30 gg = 1,25%; 31-90 = 1,39%; 91-365 = 3,125%', () => {
    expect(lateRegularisationPct(2)).toBeCloseTo(0.1667, 4);
    expect(lateRegularisationPct(15)).toBeCloseTo(1.25, 6);
    expect(lateRegularisationPct(16)).toBeCloseTo(1.25, 6);
    expect(lateRegularisationPct(30)).toBeCloseTo(1.25, 6);
    expect(lateRegularisationPct(31)).toBeCloseTo(1.3889, 4);
    expect(lateRegularisationPct(90)).toBeCloseTo(1.3889, 4);
    expect(lateRegularisationPct(91)).toBeCloseTo(3.125, 6);
    expect(lateRegularisationPct(365)).toBeCloseTo(3.125, 6);
    expect(lateRegularisationPct(366)).toBeCloseTo(3.5714, 4);
    expect(lateRegularisationPct(0)).toBe(0);
    expect(lateRegularisationPct(-3)).toBe(0);
  });

  it('giorni di ritardo da una scadenza', () => {
    expect(daysLateFrom('2026-03-31', '2026-04-10')).toBe(10);
    expect(daysLateFrom('2026-03-31', '2026-03-20')).toBe(0);
  });

  it('B12: prescrizione di una scadenza 2022-03-31 -> ultimo giorno 2025-12-31', () => {
    expect(roadTaxPrescriptionEnd('2022-03-31').dueOn).toBe('2025-12-31');
    expect(roadTaxIsPrescribed('2025-12-31', '2022-03-31')).toBe(false);
    expect(roadTaxIsPrescribed('2026-01-01', '2022-03-31')).toBe(true);
  });
});

describe('bollo: regole come dati', () => {
  it('le due versioni del primo pagamento non si sovrappongono e coprono tutto', () => {
    const [a, b] = ROAD_TAX_RULES.firstPayment;
    expect(a.validTo).toBe('2027-12-31');
    expect(b.validFrom).toBe('2028-01-01');
    expect(b.validTo).toBeNull();
  });

  it('il risultato porta la regola applicata, la fonte e l avvertenza', () => {
    const r = roadTaxRenewalDue(2026, { registeredOn: '2022-03-15' });
    expect(r.rule.id).toBe(r.ruleId);
    expect(r.verifiedOn).toBe('2026-10-07');
    expect(r.warningText).toContain('tassa regionale');
    expect(r.rule.sources.map((s) => s.url)).toContain('https://online.aci.it/acinet/calcolobollo/index.asp');
  });
});
