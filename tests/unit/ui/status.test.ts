import { describe, expect, it } from 'vitest';
import type { CategorySummary, DeadlineGroups, DeadlineRow, StateCounts } from '@/usecases/queries';
import {
  categoryA11yLabel,
  categoryLine,
  countsSummary,
  filterByCategory,
  GROUP_ORDER,
  groupIcon,
  groupTitle,
  groupTone,
  iconOfState,
  labelOfState,
  rowA11yLabel,
  rowDetail,
  sectionsOf,
  toneOfState,
  toneWord,
} from '@/ui/logic/status';

const row = (over: Partial<DeadlineRow>): DeadlineRow =>
  ({
    id: 'r1',
    title: 'Revisione',
    vehicleLabel: 'Panda di Marco',
    category: 'legal',
    label: 'In arrivo',
    text: 'tra 12 giorni',
    secondaryText: null,
    tone: 'warning',
    icon: 'clock',
    ...over,
  }) as DeadlineRow;

const counts = (over: Partial<StateCounts>): StateCounts => ({ overdue: 0, soon: 0, ok: 0, unknown: 0, total: 0, ...over });

describe('gruppi e sezioni', () => {
  it('l\'ordine e\' scadute, in arrivo, in regola, da configurare', () => {
    expect(GROUP_ORDER).toEqual(['overdue', 'soon', 'ok', 'unknown']);
    expect(GROUP_ORDER.map(groupTitle)).toEqual(['Scadute', 'In arrivo', 'In regola', 'Da configurare']);
  });

  it('ogni gruppo ha un tono e un\'icona (mai solo colore)', () => {
    expect(GROUP_ORDER.map(groupTone)).toEqual(['danger', 'warning', 'ok', 'unknown']);
    expect(GROUP_ORDER.map(groupIcon)).toEqual(['alert', 'clock', 'check', 'help']);
  });

  it('sectionsOf salta i gruppi vuoti e mantiene l\'ordine', () => {
    const groups: DeadlineGroups = { overdue: [], soon: [row({ id: 'a' })], ok: [row({ id: 'b' }), row({ id: 'c' })], unknown: [] };
    const sections = sectionsOf(groups);
    expect(sections.map((s) => s.group)).toEqual(['soon', 'ok']);
    expect(sections[1]?.rows).toHaveLength(2);
    expect(sections[0]?.icon).toBe('clock');
  });
});

describe('conteggi', () => {
  it('mostra solo i conteggi diversi da zero, con i plurali giusti', () => {
    expect(countsSummary(counts({ overdue: 1, soon: 2, ok: 5, total: 8 }))).toBe('1 scaduta · 2 in arrivo · 5 in regola');
    expect(countsSummary(counts({ overdue: 3, unknown: 1, total: 4 }))).toBe('3 scadute · 1 da configurare');
  });

  it('senza voci dice che non ci sono scadenze', () => {
    expect(countsSummary(counts({}))).toBe('Nessuna scadenza');
  });

  it('la parola di stato della categoria corrisponde al tono', () => {
    expect(toneWord('danger')).toBe('Da fare subito');
    expect(toneWord('warning')).toBe('In arrivo');
    expect(toneWord('ok')).toBe('In regola');
    expect(toneWord('unknown')).toBe('Da configurare');
  });

  it('una categoria vuota non e\' "da configurare"', () => {
    const empty = { category: 'tyres', label: 'Gomme', tone: 'unknown', icon: 'help', counts: counts({}) } as CategorySummary;
    expect(categoryLine(empty)).toBe('Nessuna voce');
    const full = { category: 'legal', label: 'Legale', tone: 'danger', icon: 'alert', counts: counts({ overdue: 1, total: 1 }) } as CategorySummary;
    expect(categoryA11yLabel(full, true)).toBe('Legale: Da fare subito. 1 scaduta. Filtro attivo');
    expect(categoryA11yLabel(full, false)).not.toContain('Filtro');
  });
});

describe('righe', () => {
  it('filtra per categoria o lascia tutto', () => {
    const rows = [row({ id: 'a', category: 'legal' }), row({ id: 'b', category: 'tyres' })];
    expect(filterByCategory(rows, null)).toHaveLength(2);
    expect(filterByCategory(rows, 'tyres').map((r) => r.id)).toEqual(['b']);
  });

  it('l\'etichetta per i lettori di schermo contiene titolo, stato e dettaglio', () => {
    expect(rowA11yLabel(row({}), false)).toBe('Revisione. In arrivo. tra 12 giorni');
    expect(rowA11yLabel(row({}), true)).toBe('Revisione, Panda di Marco. In arrivo. tra 12 giorni');
  });

  it('il dettaglio unisce la seconda riga se c\'e\'', () => {
    expect(rowDetail(row({}))).toBe('tra 12 giorni');
    expect(rowDetail(row({ secondaryText: 'oppure tra 1.200 km' }))).toBe('tra 12 giorni · oppure tra 1.200 km');
  });
});

describe('stati del wizard', () => {
  it('mappa stato -> tono, icona ed etichetta', () => {
    expect(toneOfState('soon')).toBe('warning');
    expect(toneOfState('overdue')).toBe('danger');
    expect(iconOfState('unknown')).toBe('help');
    expect(labelOfState('unknown')).toBe('Da configurare');
    expect(labelOfState('ok')).toBe('In regola');
  });
});
