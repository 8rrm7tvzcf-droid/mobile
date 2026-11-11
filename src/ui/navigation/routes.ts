// Indirizzi delle schermate in un solo posto: le rotte di src/app restano sottili e senza stringhe sparse.
import type { Href } from 'expo-router';

const h = (path: string): Href => path as Href;

export const routes = {
  today: h('/'),
  garage: h('/garage'),
  /** Registro (scheda): con `vehicleId` si apre sull'auto indicata. */
  registry: (vehicleId?: string): Href => h(vehicleId ? `/registro?auto=${vehicleId}` : '/registro'),
  settings: h('/impostazioni'),
  /** Backup e dati (Impostazioni): backup, ripristino, CSV, cancellazione. */
  backup: h('/backup'),
  /** Cestino: auto e documenti eliminati negli ultimi 30 giorni. */
  trash: h('/cestino'),
  welcome: h('/benvenuto'),
  newVehicle: h('/auto/nuova'),
  /** Dal benvenuto: a fine percorso si arriva a "Oggi". */
  newVehicleFirst: h('/auto/nuova?primo=1'),
  vehicle: (id: string): Href => h(`/auto/${id}`),
  editVehicle: (id: string): Href => h(`/auto/${id}/modifica`),
  vehicleKm: (id: string): Href => h(`/auto/${id}/km`),
  vehicleDeadlines: (id: string): Href => h(`/auto/${id}/scadenze`),
  /** Rifornimenti: elenco con consumi, nuovo (valori predefiniti) e modifica. */
  fuelList: (id: string): Href => h(`/auto/${id}/rifornimenti`),
  fuelNew: (id: string): Href => h(`/auto/${id}/rifornimento/nuovo`),
  fuelEdit: (id: string, logId: string): Href => h(`/auto/${id}/rifornimento/${logId}`),
  /** Spese: elenco, nuova e modifica. */
  expenseList: (id: string): Href => h(`/auto/${id}/spese`),
  expenseNew: (id: string): Href => h(`/auto/${id}/spesa/nuova`),
  expenseEdit: (id: string, expenseId: string): Href => h(`/auto/${id}/spesa/${expenseId}`),
  /** Interventi: elenco, nuovo (`tipo` = chip gia' scelto, per esempio 'oil'), dettaglio e modifica. */
  serviceList: (id: string): Href => h(`/auto/${id}/interventi`),
  serviceNew: (id: string, preset?: string): Href => h(preset ? `/auto/${id}/intervento/nuovo?tipo=${preset}` : `/auto/${id}/intervento/nuovo`),
  serviceDetail: (id: string, recordId: string): Href => h(`/auto/${id}/intervento/${recordId}`),
  serviceEdit: (id: string, recordId: string): Href => h(`/auto/${id}/intervento/${recordId}/modifica`),
  /** Controllo livelli: stato dei fluidi, nuovo controllo (`fluido` gia' scelto) e dettaglio di un controllo. */
  fluids: (id: string): Href => h(`/auto/${id}/livelli`),
  fluidNew: (id: string, fluid?: string): Href => h(fluid ? `/auto/${id}/livelli/nuovo?fluido=${fluid}` : `/auto/${id}/livelli/nuovo`),
  fluidCheck: (id: string, checkId: string): Href => h(`/auto/${id}/livelli/${checkId}`),
  /** Assicurazioni: elenco, nuova, dettaglio, modifica e rinnovo. */
  policies: (id: string): Href => h(`/auto/${id}/assicurazioni`),
  policyNew: (id: string): Href => h(`/auto/${id}/polizza/nuova`),
  policyDetail: (id: string, policyId: string): Href => h(`/auto/${id}/polizza/${policyId}`),
  policyEdit: (id: string, policyId: string): Href => h(`/auto/${id}/polizza/${policyId}/modifica`),
  policyRenew: (id: string, policyId: string): Href => h(`/auto/${id}/polizza/${policyId}/rinnova`),
  /** Documenti dell'auto: libretto, assicurazione, ricevute, foto. */
  documents: (id: string): Href => h(`/auto/${id}/documenti`),
  /** Costi: totali, costo al km e grafico mensile. */
  costs: (id: string): Href => h(`/auto/${id}/costi`),
  /** OBD: introduzione e collegamento, lettura, compatibilita', dati dal vivo (modalita' demo con l'auto simulata). */
  vehicleObd: (id: string): Href => h(`/auto/${id}/obd`),
  vehicleObdReading: (id: string): Href => h(`/auto/${id}/obd/lettura`),
  vehicleObdCompat: (id: string): Href => h(`/auto/${id}/obd/compatibilita`),
  vehicleObdLive: (id: string): Href => h(`/auto/${id}/obd/live`),
  /** Guida all'adattatore (statica); con l'auto, offre la prova con l'auto simulata. */
  obdAdapter: (vehicleId?: string): Href => h(vehicleId ? `/adattatore-obd?auto=${vehicleId}` : '/adattatore-obd'),
  /** Date dei documenti: immatricolazione, revisione, bollo e assicurazione RC in una schermata. */
  documentDates: (id: string): Href => h(`/auto/${id}/date`),
  /** `first`: arriva dal primo avvio, a fine wizard si va a "Oggi". */
  setup: (id: string, first = false): Href => h(`/auto/${id}/imposta${first ? '?primo=1' : ''}`),
  /** `action`: apre subito il foglio "Fatto" o "Rimanda". */
  deadline: (id: string, action?: 'fatto' | 'rimanda'): Href => h(`/scadenza/${id}${action ? `?azione=${action}` : ''}`),
};
