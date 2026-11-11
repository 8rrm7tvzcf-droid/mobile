import { describe, expect, it } from 'vitest';
import { SOURCES } from '@/domain/italy';
import type { SetupProposal } from '@/usecases/deadlines';
import {
  INSPECTION_TEMPLATE_ID,
  OFFICIAL_CHECKS,
  ROAD_TAX_TEMPLATE_ID,
  buildDocumentDates,
  documentDatesSections,
  emptyDocumentDates,
  officialCheckForTemplate,
  toFieldDate,
  type DocumentDatesContext,
  type DocumentDatesValues,
} from '@/ui/logic/documentDates';

const TODAY = '2026-11-05';

const proposal = (templateId: string, over: Partial<SetupProposal> = {}): SetupProposal => ({
  templateId,
  name: templateId,
  category: 'legal',
  scheduleType: 'fixed_date',
  intervalKm: null,
  intervalMonths: null,
  periodEnd: 'end_of_month',
  anchor: null,
  soonDays: 30,
  soonKm: 0,
  notifyOffsetsDays: [30, 7, 0],
  note: null,
  isIndicative: false,
  applies: true,
  preselected: true,
  question: templateId === INSPECTION_TEMPLATE_ID ? 'inspection' : templateId === ROAD_TAX_TEMPLATE_ID ? 'road_tax' : 'next_due',
  existingItemId: null,
  suggestedDueOn: null,
  suggestionBasis: null,
  ...over,
});

const ctx = (over: Partial<DocumentDatesContext> = {}): DocumentDatesContext => ({
  vehicleId: 'veh1',
  today: TODAY,
  firstRegistrationOn: null,
  proposals: [proposal(INSPECTION_TEMPLATE_ID), proposal(ROAD_TAX_TEMPLATE_ID), proposal('tpl_oil', { category: 'maintenance', question: 'last_done' })],
  hasRca: false,
  ...over,
});

const values = (over: Partial<DocumentDatesValues> = {}): DocumentDatesValues => ({ ...emptyDocumentDates(null), ...over });

describe('Date dei documenti: quali blocchi si mostrano', () => {
  it('revisione, bollo e polizza quando non ci sono ancora', () => {
    const s = documentDatesSections(ctx());
    expect(s.inspection?.templateId).toBe(INSPECTION_TEMPLATE_ID);
    expect(s.roadTax?.templateId).toBe(ROAD_TAX_TEMPLATE_ID);
    expect(s.policy).toBe(true);
    expect(s.inspectionExists).toBe(false);
  });

  it('le voci gia presenti non si ripropongono e si segnala che ci sono', () => {
    const s = documentDatesSections(
      ctx({ proposals: [proposal(INSPECTION_TEMPLATE_ID, { existingItemId: 'i1' }), proposal(ROAD_TAX_TEMPLATE_ID, { applies: false })], hasRca: true }),
    );
    expect(s.inspection).toBeNull();
    expect(s.inspectionExists).toBe(true);
    expect(s.roadTax).toBeNull();
    expect(s.roadTaxExists).toBe(false);
    expect(s.policy).toBe(false);
  });
});

