// Parte PURA di reconcileReminders (data.md 3.9, SPEC 8.3): dato lo stato letto dal DB, calcola le modifiche da
// applicare ai promemoria. La scrittura (INSERT/UPDATE/soft delete, ULID, transazione) e' dei casi d'uso.
// Idempotente: applicando le modifiche e richiamando la funzione con il nuovo stato il risultato e' vuoto (I5).
import type { LocalDate } from '@/domain/dates';
import { evaluateRule, evaluateThresholds } from '@/domain/maintenance';
import type {
  DueTrigger,
  Evaluation,
  ItemCategory,
  LastDone,
  MaintenanceRule,
  OdometerPoint,
  RateConfidence,
  RateParams,
} from '@/domain/maintenance';
import type { ReminderCategory } from './types';

export const POLICY_NOTIFY_OFFSETS: readonly number[] = [30, 14, 7, 1, 0];
export const INSTALLMENT_NOTIFY_OFFSETS: readonly number[] = [7, 1, 0];
const POLICY_SOON_DAYS = 30;
const INSTALLMENT_SOON_DAYS = 7;

export type PolicyKind = 'rca' | 'kasko' | 'furto_incendio' | 'other';

export interface ReconcileVehicle {
  id: string;
  /** Solo i veicoli `active` generano promemoria (e notifiche). */
  status: string;
  annualKmEstimate?: number | null;
  firstRegistrationOn?: LocalDate | null;
}

/** Voce di manutenzione con il suo ultimo fatto gia' risolto (vedi `resolveLastDone`). */
export interface ReconcileItem {
  id: string;
  name: string;
  category: ItemCategory;
  rule: MaintenanceRule;
  lastDone: LastDone | null;
  notifyOffsetsDays: readonly number[];
  isActive: boolean;
}

export interface ReconcilePolicy {
  id: string;
  kind: PolicyKind;
  company: string;
  startOn: LocalDate;
  endOn: LocalDate;
  cancelledOn?: LocalDate | null;
}

export interface ReconcilePayment {
  id: string;
  policyId: string;
  installmentNo: number;
  dueOn: LocalDate;
  paidOn?: LocalDate | null;
}

/** Promemoria aperto (`status = 'open'`) del veicolo, cosi' come e' nel DB. */
export interface OpenReminder {
  id: string;
  origin: 'generated' | 'manual';
  itemId?: string | null;
  policyId?: string | null;
  paymentId?: string | null;
  title: string;
  category: ReminderCategory;
  dueOn: LocalDate | null;
  dueKm: number | null;
  forecastOn: LocalDate | null;
  forecastConfidence: RateConfidence | null;
  effectiveDueOn: LocalDate | null;
  dueTrigger: DueTrigger | null;
  soonDays: number;
  soonKm: number;
  notifyOffsetsDays: readonly number[];
}

/**
 * Promemoria gia' chiuso (`done` / `skipped`) per un ciclo: serve a non resuscitare un promemoria che l'utente ha
 * saltato (stessa origine e stessa scadenza). Dopo un completamento la base cambia, quindi la scadenza cambia
 * e il prossimo promemoria nasce normalmente.
 */
export interface ClosedCycle {
  itemId?: string | null;
  policyId?: string | null;
  paymentId?: string | null;
  dueOn: LocalDate | null;
  dueKm: number | null;
}

export interface ReconcileInput {
  today: LocalDate;
  /** Istante UTC con millisecondi da scrivere in `computed_at` (l'orologio e' un parametro). */
  computedAt: string;
  vehicle: ReconcileVehicle;
  items: readonly ReconcileItem[];
  odometer: readonly OdometerPoint[];
  policies?: readonly ReconcilePolicy[];
  payments?: readonly ReconcilePayment[];
  openReminders: readonly OpenReminder[];
  closedCycles?: readonly ClosedCycle[];
  rateParams?: Partial<RateParams>;
}

/** Campi di un promemoria generato che il motore possiede (colonne cache + descrittive). Mai `notes` o `snoozed_until`. */
export interface ReminderFields {
  title: string;
  category: ReminderCategory;
  dueOn: LocalDate | null;
  dueKm: number | null;
  forecastOn: LocalDate | null;
  forecastConfidence: RateConfidence | null;
  effectiveDueOn: LocalDate | null;
  dueTrigger: DueTrigger | null;
  soonDays: number;
  soonKm: number;
  notifyOffsetsDays: number[];
}

