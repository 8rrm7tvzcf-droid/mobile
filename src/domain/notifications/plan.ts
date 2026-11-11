// Piano delle notifiche locali (data.md 4, SPEC 8.4). Dominio puro: promemoria + "adesso locale" -> candidate selezionate.
// Nessun fuso: produce data e ora LOCALI ("2026-10-30 alle 09:00"); l'infrastruttura le converte in istanti.
import { addDays } from '@/domain/dates';
import type { LocalDate } from '@/domain/dates';
import { DEFAULT_NOTIFY_TIME } from '@/domain/reminders';
import type { LocalDateTime, ReminderCategory, ReminderStatus } from '@/domain/reminders';

/** Prefisso delle notifiche NOSTRE (versione 1 del formato): tutto il resto si ignora. Cambiando formato si cambia prefisso. */
export const KEY_PREFIX = 'mg1:';
export const SENTINEL_KEY = 'mg1:sentinel';
export const TEST_KEY = 'mg1:test';
/** Finestra mobile: sotto il tetto di 64 notifiche pendenti di iOS. */
export const DEFAULT_MAX_SCHEDULED = 60;

/** Rango di ordinamento a parita' di istante: legale e assicurazione prima di manutenzione, poi controlli. */
const RANK: Record<ReminderCategory, number> = {
  legal: 0,
  insurance: 0,
  maintenance: 1,
  tyres: 1,
  other: 2,
  check: 3,
};

/** Giorni DOPO la scadenza in cui ripetere l'avviso se il promemoria e' ancora aperto. Poi silenzio (resta il banner in Home). */
export const OVERDUE_REPEAT: Record<ReminderCategory, readonly number[]> = {
  legal: [1, 3, 7, 14, 30],
  insurance: [1, 3, 7, 14, 30],
  maintenance: [1, 3, 7],
  tyres: [1, 3, 7],
  other: [1, 3, 7],
  check: [],
};

export interface NotifiableReminder {
  id: string;
  category: ReminderCategory;
  status: ReminderStatus;
  /** Per i promemoria generati e' `notify_enabled` della voce; per gli altri normalmente true. */
  notifyEnabled: boolean;
  effectiveDueOn: LocalDate | null;
  /** Giorni di preavviso prima della scadenza (0 = il giorno stesso). */
  notifyOffsetsDays: readonly number[];
  /** Ora del giorno 0 per i promemoria manuali con orario ('HH:MM'). */
  dueTime?: string | null;
  /** Fine dello snooze in ora locale, solo se ancora attivo (vedi `activeSnoozeUntil`). */
  snoozedUntilLocal?: LocalDateTime | null;
}

export type CandidateKind = 'lead' | 'due' | 'overdue' | 'snoozed';

export interface NotificationCandidate {
  /** Chiave deterministica: `mg1:<reminderId>:<offset>`, `+N` dopo la scadenza, `snz` per la fine dello snooze. */
  key: string;
  reminderId: string;
  category: ReminderCategory;
  kind: CandidateKind;
  date: LocalDate;
  time: string;
}

export interface SentinelCandidate {
  key: typeof SENTINEL_KEY;
  reminderId: null;
  kind: 'sentinel';
  date: LocalDate;
  time: string;
}

export interface NotificationPlan {
  /** Notifiche selezionate, in ordine di tempo. */
  items: NotificationCandidate[];
  /** "Apri l'app per aggiornare i promemoria", all'istante della prima notifica rimasta fuori; null se entra tutto. */
  sentinel: SentinelCandidate | null;
  /** Quante candidate future sono rimaste fuori dalla finestra. */
  overflow: number;
}

export interface PlanInput {
  reminders: readonly NotifiableReminder[];
  nowLocal: LocalDateTime;
  /** Ora dei preavvisi (default 09:00: non cade mai nella finestra 02:00-03:00 del cambio ora). */
  notifyTime?: string;
  maxScheduled?: number;
}

export function reminderKey(reminderId: string, suffix: string): string {
  return `${KEY_PREFIX}${reminderId}:${suffix}`;
}

