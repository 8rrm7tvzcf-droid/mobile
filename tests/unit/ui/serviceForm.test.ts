import { describe, expect, it } from 'vitest';
import { formatDateIt, formatEuro } from '@/domain/units';
import type { ServiceItemSuggestion, ServiceLine, ServiceRecordDetail, ServiceRecordSummary } from '@/usecases/services';
import {
  NEW_WORKSHOP,
  SERVICE_FILTER_KINDS,
  applyPreset,
  availableLinePresets,
  buildAddServiceInput,
  buildUpdateServicePatch,
  customLine,
  formFromRecord,
  initialServiceForm,
  lineFromPreset,
  preselectedIds,
  presetOfRecord,
  serviceAmountText,
  serviceCompletedText,
  serviceErrorField,
  serviceRowSubtitle,
  serviceSummaryText,
  suggestionLines,
  supportsOil,
  toggleId,
  type ServiceFormValues,
} from '@/ui/logic/serviceForm';
import { LINE_PRESETS } from '@/usecases/services';

const ctx = { today: '2026-10-09', unit: 'km' as const };
const base = (over: Partial<ServiceFormValues> = {}): ServiceFormValues => ({ ...initialServiceForm({ today: ctx.today, km: 45200, unit: 'km' }, 'oil'), ...over });

describe('Intervento: modulo di partenza e chip', () => {
  it('parte con la data di oggi e l\'ultimo km noto, senza tipo scelto', () => {
    const v = initialServiceForm({ today: ctx.today, km: 45200, unit: 'km' });
    expect(v.date).toBe('09/10/2026');
    expect(v.km).toBe('45200');
    expect(v.presetId).toBeNull();
    expect(buildAddServiceInput('v1', v, ctx)).toMatchObject({ ok: false, errors: { type: expect.any(String) } });
  });

  it('il chip «Cambio olio e filtri» imposta tipo, titolo e sotto-modulo del cambio olio', () => {
    const v = base();
    expect(v).toMatchObject({ presetId: 'oil', kind: 'scheduled', title: 'Cambio olio e filtri', oilOn: true });
    expect(supportsOil(v)).toBe(true);
  });

  it('cambiando chip il titolo scritto da te resta, quello del chip precedente si sostituisce', () => {
    const typed = applyPreset({ ...base(), title: 'Tagliando Panda' }, 'brakes');
    expect(typed.title).toBe('Tagliando Panda');
    expect(typed.kind).toBe('repair');
    expect(typed.oilOn).toBe(false);
    const untouched = applyPreset(base(), 'tyres');
    expect(untouched).toMatchObject({ title: 'Gomme', kind: 'tyres', oilOn: false });
  });

  it('la revisione chiede l\'esito e lo azzera cambiando tipo', () => {
    let v = applyPreset(base(), 'inspection');
    expect(v.kind).toBe('inspection');
    const missing = buildAddServiceInput('v1', v, ctx);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.inspection).toBeTruthy();
    v = { ...v, inspectionResult: 'repeat' };
    const built = buildAddServiceInput('v1', v, ctx);
    expect(built.ok && built.input.inspectionResult).toBe('repeat');
    expect(applyPreset(v, 'brakes').inspectionResult).toBeNull();
  });
});

