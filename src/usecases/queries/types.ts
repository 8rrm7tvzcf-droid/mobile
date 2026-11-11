// View model per la UI (SPEC 6.3.4, F-13, F-24): tipi delle letture. Nessun colore hex: solo nomi logici di token.
// Lo STATO delle scadenze non si salva mai: si calcola da `oggi`, dai km e dalla cache dei promemoria (data.md 3.5).
import type { LocalDate } from '@/domain/dates';
import type { DueTrigger, RateConfidence, ReasonCode, ReminderState, ScheduleType, PeriodEnd } from '@/domain/maintenance';
import type { ReminderCategory } from '@/domain/reminders';
import type { PermissionState } from '@/domain/ports';
import type { DistanceUnit } from '@/domain/units';

/** Token di colore logico (mai solo colore: ogni riga ha anche `icon` e `label`). */
export type DeadlineTone = 'danger' | 'warning' | 'ok' | 'unknown';
/** Icona logica: la UI la mappa su un'icona vera. */
export type DeadlineIcon = 'alert' | 'clock' | 'check' | 'help';

/** Gruppo di lista = stato del motore. "Scade oggi" sta in `soon` ma ha tono `danger` (SPEC 6.3.4, nota di implementazione). */
export type DeadlineGroup = ReminderState;

/** Da dove viene la scadenza. */
export type DeadlineOrigin = 'rule' | 'manual' | 'policy' | 'installment';

export interface LegalSource {
  label: string;
  url: string;
}

/** Fonte e avvertenza per le voci di legge (SPEC 7: promemoria informativi, non consulenza legale). */
export interface LegalInfo {
  warning: string;
  sources: LegalSource[];
  /** Id della regola italiana codificata (es. 'it.inspection.next'), se nota. */
  ruleId: string | null;
  verifiedOn: LocalDate | null;
  confidence: 'official' | 'practice' | 'indicative' | null;
}

export interface DeadlineReason {
  code: ReasonCode;
  /** Cosa chiedere all'utente, in italiano. */
  message: string;
}

/** Una riga di lista: un promemoria aperto oppure una voce senza occorrenza aperta (stato calcolato dalla regola). */
export interface DeadlineRow {
  /** Id del promemoria (kind 'reminder') o della voce (kind 'item', nessuna occorrenza aperta). */
  id: string;
  kind: 'reminder' | 'item';
  reminderId: string | null;
  itemId: string | null;
  policyId: string | null;
  paymentId: string | null;
  templateId: string | null;
  vehicleId: string;
  vehicleLabel: string;
  title: string;
  category: ReminderCategory;
  categoryLabel: string;
  origin: DeadlineOrigin;

  /** Stato del motore: ok / soon / overdue / unknown. */
  state: ReminderState;
  group: DeadlineGroup;
  /** 'danger' | 'warning' | 'ok' | 'unknown' (token). "Scade oggi" e' `danger`. */
  tone: DeadlineTone;
  icon: DeadlineIcon;
  /** Etichetta di stato ("In regola", "In arrivo", "Scade oggi", "Scaduto", "Probabilmente scaduto", "Da configurare"). */
  label: string;
  /** Dettaglio che segue l'etichetta: "scade il 30/11/2026 (tra 14 giorni)", "tra circa 900 km (stima)", "da 3 giorni". */
  text: string;
  /** Seconda riga facoltativa: "oppure tra 1.200 km", "circa il 12/12/2026". */
  secondaryText: string | null;
  /** `${label} · ${text}`. */
  summary: string;

  dueOn: LocalDate | null;
  dueKm: number | null;
  forecastOn: LocalDate | null;
  effectiveDueOn: LocalDate | null;
  trigger: DueTrigger | null;
  /** Vero se vince la previsione dei km: la UI scrive "circa" / "stima". */
  estimated: boolean;
  kmReached: boolean;
  dueToday: boolean;
  /** Negativo = scaduto da N giorni. */
  daysLeft: number | null;
  kmLeft: number | null;
  currentKm: number | null;
  forecastConfidence: RateConfidence | null;
  reasons: DeadlineReason[];

  snoozed: boolean;
  /** Fine dello snooze (istante UTC) se il promemoria e' rimandato. */
  snoozedUntil: string | null;
  dueTime: string | null;
  repeat: { every: number; unit: 'day' | 'week' | 'month' | 'year' } | null;

  /** Presente per le voci di legge (e la RCA): fonte e avvertenza. */
  legal: LegalInfo | null;
}

export interface StateCounts {
  overdue: number;
  soon: number;
  ok: number;
  unknown: number;
  total: number;
}

export interface DeadlineGroups {
  overdue: DeadlineRow[];
  soon: DeadlineRow[];
  ok: DeadlineRow[];
  unknown: DeadlineRow[];
}

/** Semaforo di una categoria: lo stato e' il PEGGIORE tra le sue voci. */
export interface CategorySummary {
  category: ReminderCategory;
  label: string;
  tone: DeadlineTone;
  icon: DeadlineIcon;
  counts: StateCounts;
}

export interface VehicleSummary {
  id: string;
  /** Soprannome, altrimenti "Marca Modello". */
  label: string;
  plate: string | null;
  make: string;
  model: string;
  status: string;
  isDemo: boolean;
  distanceUnit: DistanceUnit;
  currentKm: number | null;
  /** "12.345 km" oppure null se manca la lettura. */
  currentKmText: string | null;
  lastReadingOn: LocalDate | null;
  tone: DeadlineTone;
  icon: DeadlineIcon;
  counts: StateCounts;
  /** La voce piu' urgente dell'auto (scadute per prime). */
  next: DeadlineRow | null;
}

export type BannerKind = 'notifications' | 'update-km' | 'backup';

