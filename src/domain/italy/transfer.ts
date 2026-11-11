// Passaggio di proprieta' (V1) - SPEC §7.8, REG §7. Dominio puro.
// La trascrizione al PRA e l'aggiornamento del Documento Unico vanno richiesti dall'ACQUIRENTE entro 60 giorni dalla
// data di AUTENTICA della firma del venditore (art. 94 c.1 CdS), non dalla consegna del veicolo.
import { addDays, type LocalDate } from '@/domain/dates';
import { datesAfter } from './calendar';
import { SOURCES, VERIFIED_ON } from './sources';
import { buildDeadline, type DeadlineResult, type Rule } from './types';

export interface TransferParams {
  /** Giorni dalla data di autentica (il giorno iniziale non si conta: dies a quo non computatur). */
  readonly days: number;
  /** Promemoria: giorni DOPO l'autentica (30, 45, 55 e 60). */
  readonly reminderAfterDays: readonly number[];
}

export const TRANSFER_WARNING =
  "Dopo la vendita, la trascrizione del passaggio al PRA va richiesta entro 60 giorni dalla data di autentica della firma del venditore: oltre questo termine sono dovute sanzioni sull'imposta provinciale di trascrizione. Il venditore dovrebbe verificare che il passaggio sia stato registrato (per evitare responsabilità su bollo e multe). Verifica sempre i dettagli con l'agenzia pratiche auto o l'ACI.";

export const TRANSFER_RULES: { readonly deadline: Rule<TransferParams> } = {
  deadline: {
    id: 'it.transfer.pra_deadline',
    topic: 'transfer',
    title: 'Trascrizione al PRA del passaggio di proprietà',
    summary:
      "Entro 60 giorni dalla data di autentica della firma del venditore (art. 94 c.1 CdS). Dal 12-8-2026 (D.Lgs. 147/2026), per le cessioni a un rivenditore il venditore resta obbligato al bollo fino alla trascrizione.",
    validFrom: '1992-04-30',
    validTo: null,
    sources: [SOURCES.aci_pra, SOURCES.aci_art94],
    confidence: 'official',
    evidence: 'high',
    verifiedOn: VERIFIED_ON,
    warningText: TRANSFER_WARNING,
    openPoints: [
      'Se il 60º giorno cade in un festivo, probabile slittamento al primo giorno lavorativo (bassa confidenza): non applicato.',
      'Sanzioni art. 94: 727-3.629 EUR (c.3) e 363-1.813 EUR (c.4); sanzioni IPT: importi da verificare.',
      'Una «notifica di vendita» del venditore non risulta dal testo dell’art. 94: da verificare su altre norme (regolamento PRA).',
    ],
    params: { days: 60, reminderAfterDays: [30, 45, 55, 60] },
  },
};

/** Scadenza della trascrizione al PRA (vettori S1-S3). */
export function ownershipTransferDue(
  authenticatedOn: LocalDate,
  rules: { readonly deadline: Rule<TransferParams> } = TRANSFER_RULES,
): DeadlineResult<'authentication_date'> {
  return buildDeadline(
    rules.deadline,
    addDays(authenticatedOn, rules.deadline.params.days),
    'authentication_date',
  );
}

/** Date dei promemoria: 30, 45, 55 e 60 giorni dopo l'autentica (vettore S4). */
export function ownershipTransferReminderDates(
  authenticatedOn: LocalDate,
  rules: { readonly deadline: Rule<TransferParams> } = TRANSFER_RULES,
): LocalDate[] {
  return datesAfter(authenticatedOn, rules.deadline.params.reminderAfterDays);
}
