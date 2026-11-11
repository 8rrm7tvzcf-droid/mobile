// Periodi preimpostati per Registro, rifornimenti, spese e costi (SPEC 6.3.8: mese, anno, sempre). Pura.
import type { LocalDate } from '@/domain/dates';
import { periodOfLastMonths, periodOfMonth, periodOfYear } from '@/usecases/costs';
import type { ChoiceOption } from '../components/Choices';
import { it } from '../i18n/it';

export type PeriodPreset = 'all' | 'month' | 'quarter' | 'year';

export interface PeriodRange {
  from: LocalDate | null;
  to: LocalDate | null;
}

/** Estremi del periodo (inclusi) in base a "oggi"; `null` = nessun limite da quel lato. */
export function periodRange(preset: PeriodPreset, today: LocalDate): PeriodRange {
  switch (preset) {
    case 'month':
      return periodOfMonth(today.slice(0, 7));
    case 'quarter':
      return periodOfLastMonths(today, 3);
    case 'year':
      return periodOfYear(Number(today.slice(0, 4)));
    default:
      return { from: null, to: null };
  }
}

const LABELS: Record<PeriodPreset, string> = {
  all: it.registry.periods.all,
  month: it.registry.periods.month,
  quarter: it.registry.periods.quarter,
  year: it.registry.periods.year,
};

export const periodLabel = (p: PeriodPreset): string => LABELS[p];

export function periodOptions(presets: readonly PeriodPreset[]): ChoiceOption<PeriodPreset>[] {
  return presets.map((value) => ({ value, label: LABELS[value] }));
}

/** Periodi proposti dalle schermate (nell'ordine): le liste li usano tutti, i costi solo mese, anno e sempre. */
export const LIST_PERIODS: readonly PeriodPreset[] = ['all', 'month', 'quarter', 'year'];
export const COST_PERIODS: readonly PeriodPreset[] = ['month', 'year', 'all'];
