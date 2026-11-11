// Formato del backup (SPEC 8.5, data.md 5.2): documento JSON versionato `data.json`.
// `formatVersion` (del file) e' SEPARATO da `schemaVersion` (del database): il formato passa da una catena di upgrader.
import { BackupAbort } from './errors';

export const BACKUP_FORMAT = 'mygarage.backup';
export const FORMAT_VERSION = 1;

export type JsonScalar = string | number | null;
export type BackupRow = Record<string, JsonScalar>;

export interface BackupFileRef {
  attachmentId: string;
  path: string;
  sha256: string;
  size: number;
}

export interface BackupDocument {
  format: string;
  formatVersion: number;
  /** Versione dello schema del database che ha prodotto il file (migrations_log). */
  schemaVersion: number;
  appVersion: string;
  /** Istante UTC con millisecondi. */
  exportedAt: string;
  sourceDeviceId: string | null;
  includesTrash: boolean;
  counts: Record<string, number>;
  /** Impostazioni non locali (valori JSON). */
  settings: Record<string, unknown>;
  data: Record<string, BackupRow[]>;
  files: BackupFileRef[];
}

/**
 * Una tabella esportata. L'ordine di TABLES e' quello di dipendenza (genitori prima dei figli).
 *  - soft: ha `deleted_at` (cestino escluso di default);
 *  - ref: dato di riferimento citato da altre righe, esportato sempre per intero (anche cancellato);
 *  - where: filtro SQL sempre applicato (es. solo categorie utente, niente auto demo);
 *  - parents: se il genitore non e' stato esportato la riga si pota (es. figli di un'auto nel cestino);
 *  - optionalParents: come parents, ma solo se la colonna non e' NULL;
 *  - nullRefs: puntatori «morbidi» (ON DELETE SET NULL) a righe non esportate: diventano NULL;
 *  - omit: colonne locali che non si esportano; nulls: colonne esportate sempre a NULL.
 */
export interface TableSpec {
  name: string;
  soft: boolean;
  ref?: boolean;
  where?: string;
  /** Filtro applicato alla cancellazione in modalita' Sostituisci (default: nessuno = svuota la tabella). */
  deleteWhere?: string;
  parents: readonly (readonly [col: string, table: string])[];
  optionalParents?: readonly (readonly [col: string, table: string])[];
  nullRefs?: readonly (readonly [col: string, table: string])[];
  omit?: readonly string[];
  nulls?: readonly string[];
  orderBy?: string;
}

export const TABLES: readonly TableSpec[] = [
  // dati di riferimento: l'adattatore simulatore appartiene solo alla demo e non si esporta
  { name: 'obd_adapters', soft: true, ref: true, where: `transport <> 'simulator'`, parents: [] },
  { name: 'workshops', soft: true, ref: true, parents: [] },
  // le categorie di sistema arrivano dal seed
  { name: 'expense_categories', soft: true, ref: true, where: 'is_system = 0', deleteWhere: 'is_system = 0', parents: [] },
  // l'auto demo (is_demo = 1) non entra mai nel backup, e con lei nessuna riga figlia
  { name: 'vehicles', soft: true, where: 'is_demo = 0', parents: [], nullRefs: [['preferred_adapter_id', 'obd_adapters']] },
  { name: 'fuel_logs', soft: true, parents: [['vehicle_id', 'vehicles']] },
  { name: 'service_records', soft: true, parents: [['vehicle_id', 'vehicles']] },
  { name: 'service_lines', soft: false, parents: [['service_record_id', 'service_records']], orderBy: 'service_record_id, position, id' },
  { name: 'fluid_checks', soft: true, parents: [['vehicle_id', 'vehicles']] },
  { name: 'expenses', soft: true, parents: [['vehicle_id', 'vehicles']] },
  // `seq` e' locale: si riassegna all'importazione
  {
    name: 'obd_sessions',
    soft: false,
    parents: [['vehicle_id', 'vehicles']],
    nullRefs: [['adapter_id', 'obd_adapters']],
    omit: ['seq'],
    orderBy: 'seq',
  },
  {
    name: 'odometer_readings',
    soft: true,
    parents: [['vehicle_id', 'vehicles']],
    optionalParents: [
      ['fuel_log_id', 'fuel_logs'],
      ['service_record_id', 'service_records'],
      ['fluid_check_id', 'fluid_checks'],
      ['obd_session_id', 'obd_sessions'],
    ],
  },
  { name: 'maintenance_items', soft: true, parents: [['vehicle_id', 'vehicles']] },
  {
    name: 'maintenance_completions',
    soft: true,
    parents: [['item_id', 'maintenance_items']],
    optionalParents: [
      ['service_record_id', 'service_records'],
      ['fluid_check_id', 'fluid_checks'],
    ],
  },
  { name: 'insurance_policies', soft: true, parents: [['vehicle_id', 'vehicles']], nullRefs: [['renewed_from_id', 'insurance_policies']] },
  { name: 'insurance_coverages', soft: false, parents: [['policy_id', 'insurance_policies']] },
  { name: 'insurance_payments', soft: true, parents: [['policy_id', 'insurance_policies']] },
  {
    name: 'reminders',
    soft: true,
    parents: [['vehicle_id', 'vehicles']],
    nullRefs: [['completion_id', 'maintenance_completions']],
    optionalParents: [
      ['item_id', 'maintenance_items'],
      ['policy_id', 'insurance_policies'],
      ['payment_id', 'insurance_payments'],
    ],
  },
  { name: 'tyre_sets', soft: true, parents: [['vehicle_id', 'vehicles']] },
  {
    name: 'tyre_fitments',
    soft: true,
    parents: [
      ['tyre_set_id', 'tyre_sets'],
      ['vehicle_id', 'vehicles'],
    ],
  },
  { name: 'dtc_events', soft: true, parents: [['vehicle_id', 'vehicles']], nullRefs: [['session_id', 'obd_sessions']] },
  {
    name: 'attachments',
    soft: true,
    parents: [['owner_vehicle_id', 'vehicles']],
    optionalParents: [
      ['service_record_id', 'service_records'],
      ['policy_id', 'insurance_policies'],
      ['fuel_log_id', 'fuel_logs'],
      ['expense_id', 'expenses'],
      ['fluid_check_id', 'fluid_checks'],
      ['tyre_set_id', 'tyre_sets'],
    ],
    nulls: ['thumb_path'], // le miniature non viaggiano nel backup: si rigenerano
  },
];

