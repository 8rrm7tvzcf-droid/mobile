// Tipi pubblici di interventi, tagliandi, cambio olio e officine (SPEC 3.3 F-35..F-38, 6.3.6).
// Importi in centesimi interi, quantita' in millesimi, date 'YYYY-MM-DD', istanti ISO UTC (SPEC 8.1).
import type { OdometerConflictError } from '../odometer';
import type { LocalDate } from '@/domain/ports';
import type { ReasonCode, ReminderState } from '@/domain/maintenance';

// ---------------------------------------------------------------- vocabolari (coincidono con i CHECK di 0001_init)

/** `service_records.kind`. I "chip" di S-20 sono preimpostazioni di questi valori: vedi `SERVICE_PRESETS`. */
export const SERVICE_KINDS = ['scheduled', 'repair', 'inspection', 'tyres', 'bodywork', 'accessories', 'diagnostic', 'other'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

export const SERVICE_KIND_LABELS: Record<ServiceKind, string> = {
  scheduled: 'Tagliando',
  repair: 'Riparazione',
  inspection: 'Revisione',
  tyres: 'Gomme',
  bodywork: 'Carrozzeria',
  accessories: 'Accessori',
  diagnostic: 'Diagnosi',
  other: 'Altro intervento',
};

/** `service_lines.line_type`. */
export const LINE_TYPES = ['labor', 'part', 'fluid', 'fee', 'other'] as const;
export type ServiceLineType = (typeof LINE_TYPES)[number];

export const LINE_TYPE_LABELS: Record<ServiceLineType, string> = {
  labor: 'Manodopera',
  part: 'Ricambio',
  fluid: 'Fluido',
  fee: 'Diritti e tasse',
  other: 'Altro',
};

/** `service_lines.fluid_kind` (solo per le righe `fluid`). */
export const FLUID_KINDS = ['engine_oil', 'coolant', 'brake_fluid', 'washer', 'adblue', 'gearbox_oil', 'power_steering', 'other'] as const;
export type ServiceFluidKind = (typeof FLUID_KINDS)[number];

/** `service_records.inspection_result` (solo per `kind = 'inspection'`, M-3): regolare, da ripetere, sospesa. */
export const INSPECTION_RESULTS = ['regular', 'repeat', 'suspended'] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

export const INSPECTION_RESULT_LABELS: Record<InspectionResult, string> = {
  regular: 'Regolare',
  repeat: 'Da ripetere',
  suspended: 'Sospesa',
};

/** Come si comporta l'inserimento di km incoerenti con le letture vicine (SPEC 6.3.6 punto 5). */
export type KmConflictChoice =
  /** "Correggi": errore `ODO_NON_MONOTONIC` con i dettagli (`isOdometerConflict`), non si scrive nulla. */
  | 'fail'
  /** "Salva senza aggiornare i km": l'intervento si salva senza toccare il registro dei km. */
  | 'skip_km'
  /** "E' un errore della lettura precedente": le letture in conflitto vengono messe da parte (`ignored`). */
  | 'ignore_conflicting';

// ---------------------------------------------------------------- input

export interface ServiceLineInput {
  lineType: ServiceLineType;
  description: string;
  /** Millesimi di unita' (litri, pezzi, ore): default 1000. */
  quantityMilli?: number;
  /** Prezzo unitario in centesimi (facoltativo). */
  unitPriceCents?: number | null;
  /** Importo della riga in centesimi. Se manca: quantita' x prezzo unitario, altrimenti 0. */
  amountCents?: number | null;
  partCode?: string | null;
  brand?: string | null;
  /** Specifica (es. '5W-30 ACEA C3'). */
  spec?: string | null;
  /** Solo per `lineType: 'fluid'`. */
  fluidKind?: ServiceFluidKind | null;
  warrantyMonths?: number | null;
  /** "Cosa hai fatto?": le voci di manutenzione (`maintenance_items.id`) che questa riga completa. */
  completesItemIds?: readonly string[];
}

/** Campi aggiuntivi del cambio olio (F-37): diventano la riga dell'olio (con specifica e litri) e quella del filtro. */
export interface OilChangeInput {
  /** Specifica, es. '5W-30 ACEA C3'. */
  spec?: string | null;
  /** Quantita' di olio in millesimi di litro (4,5 L = 4500). */
  quantityMilli?: number | null;
  brand?: string | null;
  /** Filtro olio sostituito: aggiunge la riga "Filtro olio". */
  filterReplaced?: boolean;
  filterPartCode?: string | null;
  oilAmountCents?: number | null;
  filterAmountCents?: number | null;
}

export interface WorkshopInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  notes?: string | null;
  isFavorite?: boolean;
}

