// "Cosa hai fatto?" (SPEC F-36): dalle righe e dal tipo dell'intervento alle voci del catalogo (`tpl_*`) che probabilmente completa.
// Funzioni pure: la categoria di una riga non e' salvata (0001 non ha la colonna), si deduce sempre dalle stesse regole,
// cosi' i suggerimenti del wizard e il "ultimo fatto" ricavato dallo storico concordano.
import type { LineCategory, InspectionResult, ServiceFluidKind, ServiceKind, ServiceLineType } from './types';

/** Voci del catalogo (SPEC 7.1) che una categoria di riga completa. */
export const CATEGORY_TEMPLATES: Readonly<Record<LineCategory, readonly string[]>> = {
  engine_oil: ['tpl_oil_change'],
  oil_filter: ['tpl_oil_change'],
  air_filter: ['tpl_air_filter'],
  cabin_filter: ['tpl_cabin_filter'],
  fuel_filter: ['tpl_fuel_filter'],
  spark_plugs: ['tpl_spark_plugs'],
  timing_belt: ['tpl_timing_belt'],
  brake_fluid: ['tpl_brake_fluid'],
  brakes: ['tpl_brake_inspection'],
  coolant: ['tpl_coolant'],
  gearbox_oil: ['tpl_gearbox_oil'],
  battery: ['tpl_battery_replace'],
  battery_check: ['tpl_battery_check'],
  wipers: ['tpl_wipers'],
  air_conditioning: ['tpl_ac_service'],
  tyre_rotation: ['tpl_tyre_rotation'],
  tyres_winter: ['tpl_tyres_winter'],
  tyres_summer: ['tpl_tyres_summer'],
  gas_system: ['tpl_gas_system_check'],
  gas_cylinder: ['tpl_gas_cylinder'],
};

export const LINE_CATEGORY_LABELS: Readonly<Record<LineCategory, string>> = {
  engine_oil: 'Olio motore',
  oil_filter: 'Filtro olio',
  air_filter: 'Filtro aria',
  cabin_filter: 'Filtro abitacolo',
  fuel_filter: 'Filtro carburante',
  spark_plugs: 'Candele',
  timing_belt: 'Distribuzione',
  brake_fluid: 'Liquido freni',
  brakes: 'Freni',
  coolant: 'Liquido refrigerante',
  gearbox_oil: 'Olio cambio',
  battery: 'Batteria',
  battery_check: 'Controllo batteria',
  wipers: 'Spazzole tergicristallo',
  air_conditioning: 'Climatizzatore',
  tyre_rotation: 'Rotazione pneumatici',
  tyres_winter: 'Gomme invernali',
  tyres_summer: 'Gomme estive',
  gas_system: 'Impianto GPL/metano',
  gas_cylinder: 'Bombola GPL/metano',
};

/** Testo in minuscolo, senza accenti ne' punteggiatura ("Filtro d'aria" -> "filtro d aria"). */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const FLUID_CATEGORY: Partial<Record<ServiceFluidKind, LineCategory>> = {
  engine_oil: 'engine_oil',
  gearbox_oil: 'gearbox_oil',
  brake_fluid: 'brake_fluid',
  coolant: 'coolant',
};

