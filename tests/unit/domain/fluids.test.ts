import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_FLUIDS,
  FLUIDS,
  FLUID_INFO,
  FLUID_LEVELS,
  OBD_STANDARD_NOTE_IT,
  agoIt,
  applicableFluids,
  describeToppedUp,
  evaluateFluidStatus,
  fluidLabelIt,
  fluidStatusList,
  formatAddedAmount,
  isFluid,
  isFluidApplicable,
  isFluidLevel,
  lastCheckFor,
  levelLabelIt,
  levelSuggestionIt,
  parseAddedMl,
  readableViaStandardObd,
  toppedUpSummary,
  validateFluidCheck,
  type FluidCheck,
  type FluidVehicle,
} from '@/domain/fluids';

const TODAY = '2026-10-07';
let seq = 0;
const K = (
  fluid: FluidCheck['fluid'],
  checkedOn: string,
  level: FluidCheck['level'] = 'ok',
  extra: Partial<FluidCheck> = {},
): FluidCheck => ({ id: `k${String(++seq).padStart(3, '0')}`, fluid, checkedOn, level, ...extra });

const petrol: FluidVehicle = { fuelPrimary: 'petrol', fuelSecondary: 'lpg', powertrain: 'ice' };
const diesel: FluidVehicle = { fuelPrimary: 'diesel', powertrain: 'ice' };
const bev: FluidVehicle = { fuelPrimary: 'electric', powertrain: 'bev' };

