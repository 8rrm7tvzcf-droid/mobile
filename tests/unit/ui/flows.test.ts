import { describe, expect, it } from 'vitest';
import {
  completionSourceLabel,
  isMissingKmField,
  parseDoneForm,
  SNOOZE_KM,
  SNOOZE_OPTIONS,
  snoozeMessage,
} from '@/ui/logic/deadlineActions';
import { checkMessages, parseKmField, rangeHint, readingSubtitle, readingTitle } from '@/ui/logic/odometer';
import { buildSetupInput, emptyAnswer, groupProposals, initialWizardState, questionTitle, selectedCount } from '@/ui/logic/setupWizard';
import { it as italian } from '@/ui/i18n/it';
import type { OdometerCheck, OdometerEntry } from '@/usecases/odometer';
import type { SetupProposal } from '@/usecases/deadlines';

const ctx = { today: '2026-10-09', unit: 'km' as const };

describe('Aggiorna km', () => {
  it('legge i km con virgola, punto e unita\'', () => {
    expect(parseKmField('45.200', 'km')).toBe(45200);
    expect(parseKmField('45200 km', 'km')).toBe(45200);
    expect(parseKmField('abc', 'km')).toBeNull();
    expect(parseKmField('', 'km')).toBeNull();
    expect(parseKmField('3.000.000', 'km')).toBeNull();
  });

  it('descrive l\'intervallo ammesso', () => {
    expect(rangeHint({ min: 10000, max: 12000 }, 'km')).toBe('Per questa data sono ammessi km tra 10.000 km e 12.000 km.');
    expect(rangeHint({ min: 10000, max: Number.POSITIVE_INFINITY }, 'km')).toBe('Per questa data sono ammessi almeno 10.000 km.');
    expect(rangeHint({ min: 0, max: 2_000_000 }, 'km')).toContain('almeno');
  });

  it('riassume errori, avvisi e conflitto della verifica', () => {
    const check = {
      ok: false,
      errors: [{ code: 'NON_MONOTONIC', severity: 'error', message: 'I km sono inferiori a quelli precedenti.', related: [] }],
      warnings: [{ code: 'IMPLAUSIBLE_JUMP', severity: 'warning', message: 'Salto molto grande.', related: [] }],
      conflicts: [{ id: 'x' }],
      previous: null,
      next: null,
      allowedRange: { min: 0, max: 10 },
    } as unknown as OdometerCheck;
    expect(checkMessages(check)).toEqual({ errors: ['I km sono inferiori a quelli precedenti.'], warnings: ['Salto molto grande.'], conflict: true });
  });

  it('le letture ignorate si dichiarano nel sottotitolo', () => {
    const base = { km: 12345, readOn: '2026-10-01', sourceLabel: 'Inserito da te', status: 'valid' } as OdometerEntry;
    expect(readingTitle(base, 'km')).toBe('12.345 km');
    expect(readingSubtitle(base)).toBe('01/10/2026 · Inserito da te');
    expect(readingSubtitle({ ...base, status: 'ignored' })).toBe('01/10/2026 · Inserito da te · messa da parte');
  });
});

describe('Fatto / Rimanda', () => {
  it('Fatto: data obbligatoria e non nel futuro, km facoltativi', () => {
    const ok = parseDoneForm({ date: '01/10/2026', km: '45.300', notes: ' tagliando ' }, ctx);
    expect(ok).toEqual({ ok: true, input: { doneOn: '2026-10-01', doneKm: 45300, notes: 'tagliando' } });
    const noKm = parseDoneForm({ date: '01/10/2026', km: '', notes: '' }, ctx);
    expect(noKm.ok && noKm.input.doneKm).toBeNull();

    const bad = parseDoneForm({ date: '10/10/2026', km: 'x', notes: '' }, ctx);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.date).toBe('La data non può essere nel futuro.');
      expect(bad.errors.km).toBe('Scrivi i km con soli numeri, per esempio 45.200.');
    }
    const empty = parseDoneForm({ date: '', km: '', notes: '' }, ctx);
    expect(empty.ok).toBe(false);
  });

  it('Rimanda: domani, 3 giorni, 1 settimana, dopo N km', () => {
    expect(SNOOZE_OPTIONS.map((o) => o.label)).toEqual(['Domani', 'Tra 3 giorni', 'Tra 1 settimana', 'Dopo 500 km']);
    expect(SNOOZE_OPTIONS.map((o) => o.choice)).toEqual([
      { type: 'tomorrow' },
      { type: 'days', days: 3 },
      { type: 'days', days: 7 },
      { type: 'after_km', km: SNOOZE_KM },
    ]);
  });

  it('il messaggio dopo il rimando parla di data o di km', () => {
    expect(snoozeMessage({ reminderId: 'r', snoozedUntil: 'x', untilLocal: { date: '2026-10-10', time: '09:00' }, untilKm: null }, 'km')).toBe(
      'Rimandata a 10/10/2026 alle 09:00.',
    );
    expect(snoozeMessage({ reminderId: 'r', snoozedUntil: 'x', untilLocal: { date: '2026-11-08', time: '09:00' }, untilKm: 45700 }, 'km')).toBe(
      'Rimandata fino a 45.700 km.',
    );
  });

  it('riconosce l\'errore "servono i km attuali" e le provenienze dello storico', () => {
    expect(isMissingKmField('currentKm')).toBe(true);
    expect(isMissingKmField('date')).toBe(false);
    expect(completionSourceLabel('service')).toBe('Intervento');
    expect(completionSourceLabel('manual')).toBe('Inserito da te');
  });
});

