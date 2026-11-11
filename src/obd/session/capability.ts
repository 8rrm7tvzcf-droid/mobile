// Report di capacita' (F-59): protocollo, adattatore, PID dichiarati e realmente rispondenti, cosa leggera'
// e cosa no. Il report NON contiene il VIN ne' la targa: si puo' esportare per beta e supporto (mai inviato
// in automatico). Puro: si costruisce a partire dai risultati delle sonde.
import { pidDef } from '@/obd/protocol';
import type { AdapterInfo, CloneReason, InitResult } from './AdapterInit';

export type ServiceProbe = 'answers' | 'no_data' | 'error' | 'untested';

export interface PidCapability {
  pid: number;
  id: string;
  name: string;
  unit: string;
  /** Dichiarato nel bitmask (0100/0120/...). */
  declared: boolean;
  /** Ha risposto almeno una volta alla sonda. */
  answered: boolean;
  /** Supportato = dichiarato E risposto almeno una volta (alcune ECU dichiarano e poi rispondono NO DATA). */
  supported: boolean;
  /**
   * La sonda non ha potuto dare un esito per errori di comunicazione ripetuti (BUS BUSY, DATA ERROR, timeout):
   * il PID NON e' dato per 'non risponde', resta non verificato.
   */
  unverified?: boolean;
  /** Centralina che ha risposto. */
  ecu?: string;
  /** Valore di prova (non viene esportato). */
  sample?: number;
}

export interface ChecklistItem {
  key: string;
  /** Etichetta per l'utente (italiano). */
  label: string;
  available: boolean;
  /** Spiegazione breve quando non e' disponibile o non verificabile. */
  detail?: string;
}

export interface CapabilityReport {
  version: 1;
  generatedAt: string;
  protocol: { id: string; name: string; auto: boolean; headers: boolean };
  adapter: {
    versionNumber?: string;
    description?: string;
    stn?: string;
    isStn: boolean;
    amcSupported: boolean | null;
    suspectedClone: boolean;
    cloneReasons: CloneReason[];
    voltage?: number;
  };
  ecus: string[];
  declaredByEcu: Record<string, number[]>;
  /** PID dati dichiarati (senza i PID 'puntatore'). */
  declared: number[];
  pids: PidCapability[];
  services: {
    vin: ServiceProbe;
    status: ServiceProbe;
    dtcStored: ServiceProbe;
    dtcPending: ServiceProbe;
    dtcPermanent: ServiceProbe;
    freezeFrame: ServiceProbe;
  };
  checklist: ChecklistItem[];
  /** Avvertenze in italiano (clone, nessuna risposta, ...). */
  notes: string[];
}

/** PID mostrati nella checklist 'Dati letti dalla tua auto / non disponibili su questa auto'. */
const CHECKLIST_PIDS: readonly { pid: number; key: string; label: string }[] = [
  { pid: 0x0c, key: 'engine_rpm', label: 'Giri motore' },
  { pid: 0x0d, key: 'vehicle_speed', label: 'Velocità' },
  { pid: 0x05, key: 'coolant_temp', label: 'Temperatura liquido refrigerante' },
  { pid: 0x04, key: 'engine_load', label: 'Carico motore' },
  { pid: 0x0f, key: 'intake_temp', label: 'Temperatura aria aspirata' },
  { pid: 0x2f, key: 'fuel_level', label: 'Livello carburante' },
  { pid: 0x42, key: 'control_module_voltage', label: 'Tensione del modulo di controllo' },
  { pid: 0xa6, key: 'odometer', label: 'Chilometraggio (odometro)' },
  { pid: 0x5c, key: 'oil_temp', label: 'Temperatura olio motore' },
  { pid: 0x51, key: 'fuel_type', label: 'Tipo di carburante' },
  { pid: 0x1f, key: 'run_time', label: "Tempo dall'avviamento del motore" },
  { pid: 0x31, key: 'distance_since_clear', label: 'Distanza dalla cancellazione dei codici' },
];

/** Informazioni sul PID per il report (nome e unita' dalla tabella dichiarativa). */
export function pidCapabilityBase(pid: number): Pick<PidCapability, 'pid' | 'id' | 'name' | 'unit'> {
  const d = pidDef(pid);
  return { pid, id: d?.id ?? `pid_${pid.toString(16)}`, name: d?.name ?? `PID ${pid.toString(16).toUpperCase()}`, unit: d?.unit ?? '' };
}

