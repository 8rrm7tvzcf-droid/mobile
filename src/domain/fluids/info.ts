// Testi e regole per ogni fluido (F-44). Onesta' prima di tutto: l'OBD standard NON legge il livello dell'olio,
// del refrigerante, del liquido freni, del lavavetri, dell'AdBlue ne' la pressione dei pneumatici (data.md OBD §17,
// SPEC §3.3 e §6.3.9): sono controlli manuali guidati. I suggerimenti non sostituiscono il libretto dell'auto.
import { CHECKLIST_FLUIDS, type Fluid, type FluidLevel, type FluidVehicle } from './types';

export interface FluidInfo {
  labelIt: string;
  /** Come si fa il controllo (testo breve sotto il titolo del foglio). */
  hintIt: string;
  /** Cosa dice l'OBD su questo fluido: mai un livello. */
  obdNoteIt: string;
  /** Ricontrollo consigliato: il primo dei due (giorni o km). `null` = nessun intervallo fisso. Valori indicativi. */
  recheckDays: number | null;
  recheckKm: number | null;
  /** Testo del promemoria predefinito (SPEC §6.3.9 punto 5) e se e' attivo di default. */
  reminderTextIt: string | null;
  reminderDefaultOn: boolean;
}

export const OBD_STANDARD_NOTE_IT =
  "L'OBD standard non legge il livello di olio, refrigerante, liquido freni, lavavetri e AdBlue, né la pressione dei pneumatici: sono controlli manuali.";

export const FLUID_INFO: Record<Fluid, FluidInfo> = {
  engine_oil: {
    labelIt: 'Olio motore',
    hintIt:
      "Motore freddo, auto in piano, con l'astina: il livello deve stare tra i segni MIN e MAX. Se l'auto non ha l'astina, segui il libretto.",
    obdNoteIt: "L'OBD standard non legge il livello dell'olio: il controllo è manuale.",
    recheckDays: 30,
    recheckKm: 1000,
    reminderTextIt: "Controlla il livello dell'olio ogni 1.000 km o prima di un viaggio lungo",
    reminderDefaultOn: true,
  },
  coolant: {
    labelIt: 'Refrigerante',
    hintIt: 'A motore freddo, guarda il vaso di espansione: il livello va tra MIN e MAX. Non aprire il tappo a motore caldo.',
    obdNoteIt: "L'OBD legge la temperatura del refrigerante, non il livello: il livello non è disponibile via OBD standard.",
    recheckDays: 30,
    recheckKm: null,
    reminderTextIt: 'Controlla il livello del refrigerante una volta al mese',
    reminderDefaultOn: false,
  },
  brake_fluid: {
    labelIt: 'Liquido freni',
    hintIt: 'Guarda il serbatoio: il livello va tra MIN e MAX. Scende piano con l\'usura delle pastiglie; un calo rapido va fatto vedere.',
    obdNoteIt: "L'OBD standard non legge il livello del liquido freni: il controllo è manuale.",
    recheckDays: 180,
    recheckKm: null,
    reminderTextIt: null,
    reminderDefaultOn: false,
  },
  washer: {
    labelIt: 'Liquido lavavetri',
    hintIt: 'Guarda il serbatoio del lavavetri e rabbocca con liquido apposito (in inverno con antigelo).',
    obdNoteIt: "L'OBD standard non legge il livello del lavavetri: il controllo è manuale.",
    recheckDays: 30,
    recheckKm: null,
    reminderTextIt: 'Controlla il liquido lavavetri una volta al mese',
    reminderDefaultOn: false,
  },
  adblue: {
    labelIt: 'AdBlue',
    hintIt: "Guarda l'autonomia residua indicata sul cruscotto o nel menu dell'auto: molte auto avvisano sotto i 2.000 km circa.",
    obdNoteIt: "L'OBD standard non legge il livello dell'AdBlue: alcune auto lo mostrano solo con i comandi del costruttore.",
    recheckDays: null,
    recheckKm: null,
    reminderTextIt: 'Rabbocca AdBlue quando il cruscotto segnala meno di circa 2.000 km di autonomia',
    reminderDefaultOn: false,
  },
  power_steering: {
    labelIt: 'Servosterzo',
    hintIt: 'Se ha un serbatoio, guarda che il livello stia tra MIN e MAX. Molte auto hanno il servosterzo elettrico e non lo hanno.',
    obdNoteIt: "L'OBD standard non legge il livello dell'olio del servosterzo: il controllo è manuale.",
    recheckDays: 180,
    recheckKm: null,
    reminderTextIt: null,
    reminderDefaultOn: false,
  },
  gearbox_oil: {
    labelIt: 'Olio cambio',
    hintIt: "Di solito non ha un controllo semplice: in molti cambi lo fa l'officina. Registra qui solo ciò che il libretto prevede.",
    obdNoteIt: "L'OBD standard non legge il livello dell'olio del cambio: il controllo è manuale o in officina.",
    recheckDays: null,
    recheckKm: null,
    reminderTextIt: null,
    reminderDefaultOn: false,
  },
  tyre_pressure: {
    labelIt: 'Pressione pneumatici',
    hintIt: "A freddo, con un manometro: i valori giusti sono sul libretto o sull'adesivo del montante della portiera.",
    obdNoteIt:
      'La pressione dei pneumatici (TPMS) non è disponibile via OBD standard: controllala a freddo con un manometro.',
    recheckDays: 30,
    recheckKm: null,
    reminderTextIt: 'Controlla la pressione a freddo ogni mese e prima dei viaggi',
    reminderDefaultOn: true,
  },
  other: {
    labelIt: 'Altro',
    hintIt: 'Un fluido non in elenco: scrivi il nome nelle note.',
    obdNoteIt: "L'OBD standard non legge i livelli dei fluidi: il controllo è manuale.",
    recheckDays: null,
    recheckKm: null,
    reminderTextIt: null,
    reminderDefaultOn: false,
  },
};