const proposal = (over: Partial<SetupProposal>): SetupProposal =>
  ({
    templateId: 'tpl_x',
    name: 'Voce',
    category: 'maintenance',
    question: 'last_done',
    applies: true,
    preselected: true,
    existingItemId: null,
    suggestedDueOn: null,
    ...over,
  }) as SetupProposal;

describe('Imposta le scadenze', () => {
  const proposals = [
    proposal({ templateId: 'tpl_oil', name: 'Olio' }),
    proposal({ templateId: 'tpl_inspection', name: 'Revisione', category: 'legal', question: 'inspection' }),
    proposal({ templateId: 'tpl_road_tax', name: 'Bollo', category: 'legal', question: 'road_tax' }),
    proposal({ templateId: 'tpl_gas', name: 'Bombola', category: 'check', question: 'next_due', preselected: false }),
    proposal({ templateId: 'tpl_ev', name: 'Solo elettriche', applies: false }),
    proposal({ templateId: 'tpl_done', name: 'Gia\' presente', existingItemId: 'it1' }),
  ];

  it('parte con le voci pre-selezionate, compatibili e non gia\' presenti', () => {
    const state = initialWizardState(proposals);
    expect(Object.entries(state).filter(([, a]) => a.selected).map(([id]) => id)).toEqual(['tpl_oil', 'tpl_inspection', 'tpl_road_tax']);
    expect(selectedCount(state)).toBe(3);
  });

  it('raggruppa solo le voci compatibili nell\'ordine delle categorie', () => {
    const groups = groupProposals(proposals);
    expect(groups.map((g) => g.label)).toEqual(['Legale', 'Manutenzione', 'Controlli']);
    expect(groups.flatMap((g) => g.items.map((i) => i.templateId))).not.toContain('tpl_ev');
  });

  it('"non lo so" non inventa nulla; "data e km" legge i valori', () => {
    const state = initialWizardState(proposals);
    const input = buildSetupInput('v1', proposals, { ...state, tpl_oil: { ...emptyAnswer(true), lastDone: 'done', doneOn: '10/05/2026', doneKm: '40.000' } }, ctx);
    expect(input.ok).toBe(true);
    if (input.ok) {
      const oil = input.input.items.find((i) => i.templateId === 'tpl_oil');
      expect(oil?.lastDone).toEqual({ kind: 'done', on: '2026-05-10', km: 40000 });
      const unknown = buildSetupInput('v1', proposals, { ...state, tpl_oil: { ...emptyAnswer(true), lastDone: 'unknown' } }, ctx);
      expect(unknown.ok && unknown.input.items.find((i) => i.templateId === 'tpl_oil')?.lastDone).toEqual({ kind: 'unknown' });
    }
  });

  it('bollo: mese di pagamento; revisione: ultima revisione e scadenza dal documento', () => {
    const state = initialWizardState(proposals);
    const res = buildSetupInput(
      'v1',
      proposals,
      {
        ...state,
        tpl_road_tax: { ...emptyAnswer(true), paymentMonth: 4 },
        tpl_inspection: { ...emptyAnswer(true), lastInspectionOn: '15/06/2024', nextDueOn: '30/06/2026' },
      },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.input.items.find((i) => i.templateId === 'tpl_road_tax')?.paymentMonth).toBe(4);
      const ins = res.input.items.find((i) => i.templateId === 'tpl_inspection');
      expect(ins?.inspection).toEqual({ lastInspectionOn: '2024-06-15' });
      expect(ins?.nextDueOn).toBe('2026-06-30');
    }
  });

  it('segnala per voce le date illeggibili o nel futuro (ultimo fatto), in italiano', () => {
    const state = initialWizardState(proposals);
    const res = buildSetupInput('v1', proposals, { ...state, tpl_oil: { ...emptyAnswer(true), lastDone: 'done', doneOn: '', doneKm: 'x' } }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.tpl_oil?.doneOn).toBe(italian.common.dateExample);
      expect(res.errors.tpl_oil?.doneKm).toBe(italian.common.kmExample);
    }
    const future = buildSetupInput('v1', proposals, { ...state, tpl_oil: { ...emptyAnswer(true), lastDone: 'done', doneOn: '01/01/2030' } }, ctx);
    expect(!future.ok && future.errors.tpl_oil?.doneOn).toBe('La data non può essere nel futuro.');
  });

  it('le voci deselezionate o gia\' presenti non vanno nell\'input', () => {
    const state = initialWizardState(proposals);
    const res = buildSetupInput('v1', proposals, { ...state, tpl_oil: emptyAnswer(false), tpl_done: emptyAnswer(true) }, ctx);
    expect(res.ok && res.input.items.map((i) => i.templateId)).toEqual(['tpl_inspection', 'tpl_road_tax']);
  });

  it('la domanda dipende dal tipo di voce', () => {
    expect(questionTitle(proposal({ question: 'last_done' }))).toBe("Quando l'hai fatto l'ultima volta?");
    expect(questionTitle(proposal({ question: 'road_tax' }))).toBe('Mese in cui paghi il bollo');
  });
});

describe('testi', () => {
  it('le frasi con numeri usano i plurali giusti', () => {
    expect(italian.setup.createCount(1)).toBe('Crea 1 scadenza');
    expect(italian.setup.createCount(5)).toBe('Crea 5 scadenze');
    expect(italian.setup.summaryText(3, 1)).toBe('Abbiamo creato 3 scadenze. 1 è ancora da configurare.');
    expect(italian.setup.summaryText(1, 2)).toBe('Abbiamo creato 1 scadenza. 2 sono ancora da configurare.');
    expect(italian.settings.verifyMissing(1)).toContain('manca');
    expect(italian.settings.verifyMissing(3)).toContain('mancano');
  });

  it('i mesi del bollo sono dodici', () => {
    expect(italian.setup.monthNames).toHaveLength(12);
  });
});
