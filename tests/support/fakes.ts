// Doppioni di test per le porte Clock e IdGenerator (SPEC 8.6): orologio fisso e ID deterministici.
import type { Clock, IdGenerator } from '@/domain/ports';

export const FIXED_NOW = '2026-10-08T07:30:00.000Z';

export interface TestClock extends Clock {
  /** Sposta l'orologio (istante UTC con millisecondi). */
  set(nowIso: string): void;
}

/** Orologio fisso. Nei test il fuso e' trattato come UTC: la data locale e' la parte data dell'istante. */
export function fixedClock(nowIso: string = FIXED_NOW, timeZone = 'Europe/Rome'): TestClock {
  let now = nowIso;
  return {
    set: (v) => {
      now = v;
    },
    nowIso: () => now,
    todayLocal: () => now.slice(0, 10),
    nowLocal: () => ({ date: now.slice(0, 10), time: now.slice(11, 16) }),
    timeZone: () => timeZone,
  };
}

/** ULID "finto" di 26 caratteri, deterministico: ulidOf(1) = '01TESTID000000000000000001'. */
export function ulidOf(n: number): string {
  return `01TESTID${String(n).padStart(18, '0')}`;
}

/** Generatore di ID sequenziali (26 caratteri, ordinabili). */
export function sequentialIds(start = 1): IdGenerator & { next: number } {
  const gen = {
    next: start,
    ulid(): string {
      return ulidOf(gen.next++);
    },
  };
  return gen;
}