export const fluidLabelIt = (fluid: Fluid): string => FLUID_INFO[fluid].labelIt;

/** Nessun fluido e' leggibile con i PID standard: serve a dichiararlo nell'interfaccia senza ambiguita'. */
export const readableViaStandardObd = (_fluid: Fluid): false => false;

/** Etichetta dell'esito: per la pressione "Bassa / Gonfiata / Alta", per gli altri fluidi "Basso / Rabboccato / Alto". */
export function levelLabelIt(fluid: Fluid, level: FluidLevel): string {
  if (level === 'ok') return 'OK';
  if (fluid === 'tyre_pressure') return level === 'low' ? 'Bassa' : level === 'topped_up' ? 'Gonfiata' : 'Alta';
  return level === 'low' ? 'Basso' : level === 'topped_up' ? 'Rabboccato' : 'Alto';
}

/**
 * Suggerimento breve dopo l'esito, onesto e senza promesse: non dice mai "puoi circolare" ne' "e' sicuro".
 * `null` per l'esito OK (nessun suggerimento).
 */
export function levelSuggestionIt(fluid: Fluid, level: FluidLevel): string | null {
  if (level === 'ok') return null;
  if (level === 'topped_up') {
    if (fluid === 'tyre_pressure') return 'Ricontrolla la pressione tra qualche giorno: se cala da sola, può esserci una perdita.';
    if (fluid === 'brake_fluid') return 'Se il liquido freni continua a calare, fai controllare l\'impianto.';
    return 'Ricontrolla il livello tra qualche giorno: se cala spesso, fai controllare l\'auto.';
  }
  if (level === 'low') {
    switch (fluid) {
      case 'engine_oil':
        return "Rabbocca con l'olio indicato sul libretto (specifica e gradazione) e ricontrolla dopo qualche giorno. Se il livello cala spesso, fai controllare l'auto.";
      case 'coolant':
        return 'Controlla e rabbocca solo a motore freddo, con il liquido indicato sul libretto. Se cala spesso può esserci una perdita: fai controllare l\'auto.';
      case 'brake_fluid':
        return 'Non rabboccare senza sapere perché è calato: può dipendere da pastiglie consumate o da una perdita. Fai controllare l\'impianto frenante in officina.';
      case 'washer':
        return 'Rabbocca con liquido lavavetri (in inverno con antigelo).';
      case 'adblue':
        return "Rabbocca l'AdBlue: con il serbatoio vuoto molte auto non si riavviano.";
      case 'power_steering':
        return "Un calo del livello può indicare una perdita: fai controllare l'auto prima di un viaggio lungo.";
      case 'gearbox_oil':
        return "Fai controllare l'olio del cambio in officina.";
      case 'tyre_pressure':
        return "Gonfia ai valori del libretto o dell'adesivo sul montante, a freddo, e ricontrolla.";
      default:
        return 'Ricontrolla il livello e, se serve, fai controllare l\'auto.';
    }
  }
  // alto
  switch (fluid) {
    case 'engine_oil':
      return "Un livello sopra il massimo può danneggiare il motore: chiedi a un'officina prima di un viaggio lungo.";
    case 'coolant':
      return 'Il livello alto a freddo non è normale: ricontrolla a motore freddo e, se resta alto, chiedi a un\'officina.';
    case 'brake_fluid':
      return "Il livello alto è insolito: fai controllare l'impianto in officina.";
    case 'tyre_pressure':
      return 'Una pressione troppo alta riduce aderenza e comfort: riportala ai valori del libretto, a freddo.';
    default:
      return 'Il livello è sopra il massimo: ricontrolla e, se resta alto, chiedi a un\'officina.';
  }
}

/**
 * Quali fluidi hanno senso per questo veicolo. Elettriche e a idrogeno: niente olio motore, AdBlue, olio cambio;
 * AdBlue solo per i diesel.
 */
export function isFluidApplicable(fluid: Fluid, v: FluidVehicle): boolean {
  const noCombustion =
    v.powertrain === 'bev' ||
    v.powertrain === 'fcev' ||
    (v.powertrain == null && (v.fuelPrimary === 'electric' || v.fuelPrimary === 'hydrogen') && v.fuelSecondary == null);
  switch (fluid) {
    case 'engine_oil':
    case 'gearbox_oil':
      return !noCombustion;
    case 'adblue':
      return v.fuelPrimary === 'diesel';
    case 'power_steering':
      return !noCombustion;
    default:
      return true;
  }
}

/** I fluidi dell'elenco S-24 per questo veicolo, nell'ordine standard. */
export function applicableFluids(v: FluidVehicle, fluids: readonly Fluid[] = CHECKLIST_FLUIDS): Fluid[] {
  return fluids.filter((f) => isFluidApplicable(f, v));
}
