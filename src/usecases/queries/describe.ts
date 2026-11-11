// Testi italiani, toni e avvertenze legali delle scadenze (SPEC 6.3.4, F-24). Funzioni pure sui risultati del motore.
import { getRule } from '@/domain/italy';
import type { Evaluation, ReminderState } from '@/domain/maintenance';
import { reasonMessage, stateLabel } from '@/domain/maintenance';
import type { ReminderCategory } from '@/domain/reminders';
import type { DistanceUnit } from '@/domain/units';
import { formatDateIt, formatDistance, plural } from '@/domain/units';
import type { DeadlineIcon, DeadlineReason, DeadlineTone, LegalInfo } from './types';

export const CATEGORY_LABELS: Record<ReminderCategory, string> = {
  legal: 'Legale',
  insurance: 'Assicurazione',
  maintenance: 'Manutenzione',
  check: 'Controlli',
  tyres: 'Gomme',
  other: 'Altro',
};

/** Ordine delle categorie nei semafori (SPEC 6.3.4), poi "Altro". */
export const CATEGORY_ORDER: readonly ReminderCategory[] = ['legal', 'insurance', 'maintenance', 'check', 'tyres', 'other'];

const days = (n: number): string => plural(n, 'giorno', 'giorni');

/** Tono: rosso per scaduto E per "scade oggi" (ultimo giorno utile), giallo in arrivo, verde in regola, grigio da configurare. */
export function toneOf(ev: Pick<Evaluation, 'state' | 'dueToday'>): DeadlineTone {
  switch (ev.state) {
    case 'overdue':
      return 'danger';
    case 'soon':
      return ev.dueToday ? 'danger' : 'warning';
    case 'ok':
      return 'ok';
    case 'unknown':
      return 'unknown';
  }
}

export const ICON_OF_TONE: Record<DeadlineTone, DeadlineIcon> = {
  danger: 'alert',
  warning: 'clock',
  ok: 'check',
  unknown: 'help',
};

/** Gravita' per il "peggiore fra le voci": rosso > giallo > verde > grigio. */
export const TONE_SEVERITY: Record<DeadlineTone, number> = { danger: 3, warning: 2, ok: 1, unknown: 0 };

export function worstTone(tones: readonly DeadlineTone[]): DeadlineTone {
  let best: DeadlineTone = 'unknown';
  for (const t of tones) if (TONE_SEVERITY[t] > TONE_SEVERITY[best]) best = t;
  return best;
}

export interface EvaluationText {
  label: string;
  text: string;
  secondaryText: string | null;
  summary: string;
  reasons: DeadlineReason[];
}

/**
 * Testi di una valutazione. L'etichetta e' quella del dominio ("In regola", "In arrivo", "Scade oggi", "Scaduto",
 * "Probabilmente scaduto", "Da configurare"); `text` la segue: "In arrivo · scade il 30/11/2026 (tra 14 giorni)".
 * Le scadenze a km sono sempre "stime" (mai cifre esatte inventate: invariante I3).
 */
export function describeEvaluation(ev: Evaluation, unit: DistanceUnit): EvaluationText {
  const label = stateLabel(ev);
  const reasons: DeadlineReason[] = ev.reasons.map((code) => ({ code, message: reasonMessage(code) }));
  const due = ev.effectiveDueOn ? formatDateIt(ev.effectiveDueOn) : '';
  let text: string;
  let secondary: string | null = null;

  const kmPart = (): string | null =>
    ev.dueKm != null && ev.kmLeft != null && ev.kmLeft > 0 ? `tra ${formatDistance(ev.kmLeft, unit)}` : null;

  switch (ev.state) {
    case 'unknown':
      text = reasons[0]?.message ?? 'Mancano dei dati per calcolare la scadenza.';
      break;
    case 'overdue':
      if (ev.kmReached && ev.dueKm != null) {
        text = `raggiunti i ${formatDistance(ev.dueKm, unit)}`;
      } else if (ev.estimated) {
        text = `stima in base ai km: prevista il ${due}`;
      } else {
        text = `da ${days(-(ev.daysLeft ?? 0))} (scadenza ${due})`;
      }
      break;
    case 'soon':
    case 'ok':
      if (ev.dueToday) {
        text = ev.estimated ? 'prevista oggi (stima in base ai km)' : `scadenza del ${due}`;
      } else if (ev.trigger === 'km' && ev.kmLeft != null && ev.kmLeft > 0) {
        text = `tra circa ${formatDistance(ev.kmLeft, unit)} (stima)`;
        secondary = `circa il ${due}`;
      } else {
        text = `scade il ${due} (tra ${days(ev.daysLeft ?? 0)})`;
        const km = kmPart();
        secondary = km ? `oppure ${km}` : null;
      }
      break;
  }
  return { label, text, secondaryText: secondary, summary: `${label} · ${text}`, reasons };
}

// ---------------------------------------------------------------- avvertenza legale

const GENERIC_LEGAL_WARNING =
  'Promemoria informativo, non consulenza legale: fa fede la data riportata sul documento ufficiale.';

/** Voce del catalogo -> regola italiana codificata che ne descrive fonte e avvertenza. */
const TEMPLATE_RULE: Readonly<Record<string, string>> = {
  tpl_inspection: 'it.inspection.next',
  tpl_road_tax: 'it.road_tax.renewal',
  tpl_gas_cylinder: 'it.gas.manual',
};
const RCA_RULE_ID = 'it.rca.expiry_printed';

/**
 * Fonte e avvertenza per le voci di legge (categoria `legal`) e per la RCA. Per le altre categorie ritorna null.
 * Una voce di legge personalizzata (senza regola codificata) riceve solo l'avvertenza generica.
 */
export function legalInfoFor(input: {
  category: ReminderCategory;
  templateId: string | null;
  policyKind: string | null;
}): LegalInfo | null {
  const isRca = input.category === 'insurance' && input.policyKind === 'rca';
  if (input.category !== 'legal' && !isRca) return null;
  const ruleId = isRca ? RCA_RULE_ID : input.templateId ? (TEMPLATE_RULE[input.templateId] ?? null) : null;
  const rule = ruleId ? getRule(ruleId) : undefined;
  if (!rule) return { warning: GENERIC_LEGAL_WARNING, sources: [], ruleId: null, verifiedOn: null, confidence: null };
  return {
    warning: rule.warningText,
    sources: rule.sources.map((s) => ({ label: s.label, url: s.url })),
    ruleId: rule.id,
    verifiedOn: rule.verifiedOn,
    confidence: rule.confidence,
  };
}

export const stateOrder: readonly ReminderState[] = ['overdue', 'soon', 'ok', 'unknown'];
