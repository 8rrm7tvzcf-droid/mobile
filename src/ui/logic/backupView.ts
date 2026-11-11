// Backup e dati (F-06..F-09, S-72): testi di stato, anteprima del ripristino, esiti ed errori in italiano. Puro.
import { addDays } from '@/domain/dates';
import { formatDateIt } from '@/domain/units';
import type {
  BackupError,
  BackupPreview,
  BackupStatus,
  CsvVariant,
  ExportBackupResult,
  ExportCsvResult,
  ImportResult,
  WipeReport,
} from '@/usecases/backup';
import { it } from '../i18n/it';
import { formatBytes, localDayOf } from './documentsView';

export interface LocalMoment {
  /** 'YYYY-MM-DD' nel fuso del telefono. */
  day: string;
  /** 'HH:MM' nel fuso del telefono. */
  time: string;
}

/** Un istante ISO UTC (come `lastBackupAt`) -> giorno e ora locali. `null` se non e' una data valida. */
export function localMoment(iso: string | null): LocalMoment | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return { day: localDayOf(iso), time: `${p2(d.getHours())}:${p2(d.getMinutes())}` };
}

/** «oggi alle 14:32», «ieri alle 09:10», «il 03/10/2026 alle 09:10». */
export function whenText(iso: string | null, todayLocal: string): string | null {
  const m = localMoment(iso);
  if (!m) return null;
  if (m.day === todayLocal) return it.backup.whenToday(m.time);
  if (m.day === addDays(todayLocal, -1)) return it.backup.whenYesterday(m.time);
  return it.backup.whenDate(formatDateIt(m.day), m.time);
}

export interface BackupStatusView {
  /** «Ultimo backup: oggi alle 14:32» oppure «Non hai ancora fatto un backup». */
  title: string;
  detail: string | null;
  tone: 'ok' | 'warning' | 'info';
  icon: 'check' | 'alert' | 'info';
}

export function backupStatusView(status: BackupStatus, todayLocal: string): BackupStatusView {
  const when = whenText(status.lastBackupAt, todayLocal);
  if (when === null) {
    return status.hasData
      ? { title: it.backup.never, detail: it.backup.neverHint, tone: 'warning', icon: 'alert' }
      : { title: it.backup.never, detail: it.backup.noDataHint, tone: 'info', icon: 'info' };
  }
  const detail = status.hasData ? (status.changesSinceBackup > 0 ? it.backup.changes(status.changesSinceBackup) : it.backup.changesNone) : null;
  return status.needsReminder
    ? { title: it.backup.last(when), detail, tone: 'warning', icon: 'alert' }
    : { title: it.backup.last(when), detail, tone: 'ok', icon: 'check' };
}

/** Sottotitolo della riga «Backup e dati» in Impostazioni. */
export function backupRowSubtitle(status: BackupStatus, todayLocal: string): string {
  const when = whenText(status.lastBackupAt, todayLocal);
  return when === null ? it.backup.rowSubtitleNever : it.backup.rowSubtitle(when);
}

/** Testo del promemoria nell'Oggi. */
export function reminderMessage(status: BackupStatus): string {
  const day = localMoment(status.lastBackupAt)?.day;
  return day ? it.backup.reminderSince(formatDateIt(day)) : it.backup.reminderNever;
}

// ------------------------------------------------------------------ esportazione

/** Righe di riepilogo dopo un backup riuscito. */
export function exportSummary(r: Pick<ExportBackupResult, 'fileName' | 'sizeBytes' | 'attachmentFiles' | 'skippedFiles'>): string[] {
  const lines = [it.backup.exportDoneText(r.fileName, formatBytes(r.sizeBytes))];
  if (r.attachmentFiles > 0) lines.push(it.backup.exportFiles(r.attachmentFiles));
  if (r.skippedFiles.length > 0) lines.push(it.backup.exportSkipped(r.skippedFiles.length));
  return lines;
}

export const csvVariantOptions: { value: CsvVariant; label: string }[] = [
  { value: 'excel-it', label: it.backup.csvExcel },
  { value: 'data', label: it.backup.csvData },
];

export const csvVariantHint = (v: CsvVariant): string => (v === 'excel-it' ? it.backup.csvExcelHint : it.backup.csvDataHint);

