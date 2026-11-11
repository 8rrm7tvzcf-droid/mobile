// Le entita' esportabili in CSV (data.md 5.4): intestazioni in italiano, una riga per record, ID ULID in prima colonna
// (e ID dell'auto in seconda) per poter collegare i file. Il cestino non si esporta; l'auto demo nemmeno.
import type { SqlDatabase, SqlValue } from '@/domain/ports';
import { toCsv } from './csv';
import type { CsvColumn, CsvRow, CsvVariant } from './csv';

export type CsvEntityName =
  | 'veicoli'
  | 'letture_km'
  | 'interventi'
  | 'voci_intervento'
  | 'rifornimenti'
  | 'spese'
  | 'assicurazioni'
  | 'rate_assicurazione'
  | 'scadenze'
  | 'gomme'
  | 'controlli_livelli'
  | 'codici_errore';

/** `'all'`: tutte le auto (demo esclusa); `{ vehicleId }`: una sola auto. */
export type CsvScope = 'all' | { vehicleId: string };

const FUEL = { petrol: 'Benzina', diesel: 'Gasolio', lpg: 'GPL', cng: 'Metano', electric: 'Elettrico', hydrogen: 'Idrogeno', adblue: 'AdBlue', hvo: 'HVO' };
const CATEGORY = { legal: 'Legale', maintenance: 'Manutenzione', check: 'Controllo', tyres: 'Gomme', insurance: 'Assicurazione', other: 'Altro' };
const FLUID = {
  engine_oil: 'Olio motore',
  coolant: 'Refrigerante',
  brake_fluid: 'Liquido freni',
  washer: 'Lavavetri',
  adblue: 'AdBlue',
  gearbox_oil: 'Olio cambio',
  power_steering: 'Servosterzo',
  tyre_pressure: 'Pressione gomme',
  other: 'Altro',
};

const id = (label = 'ID'): CsvColumn => ({ key: 'id', label, type: 'text' });
const vehicleCol: CsvColumn = { key: 'vehicle_id', label: 'ID auto', type: 'text' };
const notes: CsvColumn = { key: 'notes', label: 'Note', type: 'text' };

interface Entity {
  file: string;
  columns: readonly CsvColumn[];
  /** SQL con i segnaposto per la condizione di ambito (`{scope}` = condizione su `v`, ripetibile). */
  sql: string;
  /** Quante volte compare `{scope}` (i parametri si ripetono). */
  scopeUses?: number;
}

const FROM_V = 'JOIN vehicles v ON v.id = ';
const LIVE = 'v.deleted_at IS NULL AND {scope}';

