// Schermata "Date dei documenti": immatricolazione, revisione, bollo e assicurazione RC in un colpo solo.
// Pura (niente React Native): trasforma cio' che l'utente ha scritto in tre scritture indipendenti
// (modifica auto, voci di scadenza dal catalogo, polizza RC) con messaggi d'errore in italiano.
// Non inventa mai date: cio' che resta vuoto resta vuoto (la voce e' "Da configurare" o non nasce).
import type { LocalDate } from '@/domain/dates';
import { SOURCES } from '@/domain/italy';
import { parseDateIt } from '@/domain/units';
import type { SetupDeadlinesInput, SetupProposal } from '@/usecases/deadlines';
import type { AddPolicyInput } from '@/usecases/insurance';
import type { UpdateVehicleInput } from '@/usecases/vehicles';
import { it } from '../i18n/it';
import { buildAddPolicyInput, initialPolicyForm } from './policyForm';
import { buildSetupInput, emptyAnswer, type WizardState } from './setupWizard';

export const INSPECTION_TEMPLATE_ID = 'tpl_inspection';
export const ROAD_TAX_TEMPLATE_ID = 'tpl_road_tax';

export interface DocumentDatesValues {
  /** gg/mm/aaaa */
  firstRegistration: string;
  lastInspectionOn: string;
  inspectionNextOn: string;
  /** Mese in cui si paga il bollo, 1-12. */
  paymentMonth: number | null;
  policyCompany: string;
  policyStartOn: string;
  policyEndOn: string;
}

export type DocumentDatesErrors = Partial<Record<keyof DocumentDatesValues | 'form', string>>;

export interface DocumentDatesContext {
  vehicleId: string;
  today: LocalDate;
  /** Immatricolazione gia' registrata sull'auto (null se manca). */
  firstRegistrationOn: LocalDate | null;
  proposals: readonly SetupProposal[];
  /** C'e' gia' una polizza RC auto corrente. */
  hasRca: boolean;
}

export interface DocumentDatesSections {
  /** La proposta del catalogo da creare, o null se la voce c'e' gia' (o non vale per l'auto). */
  inspection: SetupProposal | null;
  roadTax: SetupProposal | null;
  /** Mostra i campi della polizza RC (false se ce n'e' gia' una). */
  policy: boolean;
  inspectionExists: boolean;
  roadTaxExists: boolean;
}

export interface DocumentDatesPlan {
  vehiclePatch: UpdateVehicleInput | null;
  setup: SetupDeadlinesInput | null;
  policy: AddPolicyInput | null;
}

export type DocumentDatesBuild = { ok: true; plan: DocumentDatesPlan } | { ok: false; errors: DocumentDatesErrors };

/** 'YYYY-MM-DD' -> 'gg/mm/aaaa' per riempire un campo di testo. */
export function toFieldDate(ymd: LocalDate | null): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}

export function emptyDocumentDates(firstRegistrationOn: LocalDate | null): DocumentDatesValues {
  return {
    firstRegistration: toFieldDate(firstRegistrationOn),
    lastInspectionOn: '',
    inspectionNextOn: '',
    paymentMonth: null,
    policyCompany: '',
    policyStartOn: '',
    policyEndOn: '',
  };
}

const find = (proposals: readonly SetupProposal[], id: string): SetupProposal | undefined => proposals.find((p) => p.templateId === id);

/** Quali blocchi mostrare: solo cio' che manca e che vale per l'auto. */
export function documentDatesSections(ctx: Pick<DocumentDatesContext, 'proposals' | 'hasRca'>): DocumentDatesSections {
  const inspection = find(ctx.proposals, INSPECTION_TEMPLATE_ID);
  const roadTax = find(ctx.proposals, ROAD_TAX_TEMPLATE_ID);
  const open = (p: SetupProposal | undefined): SetupProposal | null => (p && p.applies && p.existingItemId === null ? p : null);
  return {
    inspection: open(inspection),
    roadTax: open(roadTax),
    policy: !ctx.hasRca,
    inspectionExists: Boolean(inspection && inspection.existingItemId !== null),
    roadTaxExists: Boolean(roadTax && roadTax.existingItemId !== null),
  };
}

const filled = (s: string): boolean => s.trim() !== '';

/**
 * Legge i campi e prepara le scritture. Regole:
 *  - immatricolazione: non nel futuro; se cambia, modifica l'auto (prima di tutto: le scadenze la usano);
 *  - revisione e bollo nascono se l'utente ha scritto qualcosa O se l'immatricolazione e' nota (da li' si calcolano);
 *  - assicurazione: nasce solo se l'utente scrive compagnia, decorrenza e scadenza (tutte e tre, come sul certificato).
 */
