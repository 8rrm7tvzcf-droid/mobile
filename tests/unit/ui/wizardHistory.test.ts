import { describe, expect, it } from 'vitest';
import type { SetupProposal } from '@/usecases/deadlines';
import type { LastDoneSuggestion } from '@/usecases/services';
import type { TimelineEntry } from '@/usecases/queries';
import { entryRoute } from '@/ui/logic/registry';
import { buildSetupInput, demoWizardState, historyAnswer, historyBacked, initialWizardState, selectedCount } from '@/ui/logic/setupWizard';

const proposal = (templateId: string, over: Partial<SetupProposal> = {}): SetupProposal =>
  ({
    templateId, name: templateId, category: 'maintenance', question: 'last_done', applies: true, preselected: true, existingItemId: null, suggestedDueOn: null, ...over,
  }) as unknown as SetupProposal;

const last = (templateId: string, doneOn: string, doneKm: number | null, serviceTitle = 'Tagliando'): LastDoneSuggestion => ({ templateId, doneOn, doneKm, serviceRecordId: 's1', serviceTitle });

const proposals = [
  proposal('tpl_service_main'),
  proposal('tpl_oil_change'),
  proposal('tpl_wipers'),
  proposal('tpl_inspection', { question: 'inspection', category: 'legal' }),
  proposal('tpl_road_tax', { question: 'road_tax', category: 'legal', suggestedDueOn: '2026-10-08' }),
  proposal('tpl_timing_belt', { preselected: false }),
  proposal('tpl_brake_fluid', { existingItemId: 'item-1' }),
];
const history = {
  tpl_service_main: last('tpl_service_main', '2026-03-12', 45200),
  tpl_oil_change: last('tpl_oil_change', '2026-03-12', null),
  tpl_inspection: last('tpl_inspection', '2025-11-05', 38000, 'Revisione'),
  tpl_timing_belt: last('tpl_timing_belt', '2024-01-10', 20000),
  tpl_brake_fluid: last('tpl_brake_fluid', '2025-01-10', 30000),
};

describe('Imposta le scadenze: «ultimo fatto» dallo storico', () => {
  it('la risposta dello storico ha data e km dell\'intervento piu recente', () => {
    expect(historyAnswer(proposals[0]!, history, 'km')).toEqual({ lastDone: 'done', doneOn: '12/03/2026', doneKm: '45200' });
    // senza km sull'intervento il campo resta vuoto (non si inventa nulla)
    expect(historyAnswer(proposals[1]!, history, 'km')).toEqual({ lastDone: 'done', doneOn: '12/03/2026', doneKm: '' });
    // revisione: data dell'ultima revisione regolare
    expect(historyAnswer(proposals[3]!, history, 'km')).toEqual({ lastInspectionOn: '05/11/2025' });
    // nessuna voce nello storico, bollo, o voce gia presente: niente
    expect(historyAnswer(proposals[2]!, history, 'km')).toBeNull();
    expect(historyAnswer(proposals[4]!, history, 'km')).toBeNull();
    expect(historyAnswer(proposals[6]!, history, 'km')).toBeNull();
  });

  it('in miglia i km dello storico si mostrano in miglia', () => {
    expect(historyAnswer(proposals[0]!, history, 'mi')).toMatchObject({ doneKm: '28086' });
  });

  it('lo stato iniziale unisce storico e catalogo; senza storico e come prima', () => {
    const s = initialWizardState(proposals, history, 'km');
    expect(s.tpl_service_main).toMatchObject({ selected: true, lastDone: 'done', doneOn: '12/03/2026', doneKm: '45200' });
    expect(s.tpl_wipers).toMatchObject({ selected: true, lastDone: 'unknown', doneOn: '' });
    expect(s.tpl_inspection?.lastInspectionOn).toBe('05/11/2025');
    // una voce non preselezionata resta spenta anche se lo storico ne parla
    expect(s.tpl_timing_belt).toMatchObject({ selected: false, lastDone: 'done' });
    expect(initialWizardState(proposals)).toEqual(initialWizardState(proposals, {}, 'km'));
    expect(initialWizardState(proposals).tpl_service_main?.lastDone).toBe('unknown');
  });

  it('segnala «Dal tuo storico» solo per le voci con una risposta proposta', () => {
    expect(Object.keys(historyBacked(proposals, history, 'km')).sort()).toEqual(['tpl_inspection', 'tpl_oil_change', 'tpl_service_main', 'tpl_timing_belt']);
    expect(historyBacked(proposals, {}, 'km')).toEqual({});
  });

  it('l\'auto di esempio: solo voci con storico, bollo dal mese di immatricolazione, e l\'input per il caso d\'uso e valido', () => {
    const s = demoWizardState(proposals, history, 'km');
    expect(s.tpl_wipers?.selected).toBe(false); // niente storico: resterebbe «Da configurare»
    expect(s.tpl_road_tax).toMatchObject({ selected: true, paymentMonth: 10 });
    expect(selectedCount(s)).toBe(4); // tagliando, olio, revisione, bollo
    const built = buildSetupInput('v1', proposals, s, { today: '2026-10-09', unit: 'km' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const byId = Object.fromEntries(built.input.items.map((i) => [i.templateId, i]));
    expect(byId.tpl_service_main?.lastDone).toEqual({ kind: 'done', on: '2026-03-12', km: 45200 });
    expect(byId.tpl_oil_change?.lastDone).toEqual({ kind: 'done', on: '2026-03-12', km: null });
    expect(byId.tpl_inspection?.inspection).toEqual({ lastInspectionOn: '2025-11-05' });
    expect(byId.tpl_road_tax?.paymentMonth).toBe(10);
    expect(byId.tpl_wipers).toBeUndefined();
  });
});

describe('Registro: ogni riga apre il suo dettaglio', () => {
  const e = (kind: TimelineEntry['kind'], id = 'x1'): TimelineEntry => ({ kind, id }) as TimelineEntry;

  it('interventi, controlli livelli, polizze e rate', () => {
    expect(entryRoute(e('service'), 'v1')).toBe('/auto/v1/intervento/x1');
    expect(entryRoute(e('fluid'), 'v1')).toBe('/auto/v1/livelli/x1');
    expect(entryRoute(e('policy'), 'v1')).toBe('/auto/v1/polizza/x1');
    expect(entryRoute(e('installment'), 'v1')).toBe('/auto/v1/assicurazioni');
  });

  it('le altre righe come prima', () => {
    expect(entryRoute(e('fuel'), 'v1')).toBe('/auto/v1/rifornimento/x1');
    expect(entryRoute(e('expense'), 'v1')).toBe('/auto/v1/spesa/x1');
    expect(entryRoute(e('deadline'), 'v1')).toBe('/scadenza/x1');
    expect(entryRoute(e('odometer'), 'v1')).toBeNull();
  });
});
