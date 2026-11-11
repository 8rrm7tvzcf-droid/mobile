// Tipi pubblici del controllo livelli (F-44, S-24). Importi in millilitri/millibar interi, date 'YYYY-MM-DD'.
import type { LocalDate } from '@/domain/dates';
import type { Fluid, FluidCheck, FluidLevel, FluidStatus } from '@/domain/fluids';

/**
 * Il controllo livelli completa la voce di controllo del catalogo collegata al fluido (SPEC 6.3.9 punto 3).
 * Refrigerante e lavavetri condividono la voce "Controlla refrigerante e lavavetri": un controllo di uno dei due la completa.
 * Liquido freni, servosterzo, olio cambio e "altro" non hanno una voce nel catalogo: nessun completamento.
 */
export const FLUID_CHECK_TEMPLATES: Readonly<Partial<Record<Fluid, string>>> = {
  engine_oil: 'tpl_check_oil_level',
  coolant: 'tpl_check_coolant_washer',
  washer: 'tpl_check_coolant_washer',
  adblue: 'tpl_check_adblue',
  tyre_pressure: 'tpl_check_tyre_pressure',
};

export interface AddFluidCheckInput {
  vehicleId: string;
  fluid: Fluid;
  /** OK, basso, rabboccato (o gonfiato per la pressione), alto. */
  level: FluidLevel;
  /** Solo con `level = 'topped_up'` e non per la pressione: 1..100.000 ml. Facoltativa. */
  addedMl?: number | null;
  /** Solo per `tyre_pressure`: 500..6000 millibar (0,5..6 bar). Facoltativa. */
  valueMillibar?: number | null;
  /** Prodotto aggiunto (es. "5W-30"), solo con `level = 'topped_up'`, al massimo 80 caratteri. */
  product?: string | null;
  /** Default: oggi. Non nel futuro. */
  checkedOn?: LocalDate;
  /** Km facoltativi: creano una lettura km collegata (stessa regola di coerenza monotona del registro). */
  km?: number | null;
  notes?: string | null;
  /**
   * Cosa fare se i km sono in conflitto con le letture vicine (finestra a tre scelte, SPEC 6.3.6 punto 5):
   * `fail` (default: errore `ODO_NON_MONOTONIC` con i dettagli, vedi `isOdometerConflict`), `skip_km` ("Salva senza aggiornare i km")
   * oppure `ignore-conflicting` ("E' un errore della lettura precedente": le letture in conflitto vengono messe da parte).
   */
  onOdometerConflict?: 'fail' | 'skip_km' | 'ignore-conflicting';
}

/** Un controllo registrato, con i testi italiani gia' pronti. */
export interface FluidCheckEntry extends FluidCheck {
  vehicleId: string;
  fluidLabelIt: string;
  /** "OK", "Basso", "Rabboccato", "Alto" ("Bassa", "Gonfiata", "Alta" per la pressione). */
  levelLabelIt: string;
  product: string | null;
  notes: string | null;
  /** Lettura km collegata (null se non c'erano km o la lettura e' stata messa da parte). */
  odometerReadingId: string | null;
  createdAt: string;
}

/** Completamento creato su una voce di controllo (`maintenance_completions.source = 'check'`). */
export interface FluidCompletion {
  completionId: string;
  itemId: string;
  itemName: string;
  /** Promemoria della voce chiuso da questo controllo (null se non c'era o la base non e' cambiata). */
  closedReminderId: string | null;
}

export interface AddFluidCheckResult {
  check: FluidCheckEntry;
  completions: FluidCompletion[];
  /** Lettura km creata (null se non c'erano km o sono stati ignorati). */
  odometerReadingId: string | null;
  /** I km erano in conflitto e sono stati ignorati (`onOdometerConflict: 'skip_km'`). */
  kmIgnored: boolean;
  /** Letture messe da parte con `ignore-conflicting`. */
  ignoredReadingIds: string[];
  /** Avvisi non bloccanti sui km (salto implausibile). */
  warnings: string[];
  /** Stato del fluido dopo il controllo (testi e suggerimento del dominio). */
  status: FluidStatus;
}

export interface DeleteFluidCheckResult {
  checkId: string;
  vehicleId: string;
  /** Completamenti annullati (soft delete) con ripristino esatto della voce. */
  undoneCompletionIds: string[];
  /** Promemoria riaperti dall'annullamento. */
  reopenedReminderIds: string[];
  /** Lettura km collegata, rimossa (null se non c'era). */
  removedReadingId: string | null;
}

export interface ListFluidChecksOptions {
  fluid?: Fluid;
  /** Estremi inclusi. */
  from?: LocalDate;
  to?: LocalDate;
  limit?: number;
  offset?: number;
}

/** Una riga dell'elenco S-24: lo stato del dominio piu' i testi guida e il prossimo controllo suggerito. */
export interface FluidStatusEntry extends FluidStatus {
  fluidLabelIt: string;
  /** Come si fa il controllo (testo breve del foglio). */
  hintIt: string;
  /** Cosa dice l'OBD su questo fluido: mai un livello (l'OBD standard non lo legge). */
  obdNoteIt: string;
  /** Falso per tutti i fluidi: nessun PID standard legge i livelli. */
  readableViaObd: false;
  /** Prossimo controllo suggerito (ultimo controllo + intervallo indicativo); null se mai controllato o senza intervallo. */
  nextCheckOn: LocalDate | null;
  /** Km del prossimo controllo suggerito (solo olio, se l'ultimo controllo aveva i km). */
  nextCheckKm: number | null;
}

export interface FluidStatusOptions {
  /** Unita' per mostrare la pressione misurata. Default bar. */
  pressureUnit?: 'bar' | 'psi';
}