/** I campi di un intervento (S-20). */
export interface ServiceRecordFields {
  serviceOn: LocalDate;
  kind: ServiceKind;
  /** Default: l'etichetta del tipo ("Tagliando", "Revisione"...). */
  title?: string | null;
  /** Km all'intervento: creano/aggiornano la lettura collegata (stessa coerenza monotona del registro km). */
  km?: number | null;
  workshopId?: string | null;
  /** Totale pagato lordo in centesimi. Alla creazione, se manca, e' la somma delle righe. */
  totalCents?: number | null;
  invoiceNumber?: string | null;
  paidOn?: LocalDate | null;
  warrantyUntilOn?: LocalDate | null;
  /** Obbligatorio per `kind: 'inspection'`, vietato per gli altri. */
  inspectionResult?: InspectionResult | null;
  notes?: string | null;
  lines?: readonly ServiceLineInput[];
  oilChange?: OilChangeInput | null;
}

export interface AddServiceRecordInput extends ServiceRecordFields {
  vehicleId: string;
  /** Officina nuova da creare nella stessa transazione (alternativa a `workshopId`). */
  newWorkshop?: WorkshopInput | null;
  /**
   * "Cosa hai fatto?": le voci da segnare "fatte" con data e km REALI dell'intervento. Si uniscono a quelle indicate
   * riga per riga (`lines[].completesItemIds`). `'suggested'` = le voci pre-selezionate da `suggestItemsForLines`.
   * Default: nessuna (si puo' scegliere dopo con `setServiceCompletions`).
   */
  completeItemIds?: readonly string[] | 'suggested';
  /** Default `'fail'`. */
  onOdometerConflict?: KmConflictChoice;
}

/** Modifica parziale: un campo `undefined` resta com'e'; `null` svuota (dove ammesso). */
export interface UpdateServiceRecordPatch extends Partial<ServiceRecordFields> {
  newWorkshop?: WorkshopInput | null;
  /** Se presente sostituisce l'insieme delle voci completate (`[]` = nessuna); se assente restano, ricalcolate sui valori nuovi. */
  completeItemIds?: readonly string[] | 'suggested';
  onOdometerConflict?: KmConflictChoice;
}