describe('Intervento: dal modulo al caso d\'uso', () => {
  it('cambio olio con specifica, litri con la virgola e filtro; totale e km letti all\'italiana', () => {
    const v = base({ total: '180,50', km: '45.200', oilSpec: '5W-30 ACEA C3', oilLitres: '4,5', workshop: NEW_WORKSHOP, newWorkshop: ' Officina Rossi ', notes: ' ok ' });
    const built = buildAddServiceInput('v1', v, ctx);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input).toMatchObject({
      vehicleId: 'v1',
      serviceOn: '2026-10-09',
      kind: 'scheduled',
      title: 'Cambio olio e filtri',
      km: 45200,
      totalCents: 18050,
      notes: 'ok',
      newWorkshop: { name: 'Officina Rossi' },
      oilChange: { spec: '5W-30 ACEA C3', quantityMilli: 4500, filterReplaced: true },
    });
    expect(built.input.workshopId).toBeUndefined();
  });

  it('officina esistente, totale vuoto (si sommano le righe) e righe con importo', () => {
    const filter = LINE_PRESETS.find((p) => p.category === 'oil_filter')!;
    const v = base({ workshop: 'w1', lines: [{ ...lineFromPreset(filter), amount: '14,00' }, customLine()] });
    const built = buildAddServiceInput('v1', v, ctx);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input.workshopId).toBe('w1');
    expect(built.input.totalCents).toBeNull();
    // la riga vuota (nessuna descrizione e nessun importo) si scarta
    expect(built.input.lines).toEqual([{ lineType: 'part', description: 'Filtro olio', fluidKind: null, amountCents: 1400 }]);
  });

  it('errori in italiano per campo: data futura, km e totale illeggibili, litri, riga senza descrizione', () => {
    const v = base({ date: '10/10/2026', km: 'abc', total: '12,3,4', oilLitres: 'tanti', lines: [{ ...customLine(), key: 'x', amount: '5' }] });
    const built = buildAddServiceInput('v1', v, ctx);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors.date).toMatch(/futuro/);
    expect(built.errors.km).toBeTruthy();
    expect(built.errors.total).toBeTruthy();
    expect(built.errors.oilLitres).toBeTruthy();
    expect(built.errors.lines?.x?.description).toBeTruthy();
    expect(buildAddServiceInput('v1', base({ date: 'ieri' }), ctx)).toMatchObject({ ok: false, errors: { date: expect.stringContaining('gg/mm/aaaa') } });
  });

  it('una nuova officina senza nome è un errore', () => {
    const built = buildAddServiceInput('v1', base({ workshop: NEW_WORKSHOP, newWorkshop: '  ' }), ctx);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.errors.workshop).toBeTruthy();
  });

  it('modifica: i km si mandano solo se cambiati; officina tolta = null', () => {
    const original = base({ km: '45200', workshop: 'w1' });
    const same = buildUpdateServicePatch({ ...original, workshop: '' }, original, ctx);
    expect(same.ok).toBe(true);
    if (same.ok) {
      expect('km' in same.input).toBe(false);
      expect(same.input.workshopId).toBeNull();
    }
    const changed = buildUpdateServicePatch({ ...original, km: '46.000' }, original, ctx);
    expect(changed.ok && changed.input.km).toBe(46000);
    const cleared = buildUpdateServicePatch({ ...original, km: '' }, original, ctx);
    expect(cleared.ok && cleared.input.km).toBeNull();
  });

  it('i campi del caso d\'uso si riportano al campo del modulo', () => {
    expect(serviceErrorField('serviceOn')).toBe('date');
    expect(serviceErrorField('totalCents')).toBe('total');
    expect(serviceErrorField('inspectionResult')).toBe('inspection');
    expect(serviceErrorField('workshopId')).toBe('workshop');
    expect(serviceErrorField('lines[0].description')).toBe('form');
    expect(serviceErrorField(undefined)).toBe('form');
  });
});

describe('Intervento: modifica di uno salvato', () => {
  const line = (over: Partial<ServiceLine>): ServiceLine => ({
    id: 'l', position: 0, lineType: 'part', description: 'x', quantityMilli: 1000, unitPriceCents: null, amountCents: 0, partCode: null, brand: null,
    spec: null, fluidKind: null, warrantyMonths: null, category: null, ...over,
  });
  const record = {
    id: 'r1',
    vehicleId: 'v1',
    serviceOn: '2026-03-12',
    kind: 'scheduled',
    kindLabel: 'Tagliando',
    title: 'Cambio olio e filtri',
    workshop: { id: 'w1', name: 'Rossi', phone: null, city: null },
    totalCents: 18050,
    linesTotalCents: 18050,
    invoiceNumber: 'F/12',
    paidOn: null,
    warrantyUntilOn: null,
    inspectionResult: null,
    inspectionNotice: null,
    notes: null,
    km: 45200,
    odometerReadingId: 'o1',
    lines: [
      line({ id: 'a', lineType: 'fluid', description: 'Olio motore 5W-30', fluidKind: 'engine_oil', spec: '5W-30', quantityMilli: 4500, amountCents: 4800, category: 'engine_oil', brand: 'Selenia' }),
      line({ id: 'b', description: 'Filtro olio', amountCents: 1400, category: 'oil_filter', partCode: 'F123' }),
      line({ id: 'c', description: 'Manodopera', lineType: 'labor', amountCents: 6500 }),
    ],
    oilChange: { spec: '5W-30', quantityMilli: 4500, filterReplaced: true },
    completions: [],
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
  } as unknown as ServiceRecordDetail;

  it('olio e filtro tornano nel sotto-modulo (non tra le righe) e non si perdono gli importi nascosti', () => {
    const v = formFromRecord(record, 'km');
    expect(v).toMatchObject({
      presetId: 'oil',
      title: 'Cambio olio e filtri',
      date: '12/03/2026',
      km: '45200',
      workshop: 'w1',
      total: '180,50',
      invoice: 'F/12',
      oilOn: true,
      oilSpec: '5W-30',
      oilLitres: '4,5',
      oilFilter: true,
      carry: { hadOil: true, oilBrand: 'Selenia', oilAmountCents: 4800, filterPartCode: 'F123', filterAmountCents: 1400 },
    });
    expect(v.lines.map((l) => l.description)).toEqual(['Manodopera']);
    const patch = buildUpdateServicePatch(v, v, ctx);
    expect(patch.ok).toBe(true);
    if (patch.ok) expect(patch.input.oilChange).toMatchObject({ spec: '5W-30', quantityMilli: 4500, oilAmountCents: 4800, filterAmountCents: 1400, filterReplaced: true });
  });

  it('spegnendo il cambio olio il caso d\'uso non riceve piu\' le righe dell\'olio', () => {
    const v = formFromRecord(record, 'km');
    const patch = buildUpdateServicePatch({ ...v, oilOn: false }, v, ctx);
    expect(patch.ok && patch.input.oilChange).toBeUndefined();
    expect(patch.ok && patch.input.lines).toEqual([{ lineType: 'labor', description: 'Manodopera', fluidKind: null, amountCents: 6500 }]);
  });

  it('riconosce il chip dal tipo e dal titolo', () => {
    expect(presetOfRecord('scheduled', 'Tagliando')).toBe('service');
    expect(presetOfRecord('inspection', 'revisione')).toBe('inspection');
    expect(presetOfRecord('repair', 'Sostituzione frizione')).toBeNull();
  });

  it('le righe pronte gia\' aggiunte non si propongono due volte', () => {
    const oil = LINE_PRESETS[0]!;
    const available = availableLinePresets([lineFromPreset(oil)]);
    expect(available.some((p) => p.description === oil.description)).toBe(false);
    expect(available.length).toBe(LINE_PRESETS.length - 1);
  });
});

