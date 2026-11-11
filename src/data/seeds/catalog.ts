// Cataloghi precaricati (data.md 1.5 / SPEC 7.1): 13 categorie di spesa di sistema e 27 template di manutenzione.
//
// I valori dei template sono INDICATIVI (is_indicative = 1): il libretto di uso e manutenzione del costruttore
// prevale e la UI lo dice. Le regole di legge (revisione 4+2 anni a fine mese, bollo, bombole) e le date delle
// gomme vengono da docs/research/features.md sezione 17.
//
// Per cambiare un valore in un rilascio successivo si alza `version` della riga: l'upsert (seed.ts) sovrascrive
// solo se la versione e' piu' alta. Gli item gia' creati dagli utenti non vengono mai toccati.
//
// Tag veicolo di `applies_to` (derivati nel dominio da powertrain e alimentazioni, MAI salvati):
// combustion | petrol | diesel | gas (GPL/metano primario o secondario) | bev. NULL = tutti.

export type TemplateCategory = 'legal' | 'maintenance' | 'check' | 'tyres' | 'other';
export type TemplateScheduleType = 'interval_last_done' | 'interval_calendar' | 'fixed_date';
export type VehicleTag = 'combustion' | 'petrol' | 'diesel' | 'gas' | 'bev';

/** [id, nome, icona, ordine] */
export type ExpenseCategorySeed = readonly [id: string, nameIt: string, icon: string, sortOrder: number];

export const EXPENSE_CATEGORIES: readonly ExpenseCategorySeed[] = [
  ['sys_insurance_other', 'Assicurazione (altro)', 'shield', 10],
  ['sys_road_tax', 'Bollo auto', 'receipt', 20],
  ['sys_inspection', 'Revisione', 'clipboard-check', 30],
  ['sys_parking', 'Parcheggio e sosta', 'parking', 40],
  ['sys_tolls', 'Pedaggi', 'road', 50],
  ['sys_fines', 'Multe', 'alert-triangle', 60],
  ['sys_washing', 'Lavaggio e cura', 'droplets', 70],
  ['sys_accessories', 'Accessori', 'package', 80],
  ['sys_fees', 'Pratiche e passaggi (ACI, PRA)', 'file-text', 90],
  ['sys_financing', 'Finanziamento / leasing / noleggio', 'landmark', 100],
  ['sys_garage', 'Box e rimessaggio', 'warehouse', 110],
  ['sys_purchase', 'Acquisto veicolo', 'shopping-cart', 120],
  ['sys_other', 'Altro', 'more-horizontal', 999],
];

/** [id, nome, categoria, tipo, km, mesi, fine periodo, ancora (mese, giorno), giorni "in arrivo", km "in arrivo",
 *   preavvisi (giorni prima), si applica a, attivo di default, indicativo, nota] */
export type TemplateSeed = readonly [
  id: string,
  nameIt: string,
  category: TemplateCategory,
  scheduleType: TemplateScheduleType,
  intervalKm: number | null,
  intervalMonths: number | null,
  periodEnd: 'exact' | 'end_of_month',
  anchor: readonly [month: number, day: number] | null,
  soonDays: number,
  soonKm: number,
  notifyOffsetsDays: readonly number[],
  appliesTo: readonly VehicleTag[] | null,
  defaultEnabled: 0 | 1,
  isIndicative: 0 | 1,
  noteIt: string | null,
];

const L = 'interval_last_done';
const C = 'interval_calendar';
const F = 'fixed_date';