export interface NewReminder extends ReminderFields {
  origin: 'generated';
  itemId: string | null;
  policyId: string | null;
  paymentId: string | null;
  computedAt: string;
}

export interface ReminderUpdate {
  id: string;
  /** Solo i campi che cambiano. */
  patch: Partial<ReminderFields>;
  computedAt: string;
}

export type CloseReason = 'policy_renewed' | 'installment_paid';
export type RemoveReason =
  | 'item_missing_or_inactive'
  | 'item_unknown'
  | 'policy_missing'
  | 'policy_cancelled'
  | 'installment_missing'
  | 'duplicate'
  | 'closed_cycle'
  | 'no_source';

export interface ReminderClose {
  id: string;
  /** Il promemoria passa a `done` con questa `completed_on`. */
  completedOn: LocalDate;
  reason: CloseReason;
}

export interface ReminderRemoval {
  id: string;
  /** Soft delete: il promemoria generato non ha piu' ragione di esistere. */
  reason: RemoveReason;
}

export interface ReminderChanges {
  create: NewReminder[];
  update: ReminderUpdate[];
  close: ReminderClose[];
  remove: ReminderRemoval[];
}

export function isEmptyChanges(c: ReminderChanges): boolean {
  return c.create.length === 0 && c.update.length === 0 && c.close.length === 0 && c.remove.length === 0;
}

const KIND_LABEL: Record<PolicyKind, string> = {
  rca: 'RCA',
  kasko: 'Kasko',
  furto_incendio: 'Furto e incendio',
  other: 'assicurazione',
};

export function policyReminderTitle(p: Pick<ReconcilePolicy, 'kind' | 'company'>): string {
  return `Scadenza ${KIND_LABEL[p.kind]} ${p.company}`;
}

export function installmentReminderTitle(installmentNo: number, installmentCount: number): string {
  return `Rata ${installmentNo}/${installmentCount}`;
}