export function buildDocumentDates(ctx: DocumentDatesContext, v: DocumentDatesValues): DocumentDatesBuild {
  const errors: DocumentDatesErrors = {};
  const sections = documentDatesSections(ctx);

  // 1. Immatricolazione
  let registeredOn: LocalDate | null = ctx.firstRegistrationOn;
  let vehiclePatch: UpdateVehicleInput | null = null;
  if (filled(v.firstRegistration)) {
    const parsed = parseDateIt(v.firstRegistration);
    if (parsed === null) errors.firstRegistration = it.common.dateExample;
    else if (parsed > ctx.today) errors.firstRegistration = it.common.futureDate;
    else {
      registeredOn = parsed;
      if (parsed !== ctx.firstRegistrationOn) vehiclePatch = { firstRegistrationOn: parsed };
    }
  }

  // 2. Revisione e bollo (stessa strada del wizard: stessi controlli, stessi calcoli)
  let setup: SetupDeadlinesInput | null = null;
  const chosen: SetupProposal[] = [];
  const state: WizardState = {};
  const known = registeredOn !== null;
  if (sections.inspection) {
    const wrote = filled(v.lastInspectionOn) || filled(v.inspectionNextOn);
    if (wrote || known) {
      chosen.push(sections.inspection);
      state[INSPECTION_TEMPLATE_ID] = { ...emptyAnswer(true), lastInspectionOn: v.lastInspectionOn, nextDueOn: v.inspectionNextOn };
    }
  }
  if (sections.roadTax) {
    const wrote = v.paymentMonth !== null;
    if (wrote || known) {
      chosen.push(sections.roadTax);
      state[ROAD_TAX_TEMPLATE_ID] = { ...emptyAnswer(true), paymentMonth: v.paymentMonth };
    }
  }
  if (chosen.length > 0) {
    const built = buildSetupInput(ctx.vehicleId, chosen, state, { today: ctx.today, unit: 'km' });
    if (!built.ok) {
      const insp = built.errors[INSPECTION_TEMPLATE_ID];
      if (insp?.lastInspectionOn) errors.lastInspectionOn = insp.lastInspectionOn;
      if (insp?.nextDueOn) errors.inspectionNextOn = insp.nextDueOn;
    } else if (built.input.items.length > 0) {
      setup = built.input;
    }
  }

  // 3. Assicurazione RC auto
  let policy: AddPolicyInput | null = null;
  if (sections.policy && (filled(v.policyCompany) || filled(v.policyStartOn) || filled(v.policyEndOn))) {
    if (!filled(v.policyCompany)) errors.policyCompany = it.policy.companyRequired;
    if (!filled(v.policyStartOn)) errors.policyStartOn = it.documentDates.policyStartRequired;
    if (!filled(v.policyEndOn)) errors.policyEndOn = it.documentDates.policyEndRequired;
    if (!errors.policyCompany && !errors.policyStartOn && !errors.policyEndOn) {
      const built = buildAddPolicyInput(ctx.vehicleId, {
        ...initialPolicyForm(ctx.today, 'rca'),
        company: v.policyCompany,
        startOn: v.policyStartOn,
        endOn: v.policyEndOn,
      });
      if (built.ok) policy = built.input;
      else {
        if (built.errors.company) errors.policyCompany = built.errors.company;
        if (built.errors.startOn) errors.policyStartOn = built.errors.startOn;
        if (built.errors.endOn) errors.policyEndOn = built.errors.endOn;
        if (built.errors.form) errors.form = built.errors.form;
      }
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (vehiclePatch === null && setup === null && policy === null) return { ok: false, errors: { form: it.documentDates.nothingToSave } };
  return { ok: true, plan: { vehiclePatch, setup, policy } };
}

// ---------------------------------------------------------------- siti ufficiali (F-21, F-22)

export interface OfficialCheck {
  id: 'inspection' | 'road_tax';
  title: string;
  subtitle: string;
  url: string;
}

/**
 * Pagine ufficiali dove l'utente controlla da se' revisione e bollo. L'app non invia nulla (nemmeno la targa): apre la pagina
 * e l'utente riporta la data. Gli indirizzi sono quelli verificati delle regole (domain/italy/sources.ts).
 */
export const OFFICIAL_CHECKS: Readonly<Record<OfficialCheck['id'], OfficialCheck>> = {
  inspection: {
    id: 'inspection',
    title: it.documentDates.checkInspection,
    subtitle: it.documentDates.checkInspectionHint,
    url: SOURCES.portale_revisioni.url,
  },
  road_tax: {
    id: 'road_tax',
    title: it.documentDates.checkRoadTax,
    subtitle: it.documentDates.checkRoadTaxHint,
    url: SOURCES.aci_calcolo_bollo.url,
  },
};

/** Per la scheda della scadenza: il controllo ufficiale giusto per il modello di voce (revisione, bollo), se esiste. */
export function officialCheckForTemplate(templateId: string | null | undefined): OfficialCheck | null {
  if (templateId === INSPECTION_TEMPLATE_ID) return OFFICIAL_CHECKS.inspection;
  if (templateId === ROAD_TAX_TEMPLATE_ID) return OFFICIAL_CHECKS.road_tax;
  return null;
}