export const TEMPLATES: readonly TemplateSeed[] = [
  // --- scadenze di legge
  ['tpl_inspection', 'Revisione periodica', 'legal', L, null, 24, 'end_of_month', null, 30, 0, [60, 30, 14, 7, 0], null, 1, 0,
    "Prima revisione 4 anni dopo l'immatricolazione, poi ogni 2 anni, entro fine mese. Controlla sempre la data sull'ultimo tagliando di revisione."],
  ['tpl_road_tax', 'Bollo auto', 'legal', C, null, 12, 'exact', null, 30, 0, [30, 15, 7, 0], null, 1, 0,
    "Inserisci l'ultimo giorno utile di pagamento (di norma fine del mese successivo a quello di scadenza). L'importo non viene calcolato: usa i servizi ufficiali."],
  ['tpl_gas_cylinder', 'Riqualifica bombola GPL/metano', 'legal', F, null, null, 'exact', null, 60, 0, [90, 30, 7, 0], ['gas'], 1, 0,
    "La scadenza e' sul cartellino della bombola: inseriscila a mano (foto consigliata)."],
  ['tpl_gas_system_check', 'Controllo impianto GPL/metano', 'maintenance', L, null, 12, 'exact', null, 30, 0, [14, 3, 0], ['gas'], 1, 1,
    'Valore indicativo: verifica il libretto uso e manutenzione o l\'installatore.'],
  // --- manutenzione programmata (valori indicativi: il libretto uso e manutenzione del costruttore prevale)
  ['tpl_service_main', 'Tagliando', 'maintenance', L, 15000, 12, 'exact', null, 30, 1500, [14, 3, 0], null, 1, 1,
    "Intervallo indicativo: usa quello del libretto di uso e manutenzione."],
  ['tpl_oil_change', 'Cambio olio motore e filtro', 'maintenance', L, 15000, 12, 'exact', null, 30, 1500, [14, 3, 0], ['combustion'], 1, 1,
    "Se il tuo tagliando comprende gia' l'olio, puoi disattivare questa voce."],
  ['tpl_cabin_filter', 'Filtro abitacolo', 'maintenance', L, 15000, 12, 'exact', null, 30, 1500, [14, 0], null, 1, 1, null],
  ['tpl_air_filter', 'Filtro aria motore', 'maintenance', L, 30000, 24, 'exact', null, 30, 2000, [14, 0], ['combustion'], 1, 1, null],
  ['tpl_fuel_filter', 'Filtro carburante', 'maintenance', L, 30000, 24, 'exact', null, 30, 2000, [14, 0], ['diesel'], 1, 1, null],
  ['tpl_spark_plugs', 'Candele', 'maintenance', L, 60000, 48, 'exact', null, 60, 3000, [30, 7, 0], ['petrol'], 1, 1, null],
  ['tpl_timing_belt', 'Cinghia di distribuzione', 'maintenance', L, 120000, 60, 'exact', null, 90, 5000, [90, 30, 7, 0], ['combustion'], 0, 1,
    "Molto variabile (molte auto hanno la catena): attivala solo se il libretto la prevede e imposta tu l'intervallo."],
  ['tpl_brake_fluid', 'Liquido freni', 'maintenance', L, null, 24, 'exact', null, 30, 0, [30, 7, 0], null, 1, 1,
    'Di norma ogni 2 anni: verifica sul libretto uso e manutenzione.'],
  ['tpl_coolant', 'Liquido refrigerante', 'maintenance', L, 60000, 48, 'exact', null, 60, 3000, [30, 7, 0], ['combustion'], 1, 1, null],
  ['tpl_brake_inspection', 'Controllo freni (pastiglie e dischi)', 'maintenance', L, 20000, 12, 'exact', null, 30, 1500, [14, 0], null, 1, 1, null],
  ['tpl_battery_check', 'Controllo batteria 12V', 'maintenance', L, null, 12, 'exact', null, 30, 0, [14, 0], null, 1, 1, null],
  ['tpl_battery_replace', 'Sostituzione batteria 12V', 'maintenance', L, null, 60, 'exact', null, 60, 0, [60, 14, 0], null, 0, 1,
    'Durata tipica 4-6 anni, molto variabile.'],
  ['tpl_wipers', 'Spazzole tergicristallo', 'maintenance', L, null, 12, 'exact', null, 21, 0, [7, 0], null, 1, 1, null],
  ['tpl_ac_service', 'Climatizzatore: sanificazione/ricarica', 'maintenance', L, null, 24, 'exact', null, 30, 0, [14, 0], null, 0, 1, null],
  ['tpl_gearbox_oil', 'Olio cambio', 'maintenance', L, 90000, 72, 'exact', null, 60, 5000, [30, 7, 0], null, 0, 1,
    'Molto variabile e a volte "a vita": imposta tu l\'intervallo.'],
  ['tpl_ev_service', 'Controllo veicolo elettrico', 'maintenance', L, 30000, 24, 'exact', null, 30, 2000, [14, 3, 0], ['bev'], 1, 1, null],
  ['tpl_tyre_rotation', 'Rotazione pneumatici', 'tyres', L, 10000, null, 'exact', null, 14, 1000, [7, 0], null, 0, 1, null],
  // --- controlli a mano (non esistono PID OBD standard)
  ['tpl_check_oil_level', 'Controlla livello olio motore', 'check', L, 1000, 1, 'exact', null, 3, 200, [0], ['combustion'], 1, 1,
    "Motore freddo, auto in piano, con l'astina. Registra OK / basso / rabboccato."],
  ['tpl_check_tyre_pressure', 'Controlla pressione pneumatici (a freddo)', 'check', L, null, 1, 'exact', null, 3, 0, [0], null, 1, 1,
    "A freddo e prima dei viaggi lunghi; valori sul libretto o sull'adesivo del montante."],
  ['tpl_check_coolant_washer', 'Controlla refrigerante e lavavetri', 'check', L, null, 1, 'exact', null, 3, 0, [0], ['combustion'], 0, 1, null],
  ['tpl_check_adblue', 'Controlla AdBlue', 'check', L, 2000, null, 'exact', null, 0, 500, [0], ['diesel'], 0, 1,
    'Quando il cruscotto segnala meno di circa 2.000 km di autonomia.'],
  // --- cambio gomme stagionale (date di calendario annuali)
  ['tpl_tyres_winter', 'Montaggio gomme invernali', 'tyres', C, null, 12, 'exact', [11, 15], 21, 0, [14, 3, 0], null, 0, 0,
    'Obbligo invernali o catene a bordo dal 15 novembre al 15 aprile sulle strade con ordinanza.'],
  ['tpl_tyres_summer', 'Montaggio gomme estive', 'tyres', C, null, 12, 'exact', [4, 15], 21, 0, [14, 3, 0], null, 0, 0,
    "Se le invernali hanno indice di velocita' inferiore al libretto vanno sostituite dal 15 maggio al 15 ottobre."],
];