export interface ServiceFilters {
  kinds?: readonly ServiceKind[];
  /** Estremi inclusi, 'YYYY-MM-DD'. */
  from?: LocalDate | null;
  to?: LocalDate | null;
  workshopId?: string | null;
  /** Cerca in titolo, note, numero fattura e descrizione delle righe (senza distinguere maiuscole). */
  text?: string | null;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------- output

export type ServiceWarningCode = 'KM_IMPLAUSIBLE' | 'KM_VERY_HIGH' | 'TOTAL_MISMATCH' | 'DUPLICATE_COMPLETION' | 'ITEM_SKIPPED';

/** Avviso non bloccante da mostrare dopo il salvataggio. */
export interface ServiceWarning {
  code: ServiceWarningCode;
  message: string;
}

export type LineCategory =
  | 'engine_oil'
  | 'oil_filter'
  | 'air_filter'
  | 'cabin_filter'
  | 'fuel_filter'
  | 'spark_plugs'
  | 'timing_belt'
  | 'brake_fluid'
  | 'brakes'
  | 'coolant'
  | 'gearbox_oil'
  | 'battery'
  | 'battery_check'
  | 'wipers'
  | 'air_conditioning'
  | 'tyre_rotation'
  | 'tyres_winter'
  | 'tyres_summer'
  | 'gas_system'
  | 'gas_cylinder';

export interface ServiceLine {
  id: string;
  position: number;
  lineType: ServiceLineType;
  description: string;
  quantityMilli: number;
  unitPriceCents: number | null;
  amountCents: number;
  partCode: string | null;
  brand: string | null;
  spec: string | null;
  fluidKind: ServiceFluidKind | null;
  warrantyMonths: number | null;
  /** Categoria dedotta da tipo, fluido e descrizione (non e' salvata): guida i suggerimenti. */
  category: LineCategory | null;
}

export interface WorkshopRef {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
}

/** Una voce di manutenzione completata dall'intervento. */
export interface ServiceCompletionInfo {
  completionId: string;
  itemId: string;
  itemName: string;
  templateId: string | null;
  doneOn: LocalDate;
  doneKm: number | null;
  /** Creato da questa operazione (false: gia' esisteva e non e' cambiato). */
  isNew: boolean;
  /** Stato della voce dopo il completamento (il prossimo parte dai valori REALI). */
  next: { state: ReminderState; effectiveDueOn: LocalDate | null; reasons: ReasonCode[] } | null;
  /** "Prossimo cambio olio: tra 15.000 km o il 07/10/2027, il primo dei due." (null se non calcolabile). */
  nextText: string | null;
}

export interface OilChangeDetail {
  spec: string | null;
  /** Millesimi di litro. */
  quantityMilli: number;
  filterReplaced: boolean;
}

export interface ServiceRecordSummary {
  id: string;
  vehicleId: string;
  serviceOn: LocalDate;
  kind: ServiceKind;
  kindLabel: string;
  title: string;
  workshopId: string | null;
  workshopName: string | null;
  totalCents: number;
  km: number | null;
  lineCount: number;
  /** Ha una riga di olio motore (cambio olio). */
  hasOil: boolean;
  inspectionResult: InspectionResult | null;
  invoiceNumber: string | null;
  notes: string | null;
  /** Nomi delle voci di manutenzione completate. */
  completedItemNames: string[];
}

export interface ServiceRecordDetail {
  id: string;
  vehicleId: string;
  serviceOn: LocalDate;
  kind: ServiceKind;
  kindLabel: string;
  title: string;
  workshop: WorkshopRef | null;
  totalCents: number;
  /** Somma degli importi delle righe (puo' differire dal totale: IVA, sconti). */
  linesTotalCents: number;
  invoiceNumber: string | null;
  paidOn: LocalDate | null;
  warrantyUntilOn: LocalDate | null;
  inspectionResult: InspectionResult | null;
  /** Testo informativo per la revisione "da ripetere" o "sospesa" (nessuna dichiarazione su dove si possa circolare). */
  inspectionNotice: string | null;
  notes: string | null;
  /** Km dell'intervento (dalla lettura collegata). */
  km: number | null;
  odometerReadingId: string | null;
  lines: ServiceLine[];
  oilChange: OilChangeDetail | null;
  completions: ServiceCompletionInfo[];
  createdAt: string;
  updatedAt: string;
  /** Valorizzato solo se l'intervento e' nel cestino. */
  deletedAt: string | null;
}

export interface AddServiceRecordResult {
  record: ServiceRecordDetail;
  completions: ServiceCompletionInfo[];
  odometerReadingId: string | null;
  /** I km erano in conflitto e sono stati ignorati (`onOdometerConflict: 'skip_km'`). */
  kmIgnored: boolean;
  /** Letture messe da parte con `ignore_conflicting`. */
  ignoredReadingIds: string[];
  warnings: ServiceWarning[];
  /** Promemoria "Rifare la revisione" creato per l'esito "da ripetere". */
  repeatReminderId: string | null;
}

export type UpdateServiceRecordResult = AddServiceRecordResult;

export interface SetServiceCompletionsResult {
  completions: ServiceCompletionInfo[];
  removedCompletionIds: string[];
  warnings: ServiceWarning[];
}

export interface DeleteServiceRecordResult {
  /** Completamenti annullati (soft delete) insieme all'intervento. */
  removedCompletionIds: string[];
  /** Promemoria riaperti dall'annullamento. */
  reopenedReminderIds: string[];
  /** Lettura km collegata messa nel cestino. */
  removedReadingId: string | null;
}

export interface RestoreServiceRecordResult {
  record: ServiceRecordDetail;
  completions: ServiceCompletionInfo[];
  restoredReadingId: string | null;
  kmIgnored: boolean;
  /** Voci non ricompletate perche' nel frattempo eliminate o disattivate. */
  skippedItemIds: string[];
  warnings: ServiceWarning[];
}

export interface ServiceItemSuggestion {
  itemId: string;
  name: string;
  templateId: string | null;
  category: string;
  /** Le righe / il tipo dell'intervento indicano questa voce. */
  matched: boolean;
  /** Da pre-selezionare in S-21: `matched` e non gia' completata lo stesso giorno. */
  preselected: boolean;
  /** Perche' e' proposta ("Riga «Filtro olio»", "Tagliando"), o perche' non e' pre-selezionata. */
  reason: string | null;
  /** La voce risulta gia' completata in questa data da un altro intervento o da un "Fatto": niente doppione. */
  alreadyDoneOn: LocalDate | null;
}

export interface SuggestItemsOptions {
  kind?: ServiceKind;
  title?: string | null;
  inspectionResult?: InspectionResult | null;
  /** Campi del cambio olio: contano come righe di olio e di filtro. */
  oilChange?: OilChangeInput | null;
  /** Data dell'intervento: serve a segnalare le voci gia' completate quel giorno. */
  serviceOn?: LocalDate | null;
  /** Intervento che si sta modificando: i suoi completamenti non contano come "gia' fatti". */
  excludeRecordId?: string | null;
}

export interface LastDoneSuggestion {
  templateId: string;
  doneOn: LocalDate;
  /** Km dell'intervento piu' recente che ha fatto quella voce (null se l'intervento non ha km). */
  doneKm: number | null;
  serviceRecordId: string;
  serviceTitle: string;
}

export interface Workshop {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  isFavorite: boolean;
  /** Interventi (non nel cestino) fatti in questa officina. */
  serviceCount: number;
  lastServiceOn: LocalDate | null;
  totalSpentCents: number;
}

export interface UpsertWorkshopInput extends Partial<WorkshopInput> {
  /** Se presente si modifica quell'officina; altrimenti si crea (o si riusa quella con lo stesso nome). */
  id?: string;
}

export interface ListWorkshopsOptions {
  /** Cerca nel nome e nella citta'. */
  search?: string | null;
  /** Default 'recent': preferite, poi usate di recente, poi per nome. */
  order?: 'recent' | 'name';
}

export type { OdometerConflictError };
