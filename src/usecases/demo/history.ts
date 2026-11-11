// Storico dell'auto di esempio (F-17): due anni di letture km, rifornimenti a benzina, due tagliandi e una revisione, calcolati dalla data di oggi.
// Funzione pura e deterministica: niente Math.random() ne' orologio, cosi' i test e le schermate restano stabili.
import { addDays, addMonths, weekday, type LocalDate } from '@/domain/dates';

/** Giorni di storico (da 730 giorni fa a due giorni fa). */
export const DEMO_SPAN_DAYS = 730;
/** Km alla prima lettura dello storico (auto immatricolata 5 anni fa, circa 10.000 km all'anno). */
export const DEMO_START_KM = 31_400;
/** Ultima lettura: due giorni fa (cosi' l'invito «Aggiorna i km» non compare subito). */
const LAST_DAY = DEMO_SPAN_DAYS - 2;

export interface DemoFuelLog {
  on: LocalDate;
  km: number;
  /** L'auto di esempio e' a sola benzina: un solo carburante, cosi' i consumi per serbatoio sono credibili. */
  fuelType: 'petrol';
  quantityMilli: number;
  unitPriceMilli: number;
  totalCents: number;
}

export interface DemoServiceLine {
  type: 'labor' | 'part' | 'fluid' | 'fee';
  description: string;
  amountCents: number;
  fluidKind?: 'engine_oil' | 'brake_fluid' | 'coolant';
  spec?: string;
}

export interface DemoService {
  on: LocalDate;
  km: number;
  kind: 'scheduled' | 'inspection';
  /** Solo per la revisione. */
  inspectionResult?: 'regular';
  title: string;
  lines: DemoServiceLine[];
  totalCents: number;
}

export interface DemoPlan {
  firstRegistrationOn: LocalDate;
  startOn: LocalDate;
  /** Letture inserite a mano. */
  manual: { on: LocalDate; km: number }[];
  fuel: DemoFuelLog[];
  services: DemoService[];
  /** Km dell'ultima lettura. */
  finalKm: number;
  finalOn: LocalDate;
}

// Fattori per giorno della settimana (0 = domenica): si usa l'auto per andare al lavoro, il fine settimana meno.
const WEEKDAY_FACTOR = [0.55, 1.15, 1.15, 1.15, 1.15, 1.2, 0.8] as const;
const BASE_KM_PER_DAY = 29;
const FUEL_GAPS = [13, 15, 14, 16, 12, 15, 14, 13] as const;

/** Km a ogni giorno dello storico (indice 0 = primo giorno): cumulati, mai decrescenti. */
function kmByDay(startOn: LocalDate): number[] {
  const out: number[] = [DEMO_START_KM];
  let cum = DEMO_START_KM;
  for (let i = 0; i < DEMO_SPAN_DAYS; i++) {
    const seasonal = 1 + 0.25 * Math.sin((2 * Math.PI * i) / 365 - 1.2); // piu' km d'estate
    cum += BASE_KM_PER_DAY * seasonal * WEEKDAY_FACTOR[weekday(addDays(startOn, i))]!;
    out.push(Math.round(cum));
  }
  return out;
}

const SERVICE_LINES_BASE: DemoServiceLine[] = [
  { type: 'fluid', description: 'Olio motore 5W-30 (3,5 L)', amountCents: 4800, fluidKind: 'engine_oil', spec: '5W-30' },
  { type: 'part', description: 'Filtro olio', amountCents: 1400 },
  { type: 'part', description: 'Filtro aria', amountCents: 1800 },
];

/** Il piano dello storico dell'auto di esempio per la data `today`. */
export function buildDemoPlan(today: LocalDate): DemoPlan {
  const startOn = addDays(today, -DEMO_SPAN_DAYS);
  const km = kmByDay(startOn);
  const on = (i: number): LocalDate => addDays(startOn, i);

  const fuel: DemoFuelLog[] = [];
  let day = 11;
  let previousKm = km[0]!;
  for (let k = 0; day <= LAST_DAY - 2; k++) {
    // Pieno a pieno: i litri coprono i km fatti dal rifornimento precedente, a circa 6,0-6,8 L/100 km (Panda 1.2 benzina).
    const distance = km[day]! - previousKm;
    const per100 = 6000 + ((k * 37) % 9) * 100; // millesimi di litro ogni 100 km
    const quantityMilli = Math.round((distance * per100) / 100);
    const unitPriceMilli = 1780 + ((k * 53) % 130);
    fuel.push({
      on: on(day),
      km: km[day]!,
      fuelType: 'petrol',
      quantityMilli,
      unitPriceMilli,
      totalCents: Math.round((quantityMilli * unitPriceMilli) / 10_000),
    });
    previousKm = km[day]!;
    day += FUEL_GAPS[k % FUEL_GAPS.length]!;
  }

  const manual: { on: LocalDate; km: number }[] = [];
  for (let i = 30; i < LAST_DAY; i += 45) manual.push({ on: on(i), km: km[i]! });
  manual.push({ on: on(LAST_DAY), km: km[LAST_DAY]! });

  const mkService = (offsetDays: number, extra: DemoServiceLine[], labor: number): DemoService => {
    const i = DEMO_SPAN_DAYS - offsetDays;
    const lines: DemoServiceLine[] = [
      { type: 'labor', description: 'Manodopera tagliando', amountCents: labor },
      ...SERVICE_LINES_BASE,
      ...extra,
    ];
    return { on: on(i), km: km[i]!, kind: 'scheduled', title: 'Tagliando', lines, totalCents: lines.reduce((s, l) => s + l.amountCents, 0) };
  };
  // Revisione regolare circa undici mesi fa (la prima era dovuta a quattro anni dall'immatricolazione).
  const inspectionIndex = DEMO_SPAN_DAYS - 335;
  const inspection: DemoService = {
    on: on(inspectionIndex),
    km: km[inspectionIndex]!,
    kind: 'inspection',
    inspectionResult: 'regular',
    title: 'Revisione',
    lines: [{ type: 'fee', description: 'Revisione ministeriale', amountCents: 7980 }],
    totalCents: 7980,
  };
  const services = [
    // Il primo tagliando comprende anche liquido freni, candele, refrigerante, batteria e spazzole: oggi alcune di queste
    // voci sono ormai da rifare (il semaforo dell'auto di esempio non e' tutto verde).
    mkService(
      540,
      [
        { type: 'fluid', description: 'Liquido freni', amountCents: 2200, fluidKind: 'brake_fluid' },
        { type: 'part', description: 'Candele', amountCents: 3600 },
        { type: 'fluid', description: 'Liquido refrigerante', amountCents: 2800, fluidKind: 'coolant' },
        { type: 'labor', description: 'Controllo batteria', amountCents: 1500 },
        { type: 'part', description: 'Spazzole tergicristallo', amountCents: 1800 },
      ],
      6500,
    ),
    inspection,
    mkService(175, [{ type: 'part', description: 'Filtro abitacolo', amountCents: 1900 }], 7000),
  ];

  return {
    firstRegistrationOn: addMonths(today, -60),
    startOn,
    manual,
    fuel,
    services,
    finalKm: km[LAST_DAY]!,
    finalOn: on(LAST_DAY),
  };
}