/** Riga di `service_templates` pronta per l'upsert (nomi di colonna, JSON gia' serializzati). */
export interface TemplateRow {
  id: string;
  version: number;
  name_it: string;
  category: TemplateCategory;
  schedule_type: TemplateScheduleType;
  interval_km: number | null;
  interval_months: number | null;
  period_end: 'exact' | 'end_of_month';
  anchor_month: number | null;
  anchor_day: number | null;
  soon_days: number;
  soon_km: number;
  notify_offsets_days: string;
  applies_to: string | null;
  default_enabled: number;
  is_indicative: number;
  note_it: string | null;
  sort_order: number;
}

export function templateRow(t: TemplateSeed, index: number, version = 1): TemplateRow {
  const [
    id,
    name_it,
    category,
    schedule_type,
    interval_km,
    interval_months,
    period_end,
    anchor,
    soon_days,
    soon_km,
    offsets,
    applies,
    default_enabled,
    is_indicative,
    note_it,
  ] = t;
  return {
    id,
    version,
    name_it,
    category,
    schedule_type,
    interval_km,
    interval_months,
    period_end,
    anchor_month: anchor ? anchor[0] : null,
    anchor_day: anchor ? anchor[1] : null,
    soon_days,
    soon_km,
    notify_offsets_days: JSON.stringify(offsets),
    applies_to: applies ? JSON.stringify(applies) : null,
    default_enabled,
    is_indicative,
    note_it,
    sort_order: (index + 1) * 10,
  };
}

/** Le 27 righe dei template, nell'ordine del catalogo. */
export const TEMPLATE_ROWS: readonly TemplateRow[] = TEMPLATES.map((t, i) => templateRow(t, i));