export type BannerActionId =
  | 'enable-notifications'
  | 'retry-notifications'
  | 'open-system-settings'
  | 'open-notification-settings'
  | 'update-odometer'
  | 'open-backup';

export interface DashboardBanner {
  kind: BannerKind;
  tone: 'warning' | 'info';
  title: string;
  message: string;
  action: { id: BannerActionId; label: string };
  /** Per 'update-km': l'auto a cui riferirsi. */
  vehicleId?: string;
}

export interface NotificationStatus {
  /** Impostazione `notify.enabled`. */
  enabled: boolean;
  /** 'unknown' se il chiamante non ha passato lo scheduler (dipendenze senza `scheduler`). */
  permission: PermissionState | 'unknown';
  /** Vero se gli avvisi sono attivi (impostazione acceso e permesso concesso). */
  active: boolean;
}

export interface Dashboard {
  today: LocalDate;
  /** Auto attive (tutte, anche con filtro: il selettore le mostra sempre). */
  vehicles: VehicleSummary[];
  hasVehicles: boolean;
  /** Il selettore d'auto compare solo con piu' di un veicolo. */
  showVehicleSelector: boolean;
  /** Filtro applicato ("Tutte le auto" = null). */
  vehicleId: string | null;
  /** Scheda "Prossima scadenza": la voce piu' urgente (scadute per prime, poi per data effettiva). */
  next: DeadlineRow | null;
  categories: CategorySummary[];
  /** Tutte le scadenze, ordinate per urgenza e raggruppate per stato. */
  groups: DeadlineGroups;
  counts: StateCounts;
  /** "Da fare": fino a 50 promemoria aperti non rimandati (scadute, poi in arrivo, poi per data). */
  todo: DeadlineRow[];
  /** Al massimo due, in quest'ordine: avvisi spenti, aggiorna i km, backup. */
  banners: DashboardBanner[];
  notifications: NotificationStatus;
  /** Stato vuoto con azione: nessuna auto, oppure auto senza scadenze. */
  emptyState: 'no-vehicles' | 'no-deadlines' | null;
}

export interface VehicleDeadlines {
  vehicle: VehicleSummary;
  /** Tutte le righe ordinate per urgenza. */
  rows: DeadlineRow[];
  groups: DeadlineGroups;
  counts: StateCounts;
}

export interface RuleDescription {
  scheduleType: ScheduleType;
  intervalKm: number | null;
  intervalMonths: number | null;
  periodEnd: PeriodEnd | null;
  fixedDueOn: LocalDate | null;
  soonDays: number;
  soonKm: number;
  notifyOffsetsDays: number[];
  notifyEnabled: boolean;
  /** "Ogni 15.000 km o 12 mesi (il primo dei due)". */
  text: string;
}

export interface CompletionEntry {
  id: string;
  doneOn: LocalDate;
  doneKm: number | null;
  source: 'service' | 'check' | 'manual' | 'import';
  notes: string | null;
}

export interface DeadlineDetail {
  row: DeadlineRow;
  /** Regola di calcolo (solo per le voci generate da una regola). */
  rule: RuleDescription | null;
  /** Base di calcolo: da dove parte la scadenza ("Ultimo intervento il 01/03/2026 a 12.000 km"). */
  basis: {
    source: 'completion' | 'baseline' | 'fixed' | 'manual' | 'policy' | 'none';
    lastDoneOn: LocalDate | null;
    lastDoneKm: number | null;
    text: string;
  };
  /** Previsione dei km (media km/giorno), se la scadenza ha una componente a km. */
  forecast: { kmPerDay: number; confidence: RateConfidence; text: string } | null;
  /** Storico dei completamenti, dal piu' recente (max 20). */
  history: CompletionEntry[];
  notes: string | null;
  notifyOffsetsDays: number[];
}

export type TimelineKind =
  | 'odometer'
  | 'deadline'
  | 'completion'
  | 'service'
  | 'fuel'
  | 'expense'
  | 'fluid'
  | 'policy'
  | 'installment';

/** Icona logica della voce: la UI la mappa su un'icona vera. */
export type TimelineIcon = DeadlineIcon | 'gauge' | 'done' | 'service' | 'fuel' | 'expense' | 'fluid' | 'policy' | 'payment';

export interface TimelineEntry {
  /** Id della riga sorgente (lettura km, promemoria, completamento, intervento, rifornimento, spesa, controllo, polizza o rata). */
  id: string;
  kind: TimelineKind;
  date: LocalDate;
  title: string;
  text: string;
  /** Le scadenze aperte portano il loro tono; le altre voci sono 'neutral'/'ok'. */
  tone: DeadlineTone | 'neutral';
  icon: TimelineIcon;
  /** Vero per le scadenze ancora aperte (la UI le separa dallo storico). */
  upcoming: boolean;
  /** Letture km marcate `ignored`. */
  ignored: boolean;
  /** Importo in centesimi se la voce e' un costo (intervento, rifornimento, spesa, rata pagata); `null` altrimenti. */
  amountCents: number | null;
  /** Km collegati alla voce; `null` se non ci sono. */
  km: number | null;
  /** «45.200 km» (o miglia secondo l'auto), pronto da mostrare; `null` senza km. */
  kmText: string | null;
}

export interface TimelineOptions {
  limit?: number;
  /** Solo questi tipi di voce (vuoto o omesso = tutti). */
  kinds?: readonly TimelineKind[];
  /** Estremi inclusi, 'YYYY-MM-DD'; omessi = nessun limite. */
  from?: LocalDate | null;
  to?: LocalDate | null;
}

export interface Timeline {
  vehicleId: string;
  entries: TimelineEntry[];
}