/** Categoria dedotta da un testo libero (descrizione di una riga, titolo dell'intervento, nome di una voce). */
export function categoryOfText(text: string): LineCategory | null {
  const t = normalizeText(text);
  if (t === '') return null;
  if (/\bfiltr\w*\b.*\b(abitacolo|antipolline|pollini|polline|climatizzatore|clima|aria condizionata)\b/.test(t)) return 'cabin_filter';
  if (/\bfiltr\w*\b.*\baria\b/.test(t)) return 'air_filter';
  if (/\bfiltr\w*\b.*\b(carburante|gasolio|benzina|nafta|diesel)\b/.test(t)) return 'fuel_filter';
  if (/\bfiltr\w*\b.*\bolio\b|\bolio\b.*\bfiltr\w*\b/.test(t)) return 'oil_filter';
  if (/\b(liquido|olio)\b.*\bfreni\b/.test(t)) return 'brake_fluid';
  if (/\b(idroguida|servosterzo)\b/.test(t)) return null;
  if (/\bolio (del |per |di )?(cambio|trasmissione|differenziale)\b|\batf\b/.test(t)) return 'gearbox_oil';
  if (/\bolio\b|\b\d{1,2}w ?\d{2}\b/.test(t)) return 'engine_oil';
  if (/\b(refrigerante|antigelo|radiatore|raffreddamento)\b/.test(t)) return 'coolant';
  if (/\b(pastiglie|dischi|ganasce|pinze|freni|freno)\b/.test(t)) return 'brakes';
  if (/\bcandele?\b/.test(t)) return 'spark_plugs';
  if (/\bdistribuzione\b/.test(t)) return 'timing_belt';
  if (/\b(controllo|test|verifica|diagnosi)\b.*\bbatteria\b|\bbatteria\b.*\b(controllo|test|verifica)\b/.test(t)) return 'battery_check';
  if (/\bbatteria\b/.test(t)) return 'battery';
  if (/\b(spazzole|tergicristall\w*|tergi)\b/.test(t)) return 'wipers';
  if (/\b(climatizzator\w*|condizionat\w*|clima|sanificazione)\b/.test(t)) return 'air_conditioning';
  const tyres = /\b(pneumatici|gomme)\b/.test(t);
  if (tyres && /\b(rotazione|inversione|incrocio)\b/.test(t)) return 'tyre_rotation';
  if (tyres && /\binvernal\w*\b/.test(t)) return 'tyres_winter';
  if (tyres && /\bestiv\w*\b/.test(t)) return 'tyres_summer';
  if (/\bimpianto\b.*\b(gpl|metano)\b|\b(gpl|metano)\b.*\bimpianto\b/.test(t)) return 'gas_system';
  if (/\bbombola\b/.test(t)) return 'gas_cylinder';
  return null;
}

export interface LineLike {
  lineType: ServiceLineType;
  fluidKind?: ServiceFluidKind | null;
  description: string;
}

/** Categoria di una riga: prima il tipo di fluido, poi la descrizione. */
export function lineCategoryOf(line: LineLike): LineCategory | null {
  if (line.fluidKind) {
    const byFluid = FLUID_CATEGORY[line.fluidKind];
    if (byFluid) return byFluid;
  }
  return categoryOfText(line.description);
}

export interface ServiceLike {
  kind: ServiceKind;
  title: string | null;
  inspectionResult?: InspectionResult | null;
  lines: readonly LineLike[];
}

export interface ServiceMatch {
  /** Voci del catalogo indicate dall'intervento, con il perche' (italiano). */
  templates: Map<string, string>;
  /** Categorie presenti nelle righe e nel titolo (servono alle voci personalizzate, senza `template_id`). */
  categories: Map<LineCategory, string>;
  /** Voci che l'intervento tocca ma NON completa, con il motivo (revisione da ripetere o sospesa). */
  notCompleted: Map<string, string>;
}

/** "Tagliando completo": il titolo lo dice (o manca): comprende la voce Tagliando e il cambio olio. */
export function isFullServiceTitle(title: string | null | undefined): boolean {
  const t = normalizeText(title ?? '');
  return t === '' || /\b(tagliando|service|manutenzione programmata|manutenzione periodica)\b/.test(t);
}

const INSPECTION_NOT_DONE: Record<Exclude<InspectionResult, 'regular'>, string> = {
  repeat: 'Con esito «da ripetere» la revisione non è superata: la scadenza non si sposta, va rifatta entro un mese.',
  suspended: 'Con esito «sospesa» serve una nuova richiesta di revisione: la scadenza non si sposta.',
};