describe('Date dei documenti: dalle date scritte alle scritture', () => {
  it('senza nulla di scritto e senza immatricolazione non c e niente da salvare', () => {
    const r = buildDocumentDates(ctx(), values());
    expect(r).toEqual({ ok: false, errors: { form: expect.stringContaining('nessuna data') } });
  });

  it('solo l immatricolazione: modifica l auto e crea revisione e bollo, che si calcolano da li', () => {
    const r = buildDocumentDates(ctx(), values({ firstRegistration: '15/03/2021' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.vehiclePatch).toEqual({ firstRegistrationOn: '2021-03-15' });
    expect(r.plan.setup?.vehicleId).toBe('veh1');
    expect(r.plan.setup?.items.map((i) => i.templateId)).toEqual([INSPECTION_TEMPLATE_ID, ROAD_TAX_TEMPLATE_ID]);
    expect(r.plan.policy).toBeNull();
  });

  it('immatricolazione gia sull auto e invariata: nessuna modifica dell auto, le voci nascono comunque', () => {
    const r = buildDocumentDates(ctx({ firstRegistrationOn: '2021-03-15' }), values({ firstRegistration: '15/03/2021' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.vehiclePatch).toBeNull();
    expect(r.plan.setup?.items).toHaveLength(2);
  });

  it('immatricolazione sconosciuta: la revisione nasce solo se scrivi la data, il bollo solo se scegli il mese', () => {
    const inspectionOnly = buildDocumentDates(ctx(), values({ lastInspectionOn: '10/05/2025' }));
    expect(inspectionOnly.ok).toBe(true);
    if (!inspectionOnly.ok) return;
    expect(inspectionOnly.plan.setup?.items).toEqual([{ templateId: INSPECTION_TEMPLATE_ID, inspection: { lastInspectionOn: '2025-05-10' } }]);

    const taxOnly = buildDocumentDates(ctx(), values({ paymentMonth: 5 }));
    expect(taxOnly.ok).toBe(true);
    if (!taxOnly.ok) return;
    expect(taxOnly.plan.setup?.items).toEqual([{ templateId: ROAD_TAX_TEMPLATE_ID, paymentMonth: 5 }]);
  });

  it('la scadenza scritta sul documento della revisione puo essere futura, l ultima revisione no', () => {
    const next = buildDocumentDates(ctx(), values({ inspectionNextOn: '30/06/2027' }));
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.plan.setup?.items[0]).toMatchObject({ templateId: INSPECTION_TEMPLATE_ID, nextDueOn: '2027-06-30' });

    const future = buildDocumentDates(ctx(), values({ lastInspectionOn: '10/05/2030' }));
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.errors.lastInspectionOn).toBeTruthy();
  });

  it('immatricolazione illeggibile o nel futuro: errore sul campo giusto', () => {
    const bad = buildDocumentDates(ctx(), values({ firstRegistration: 'boh' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.firstRegistration).toBeTruthy();
    const future = buildDocumentDates(ctx(), values({ firstRegistration: '01/01/2030' }));
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.errors.firstRegistration).toBeTruthy();
  });

  it('le voci gia presenti non vengono toccate', () => {
    const c = ctx({
      firstRegistrationOn: '2021-03-15',
      proposals: [proposal(INSPECTION_TEMPLATE_ID, { existingItemId: 'i1' }), proposal(ROAD_TAX_TEMPLATE_ID, { existingItemId: 'i2' })],
    });
    const r = buildDocumentDates(c, values({ firstRegistration: '15/03/2021', lastInspectionOn: '10/05/2025', paymentMonth: 3 }));
    expect(r).toEqual({ ok: false, errors: { form: expect.stringContaining('nessuna data') } });
  });
});

describe('Date dei documenti: assicurazione RC', () => {
  it('compagnia, decorrenza e scadenza creano una polizza RC auto', () => {
    const r = buildDocumentDates(ctx(), values({ policyCompany: ' Generali ', policyStartOn: '01/03/2026', policyEndOn: '01/03/2027' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.policy).toMatchObject({ vehicleId: 'veh1', kind: 'rca', company: 'Generali', startOn: '2026-03-01', endOn: '2027-03-01', premiumCents: 0 });
    expect(r.plan.setup).toBeNull();
    expect(r.plan.vehiclePatch).toBeNull();
  });

  it('se ne scrivi solo una parte, chiede le altre e non crea nulla', () => {
    const r = buildDocumentDates(ctx(), values({ policyCompany: 'Generali' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.policyStartOn).toBeTruthy();
    expect(r.errors.policyEndOn).toBeTruthy();
    expect(r.errors.policyCompany).toBeUndefined();
  });

  it('scadenza prima della decorrenza: errore sulla scadenza', () => {
    const r = buildDocumentDates(ctx(), values({ policyCompany: 'Generali', policyStartOn: '01/03/2027', policyEndOn: '01/03/2026' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.policyEndOn).toBeTruthy();
  });

  it('con una polizza RC gia presente i campi della polizza non contano', () => {
    const r = buildDocumentDates(ctx({ hasRca: true }), values({ policyCompany: 'Generali', policyStartOn: '01/03/2026', policyEndOn: '01/03/2027' }));
    expect(r).toEqual({ ok: false, errors: { form: expect.stringContaining('nessuna data') } });
  });

  it('tutto insieme: auto, scadenze e polizza', () => {
    const r = buildDocumentDates(
      ctx(),
      values({ firstRegistration: '15/03/2021', lastInspectionOn: '10/05/2025', paymentMonth: 3, policyCompany: 'Generali', policyStartOn: '01/03/2026', policyEndOn: '01/03/2027' }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.vehiclePatch).not.toBeNull();
    expect(r.plan.setup?.items).toHaveLength(2);
    expect(r.plan.policy).not.toBeNull();
  });
});

describe('Date dei documenti: controlli sui siti ufficiali', () => {
  it('gli indirizzi sono quelli verificati delle regole', () => {
    expect(OFFICIAL_CHECKS.inspection.url).toBe(SOURCES.portale_revisioni.url);
    expect(OFFICIAL_CHECKS.road_tax.url).toBe(SOURCES.aci_calcolo_bollo.url);
    expect(OFFICIAL_CHECKS.inspection.url.startsWith('https://')).toBe(true);
    expect(OFFICIAL_CHECKS.road_tax.url.startsWith('https://')).toBe(true);
  });

  it('il controllo giusto per revisione e bollo, nessuno per le altre voci', () => {
    expect(officialCheckForTemplate(INSPECTION_TEMPLATE_ID)?.id).toBe('inspection');
    expect(officialCheckForTemplate(ROAD_TAX_TEMPLATE_ID)?.id).toBe('road_tax');
    expect(officialCheckForTemplate('tpl_oil')).toBeNull();
    expect(officialCheckForTemplate(null)).toBeNull();
  });

  it('la data nel campo e gg/mm/aaaa', () => {
    expect(toFieldDate('2021-03-05')).toBe('05/03/2021');
    expect(toFieldDate(null)).toBe('');
  });
});