export const CSV_ENTITIES: Readonly<Record<CsvEntityName, Entity>> = {
  veicoli: {
    file: 'veicoli.csv',
    columns: [
      id(),
      { key: 'nickname', label: 'Soprannome', type: 'text' },
      { key: 'plate', label: 'Targa', type: 'text' },
      { key: 'vin', label: 'Telaio (VIN)', type: 'text' },
      { key: 'make', label: 'Marca', type: 'text' },
      { key: 'model', label: 'Modello', type: 'text' },
      { key: 'trim', label: 'Versione', type: 'text' },
      { key: 'model_year', label: 'Anno modello', type: 'int' },
      { key: 'first_registration_on', label: 'Prima immatricolazione', type: 'date' },
      {
        key: 'powertrain',
        label: 'Motorizzazione',
        type: 'text',
        map: { ice: 'Termico', mhev: 'Mild hybrid', hev: 'Ibrido', phev: 'Ibrido plug-in', bev: 'Elettrico', fcev: 'Idrogeno (fuel cell)' },
      },
      { key: 'fuel_primary', label: 'Alimentazione', type: 'text', map: FUEL },
      { key: 'fuel_secondary', label: 'Alimentazione secondaria', type: 'text', map: FUEL },
      { key: 'engine_cc', label: 'Cilindrata (cc)', type: 'int' },
      { key: 'power_kw', label: 'Potenza (kW)', type: 'int' },
      { key: 'euro_class', label: 'Classe Euro', type: 'text' },
      { key: 'status', label: 'Stato', type: 'text', map: { active: 'Attiva', sold: 'Venduta', scrapped: 'Rottamata', archived: 'Archiviata' } },
      { key: 'purchase_on', label: 'Data acquisto', type: 'date' },
      { key: 'purchase_km', label: 'Km acquisto', type: 'int' },
      { key: 'purchase_price_cents', label: 'Prezzo acquisto (EUR)', type: 'cents' },
      { key: 'sold_on', label: 'Data vendita', type: 'date' },
      { key: 'sold_km', label: 'Km vendita', type: 'int' },
      { key: 'sold_price_cents', label: 'Prezzo vendita (EUR)', type: 'cents' },
      notes,
    ],
    sql: `SELECT v.* FROM vehicles v WHERE ${LIVE} ORDER BY v.sort_order, v.id`,
  },
  letture_km: {
    file: 'letture_km.csv',
    columns: [
      id(),
      vehicleCol,
      { key: 'read_on', label: 'Data', type: 'date' },
      { key: 'km', label: 'Km', type: 'int' },
      {
        key: 'source',
        label: 'Origine',
        type: 'text',
        map: { manual: 'Manuale', obd: 'OBD', fuel: 'Rifornimento', service: 'Intervento', fluid_check: 'Controllo livelli', import: 'Importata' },
      },
      { key: 'status', label: 'Stato', type: 'text', map: { valid: 'Valida', ignored: 'Ignorata' } },
      { key: 'note', label: 'Nota', type: 'text' },
    ],
    sql: `SELECT o.* FROM odometer_readings o ${FROM_V}o.vehicle_id WHERE o.deleted_at IS NULL AND ${LIVE} ORDER BY o.vehicle_id, o.read_on, o.km, o.id`,
  },
  interventi: {
    file: 'interventi.csv',
    columns: [
      id(),
      vehicleCol,
      { key: 'service_on', label: 'Data', type: 'date' },
      {
        key: 'kind',
        label: 'Tipo',
        type: 'text',
        map: {
          scheduled: 'Programmato',
          repair: 'Riparazione',
          inspection: 'Revisione',
          tyres: 'Gomme',
          bodywork: 'Carrozzeria',
          accessories: 'Accessori',
          diagnostic: 'Diagnosi',
          other: 'Altro',
        },
      },
      { key: 'title', label: 'Titolo', type: 'text' },
      { key: 'workshop_name', label: 'Officina', type: 'text' },
      { key: 'total_cents', label: 'Totale (EUR)', type: 'cents' },
      { key: 'invoice_number', label: 'N. fattura', type: 'text' },
      { key: 'paid_on', label: 'Pagato il', type: 'date' },
      { key: 'warranty_until_on', label: 'Garanzia fino al', type: 'date' },
      { key: 'inspection_result', label: 'Esito revisione', type: 'text', map: { regular: 'Regolare', repeat: 'Da ripetere', suspended: 'Sospesa' } },
      notes,
    ],
    sql: `SELECT s.*, w.name AS workshop_name FROM service_records s ${FROM_V}s.vehicle_id LEFT JOIN workshops w ON w.id = s.workshop_id
          WHERE s.deleted_at IS NULL AND ${LIVE} ORDER BY s.vehicle_id, s.service_on, s.id`,
  },
  voci_intervento: {
    file: 'voci_intervento.csv',
    columns: [
      id(),
      { key: 'service_record_id', label: 'ID intervento', type: 'text' },
      vehicleCol,
      { key: 'position', label: 'Posizione', type: 'int' },
      {
        key: 'line_type',
        label: 'Tipo',
        type: 'text',
        map: { labor: 'Manodopera', part: 'Ricambio', fluid: 'Fluido', fee: 'Diritti e spese', other: 'Altro' },
      },
      { key: 'description', label: 'Descrizione', type: 'text' },
      { key: 'quantity_milli', label: 'Quantità', type: 'milli' },
      { key: 'unit_price_cents', label: 'Prezzo unitario (EUR)', type: 'cents' },
      { key: 'amount_cents', label: 'Importo (EUR)', type: 'cents' },
      { key: 'part_code', label: 'Codice ricambio', type: 'text' },
      { key: 'brand', label: 'Marca', type: 'text' },
      { key: 'spec', label: 'Specifica', type: 'text' },
      { key: 'fluid_kind', label: 'Fluido', type: 'text', map: FLUID },
      { key: 'warranty_months', label: 'Garanzia (mesi)', type: 'int' },
    ],
    sql: `SELECT l.*, s.vehicle_id AS vehicle_id FROM service_lines l JOIN service_records s ON s.id = l.service_record_id ${FROM_V}s.vehicle_id
          WHERE s.deleted_at IS NULL AND ${LIVE} ORDER BY s.vehicle_id, s.service_on, l.service_record_id, l.position, l.id`,
  },
  rifornimenti: {
    file: 'rifornimenti.csv',
    columns: [
      id(),
      vehicleCol,
      { key: 'filled_on', label: 'Data', type: 'date' },
      { key: 'fuel_type', label: 'Carburante', type: 'text', map: FUEL },
      { key: 'grade', label: 'Qualità', type: 'text' },
      { key: 'quantity_milli', label: 'Quantità', type: 'milli' },
      { key: 'quantity_unit', label: 'Unità', type: 'text' },
      { key: 'unit_price_milli', label: 'Prezzo unitario (EUR)', type: 'milli' },
      { key: 'total_cents', label: 'Totale (EUR)', type: 'cents' },
      { key: 'is_full', label: 'Pieno', type: 'bool' },
      { key: 'missed_before', label: 'Rifornimento mancato prima', type: 'bool' },
      { key: 'station', label: 'Distributore', type: 'text' },
      notes,
    ],
    sql: `SELECT f.* FROM fuel_logs f ${FROM_V}f.vehicle_id WHERE f.deleted_at IS NULL AND ${LIVE} ORDER BY f.vehicle_id, f.filled_on, f.id`,
  },
  spese: {
    file: 'spese.csv',
    columns: [
      id(),
      vehicleCol,
      { key: 'spent_on', label: 'Data', type: 'date' },
      { key: 'category_name', label: 'Categoria', type: 'text' },
      { key: 'amount_cents', label: 'Importo (EUR)', type: 'cents' },
      { key: 'description', label: 'Descrizione', type: 'text' },
      { key: 'vendor', label: 'Fornitore', type: 'text' },
      notes,
    ],
    sql: `SELECT e.*, c.name_it AS category_name FROM expenses e ${FROM_V}e.vehicle_id JOIN expense_categories c ON c.id = e.category_id
          WHERE e.deleted_at IS NULL AND ${LIVE} ORDER BY e.vehicle_id, e.spent_on, e.id`,
  },
  assicurazioni: {
    file: 'assicurazioni.csv',
    columns: [
      id(),
      vehicleCol,
      { key: 'kind', label: 'Tipo', type: 'text', map: { rca: 'RC auto', kasko: 'Kasko', furto_incendio: 'Furto e incendio', other: 'Altro' } },
      { key: 'company', label: 'Compagnia', type: 'text' },
      { key: 'agency_name', label: 'Agenzia', type: 'text' },
      { key: 'policy_number', label: 'N. polizza', type: 'text' },
      { key: 'start_on', label: 'Decorrenza', type: 'date' },
      { key: 'end_on', label: 'Scadenza', type: 'date' },
      { key: 'premium_cents', label: 'Premio (EUR)', type: 'cents' },
      {
        key: 'payment_frequency',
        label: 'Frequenza di pagamento',
        type: 'text',
        map: { single: 'Unica', annual: 'Annuale', semiannual: 'Semestrale', quarterly: 'Trimestrale', monthly: 'Mensile' },
      },
      { key: 'merit_class', label: 'Classe di merito', type: 'int' },
      { key: 'black_box', label: 'Scatola nera', type: 'bool' },
      { key: 'renewed_from_id', label: 'Rinnova la polizza', type: 'text' },
      { key: 'cancelled_on', label: 'Annullata il', type: 'date' },
      notes,
    ],
    sql: `SELECT p.* FROM insurance_policies p ${FROM_V}p.vehicle_id WHERE p.deleted_at IS NULL AND ${LIVE} ORDER BY p.vehicle_id, p.start_on, p.id`,
  },
  rate_assicurazione: {
    file: 'rate_assicurazione.csv',
    columns: [
      id(),
      { key: 'policy_id', label: 'ID polizza', type: 'text' },
      vehicleCol,
      { key: 'installment_no', label: 'N. rata', type: 'int' },
      { key: 'due_on', label: 'Scadenza', type: 'date' },
      { key: 'amount_cents', label: 'Importo (EUR)', type: 'cents' },
      { key: 'paid_on', label: 'Pagata il', type: 'date' },
      notes,
    ],
    sql: `SELECT ip.*, p.vehicle_id AS vehicle_id FROM insurance_payments ip JOIN insurance_policies p ON p.id = ip.policy_id ${FROM_V}p.vehicle_id
          WHERE ip.deleted_at IS NULL AND p.deleted_at IS NULL AND ${LIVE} ORDER BY p.vehicle_id, ip.policy_id, ip.installment_no`,
  },
  scadenze: {
    file: 'scadenze.csv',
    columns: [
      id(),
      vehicleCol,
      { key: 'origin', label: 'Origine', type: 'text', map: { rule: 'Regola', custom: 'Personalizzata' } },
      { key: 'name', label: 'Nome', type: 'text' },
      { key: 'category', label: 'Categoria', type: 'text', map: CATEGORY },
      {
        key: 'schedule_type',
        label: 'Tipo di regola',
        type: 'text',
        map: { interval_last_done: "Dall'ultimo fatto", interval_calendar: 'Serie di calendario', fixed_date: 'Data fissa' },
      },
      { key: 'interval_km', label: 'Ogni (km)', type: 'int' },
      { key: 'interval_months', label: 'Ogni (mesi)', type: 'int' },
      { key: 'last_done_on', label: 'Ultima esecuzione', type: 'date' },
      { key: 'last_done_km', label: 'Km ultima esecuzione', type: 'int' },
      { key: 'next_due_on', label: 'Prossima scadenza', type: 'date' },
      { key: 'next_due_km', label: 'Km prossima scadenza', type: 'int' },
      { key: 'status', label: 'Stato', type: 'text', map: { open: 'Aperta', done: 'Fatta', skipped: 'Saltata' } },
      { key: 'is_active', label: 'Attiva', type: 'bool' },
      notes,
    ],
    sql: `SELECT i.id AS id, i.vehicle_id AS vehicle_id, 'rule' AS origin, i.name AS name, i.category AS category,
            i.schedule_type AS schedule_type, i.interval_km AS interval_km, i.interval_months AS interval_months,
            l.last_done_on AS last_done_on, l.last_done_km AS last_done_km, r.effective_due_on AS next_due_on,
            r.due_km AS next_due_km, r.status AS status, i.is_active AS is_active, i.notes AS notes
          FROM maintenance_items i ${FROM_V}i.vehicle_id
          LEFT JOIN v_item_last_done l ON l.item_id = i.id
          LEFT JOIN reminders r ON r.item_id = i.id AND r.status = 'open' AND r.deleted_at IS NULL
          WHERE i.deleted_at IS NULL AND ${LIVE}
          UNION ALL
          SELECT r.id, r.vehicle_id, 'custom', r.title, r.category, NULL, NULL, NULL, NULL, NULL, r.effective_due_on, r.due_km, r.status, 1, r.notes
          FROM reminders r ${FROM_V}r.vehicle_id
          WHERE r.origin = 'manual' AND r.deleted_at IS NULL AND ${LIVE}
          ORDER BY 2, 3, 4, 1`,
    scopeUses: 2,
  },
  gomme: {
    file: 'gomme.csv',
    columns: [
      id(),
      vehicleCol,
      { key: 'label', label: 'Etichetta', type: 'text' },
      { key: 'season', label: 'Stagione', type: 'text', map: { summer: 'Estive', winter: 'Invernali', all_season: '4 stagioni' } },
      { key: 'brand', label: 'Marca', type: 'text' },
      { key: 'model', label: 'Modello', type: 'text' },
      { key: 'width_mm', label: 'Larghezza (mm)', type: 'int' },
      { key: 'aspect_pct', label: 'Spalla (%)', type: 'int' },
      { key: 'rim_in', label: 'Cerchio (pollici)', type: 'int' },
      { key: 'load_index', label: 'Indice di carico', type: 'int' },
      { key: 'speed_symbol', label: 'Simbolo di velocità', type: 'text' },
      { key: 'quantity', label: 'Quantità', type: 'int' },
      { key: 'dot_codes', label: 'DOT', type: 'text' },
      { key: 'purchased_on', label: 'Acquisto', type: 'date' },
      { key: 'purchase_price_cents', label: 'Prezzo (EUR)', type: 'cents' },
      { key: 'storage_location', label: 'Deposito', type: 'text' },
      { key: 'retired_on', label: 'Dismesse il', type: 'date' },
      notes,
    ],
    sql: `SELECT t.* FROM tyre_sets t ${FROM_V}t.vehicle_id WHERE t.deleted_at IS NULL AND ${LIVE} ORDER BY t.vehicle_id, t.season, t.id`,
  },
  controlli_livelli: {
    file: 'controlli_livelli.csv',
    columns: [
      id(),
      vehicleCol,
      { key: 'checked_on', label: 'Data', type: 'date' },
      { key: 'fluid', label: 'Fluido', type: 'text', map: FLUID },
      { key: 'level', label: 'Esito', type: 'text', map: { ok: 'OK', low: 'Basso', topped_up: 'Rabboccato', high: 'Alto' } },
      { key: 'added_ml', label: 'Aggiunto (ml)', type: 'int' },
      { key: 'value_millibar', label: 'Pressione (bar)', type: 'milli' },
      { key: 'product', label: 'Prodotto', type: 'text' },
      notes,
    ],
    sql: `SELECT c.* FROM fluid_checks c ${FROM_V}c.vehicle_id WHERE c.deleted_at IS NULL AND ${LIVE} ORDER BY c.vehicle_id, c.checked_on, c.id`,
  },
  codici_errore: {
    file: 'codici_errore.csv',
    columns: [
      id(),
      vehicleCol,
      { key: 'code', label: 'Codice', type: 'text' },
      { key: 'kind', label: 'Tipo', type: 'text', map: { stored: 'Memorizzato', pending: 'In attesa', permanent: 'Permanente' } },
      { key: 'state', label: 'Stato', type: 'text', map: { active: 'Attivo', absent: 'Assente', cleared: 'Cancellato', ignored: 'Ignorato' } },
      { key: 'first_seen_at', label: 'Prima rilevazione', type: 'date' },
      { key: 'last_seen_at', label: 'Ultima rilevazione', type: 'date' },
      { key: 'seen_count', label: 'Volte', type: 'int' },
      { key: 'odometer_km', label: 'Km', type: 'int' },
      { key: 'title_it', label: 'Descrizione', type: 'text' },
      { key: 'user_note', label: 'Nota', type: 'text' },
    ],
    sql: `SELECT e.* FROM dtc_events e ${FROM_V}e.vehicle_id WHERE e.deleted_at IS NULL AND ${LIVE} ORDER BY e.vehicle_id, e.last_seen_at, e.id`,
  },
};

export const CSV_ENTITY_NAMES = Object.keys(CSV_ENTITIES) as CsvEntityName[];

/** Costruisce i CSV richiesti: nome file -> testo. Legge su `db` (puo' essere una transazione di lettura). */
export async function buildCsvFiles(
  db: SqlDatabase,
  variant: CsvVariant,
  scope: CsvScope = 'all',
  entities: readonly CsvEntityName[] = CSV_ENTITY_NAMES,
): Promise<{ files: Record<string, string>; rows: Record<string, number> }> {
  const cond = scope === 'all' ? 'v.is_demo = 0' : 'v.id = ?';
  const scopeParams: SqlValue[] = scope === 'all' ? [] : [scope.vehicleId];
  const files: Record<string, string> = {};
  const rows: Record<string, number> = {};
  for (const name of entities) {
    const e = CSV_ENTITIES[name];
    const params: SqlValue[] = [];
    for (let i = 0; i < (e.scopeUses ?? 1); i++) params.push(...scopeParams);
    const data = await db.all<CsvRow>(e.sql.split('{scope}').join(cond), params);
    files[e.file] = toCsv(data, e.columns, variant);
    rows[name] = data.length;
  }
  return { files, rows };
}
