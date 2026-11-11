// Registro (S-13): filtri per tipo, raggruppamento per mese e presentazione delle righe. Pura: niente React Native.
import type { Href } from 'expo-router';
import { formatDateIt, formatEuro, formatMonthYearIt } from '@/domain/units';
import type { TimelineEntry, TimelineIcon, TimelineKind } from '@/usecases/queries';
import type { IconName } from '../components/Icon';
import type { ChoiceOption } from '../components/Choices';
import { it } from '../i18n/it';
import { routes } from '../navigation/routes';

export type KindFilter = 'all' | 'service' | 'fuel' | 'expense' | 'fluid' | 'insurance' | 'km' | 'deadline';

/** Quali tipi di voce mostra ciascun filtro (`undefined` = tutti). */
export const KIND_FILTER_KINDS: Record<KindFilter, readonly TimelineKind[] | undefined> = {
  all: undefined,
  service: ['service'],
  fuel: ['fuel'],
  expense: ['expense'],
  fluid: ['fluid'],
  insurance: ['policy', 'installment'],
  km: ['odometer'],
  deadline: ['deadline', 'completion'],
};

const FILTER_ORDER: readonly KindFilter[] = ['all', 'fuel', 'expense', 'service', 'fluid', 'insurance', 'km', 'deadline'];

export const kindFilterOptions: readonly ChoiceOption<KindFilter>[] = FILTER_ORDER.map((value) => ({ value, label: it.registry.kinds[value] }));

export interface TimelineGroup {
  /** 'upcoming' oppure 'AAAA-MM'. */
  key: string;
  title: string;
  /** Per i mesi: quanto si e' speso (interventi, rifornimenti, spese, rate pagate); `null` se non c'e' nulla. */
  totalText: string | null;
  entries: TimelineEntry[];
}

const capitalize = (s: string): string => (s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Le scadenze aperte in cima (la piu' vicina per prima), poi un gruppo per mese dal piu' recente. */
export function groupTimeline(entries: readonly TimelineEntry[]): TimelineGroup[] {
  const upcoming = entries.filter((e) => e.upcoming).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  const groups: TimelineGroup[] = [];
  if (upcoming.length > 0) groups.push({ key: 'upcoming', title: it.registry.upcomingTitle, totalText: null, entries: upcoming });
  const byMonth = new Map<string, TimelineEntry[]>();
  for (const e of entries) {
    if (e.upcoming) continue;
    const key = e.date.slice(0, 7);
    const list = byMonth.get(key);
    if (list) list.push(e);
    else byMonth.set(key, [e]);
  }
  for (const key of [...byMonth.keys()].sort().reverse()) {
    const list = byMonth.get(key) ?? [];
    const spent = list.reduce((sum, e) => sum + (e.amountCents ?? 0), 0);
    groups.push({ key, title: capitalize(formatMonthYearIt(key)), totalText: spent > 0 ? it.registry.monthSpent(formatEuro(spent)) : null, entries: list });
  }
  return groups;
}

const ICONS: Record<TimelineIcon, IconName> = {
  service: 'wrench',
  fuel: 'fuel',
  expense: 'receipt',
  fluid: 'droplet',
  policy: 'shield',
  payment: 'euro',
  gauge: 'gauge',
  done: 'check',
  alert: 'alert',
  clock: 'clock',
  check: 'check',
  help: 'help',
};

export const entryIcon = (e: TimelineEntry): IconName => ICONS[e.icon];

export const entryAmountText = (e: TimelineEntry): string | null => (e.amountCents !== null ? formatEuro(e.amountCents) : null);

/** Sottotitolo: data, dettagli e km (i km non si ripetono dove stanno gia' nel testo). */
export function entrySubtitle(e: TimelineEntry): string {
  const showKm = e.kmText !== null && (e.kind === 'service' || e.kind === 'fuel' || e.kind === 'fluid');
  return [formatDateIt(e.date), e.text, showKm ? e.kmText : null].filter((p): p is string => Boolean(p)).join(' · ');
}

/** Frase unica per i lettori di schermo: tipo, titolo, data, dettagli, importo. */
export function entryA11yLabel(e: TimelineEntry): string {
  const parts = [e.title, entrySubtitle(e), entryAmountText(e), e.ignored ? 'messa da parte' : null];
  return parts.filter((p): p is string => Boolean(p)).join('. ');
}

/** Dove porta il tocco su una riga: dettaglio di interventi, controlli, rifornimenti, spese, polizze e scadenze. */
export function entryRoute(e: TimelineEntry, vehicleId: string): Href | null {
  switch (e.kind) {
    case 'fuel':
      return routes.fuelEdit(vehicleId, e.id);
    case 'expense':
      return routes.expenseEdit(vehicleId, e.id);
    case 'service':
      return routes.serviceDetail(vehicleId, e.id);
    case 'fluid':
      return routes.fluidCheck(vehicleId, e.id);
    case 'policy':
      return routes.policyDetail(vehicleId, e.id);
    case 'installment':
      return routes.policies(vehicleId);
    case 'deadline':
      return routes.deadline(e.id);
    default:
      return null;
  }
}