function serviceLabel(p: ServiceProbe): { available: boolean; detail?: string } {
  switch (p) {
    case 'answers':
      return { available: true };
    case 'no_data':
      return { available: false, detail: 'Questa auto non risponde a questa richiesta.' };
    case 'error':
      return { available: false, detail: 'La lettura non e riuscita: riprova.' };
    default:
      return { available: false, detail: 'Non ancora verificato.' };
  }
}

export function buildChecklist(r: Pick<CapabilityReport, 'services' | 'pids' | 'adapter'>): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  const s = r.services;
  out.push({ key: 'vin', label: 'Numero di telaio (VIN)', ...serviceLabel(s.vin) });
  out.push({ key: 'mil', label: 'Spia motore e numero di codici', ...serviceLabel(s.status) });
  out.push({ key: 'monitors', label: 'Monitor di prontezza', ...serviceLabel(s.status) });
  out.push({ key: 'dtc_stored', label: 'Codici guasto memorizzati', ...serviceLabel(s.dtcStored) });
  out.push({ key: 'dtc_pending', label: 'Codici guasto pendenti', ...serviceLabel(s.dtcPending) });
  out.push({ key: 'dtc_permanent', label: 'Codici guasto permanenti', ...serviceLabel(s.dtcPermanent) });
  if (s.freezeFrame === 'untested') {
    out.push({
      key: 'freeze_frame',
      label: 'Freeze frame (condizioni del guasto)',
      available: false,
      detail: "Si puo' verificare solo quando l'auto ha un codice memorizzato.",
    });
  } else {
    out.push({ key: 'freeze_frame', label: 'Freeze frame (condizioni del guasto)', ...serviceLabel(s.freezeFrame) });
  }
  for (const c of CHECKLIST_PIDS) {
    const p = r.pids.find((x) => x.pid === c.pid);
    const available = p?.supported === true;
    out.push({
      key: c.key,
      label: c.label,
      available,
      detail: available
        ? undefined
        : p?.unverified
          ? 'Non verificato: la lettura non e riuscita, riprova.'
          : p?.declared
            ? "L'auto lo dichiara ma non risponde."
            : 'Non disponibile su questa auto.',
    });
  }
  out.push({
    key: 'adapter_voltage',
    label: 'Tensione al connettore OBD',
    available: r.adapter.voltage !== undefined,
    detail: r.adapter.voltage !== undefined ? undefined : "L'adattatore non la fornisce.",
  });
  return out;
}

export function buildNotes(adapter: AdapterInfo, ecus: readonly string[], pids: readonly PidCapability[]): string[] {
  const notes: string[] = [];
  if (adapter.suspectedClone) {
    notes.push("L'adattatore sembra un clone economico: alcune letture potrebbero essere lente o incomplete.");
  }
  if (ecus.length === 0) {
    notes.push("Nessuna centralina ha risposto: l'auto potrebbe non essere compatibile con questo adattatore.");
  }
  if (pids.some((p) => p.unverified)) {
    notes.push("Alcuni dati non sono stati verificati per errori di comunicazione con l'auto: riprova la lettura.");
  }
  if (pids.length > 0 && pids.every((p) => !p.supported && !p.unverified)) {
    notes.push("L'auto non ha risposto a nessun dato standard.");
  }
  return notes;
}

export function reportAdapterFrom(init: InitResult): CapabilityReport['adapter'] {
  const a = init.adapter;
  return {
    versionNumber: a.versionNumber,
    description: a.description,
    stn: a.stn,
    isStn: a.isStn,
    amcSupported: a.amcSupported,
    suspectedClone: a.suspectedClone,
    cloneReasons: a.cloneReasons,
    voltage: init.voltage,
  };
}

/**
 * File di report per beta e supporto: nessun VIN, nessuna targa e nessun valore letto (solo cosa risponde).
 * Va condiviso solo su richiesta esplicita dell'utente, mai in automatico.
 */
export function exportCapabilityReport(report: CapabilityReport): string {
  const clean: CapabilityReport = {
    ...report,
    pids: report.pids.map((p) => ({ pid: p.pid, id: p.id, name: p.name, unit: p.unit, declared: p.declared, answered: p.answered, supported: p.supported, unverified: p.unverified, ecu: p.ecu })),
  };
  return JSON.stringify(clean, null, 2);
}