describe('Interventi: elenco, filtri e «Cosa hai fatto?»', () => {
  const summary = (over: Partial<ServiceRecordSummary> = {}): ServiceRecordSummary => ({
    id: 's1', vehicleId: 'v1', serviceOn: '2026-03-12', kind: 'scheduled', kindLabel: 'Tagliando', title: 'Tagliando', workshopId: 'w1', workshopName: 'Rossi',
    totalCents: 18050, km: 45200, lineCount: 3, hasOil: true, inspectionResult: null, invoiceNumber: null, notes: null, completedItemNames: ['Tagliando', 'Cambio olio motore e filtro'], ...over,
  });

  it('sottotitolo con data, officina e km; importo solo se c\'e\'', () => {
    expect(serviceRowSubtitle(summary(), 'km')).toBe('12/03/2026 · Rossi · 45.200 km');
    expect(serviceRowSubtitle(summary({ workshopName: null, km: null }), 'km')).toBe('12/03/2026');
    expect(serviceAmountText(summary())).toBe(formatEuro(18050));
    expect(serviceAmountText(summary({ totalCents: 0 }))).toBeNull();
    expect(serviceCompletedText(summary())).toBe('Scadenze aggiornate: Tagliando, Cambio olio motore e filtro');
    expect(serviceCompletedText(summary({ completedItemNames: [] }))).toBeNull();
  });

  it('riepilogo con numero di interventi e spesa totale', () => {
    expect(serviceSummaryText([summary(), summary({ totalCents: 1000 })])).toBe(`2 interventi · ${formatEuro(19050)}`);
    expect(serviceSummaryText([summary()])).toBe(`1 intervento · ${formatEuro(18050)}`);
  });

  it('i filtri per tipo raggruppano gli interventi meno comuni in «Altro»', () => {
    expect(SERVICE_FILTER_KINDS.all).toBeUndefined();
    expect(SERVICE_FILTER_KINDS.other).toEqual(['bodywork', 'accessories', 'diagnostic', 'other']);
    expect(SERVICE_FILTER_KINDS.inspection).toEqual(['inspection']);
  });

  it('«Cosa hai fatto?»: preselezione, interruttore e righe per i suggerimenti', () => {
    const s = (itemId: string, preselected: boolean): ServiceItemSuggestion => ({ itemId, name: itemId, templateId: null, category: 'maintenance', matched: preselected, preselected, reason: null, alreadyDoneOn: null });
    expect(preselectedIds([s('a', true), s('b', false), s('c', true)])).toEqual(['a', 'c']);
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
    expect(suggestionLines(record2())).toEqual([{ lineType: 'part', description: 'Filtro olio', fluidKind: null }]);
    expect(formatDateIt('2026-10-09')).toBe('09/10/2026');
  });
});

function record2(): Pick<ServiceRecordDetail, 'lines'> {
  return { lines: [{ lineType: 'part', description: 'Filtro olio', fluidKind: null }] as unknown as ServiceRecordDetail['lines'] };
}
