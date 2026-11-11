// Classificazione delle righe e del tipo di intervento -> voci del catalogo (F-36). Funzioni pure.
import { describe, expect, it } from 'vitest';
import { CATEGORY_TEMPLATES, LINE_PRESETS, SERVICE_PRESETS, categoryOfText, lineCategoryOf, matchService } from '@/usecases/services';

describe('categoryOfText', () => {
  const cases: [string, string | null][] = [
    ['Filtro olio', 'oil_filter'],
    ['Olio e filtro', 'oil_filter'],
    ['Olio motore 5W-30 (3,5 L)', 'engine_oil'],
    ['Cambio olio e filtri', 'oil_filter'], // olio e filtro nella stessa riga: in ogni caso la voce e' il cambio olio
    ['5W-40 sintetico', 'engine_oil'],
    ['Olio cambio ATF', 'gearbox_oil'],
    ['Olio del cambio manuale', 'gearbox_oil'],
    ['Olio motore, cambio filtro', 'oil_filter'], // "cambio" come verbo non e' il cambio di velocita'
    ['Cambio olio motore', 'engine_oil'],
    ['Olio freni DOT 4', 'brake_fluid'],
    ['Liquido freni', 'brake_fluid'],
    ['Olio idroguida', null],
    ['Filtro abitacolo', 'cabin_filter'],
    ['Filtro antipolline', 'cabin_filter'],
    ['Filtro aria motore', 'air_filter'],
    ['Filtro dell’aria', 'air_filter'],
    ['Filtro gasolio', 'fuel_filter'],
    ['Pastiglie freni anteriori', 'brakes'],
    ['Dischi e pastiglie', 'brakes'],
    ['Candele', 'spark_plugs'],
    ['Candelette', null], // candelette = riscaldamento diesel, non candele
    ['Kit distribuzione', 'timing_belt'],
    ['Cinghia di distribuzione e pompa acqua', 'timing_belt'],
    ['Sostituzione batteria', 'battery'],
    ['Controllo batteria', 'battery_check'],
    ['Spazzole tergicristallo', 'wipers'],
    ['Sanificazione climatizzatore', 'air_conditioning'],
    ['Liquido refrigerante', 'coolant'],
    ['Antigelo', 'coolant'],
    ['Rotazione pneumatici', 'tyre_rotation'],
    ['Montaggio gomme invernali', 'tyres_winter'],
    ['Gomme estive', 'tyres_summer'],
    ['Controllo impianto GPL', 'gas_system'],
    ['Collaudo bombola', 'gas_cylinder'],
    ['Manodopera tagliando', null],
    ['', null],
  ];
  for (const [text, cat] of cases) it(`«${text}» -> ${cat ?? 'nessuna'}`, () => expect(categoryOfText(text)).toBe(cat));
});

describe('lineCategoryOf', () => {
  it('il tipo di fluido prevale sulla descrizione', () => {
    expect(lineCategoryOf({ lineType: 'fluid', fluidKind: 'engine_oil', description: 'Lubrificante' })).toBe('engine_oil');
    expect(lineCategoryOf({ lineType: 'fluid', fluidKind: 'brake_fluid', description: 'DOT 4' })).toBe('brake_fluid');
    expect(lineCategoryOf({ lineType: 'fluid', fluidKind: 'washer', description: 'Liquido lavavetri' })).toBeNull();
  });

  it('le righe pronte della UI (LINE_PRESETS) si classificano nella propria categoria', () => {
    for (const p of LINE_PRESETS) expect(lineCategoryOf({ lineType: p.lineType, fluidKind: p.fluidKind, description: p.description }), p.description).toBe(p.category);
  });
});

describe('matchService', () => {
  const lines = (...d: string[]) => d.map((description) => ({ lineType: 'part' as const, description }));

  it('olio e filtro olio -> cambio olio (una voce sola), filtro abitacolo -> filtro abitacolo', () => {
    const m = matchService({ kind: 'repair', title: 'Manutenzione', lines: lines('Olio motore', 'Filtro olio', 'Filtro abitacolo') });
    expect([...m.templates.keys()].sort()).toEqual(['tpl_cabin_filter', 'tpl_oil_change']);
    expect(m.templates.get('tpl_oil_change')).toBe('Riga «Olio motore»');
  });

  it('tagliando: tagliando + olio + (EV) controllo veicolo elettrico; senza titolo vale come tagliando; altri titoli no', () => {
    expect([...matchService({ kind: 'scheduled', title: 'Tagliando', lines: [] }).templates.keys()].sort()).toEqual(['tpl_ev_service', 'tpl_oil_change', 'tpl_service_main']);
    expect(matchService({ kind: 'scheduled', title: null, lines: [] }).templates.has('tpl_service_main')).toBe(true);
    const timing = matchService({ kind: 'scheduled', title: 'Distribuzione', lines: [] });
    expect([...timing.templates.keys()]).toEqual(['tpl_timing_belt']);
    const oil = matchService({ kind: 'scheduled', title: 'Cambio olio e filtri', lines: [] });
    expect([...oil.templates.keys()]).toEqual(['tpl_oil_change']);
  });

  it('revisione: solo l esito regolare completa la voce', () => {
    expect(matchService({ kind: 'inspection', title: 'Revisione', inspectionResult: 'regular', lines: [] }).templates.has('tpl_inspection')).toBe(true);
    for (const r of ['repeat', 'suspended'] as const) {
      const m = matchService({ kind: 'inspection', title: 'Revisione', inspectionResult: r, lines: [] });
      expect(m.templates.size).toBe(0);
      expect(m.notCompleted.has('tpl_inspection')).toBe(true);
    }
  });

  it('i chip di S-20 (SERVICE_PRESETS) hanno un tipo valido e, dove ha senso, indicano una voce', () => {
    const expected: Record<string, string[]> = {
      service: ['tpl_ev_service', 'tpl_oil_change', 'tpl_service_main'],
      oil: ['tpl_oil_change'],
      brakes: ['tpl_brake_inspection'],
      timing: ['tpl_timing_belt'],
      battery: ['tpl_battery_replace'],
    };
    for (const p of SERVICE_PRESETS) {
      const got = [...matchService({ kind: p.kind, title: p.title, lines: [] }).templates.keys()].sort();
      expect(got, p.id).toEqual(expected[p.id] ?? []);
    }
  });

  it('ogni categoria punta a voci del catalogo (tpl_*)', () => {
    for (const ts of Object.values(CATEGORY_TEMPLATES)) for (const t of ts) expect(t).toMatch(/^tpl_/);
  });
});