describe('fluids: catalogo', () => {
  it('fluidi e esiti del DB piu la pressione (M-1)', () => {
    expect([...FLUIDS]).toEqual([
      'engine_oil',
      'coolant',
      'brake_fluid',
      'washer',
      'adblue',
      'power_steering',
      'gearbox_oil',
      'tyre_pressure',
      'other',
    ]);
    expect([...FLUID_LEVELS]).toEqual(['ok', 'low', 'topped_up', 'high']);
    expect(CHECKLIST_FLUIDS).not.toContain('other');
    expect(CHECKLIST_FLUIDS).toHaveLength(8);
    expect(isFluid('engine_oil')).toBe(true);
    expect(isFluid('benzina')).toBe(false);
    expect(isFluidLevel('low')).toBe(true);
    expect(isFluidLevel('medium')).toBe(false);
  });

  it('etichette in italiano', () => {
    expect(fluidLabelIt('engine_oil')).toBe('Olio motore');
    expect(fluidLabelIt('tyre_pressure')).toBe('Pressione pneumatici');
    expect(levelLabelIt('engine_oil', 'ok')).toBe('OK');
    expect(levelLabelIt('engine_oil', 'low')).toBe('Basso');
    expect(levelLabelIt('engine_oil', 'topped_up')).toBe('Rabboccato');
    expect(levelLabelIt('engine_oil', 'high')).toBe('Alto');
    expect(levelLabelIt('tyre_pressure', 'low')).toBe('Bassa');
    expect(levelLabelIt('tyre_pressure', 'topped_up')).toBe('Gonfiata');
    expect(levelLabelIt('tyre_pressure', 'high')).toBe('Alta');
  });

  it('i suggerimenti di controllo seguono la specifica (olio, pressione)', () => {
    expect(FLUID_INFO.engine_oil.hintIt).toMatch(/motore freddo, auto in piano, con l'astina/i);
    expect(FLUID_INFO.tyre_pressure.hintIt).toMatch(/a freddo/i);
    expect(FLUID_INFO.tyre_pressure.hintIt).toMatch(/libretto|montante/i);
  });

  it('promemoria predefiniti: attivi solo olio e pressione (SPEC 6.3.9)', () => {
    const on = FLUIDS.filter((f) => FLUID_INFO[f].reminderDefaultOn);
    expect(on).toEqual(['engine_oil', 'tyre_pressure']);
    expect(FLUID_INFO.engine_oil.reminderTextIt).toBe("Controlla il livello dell'olio ogni 1.000 km o prima di un viaggio lungo");
    expect(FLUID_INFO.tyre_pressure.reminderTextIt).toBe('Controlla la pressione a freddo ogni mese e prima dei viaggi');
  });
});

describe('fluids: onesta sull OBD (nessun livello via PID standard)', () => {
  it('nessun fluido e leggibile via OBD standard e ogni nota lo dice', () => {
    for (const f of FLUIDS) {
      expect(readableViaStandardObd(f)).toBe(false);
      expect(FLUID_INFO[f].obdNoteIt).toMatch(/non legge|non è disponibile/i);
    }
    expect(FLUID_INFO.engine_oil.obdNoteIt).toBe("L'OBD standard non legge il livello dell'olio: il controllo è manuale.");
    expect(OBD_STANDARD_NOTE_IT).toMatch(/olio/);
    expect(OBD_STANDARD_NOTE_IT).toMatch(/pressione dei pneumatici/);
  });

  it('per il refrigerante l OBD da la temperatura, non il livello', () => {
    expect(FLUID_INFO.coolant.obdNoteIt).toMatch(/temperatura/);
    expect(FLUID_INFO.coolant.obdNoteIt).toMatch(/non il livello/);
  });

  it('i suggerimenti non promettono sicurezza ne dicono se si puo circolare', () => {
    for (const f of FLUIDS) {
      for (const l of FLUID_LEVELS) {
        const s = levelSuggestionIt(f, l);
        if (s === null) continue;
        expect(s).not.toMatch(/puoi (tranquillamente )?(guidare|circolare)|è sicuro|non c'è (nessun )?problema|tutto a posto/i);
      }
    }
  });

  it('esito OK: nessun suggerimento; basso: guida concreta e onesta', () => {
    expect(levelSuggestionIt('engine_oil', 'ok')).toBeNull();
    expect(levelSuggestionIt('engine_oil', 'low')).toMatch(/libretto/);
    expect(levelSuggestionIt('brake_fluid', 'low')).toMatch(/Non rabboccare senza sapere perché è calato/);
    expect(levelSuggestionIt('brake_fluid', 'low')).toMatch(/officina/);
    expect(levelSuggestionIt('adblue', 'low')).toMatch(/Rabbocca l'AdBlue/);
    expect(levelSuggestionIt('tyre_pressure', 'low')).toMatch(/a freddo/);
    expect(levelSuggestionIt('engine_oil', 'high')).toMatch(/officina/);
    expect(levelSuggestionIt('coolant', 'low')).toMatch(/motore freddo/);
    expect(levelSuggestionIt('engine_oil', 'topped_up')).toMatch(/Ricontrolla/);
  });
});

describe('fluids: applicabilita al veicolo', () => {
  it('benzina/GPL: olio, refrigerante, freni, lavavetri, servosterzo, cambio, pressione (senza AdBlue)', () => {
    expect(applicableFluids(petrol)).toEqual([
      'engine_oil',
      'coolant',
      'brake_fluid',
      'washer',
      'power_steering',
      'gearbox_oil',
      'tyre_pressure',
    ]);
  });

  it('diesel: aggiunge AdBlue', () => {
    expect(applicableFluids(diesel)).toContain('adblue');
    expect(applicableFluids(diesel)).toHaveLength(8);
  });

  it('elettrica: niente olio motore, AdBlue, olio cambio, servosterzo', () => {
    expect(applicableFluids(bev)).toEqual(['coolant', 'brake_fluid', 'washer', 'tyre_pressure']);
    expect(isFluidApplicable('engine_oil', bev)).toBe(false);
    // senza powertrain si deduce dal carburante
    expect(isFluidApplicable('engine_oil', { fuelPrimary: 'electric' })).toBe(false);
    // ibrido plug-in: ha un motore termico
    expect(isFluidApplicable('engine_oil', { fuelPrimary: 'petrol', fuelSecondary: 'electric', powertrain: 'phev' })).toBe(true);
    expect(isFluidApplicable('engine_oil', { fuelPrimary: 'electric', fuelSecondary: 'petrol' })).toBe(true);
  });
});

describe('fluids: stato dell ultima verifica', () => {
  it('mai controllato', () => {
    const s = evaluateFluidStatus('engine_oil', [], TODAY);
    expect(s).toMatchObject({ kind: 'never', last: null, labelIt: 'Mai controllato', detailIt: 'Mai controllato' });
  });

  it('ok: controllato di recente', () => {
    const s = evaluateFluidStatus('engine_oil', [K('engine_oil', '2026-10-02', 'ok')], TODAY);
    expect(s).toMatchObject({ kind: 'ok', daysSince: 5, labelIt: 'OK', detailIt: 'Ultima verifica: 5 giorni fa', recheckDue: false });
  });

  it('da ricontrollare dopo 30 giorni', () => {
    const s = evaluateFluidStatus('engine_oil', [K('engine_oil', '2026-09-07', 'ok')], TODAY);
    expect(s).toMatchObject({ kind: 'overdue', daysSince: 30, labelIt: 'Da ricontrollare', recheckDue: true });
    expect(evaluateFluidStatus('engine_oil', [K('engine_oil', '2026-09-08', 'ok')], TODAY).kind).toBe('ok'); // 29 giorni
  });

  it('da ricontrollare dopo 1.000 km anche se e recente (il primo dei due)', () => {
    const checks = [K('engine_oil', '2026-10-01', 'ok', { km: 50000 })];
    expect(evaluateFluidStatus('engine_oil', checks, TODAY, { currentKm: 50999 })).toMatchObject({ kind: 'ok', kmSince: 999 });
    expect(evaluateFluidStatus('engine_oil', checks, TODAY, { currentKm: 51000 })).toMatchObject({ kind: 'overdue', kmSince: 1000 });
    // senza km noti l'intervallo a km non si applica
    expect(evaluateFluidStatus('engine_oil', checks, TODAY).kmSince).toBeNull();
  });

  it('basso o alto: serve attenzione, anche se recente, con suggerimento', () => {
    const low = evaluateFluidStatus('engine_oil', [K('engine_oil', '2026-10-06', 'low')], TODAY);
    expect(low).toMatchObject({ kind: 'attention', labelIt: 'Basso' });
    expect(low.suggestionIt).toMatch(/libretto/);
    const high = evaluateFluidStatus('coolant', [K('coolant', '2026-10-06', 'high')], TODAY);
    expect(high).toMatchObject({ kind: 'attention', labelIt: 'Alto' });
  });

  it('rabboccato: tutto a posto fino al prossimo ricontrollo; mostra quanto', () => {
    const s = evaluateFluidStatus('engine_oil', [K('engine_oil', '2026-10-05', 'topped_up', { addedMl: 500 })], TODAY);
    expect(s).toMatchObject({ kind: 'ok', labelIt: 'Rabboccato' });
    expect(s.detailIt).toBe('Ultima verifica: 2 giorni fa · 500 ml aggiunti');
    expect(s.suggestionIt).toBeNull();
  });

  it('pressione: mostra il valore misurato in bar o psi', () => {
    const c = [K('tyre_pressure', '2026-10-07', 'ok', { valueMillibar: 2200 })];
    expect(evaluateFluidStatus('tyre_pressure', c, TODAY).detailIt).toBe('Ultima verifica: oggi · 2,2 bar');
    expect(evaluateFluidStatus('tyre_pressure', c, TODAY, { pressureUnit: 'psi' }).detailIt).toBe('Ultima verifica: oggi · 31,9 psi');
  });

  it('conta l ultimo controllo del fluido, non quello di altri fluidi; a parita di data vince l id piu recente', () => {
    const a = K('engine_oil', '2026-09-01', 'low');
    const b = K('engine_oil', '2026-10-01', 'ok');
    const c = K('coolant', '2026-10-05', 'low');
    expect(lastCheckFor([a, b, c], 'engine_oil')?.id).toBe(b.id);
    const x = K('washer', '2026-10-01', 'low');
    const y = K('washer', '2026-10-01', 'topped_up');
    expect(lastCheckFor([y, x], 'washer')?.id).toBe(y.id);
    expect(lastCheckFor([x, y], 'washer')?.id).toBe(y.id);
    expect(lastCheckFor([], 'washer')).toBeNull();
    // un controllo vecchio che era basso non conta se dopo e tornato ok
    expect(evaluateFluidStatus('engine_oil', [a, b], TODAY).kind).toBe('ok');
  });

  it('i fluidi senza intervallo non scadono mai (AdBlue, olio cambio)', () => {
    const s = evaluateFluidStatus('adblue', [K('adblue', '2020-01-01', 'ok')], TODAY);
    expect(s).toMatchObject({ kind: 'ok', recheckDue: false });
  });

  it('data nel futuro: giorni a zero, mai negativi', () => {
    expect(evaluateFluidStatus('engine_oil', [K('engine_oil', '2026-10-09', 'ok')], TODAY).daysSince).toBe(0);
  });

  it('elenco S-24 completo per veicolo', () => {
    const l = fluidStatusList([K('engine_oil', '2026-10-06', 'ok')], TODAY, diesel);
    expect(l.map((s) => s.fluid)).toEqual(applicableFluids(diesel));
    expect(l[0]).toMatchObject({ fluid: 'engine_oil', kind: 'ok' });
    expect(l.slice(1).every((s) => s.kind === 'never')).toBe(true);
  });

  it('tempo trascorso in italiano', () => {
    expect(agoIt(0)).toBe('oggi');
    expect(agoIt(1)).toBe('ieri');
    expect(agoIt(5)).toBe('5 giorni fa');
    expect(agoIt(14)).toBe('2 settimane fa');
    expect(agoIt(59)).toBe('8 settimane fa');
    expect(agoIt(60)).toBe('2 mesi fa');
    expect(agoIt(400)).toBe('13 mesi fa');
    expect(agoIt(800)).toBe('2 anni fa');
    expect(agoIt(-3)).toBe('oggi');
  });
});

describe('fluids: validazione (i CHECK di fluid_checks)', () => {
  const base = { checkedOn: '2026-10-07', fluid: 'engine_oil', level: 'ok' };
  const codes = (i: Record<string, unknown>) => validateFluidCheck({ ...base, ...i }, { today: TODAY }).errors.map((e) => e.code);

  it('un controllo valido', () => {
    expect(validateFluidCheck(base, { today: TODAY })).toEqual({ ok: true, errors: [] });
    expect(codes({ level: 'topped_up', addedMl: 500 })).toEqual([]);
    expect(codes({ fluid: 'tyre_pressure', valueMillibar: 2200 })).toEqual([]);
  });

  it('data non valida o futura', () => {
    expect(codes({ checkedOn: '2026-02-30' })).toEqual(['INVALID_DATE']);
    expect(codes({ checkedOn: '2026-10-08' })).toEqual(['FUTURE_DATE']);
  });

  it('fluido o esito sconosciuti', () => {
    expect(codes({ fluid: 'acqua' })).toEqual(['INVALID_FLUID']);
    expect(codes({ level: 'medio' })).toEqual(['INVALID_LEVEL']);
  });

  it('la quantita aggiunta solo con «rabboccato», tra 1 e 100.000 ml', () => {
    expect(codes({ level: 'ok', addedMl: 500 })).toEqual(['ADDED_WITHOUT_TOP_UP']);
    expect(codes({ level: 'low', addedMl: 500 })).toEqual(['ADDED_WITHOUT_TOP_UP']);
    expect(codes({ level: 'topped_up', addedMl: 0 })).toEqual(['INVALID_ADDED_AMOUNT']);
    expect(codes({ level: 'topped_up', addedMl: 100001 })).toEqual(['INVALID_ADDED_AMOUNT']);
    expect(codes({ level: 'topped_up', addedMl: 250.5 })).toEqual(['INVALID_ADDED_AMOUNT']);
    expect(codes({ level: 'topped_up', addedMl: 100000 })).toEqual([]);
    expect(codes({ level: 'topped_up', addedMl: null })).toEqual([]);
  });

  it('la pressione solo per i pneumatici, tra 500 e 6000 millibar', () => {
    expect(codes({ fluid: 'tyre_pressure', valueMillibar: 499 })).toEqual(['INVALID_PRESSURE']);
    expect(codes({ fluid: 'tyre_pressure', valueMillibar: 6001 })).toEqual(['INVALID_PRESSURE']);
    expect(codes({ fluid: 'tyre_pressure', valueMillibar: 500 })).toEqual([]);
    expect(codes({ fluid: 'tyre_pressure', valueMillibar: 6000 })).toEqual([]);
    expect(codes({ fluid: 'engine_oil', valueMillibar: 2200 })).toEqual(['PRESSURE_ON_OTHER_FLUID']);
  });

  it('km facoltativi ma validi', () => {
    expect(codes({ km: 12345 })).toEqual([]);
    expect(codes({ km: -1 })).toEqual(['INVALID_KM']);
    expect(codes({ km: 2_000_001 })).toEqual(['INVALID_KM']);
  });

  it('quantita aggiunta scritta dall utente', () => {
    expect(parseAddedMl('250', 'ml')).toBe(250);
    expect(parseAddedMl('250 ml', 'ml')).toBe(250);
    expect(parseAddedMl('0,5', 'L')).toBe(500);
    expect(parseAddedMl('1.5 L', 'L')).toBe(1500);
    expect(parseAddedMl('1,5', 'L')).toBe(1500);
    expect(parseAddedMl('0', 'ml')).toBeNull();
    expect(parseAddedMl('2,5', 'ml')).toBeNull();
    expect(parseAddedMl('poco', 'ml')).toBeNull();
    expect(parseAddedMl('0,0005', 'L')).toBeNull();
  });
});

describe('fluids: rabbocchi nel periodo (base del consumo di olio, V1)', () => {
  const checks = [
    K('engine_oil', '2026-01-10', 'topped_up', { addedMl: 500 }),
    K('engine_oil', '2026-04-10', 'topped_up', { addedMl: 750 }),
    K('engine_oil', '2026-06-10', 'topped_up'), // senza quantita
    K('engine_oil', '2026-07-10', 'ok'),
    K('engine_oil', '2025-12-31', 'topped_up', { addedMl: 1000 }),
    K('coolant', '2026-02-10', 'topped_up', { addedMl: 300 }),
  ];

  it('somma solo i rabbocchi dell olio nell anno', () => {
    const s = toppedUpSummary(checks, 'engine_oil', '2026-01-01', '2026-12-31');
    expect(s).toEqual({ count: 3, totalMl: 1250, withoutAmount: 1 });
    expect(describeToppedUp(s)).toBe('3 rabbocchi, 1,25 L in tutto');
  });

  it('estremi inclusi e periodo vuoto', () => {
    expect(toppedUpSummary(checks, 'engine_oil', '2026-01-10', '2026-01-10').count).toBe(1);
    const none = toppedUpSummary(checks, 'engine_oil', '2027-01-01', '2027-12-31');
    expect(none).toEqual({ count: 0, totalMl: 0, withoutAmount: 0 });
    expect(describeToppedUp(none)).toBe('Nessun rabbocco nel periodo');
    expect(describeToppedUp({ count: 1, totalMl: 0, withoutAmount: 1 })).toBe('1 rabbocco');
  });

  it('quantita in testo', () => {
    expect(formatAddedAmount(250)).toBe('250 ml');
    expect(formatAddedAmount(999)).toBe('999 ml');
    expect(formatAddedAmount(1000)).toBe('1 L');
    expect(formatAddedAmount(1500)).toBe('1,5 L');
    expect(formatAddedAmount(1050)).toBe('1,05 L');
    expect(formatAddedAmount(10000)).toBe('10 L');
  });
});
