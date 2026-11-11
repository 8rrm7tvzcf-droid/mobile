// Aggiorna km (S-25, F-03): lettura dell'input, avvisi di coerenza e righe del registro. Pura.
import { formatDateIt, formatDistance, formatInt, parseDistanceInput, MAX_KM, type DistanceUnit } from '@/domain/units';
import type { KmRange, OdometerCheck, OdometerEntry } from '@/usecases/odometer';
import { it } from '../i18n/it';

export const parseKmField = (text: string, unit: DistanceUnit): number | null => parseDistanceInput(text, unit);

/** "Per questa data sono ammessi km tra X e Y." */
export function rangeHint(range: KmRange, unit: DistanceUnit): string {
  const min = formatDistance(range.min, unit);
  if (!Number.isFinite(range.max) || range.max >= MAX_KM) return it.km.rangeFrom(min);
  return it.km.range(min, formatDistance(range.max, unit));
}

export interface CheckMessages {
  /** Errori bloccanti (testo italiano dal dominio). */
  errors: string[];
  /** Avvisi che non impediscono di salvare. */
  warnings: string[];
  /** Vero se c'e' un conflitto di coerenza con le altre letture. */
  conflict: boolean;
}

export function checkMessages(check: OdometerCheck): CheckMessages {
  return {
    errors: check.errors.map((e) => e.message),
    warnings: check.warnings.map((w) => w.message),
    conflict: check.conflicts.length > 0,
  };
}

export const readingTitle = (e: OdometerEntry, unit: DistanceUnit): string => formatDistance(e.km, unit);

export function readingSubtitle(e: OdometerEntry): string {
  const base = `${formatDateIt(e.readOn)} · ${e.sourceLabel}`;
  return e.status === 'ignored' ? `${base} · ${it.vehicle.readingIgnored}` : base;
}

export function readingA11yLabel(e: OdometerEntry, unit: DistanceUnit): string {
  return `${readingTitle(e, unit)}, ${readingSubtitle(e)}`;
}

/** Km formattati per un'auto (usa km o miglia secondo l'unita' dell'auto). */
export const kmText = (km: number, unit: DistanceUnit): string => formatDistance(km, unit);

export const kmNumber = (km: number): string => formatInt(km);