export function csvSummary(r: Pick<ExportCsvResult, 'files'>): string {
  const rows = r.files.reduce((sum, f) => sum + f.rows, 0);
  return it.backup.csvDoneText(rows, r.files.length);
}

// ------------------------------------------------------------------ ripristino

/** «3 auto, 214 interventi, 36 allegati»: solo le voci presenti. */
export function previewCounts(p: Pick<BackupPreview, 'summary'>): string[] {
  const s = p.summary;
  const c = it.backup.counts;
  const lines: string[] = [];
  if (s.vehicles > 0) lines.push(c.vehicles(s.vehicles));
  if (s.services > 0) lines.push(c.services(s.services));
  if (s.fuelLogs > 0) lines.push(c.fuelLogs(s.fuelLogs));
  if (s.expenses > 0) lines.push(c.expenses(s.expenses));
  if (s.policies > 0) lines.push(c.policies(s.policies));
  if (s.reminders > 0) lines.push(c.reminders(s.reminders));
  if (s.attachments > 0) lines.push(c.attachments(s.attachments));
  return lines;
}

/** Tutte le frasi dell'anteprima, nell'ordine in cui si mostrano. */
export function previewLines(p: BackupPreview): string[] {
  const m = localMoment(p.exportedAt);
  const lines: string[] = [];
  const counts = previewCounts(p);
  lines.push(counts.length > 0 ? counts.join(', ') : it.backup.previewNothing);
  if (m) lines.push(it.backup.previewCreated(formatDateIt(m.day), m.time));
  lines.push(it.backup.previewVersion(p.appVersion));
  lines.push(it.backup.previewSize(formatBytes(p.sizeBytes)));
  if (p.jsonOnly) lines.push(it.backup.previewJsonOnly);
  else if (p.attachmentsWithoutFile > 0) lines.push(it.backup.previewNoFile(p.attachmentsWithoutFile));
  if (p.includesTrash) lines.push(it.backup.previewTrash);
  lines.push(p.localVehicles > 0 ? it.backup.previewLocal(p.localVehicles) : it.backup.previewLocalNone);
  return lines;
}

/** «Unisci» non e' possibile con un conflitto di targa (farebbe fallire tutto). */
export const canMerge = (p: Pick<BackupPreview, 'plateConflicts'>): boolean => p.plateConflicts.length === 0;

export function conflictPlates(p: Pick<BackupPreview, 'plateConflicts'>): string {
  return [...new Set(p.plateConflicts.map((c) => c.plate))].join(', ');
}

/** Messaggio in italiano semplice per un errore di backup: mai testi tecnici. */
export function describeBackupError(e: Pick<BackupError, 'code'>): string {
  return it.backup.errors[e.code] ?? it.errors.generic;
}

/** Frasi del risultato di un ripristino. */
export function importSummary(r: Pick<ImportResult, 'mode' | 'inserted' | 'updated' | 'keptLocal' | 'attachmentFilesInstalled' | 'attachmentsWithoutFile' | 'safetyCopyPath'>): string[] {
  const lines = [it.backup.resultCounts(r.inserted, r.updated, r.keptLocal)];
  if (r.attachmentFilesInstalled > 0) lines.push(it.backup.resultFiles(r.attachmentFilesInstalled));
  if (r.attachmentsWithoutFile.length > 0) lines.push(it.backup.resultNoFile(r.attachmentsWithoutFile.length));
  lines.push(r.safetyCopyPath !== null ? it.backup.resultSafety : it.backup.resultSafetyNone);
  return lines;
}

// ------------------------------------------------------------------ cancellazione

/** La parola da scrivere per confermare: si accetta anche in minuscolo e con spazi ai lati, ma deve essere proprio quella. */
export const isWipeWord = (text: string): boolean => text.trim().toUpperCase() === it.backup.wipeWord;

export interface WipeOutcome {
  /** Tutto cancellato e verificato: si puo' tornare al benvenuto. */
  done: boolean;
  warnings: string[];
}

export function wipeOutcome(r: Pick<WipeReport, 'complete' | 'notificationsOk'>): WipeOutcome {
  const warnings: string[] = [];
  if (!r.complete) warnings.push(it.backup.wipeIncomplete);
  if (!r.notificationsOk) warnings.push(it.backup.wipeNotifications);
  return { done: r.complete && r.notificationsOk, warnings };
}