/** Vero per le chiavi delle notifiche nostre. */
export function isOurKey(key: string): boolean {
  return key.startsWith(KEY_PREFIX);
}

const stamp = (c: { date: string; time: string }): string => `${c.date}T${c.time}`;
const cmpAt = (a: { date: string; time: string }, b: { date: string; time: string }): number => {
  const x = stamp(a);
  const y = stamp(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Candidate -> selezione sotto il tetto.
 *
 * 1. per ogni promemoria aperto con notifiche attive e una scadenza: preavvisi (`notifyOffsetsDays`, chiave `<offset>`),
 *    ripetizioni dopo la scadenza (`+N`, per categoria) e, se rimandato, solo cio' che cade dopo la fine dello snooze
 *    piu' una notifica `snz` alla fine;
 * 2. si tengono solo le candidate FUTURE, ordinate per (data, ora, rango di categoria, chiave);
 * 3. se sono <= `maxScheduled` entrano tutte; altrimenti uno slot e' riservato alla sentinella e si fanno due passate:
 *    la prossima notifica di OGNI promemoria, poi le piu' vicine nel tempo.
 */
export function planNotifications(input: PlanInput): NotificationPlan {
  const { reminders, nowLocal, notifyTime = DEFAULT_NOTIFY_TIME, maxScheduled = DEFAULT_MAX_SCHEDULED } = input;
  const cand: NotificationCandidate[] = [];
  for (const r of reminders) {
    if (r.status !== 'open' || !r.notifyEnabled || !r.effectiveDueOn) continue;
    const due = r.effectiveDueOn;
    const mk = (suffix: string, kind: CandidateKind, date: LocalDate, time: string): NotificationCandidate => ({
      key: reminderKey(r.id, suffix),
      reminderId: r.id,
      category: r.category,
      kind,
      date,
      time,
    });
    const mine: NotificationCandidate[] = [];
    for (const off of [...new Set(r.notifyOffsetsDays)].sort((a, b) => b - a)) {
      mine.push(
        mk(String(off), off === 0 ? 'due' : 'lead', addDays(due, -off), off === 0 && r.dueTime ? r.dueTime : notifyTime),
      );
    }
    for (const d of OVERDUE_REPEAT[r.category] ?? [1, 3, 7]) mine.push(mk(`+${d}`, 'overdue', addDays(due, d), notifyTime));
    const snooze = r.snoozedUntilLocal;
    if (snooze && cmpAt(snooze, nowLocal) > 0) {
      // rimandato: sparisce cio' che cade prima della fine dello snooze e si aggiunge un avviso alla fine
      cand.push(...mine.filter((c) => cmpAt(c, snooze) >= 0));
      cand.push(mk('snz', 'snoozed', snooze.date, snooze.time));
    } else {
      cand.push(...mine);
    }
  }

  const future = cand
    .filter((c) => cmpAt(c, nowLocal) > 0)
    .sort((a, b) => cmpAt(a, b) || RANK[a.category] - RANK[b.category] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (future.length <= maxScheduled) return { items: future, sentinel: null, overflow: 0 };
  if (maxScheduled < 1) return { items: [], sentinel: null, overflow: future.length };

  const cap = maxScheduled - 1; // uno slot e' riservato alla sentinella
  const chosen = new Set<string>();
  const seen = new Set<string>();
  for (const c of future) {
    // passata 1: la prossima notifica di OGNI promemoria
    if (chosen.size >= cap) break;
    if (!seen.has(c.reminderId)) {
      seen.add(c.reminderId);
      chosen.add(c.key);
    }
  }
  for (const c of future) {
    // passata 2: le altre, in ordine di tempo
    if (chosen.size >= cap) break;
    chosen.add(c.key);
  }
  const items = future.filter((c) => chosen.has(c.key));
  const overflow = future.filter((c) => !chosen.has(c.key));
  const first = overflow[0] as NotificationCandidate;
  const sentinel: SentinelCandidate = { key: SENTINEL_KEY, reminderId: null, kind: 'sentinel', date: first.date, time: first.time };
  return { items, sentinel, overflow: overflow.length };
}