/** Quali voci del catalogo indicano le righe e il tipo di un intervento (puro, deterministico). */
export function matchService(like: ServiceLike): ServiceMatch {
  const templates = new Map<string, string>();
  const categories = new Map<LineCategory, string>();
  const notCompleted = new Map<string, string>();
  const add = (cat: LineCategory, reason: string): void => {
    if (!categories.has(cat)) categories.set(cat, reason);
    for (const t of CATEGORY_TEMPLATES[cat]) if (!templates.has(t)) templates.set(t, reason);
  };

  for (const l of like.lines) {
    const cat = lineCategoryOf(l);
    if (cat) add(cat, `Riga «${l.description.trim()}»`);
  }

  const title = like.title?.trim() ?? '';
  if (like.kind === 'scheduled' && isFullServiceTitle(title)) {
    if (!templates.has('tpl_service_main')) templates.set('tpl_service_main', 'Tagliando');
    if (!templates.has('tpl_oil_change')) templates.set('tpl_oil_change', 'Il tagliando comprende il cambio olio');
    if (!templates.has('tpl_ev_service')) templates.set('tpl_ev_service', 'Tagliando');
  }
  const titleCat = categoryOfText(title);
  if (titleCat) add(titleCat, `Tipo «${title}»`);

  if (like.kind === 'inspection') {
    const result = like.inspectionResult ?? null;
    if (result === 'repeat' || result === 'suspended') notCompleted.set('tpl_inspection', INSPECTION_NOT_DONE[result]);
    else if (result === 'regular') templates.set('tpl_inspection', 'Revisione con esito regolare');
  }
  return { templates, categories, notCompleted };
}

// ---------------------------------------------------------------- preimpostazioni per la UI (S-20)

export interface ServicePreset {
  id: string;
  label: string;
  kind: ServiceKind;
  title: string;
}

/** I "chip" del tipo di intervento (SPEC 6.3.6 punto 1) e il `kind` che salvano. */
export const SERVICE_PRESETS: readonly ServicePreset[] = [
  { id: 'service', label: 'Tagliando', kind: 'scheduled', title: 'Tagliando' },
  { id: 'oil', label: 'Cambio olio e filtri', kind: 'scheduled', title: 'Cambio olio e filtri' },
  { id: 'brakes', label: 'Freni', kind: 'repair', title: 'Freni' },
  { id: 'tyres', label: 'Gomme', kind: 'tyres', title: 'Gomme' },
  { id: 'timing', label: 'Distribuzione', kind: 'scheduled', title: 'Distribuzione' },
  { id: 'battery', label: 'Batteria', kind: 'repair', title: 'Batteria' },
  { id: 'inspection', label: 'Revisione', kind: 'inspection', title: 'Revisione' },
  { id: 'bodywork', label: 'Carrozzeria', kind: 'bodywork', title: 'Carrozzeria' },
  { id: 'other', label: 'Altro', kind: 'other', title: 'Intervento' },
];

export interface LinePreset {
  category: LineCategory;
  lineType: ServiceLineType;
  description: string;
  fluidKind?: ServiceFluidKind;
}

/** Righe pronte (descrizione canonica) per il selettore delle righe: ognuna si classifica nella propria categoria. */
export const LINE_PRESETS: readonly LinePreset[] = [
  { category: 'engine_oil', lineType: 'fluid', description: 'Olio motore', fluidKind: 'engine_oil' },
  { category: 'oil_filter', lineType: 'part', description: 'Filtro olio' },
  { category: 'air_filter', lineType: 'part', description: 'Filtro aria' },
  { category: 'cabin_filter', lineType: 'part', description: 'Filtro abitacolo' },
  { category: 'fuel_filter', lineType: 'part', description: 'Filtro carburante' },
  { category: 'spark_plugs', lineType: 'part', description: 'Candele' },
  { category: 'timing_belt', lineType: 'part', description: 'Kit distribuzione' },
  { category: 'brake_fluid', lineType: 'fluid', description: 'Liquido freni', fluidKind: 'brake_fluid' },
  { category: 'brakes', lineType: 'part', description: 'Pastiglie freni' },
  { category: 'coolant', lineType: 'fluid', description: 'Liquido refrigerante', fluidKind: 'coolant' },
  { category: 'gearbox_oil', lineType: 'fluid', description: 'Olio cambio', fluidKind: 'gearbox_oil' },
  { category: 'battery', lineType: 'part', description: 'Batteria 12 V' },
  { category: 'wipers', lineType: 'part', description: 'Spazzole tergicristallo' },
  { category: 'air_conditioning', lineType: 'labor', description: 'Sanificazione climatizzatore' },
  { category: 'tyre_rotation', lineType: 'labor', description: 'Rotazione pneumatici' },
];
