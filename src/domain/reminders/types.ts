// Tipi condivisi dei promemoria (occorrenze), delle ricorrenze e dello snooze. Dominio puro.
import type { LocalDate } from '@/domain/dates';
import type { ItemCategory } from '@/domain/maintenance';

/** Categoria di un promemoria (`reminders.category`): quelle delle voci piu' `insurance` (polizze e rate). */
export type ReminderCategory = ItemCategory | 'insurance';
export type ReminderStatus = 'open' | 'done' | 'skipped';
export type RepeatUnit = 'day' | 'week' | 'month' | 'year';

/** Data e ora locali del dispositivo, come `Clock.nowLocal()`: l'ora e' 'HH:MM'. */
export interface LocalDateTime {
  date: LocalDate;
  time: string;
}

/** Ricorrenza di un promemoria manuale: le occorrenze sono ancorate all'ORIGINE, non alla precedente. */
export interface RepeatRule {
  originOn: LocalDate;
  every: number;
  unit: RepeatUnit;
}