function sameArray(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function diffFields(current: OpenReminder, next: ReminderFields, keys: readonly (keyof ReminderFields)[]): Partial<ReminderFields> {
  const patch: Record<string, unknown> = {};
  for (const k of keys) {
    const a = current[k];
    const b = next[k];
    const same = Array.isArray(a) && Array.isArray(b) ? sameArray(a as number[], b as number[]) : a === b;
    if (!same) patch[k] = b;
  }
  return patch as Partial<ReminderFields>;
}

const GENERATED_KEYS: readonly (keyof ReminderFields)[] = [
  'title',
  'category',
  'dueOn',
  'dueKm',
  'forecastOn',
  'forecastConfidence',
  'effectiveDueOn',
  'dueTrigger',
  'soonDays',
  'soonKm',
  'notifyOffsetsDays',
];

/** Dei promemoria manuali il motore aggiorna SOLO la cache calcolata (I2). */
const MANUAL_KEYS: readonly (keyof ReminderFields)[] = ['forecastOn', 'forecastConfidence', 'effectiveDueOn', 'dueTrigger'];

function fieldsFromEvaluation(
  ev: Evaluation,
  base: Pick<ReminderFields, 'title' | 'category' | 'soonDays' | 'soonKm' | 'notifyOffsetsDays'>,
): ReminderFields {
  return {
    ...base,
    dueOn: ev.dueOn,
    dueKm: ev.dueKm,
    forecastOn: ev.forecastOn,
    forecastConfidence: ev.forecastConfidence,
    effectiveDueOn: ev.effectiveDueOn,
    dueTrigger: ev.trigger,
  };
}

function dateOnlyFields(
  dueOn: LocalDate,
  base: Pick<ReminderFields, 'title' | 'soonDays' | 'notifyOffsetsDays'>,
): ReminderFields {
  return {
    ...base,
    category: 'insurance',
    dueOn,
    dueKm: null,
    forecastOn: null,
    forecastConfidence: null,
    effectiveDueOn: dueOn,
    dueTrigger: 'time',
    soonKm: 0,
  };
}

/**
 * Calcola cosa cambiare nei promemoria di un veicolo (non scrive nulla):
 *
 * - voci attive: `evaluateRule`; senza scadenza ne' a tempo ne' a km (stato `unknown`) nessun promemoria; altrimenti
 *   un promemoria aperto per voce (crea se manca, aggiorna solo se cambia qualcosa);
 * - polizze: per ogni tipo, la polizza non annullata con `endOn` maggiore genera "Scadenza <tipo> <compagnia>";
 *   i promemoria delle polizze precedenti dello stesso tipo passano a `done` (rinnovate);
 * - rate: una per rata non pagata ("Rata n/N"); pagata -> `done`;
 * - promemoria manuali: aggiorna solo previsione, scadenza effettiva e trigger (se hanno `dueKm`);
 * - promemoria generati orfani (voce/polizza/rata sparita o disattivata), duplicati e promemoria aperti che coinciderebbero
 *   con un ciclo saltato -> rimozione (soft delete);
 * - veicolo non attivo: nessuna modifica (non genera e non notifica).
 */
export function planReminderChanges(input: ReconcileInput): ReminderChanges {
  const changes: ReminderChanges = { create: [], update: [], close: [], remove: [] };
  const { today, computedAt, vehicle } = input;
  if (vehicle.status !== 'active') return changes;

  const closedCycles = input.closedCycles ?? [];
  const policies = input.policies ?? [];
  const payments = input.payments ?? [];
  const profile = { annualKmEstimate: vehicle.annualKmEstimate, firstRegistrationOn: vehicle.firstRegistrationOn };

  // indice dei promemoria aperti per origine; I1: uno solo per voce/polizza/rata, gli eventuali doppioni si rimuovono
  const byItem = new Map<string, OpenReminder>();
  const byPolicy = new Map<string, OpenReminder>();
  const byPayment = new Map<string, OpenReminder>();
  const manual: OpenReminder[] = [];
  for (const r of input.openReminders) {
    if (r.origin === 'manual') {
      manual.push(r);
      continue;
    }
    const slot = r.itemId ? byItem : r.policyId ? byPolicy : r.paymentId ? byPayment : null;
    const key = r.itemId ?? r.policyId ?? r.paymentId ?? null;
    if (!slot || key == null) {
      changes.remove.push({ id: r.id, reason: 'no_source' });
    } else if (slot.has(key)) {
      changes.remove.push({ id: r.id, reason: 'duplicate' });
    } else {
      slot.set(key, r);
    }
  }

  const isClosed = (src: 'itemId' | 'policyId' | 'paymentId', id: string, dueOn: LocalDate | null, dueKm: number | null) =>
    closedCycles.some((c) => c[src] === id && c.dueOn === dueOn && c.dueKm === dueKm);

  const upsert = (
    existing: OpenReminder | undefined,
    fields: ReminderFields,
    source: Pick<NewReminder, 'itemId' | 'policyId' | 'paymentId'>,
    closedKey: ['itemId' | 'policyId' | 'paymentId', string],
  ) => {
    if (existing) {
      // un ciclo saltato non ha mai un promemoria aperto: se la voce torna sulla scadenza saltata (es. Salta + Fatto + Annulla)
      // il promemoria nato nel frattempo non va riportato a quella scadenza, va tolto
      if (isClosed(closedKey[0], closedKey[1], fields.dueOn, fields.dueKm)) {
        changes.remove.push({ id: existing.id, reason: 'closed_cycle' });
        return;
      }
      const patch = diffFields(existing, fields, GENERATED_KEYS);
      if (Object.keys(patch).length > 0) changes.update.push({ id: existing.id, patch, computedAt });
    } else if (!isClosed(closedKey[0], closedKey[1], fields.dueOn, fields.dueKm)) {
      changes.create.push({ ...fields, origin: 'generated', ...source, computedAt });
    }
  };

  // ---- voci di manutenzione
  const activeItems = new Map(input.items.filter((i) => i.isActive).map((i) => [i.id, i]));
  for (const item of activeItems.values()) {
    const existing = byItem.get(item.id);
    const ev = evaluateRule({
      today,
      rule: item.rule,
      lastDone: item.lastDone,
      odometer: input.odometer,
      vehicle: profile,
      rateParams: input.rateParams,
    });
    if (ev.dueOn == null && ev.dueKm == null) {
      if (existing) changes.remove.push({ id: existing.id, reason: 'item_unknown' }); // stato `unknown`: nessun promemoria
      continue;
    }
    const fields = fieldsFromEvaluation(ev, {
      title: item.name,
      category: item.category,
      soonDays: item.rule.soonDays ?? 30,
      soonKm: item.rule.soonKm ?? 1500,
      notifyOffsetsDays: [...item.notifyOffsetsDays],
    });
    upsert(existing, fields, { itemId: item.id, policyId: null, paymentId: null }, ['itemId', item.id]);
  }
  for (const [itemId, r] of byItem) {
    if (!activeItems.has(itemId)) changes.remove.push({ id: r.id, reason: 'item_missing_or_inactive' });
  }

  // ---- polizze: la piu' recente per tipo (endOn massimo, poi startOn, poi id per determinismo)
  const policyById = new Map(policies.map((p) => [p.id, p]));
  const latestByKind = new Map<PolicyKind, ReconcilePolicy>();
  for (const p of policies) {
    if (p.cancelledOn) continue;
    const cur = latestByKind.get(p.kind);
    if (!cur || p.endOn > cur.endOn || (p.endOn === cur.endOn && (p.startOn > cur.startOn || (p.startOn === cur.startOn && p.id > cur.id)))) {
      latestByKind.set(p.kind, p);
    }
  }
  const latestIds = new Set([...latestByKind.values()].map((p) => p.id));
  for (const p of [...latestByKind.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const fields = dateOnlyFields(p.endOn, {
      title: policyReminderTitle(p),
      soonDays: POLICY_SOON_DAYS,
      notifyOffsetsDays: [...POLICY_NOTIFY_OFFSETS],
    });
    upsert(byPolicy.get(p.id), fields, { itemId: null, policyId: p.id, paymentId: null }, ['policyId', p.id]);
  }
  for (const [policyId, r] of byPolicy) {
    if (latestIds.has(policyId)) continue;
    const policy = policyById.get(policyId);
    if (!policy) changes.remove.push({ id: r.id, reason: 'policy_missing' });
    else if (policy.cancelledOn) changes.remove.push({ id: r.id, reason: 'policy_cancelled' });
    else changes.close.push({ id: r.id, completedOn: today, reason: 'policy_renewed' }); // rinnovata da una polizza piu' recente
  }

  // ---- rate del premio
  const installmentCount = new Map<string, number>();
  for (const pay of payments) installmentCount.set(pay.policyId, (installmentCount.get(pay.policyId) ?? 0) + 1);
  const paymentIds = new Set(payments.map((p) => p.id));
  for (const pay of payments) {
    const existing = byPayment.get(pay.id);
    const policy = policyById.get(pay.policyId);
    if (!policy || policy.cancelledOn) {
      if (existing) changes.remove.push({ id: existing.id, reason: policy ? 'policy_cancelled' : 'policy_missing' });
      continue;
    }
    if (pay.paidOn) {
      if (existing) changes.close.push({ id: existing.id, completedOn: pay.paidOn, reason: 'installment_paid' });
      continue;
    }
    const fields = dateOnlyFields(pay.dueOn, {
      title: installmentReminderTitle(pay.installmentNo, installmentCount.get(pay.policyId) ?? 1),
      soonDays: INSTALLMENT_SOON_DAYS,
      notifyOffsetsDays: [...INSTALLMENT_NOTIFY_OFFSETS],
    });
    upsert(existing, fields, { itemId: null, policyId: null, paymentId: pay.id }, ['paymentId', pay.id]);
  }
  for (const [paymentId, r] of byPayment) {
    if (!paymentIds.has(paymentId)) changes.remove.push({ id: r.id, reason: 'installment_missing' });
  }

  // ---- promemoria manuali: solo la cache calcolata
  for (const r of manual) {
    if (r.dueOn == null && r.dueKm == null) continue;
    const ev = evaluateThresholds({
      today,
      dueOn: r.dueOn,
      dueKm: r.dueKm,
      soonDays: r.soonDays,
      soonKm: r.soonKm,
      odometer: input.odometer,
      vehicle: profile,
      rateParams: input.rateParams,
    });
    const next = fieldsFromEvaluation(ev, {
      title: r.title,
      category: r.category,
      soonDays: r.soonDays,
      soonKm: r.soonKm,
      notifyOffsetsDays: [...r.notifyOffsetsDays],
    });
    const patch = diffFields(r, next, MANUAL_KEYS);
    if (Object.keys(patch).length > 0) changes.update.push({ id: r.id, patch, computedAt });
  }

  return changes;
}
