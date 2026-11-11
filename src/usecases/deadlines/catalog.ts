// Catalogo proposto dal wizard "Imposta le scadenze" (SPEC 6.3.3, 7.1): le 27 voci con compatibilita', preselezione e
// domanda da porre. Sola lettura: non scrive nulla.
import type { LocalDate } from '@/domain/dates';
import { inspectionDue, roadTaxNextDue, roadTaxRegionForProvince } from '@/domain/italy';
import type { ItemCategory, ScheduleType } from '@/domain/maintenance';
import { templateApplies } from './applicability';
import type { VehicleTag } from './applicability';
import { ok, fail } from '../context';
import type { Deps, UsecaseResult } from '../context';
import { parseOffsets } from './internal';
import { TEMPLATE_COLUMNS, loadSetupVehicle, nextAnchorOn, parseAppliesTo } from './templates';
import type { TemplateRow } from './templates';

/** Cosa chiedere all'utente per la voce. */
export type SetupQuestion =
  | 'last_done' // "Quando l'hai fatto l'ultima volta?" (data e km / non lo so / mai fatto)
  | 'inspection' // data dell'ultima revisione, oppure la prima immatricolazione se l'auto ha meno di 4 anni
  | 'road_tax' // mese di pagamento (con link al calcolo ACI)
  | 'next_due'; // prossima scadenza dal documento o dal cartellino (bombola, gomme)

export interface SetupProposal {
  templateId: string;
  name: string;
  category: ItemCategory;
  scheduleType: ScheduleType;
  intervalKm: number | null;
  intervalMonths: number | null;
  periodEnd: 'exact' | 'end_of_month';
  anchor: { month: number; day: number } | null;
  soonDays: number;
  soonKm: number;
  notifyOffsetsDays: number[];
  /** Nota del catalogo (in italiano), da mostrare sotto il nome. */
  note: string | null;
  /** Valori del catalogo indicativi: il libretto di uso e manutenzione prevale. */
  isIndicative: boolean;
  /** Compatibile con l'alimentazione del veicolo. */
  applies: boolean;
  /** Attiva di default E compatibile: pre-selezionata nel wizard. */
  preselected: boolean;
  question: SetupQuestion;
  /** Se la voce esiste gia' sul veicolo (non nel cestino): l'id della voce. */
  existingItemId: string | null;
  /** Data proposta (non scritta): revisione dall'immatricolazione, bollo dal mese di immatricolazione, ancora delle gomme. */
  suggestedDueOn: LocalDate | null;
  suggestionBasis: string | null;
}

export interface SetupCatalog {
  vehicleId: string;
  /** Tag derivati da powertrain e alimentazioni (mai salvati). */
  vehicleTags: VehicleTag[];
  proposals: SetupProposal[];
}

function questionFor(t: TemplateRow): SetupQuestion {
  if (t.id === 'tpl_inspection') return 'inspection';
  if (t.id === 'tpl_road_tax') return 'road_tax';
  return t.schedule_type === 'interval_last_done' ? 'last_done' : 'next_due';
}

/** Le voci del catalogo per il veicolo, nell'ordine del catalogo, con compatibilita' e voci gia' presenti. */
export async function listSetupCatalog(d: Deps, vehicleId: string): Promise<UsecaseResult<SetupCatalog>> {
  const vehicle = await loadSetupVehicle(d.db, vehicleId);
  if (!vehicle) return fail({ code: 'ITEM_NOT_FOUND' });
  const today = d.clock.todayLocal();
  const templates = await d.db.all<TemplateRow>(`SELECT ${TEMPLATE_COLUMNS} FROM service_templates ORDER BY sort_order, id`);
  const existing = await d.db.all<{ id: string; template_id: string }>(
    'SELECT id, template_id FROM maintenance_items WHERE vehicle_id = ? AND deleted_at IS NULL AND template_id IS NOT NULL ORDER BY created_at, id',
    [vehicleId],
  );
  const existingByTemplate = new Map<string, string>();
  for (const e of existing) if (!existingByTemplate.has(e.template_id)) existingByTemplate.set(e.template_id, e.id);

  const proposals = templates.map<SetupProposal>((t) => {
    const applies = templateApplies(parseAppliesTo(t.applies_to), vehicle.tags);
    let suggestedDueOn: LocalDate | null = null;
    let suggestionBasis: string | null = null;
    if (t.id === 'tpl_inspection' && vehicle.firstRegistrationOn) {
      const first = inspectionDue({ firstRegisteredOn: vehicle.firstRegistrationOn });
      if (first.dueOn !== null && first.dueOn >= today) {
        suggestedDueOn = first.dueOn;
        suggestionBasis = first.basis;
      }
    } else if (t.id === 'tpl_road_tax' && vehicle.firstRegistrationOn) {
      const res = roadTaxNextDue(today, { registeredOn: vehicle.firstRegistrationOn, region: roadTaxRegionForProvince('') });
      suggestedDueOn = res.dueOn;
      suggestionBasis = res.basis;
    } else if (t.anchor_month != null && t.anchor_day != null) {
      suggestedDueOn = nextAnchorOn(today, t.anchor_month, t.anchor_day);
      suggestionBasis = 'template_anchor';
    }
    return {
      templateId: t.id,
      name: t.name_it,
      category: t.category,
      scheduleType: t.schedule_type,
      intervalKm: t.interval_km,
      intervalMonths: t.interval_months,
      periodEnd: t.period_end,
      anchor: t.anchor_month != null && t.anchor_day != null ? { month: t.anchor_month, day: t.anchor_day } : null,
      soonDays: t.soon_days,
      soonKm: t.soon_km,
      notifyOffsetsDays: parseOffsets(t.notify_offsets_days),
      note: t.note_it,
      isIndicative: t.is_indicative === 1,
      applies,
      preselected: applies && t.default_enabled === 1,
      question: questionFor(t),
      existingItemId: existingByTemplate.get(t.id) ?? null,
      suggestedDueOn,
      suggestionBasis,
    };
  });
  return ok({ vehicleId, vehicleTags: vehicle.tags, proposals });
}
