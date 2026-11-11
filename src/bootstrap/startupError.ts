// Cosa dire all'utente quando l'avvio fallisce (SPEC 8.6: "errore -> schermata di recupero"; "DB piu' nuovo dell'app ->
// Aggiorna MyGarage"). Funzione pura: la UI non legge mai testi SQLite o stack, solo questo riepilogo in italiano semplice.
import { DatabaseBootError, SchemaTooNewError, type BootFailureKind } from '@/data';

export type StartupErrorKind = 'update-required' | 'unsupported-device' | 'data-problem' | 'unexpected';

export interface StartupErrorInfo {
  kind: StartupErrorKind;
  title: string;
  /** Italiano semplice, senza termini tecnici. */
  message: string;
  /** Codice tecnico breve da mostrare in piccolo e da comunicare al supporto. */
  detail: string;
}

const SAFE = "I tuoi dati sono ancora sul telefono e non sono stati cancellati.";

const UPDATE_REQUIRED: Omit<StartupErrorInfo, 'detail'> = {
  kind: 'update-required',
  title: 'Aggiorna MyGarage',
  message:
    "I tuoi dati sono stati salvati da una versione di MyGarage più recente di quella installata. Per non rovinarli, questa versione non li apre. Aggiorna l'app dallo store e riprova.",
};

const MESSAGES: Record<Exclude<BootFailureKind, 'schema-too-new'>, Omit<StartupErrorInfo, 'detail'>> = {
  'sqlite-too-old': {
    kind: 'unsupported-device',
    title: 'Telefono non supportato',
    message:
      'Il motore che conserva i dati su questo telefono è troppo vecchio per MyGarage. Prova ad aggiornare il sistema operativo del telefono.',
  },
  'unknown-database': {
    kind: 'data-problem',
    title: 'File dei dati non riconosciuto',
    message: `Il file dei dati sul telefono non sembra creato da MyGarage, quindi non lo tocco. ${SAFE} Scrivi al supporto indicando il codice qui sotto.`,
  },
  'checksum-mismatch': {
    kind: 'data-problem',
    title: 'Non riesco ad aprire i tuoi dati',
    message: `Il database non corrisponde a questa versione dell'app. ${SAFE} Prova a riavviare MyGarage; se il problema resta, scrivi al supporto indicando il codice qui sotto.`,
  },
  'migration-failed': {
    kind: 'data-problem',
    title: "Aggiornamento dei dati non riuscito",
    message: `Non sono riuscito ad aggiornare i tuoi dati alla nuova versione. ${SAFE} Prima di ogni aggiornamento l'app crea una copia di sicurezza: scrivi al supporto indicando il codice qui sotto.`,
  },
  'seed-failed': {
    kind: 'data-problem',
    title: 'Non riesco ad aprire i tuoi dati',
    message: `Qualcosa è andato storto nel preparare i dati iniziali. ${SAFE} Riprova; se il problema resta, scrivi al supporto indicando il codice qui sotto.`,
  },
  'pragma-failed': {
    kind: 'data-problem',
    title: 'Non riesco ad aprire i tuoi dati',
    message: `Il telefono non mi permette di aprire il database. ${SAFE} Riprova; se il problema resta, riavvia il telefono e scrivi al supporto indicando il codice qui sotto.`,
  },
};

const UNEXPECTED: Omit<StartupErrorInfo, 'detail'> = {
  kind: 'unexpected',
  title: "Qualcosa non ha funzionato all'avvio",
  message: "MyGarage non è riuscita a partire. Riprova; se continua, chiudi l'app e riaprila.",
};

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function describeStartupError(e: unknown): StartupErrorInfo {
  if (e instanceof DatabaseBootError) {
    const base = e.kind === 'schema-too-new' ? UPDATE_REQUIRED : MESSAGES[e.kind];
    return { ...base, detail: `${e.kind} (${e.stage}): ${e.message}` };
  }
  if (e instanceof SchemaTooNewError) return { ...UPDATE_REQUIRED, detail: `schema-too-new: ${e.message}` };
  return { ...UNEXPECTED, detail: messageOf(e) };
}
