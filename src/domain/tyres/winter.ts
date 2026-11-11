// Finestra dei pneumatici invernali (15 novembre - 15 aprile, dove prescritta) - SPEC §7.5, REG §4. Dominio puro.
// L'obbligo NON e' nazionale e indistinto: dipende da segnaletica e ordinanze. Il dominio mostra il periodo standard.
import { makeDate, parseDate, type LocalDate } from '@/domain/dates';
import { buildDeadline, buildOutcome, type DeadlineResult, type RuleOutcome } from '@/domain/italy/types';
import { TYRE_RULES, type SeasonDate, type TyreRules } from './rules';

/** `seasonStartYear` e' l'anno in cui inizia la stagione (2026 per la stagione 2026/27). */
function seasonDate(seasonStartYear: number, d: SeasonDate): LocalDate {
  return makeDate(seasonStartYear + d.yearOffset, d.month, d.day);
}

export interface WinterTyreSeason extends RuleOutcome {
  readonly seasonStartYear: number;
  /** Montaggio consentito (15 ottobre). */
  readonly mountAllowedFrom: LocalDate;
  /** Inizio periodo delle ordinanze (15 novembre): e' anche `dueOn`. */
  readonly obligationFrom: LocalDate;
  /** Fine periodo delle ordinanze (15 aprile). */
  readonly obligationTo: LocalDate;
  /** Limite per invernali con indice di velocita' inferiore (15 maggio, minimo Q). */
  readonly lowSpeedIndexUntil: LocalDate;
}

/** Calendario della stagione invernale (vettore T1). */
export function winterTyreSeason(seasonStartYear: number, rules: TyreRules = TYRE_RULES): WinterTyreSeason {
  const rule = rules.winterWindow;
  const p = rule.params;
  const obligationFrom = seasonDate(seasonStartYear, p.obligationFrom);
  return {
    ...buildOutcome(rule),
    dueOn: obligationFrom,
    seasonStartYear,
    mountAllowedFrom: seasonDate(seasonStartYear, p.mountAllowedFrom),
    obligationFrom,
    obligationTo: seasonDate(seasonStartYear, p.obligationTo),
    lowSpeedIndexUntil: seasonDate(seasonStartYear, p.lowSpeedIndexUntil),
  };
}

/** Promemoria stagionali suggeriti: 1/10, 8/11, 15/11, 1/4, 15/4 (REG §4.3). */
export function winterTyreReminderDates(seasonStartYear: number, rules: TyreRules = TYRE_RULES): LocalDate[] {
  return rules.winterWindow.params.reminders.map((d) => seasonDate(seasonStartYear, d));
}

/** Stagione di riferimento per una data: fino al 15 maggio vale quella iniziata l'autunno prima, poi la prossima. */
export function winterTyreSeasonStartYearFor(today: LocalDate, rules: TyreRules = TYRE_RULES): number {
  const y = parseDate(today).y;
  const until = rules.winterWindow.params.lowSpeedIndexUntil;
  return today <= makeDate(y, until.month, until.day) ? y - 1 : y;
}

export type WinterWindowState =
  | 'outside'
  | 'mounting_allowed'
  | 'obligation_period'
  | 'after_obligation';

export interface WinterWindowStatus extends RuleOutcome {
  readonly state: WinterWindowState;
  readonly season: WinterTyreSeason;
  readonly label: string;
}

/** In che punto della finestra ci troviamo (informativo: l'obbligo vale solo dove c'e' segnaletica/ordinanza). */
export function winterTyreWindowStatus(today: LocalDate, rules: TyreRules = TYRE_RULES): WinterWindowStatus {
  const season = winterTyreSeason(winterTyreSeasonStartYearFor(today, rules), rules);
  const base = buildOutcome(rules.winterWindow);
  if (today < season.mountAllowedFrom) {
    return { ...base, state: 'outside', season, label: 'Fuori stagione invernale' };
  }
  if (today < season.obligationFrom) {
    return { ...base, state: 'mounting_allowed', season, label: 'Montaggio degli invernali consentito' };
  }
  if (today <= season.obligationTo) {
    return {
      ...base,
      state: 'obligation_period',
      season,
      label: "Periodo degli obblighi (dove c'è segnaletica o ordinanza)",
    };
  }
  if (today <= season.lowSpeedIndexUntil) {
    return {
      ...base,
      state: 'after_obligation',
      season,
      label: 'Fine del periodo degli obblighi: invernali con indice di velocità inferiore ammessi fino al 15 maggio',
    };
  }
  return { ...base, state: 'outside', season, label: 'Fuori stagione invernale' };
}

export type TyreChangeKind = 'winter' | 'summer';

/**
 * Data del cambio gomme della stagione: montaggio invernali entro il 15 novembre, estive dopo il 15 aprile
 * (voci stagionali del catalogo, spente di default).
 */
export function tyreChangeDue(
  kind: TyreChangeKind,
  seasonStartYear: number,
  rules: TyreRules = TYRE_RULES,
): DeadlineResult<'season_calendar'> {
  const season = winterTyreSeason(seasonStartYear, rules);
  const dueOn = kind === 'winter' ? season.obligationFrom : season.obligationTo;
  return buildDeadline(rules.winterWindow, dueOn, 'season_calendar');
}

/** Prossima data di cambio gomme del tipo richiesto a partire da `from` (inclusa). */
export function nextTyreChangeDue(
  kind: TyreChangeKind,
  from: LocalDate,
  rules: TyreRules = TYRE_RULES,
): DeadlineResult<'season_calendar'> {
  const y = parseDate(from).y;
  // Invernali: 15/11 dell'anno di inizio stagione; estive: 15/4 dell'anno successivo (stagione iniziata l'anno prima).
  const candidates = kind === 'winter' ? [y, y + 1] : [y - 1, y];
  for (const startYear of candidates) {
    const due = tyreChangeDue(kind, startYear, rules);
    if (due.dueOn !== null && due.dueOn >= from) return due;
  }
  return tyreChangeDue(kind, candidates[1] ?? y, rules);
}
