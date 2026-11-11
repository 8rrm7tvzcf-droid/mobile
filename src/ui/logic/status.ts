// Presentazione delle scadenze: gruppi, conteggi, etichette di accessibilita'. Pura: niente React Native.
// I semafori hanno SEMPRE icona + testo (SPEC 10 NFR-07): qui si decide quale.
import type {
  CategorySummary,
  DeadlineGroups,
  DeadlineIcon,
  DeadlineRow,
  DeadlineTone,
  StateCounts,
} from '@/usecases/queries';
import type { ReminderCategory } from '@/domain/reminders';
import { formatInt } from '@/domain/units';
import type { Href } from 'expo-router';
import { it } from '../i18n/it';
import { routes } from '../navigation/routes';

export type StatusGroup = 'overdue' | 'soon' | 'ok' | 'unknown';

export const GROUP_ORDER: readonly StatusGroup[] = ['overdue', 'soon', 'ok', 'unknown'];

const GROUP_TITLES: Record<StatusGroup, string> = {
  overdue: it.deadlines.groupOverdue,
  soon: it.deadlines.groupSoon,
  ok: it.deadlines.groupOk,
  unknown: it.deadlines.groupUnknown,
};

const GROUP_TONE: Record<StatusGroup, DeadlineTone> = { overdue: 'danger', soon: 'warning', ok: 'ok', unknown: 'unknown' };
const GROUP_ICON: Record<StatusGroup, DeadlineIcon> = { overdue: 'alert', soon: 'clock', ok: 'check', unknown: 'help' };

export const groupTitle = (g: StatusGroup): string => GROUP_TITLES[g];
export const groupTone = (g: StatusGroup): DeadlineTone => GROUP_TONE[g];
export const groupIcon = (g: StatusGroup): DeadlineIcon => GROUP_ICON[g];

export interface StatusSection {
  group: StatusGroup;
  title: string;
  tone: DeadlineTone;
  icon: DeadlineIcon;
  rows: DeadlineRow[];
}

/** Le sezioni non vuote di un elenco, nell'ordine scadute -> in arrivo -> in regola -> da configurare. */
export function sectionsOf(groups: DeadlineGroups): StatusSection[] {
  return GROUP_ORDER.filter((g) => groups[g].length > 0).map((g) => ({
    group: g,
    title: groupTitle(g),
    tone: groupTone(g),
    icon: groupIcon(g),
    rows: groups[g],
  }));
}

/** "1 scaduta · 2 in arrivo · 5 in regola": solo i conteggi diversi da zero. */
export function countsSummary(c: StateCounts): string {
  if (c.total === 0) return it.deadlines.emptyTitle;
  const parts: string[] = [];
  if (c.overdue > 0) parts.push(`${formatInt(c.overdue)} ${c.overdue === 1 ? 'scaduta' : 'scadute'}`);
  if (c.soon > 0) parts.push(`${formatInt(c.soon)} in arrivo`);
  if (c.ok > 0) parts.push(`${formatInt(c.ok)} in regola`);
  if (c.unknown > 0) parts.push(`${formatInt(c.unknown)} da configurare`);
  return parts.join(' · ');
}

/** Parola di stato di una categoria (il tono e' il PEGGIORE tra le sue voci). */
export function toneWord(tone: DeadlineTone): string {
  switch (tone) {
    case 'danger':
      return 'Da fare subito';
    case 'warning':
      return 'In arrivo';
    case 'ok':
      return 'In regola';
    default:
      return 'Da configurare';
  }
}

/** Una voce di categoria vuota (nessuna scadenza) non e' "da configurare": e' vuota. */
export function categoryLine(c: CategorySummary): string {
  return c.counts.total === 0 ? 'Nessuna voce' : toneWord(c.tone);
}

export function categoryA11yLabel(c: CategorySummary, selected: boolean): string {
  const base = `${c.label}: ${categoryLine(c)}. ${countsSummary(c.counts)}`;
  return selected ? `${base}. Filtro attivo` : base;
}

export function filterByCategory(rows: readonly DeadlineRow[], category: ReminderCategory | null): DeadlineRow[] {
  return category === null ? [...rows] : rows.filter((r) => r.category === category);
}

/** Etichetta per i lettori di schermo: titolo, auto (se serve) e stato completo. */
export function rowA11yLabel(row: DeadlineRow, withVehicle: boolean): string {
  const car = withVehicle ? `, ${row.vehicleLabel}` : '';
  return `${row.title}${car}. ${row.label}. ${row.text}`;
}

/** Seconda riga di una riga d'elenco: stato e dettaglio, piu' l'eventuale stima di seguito. */
export function rowDetail(row: DeadlineRow): string {
  return row.secondaryText ? `${row.text} · ${row.secondaryText}` : row.text;
}

// ---- Esito del wizard: stato del motore -> semaforo ----

export type EngineState = 'ok' | 'soon' | 'overdue' | 'unknown';

const STATE_TONE: Record<EngineState, DeadlineTone> = { ok: 'ok', soon: 'warning', overdue: 'danger', unknown: 'unknown' };
const STATE_LABEL: Record<EngineState, string> = { ok: 'In regola', soon: 'In arrivo', overdue: 'Scaduta', unknown: 'Da configurare' };

export const toneOfState = (s: EngineState): DeadlineTone => STATE_TONE[s];
export const iconOfState = (s: EngineState): DeadlineIcon => GROUP_ICON[s];
export const labelOfState = (s: EngineState): string => STATE_LABEL[s];

/** Dove porta il tocco su una scadenza: la scadenza di una polizza (o di una sua rata) porta alla scheda della polizza. */
export function deadlineHref(row: Pick<DeadlineRow, 'id' | 'vehicleId' | 'policyId' | 'origin'>): Href {
  if (row.policyId && (row.origin === 'policy' || row.origin === 'installment')) return routes.policyDetail(row.vehicleId, row.policyId);
  return routes.deadline(row.id);
}