/** Impostazioni che restano sul dispositivo: non si esportano e un backup non le sovrascrive. */
export const LOCAL_SETTINGS: ReadonlySet<string> = new Set(['device.id', 'backup.lastExportAt']);

// ------------------------------------------------------------------ upgrader del formato

export type FormatUpgrader = (doc: BackupDocument) => BackupDocument;

/** `UPGRADERS[n]` porta un documento dalla versione n alla n+1. Vuota finche' esiste solo la v1. */
export const UPGRADERS: Record<number, FormatUpgrader> = {};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Controlla l'intestazione del documento e lo porta alla versione del formato corrente con la catena di upgrader.
 * `NOT_A_BACKUP` se non e' un backup, `BACKUP_TOO_NEW` se e' piu' nuovo dell'app.
 */
export function upgradeBackup(raw: unknown, upgraders: Record<number, FormatUpgrader> = UPGRADERS, target = FORMAT_VERSION): BackupDocument {
  if (!isObject(raw) || raw['format'] !== BACKUP_FORMAT) throw new BackupAbort('NOT_A_BACKUP', 'Il file non è un backup di MyGarage.');
  const version = raw['formatVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BackupAbort('BAD_VERSION', 'La versione del backup non è valida.');
  }
  if (version > target) {
    throw new BackupAbort('BACKUP_TOO_NEW', `Questo backup è stato creato da una versione più recente di MyGarage (formato ${version}): aggiorna l'app.`);
  }
  let doc = raw as unknown as BackupDocument;
  while (doc.formatVersion < target) {
    const up = upgraders[doc.formatVersion];
    if (!up) throw new BackupAbort('NO_UPGRADER', `Manca la conversione del backup dalla versione ${doc.formatVersion} alla ${doc.formatVersion + 1}.`);
    doc = { ...up(doc), formatVersion: doc.formatVersion + 1 };
  }
  if (!isObject(doc.data)) throw new BackupAbort('NOT_A_BACKUP', 'Il backup non contiene dati.');
  return {
    ...doc,
    schemaVersion: Number.isInteger(doc.schemaVersion) ? doc.schemaVersion : 1,
    appVersion: typeof doc.appVersion === 'string' ? doc.appVersion : 'sconosciuta',
    exportedAt: typeof doc.exportedAt === 'string' ? doc.exportedAt : '',
    sourceDeviceId: typeof doc.sourceDeviceId === 'string' ? doc.sourceDeviceId : null,
    includesTrash: doc.includesTrash === true,
    counts: isObject(doc.counts) ? (doc.counts as Record<string, number>) : {},
    settings: isObject(doc.settings) ? doc.settings : {},
    files: Array.isArray(doc.files) ? doc.files : [],
  };
}

/** Quanti record per tabella ci sono davvero nel documento (non ci si fida di `counts`). */
export function countRows(doc: BackupDocument): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const rows = doc.data[t.name];
    out[t.name] = Array.isArray(rows) ? rows.length : 0;
  }
  return out;
}
