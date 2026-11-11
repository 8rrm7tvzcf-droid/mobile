import { afterEach, describe, expect, it } from 'vitest';
import { it as italian } from '@/ui/i18n/it';
import { isBackupReminderSnoozed, resetBackupReminderSnooze, snoozeBackupReminder } from '@/ui/hooks/backupReminder';
import {
  backupRowSubtitle,
  backupStatusView,
  canMerge,
  conflictPlates,
  csvSummary,
  csvVariantHint,
  csvVariantOptions,
  describeBackupError,
  exportSummary,
  importSummary,
  isWipeWord,
  localMoment,
  previewCounts,
  previewLines,
  reminderMessage,
  whenText,
  wipeOutcome,
} from '@/ui/logic/backupView';
import type { BackupErrorCode, BackupPreview, BackupStatus } from '@/usecases/backup';

const localIso = (y: number, m: number, d: number, h: number, min: number): string => new Date(y, m - 1, d, h, min).toISOString();

const status = (over: Partial<BackupStatus> = {}): BackupStatus => ({
  lastBackupAt: null,
  daysSinceLastBackup: null,
  hasData: true,
  changesSinceBackup: 0,
  nudgeDays: 30,
  needsReminder: false,
  ...over,
});

const preview = (over: Partial<BackupPreview> = {}): BackupPreview => ({
  formatVersion: 1,
  schemaVersion: 1,
  appVersion: '1.0.0',
  exportedAt: localIso(2026, 10, 12, 9, 5),
  includesTrash: false,
  counts: {},
  summary: { vehicles: 3, services: 214, fuelLogs: 1, expenses: 0, policies: 2, reminders: 0, attachments: 36 },
  attachmentFiles: 36,
  attachmentsWithoutFile: 0,
  sizeBytes: 2 * 1024 * 1024,
  jsonOnly: false,
  localVehicles: 0,
  plateConflicts: [],
  ...over,
});

describe('data e ora dell\'ultimo backup', () => {
  it('legge giorno e ora nel fuso del telefono', () => {
    expect(localMoment(localIso(2026, 10, 13, 14, 32))).toEqual({ day: '2026-10-13', time: '14:32' });
    expect(localMoment(null)).toBeNull();
    expect(localMoment('non e\' una data')).toBeNull();
  });

  it('dice oggi, ieri o la data', () => {
    expect(whenText(localIso(2026, 10, 13, 14, 32), '2026-10-13')).toBe('oggi alle 14:32');
    expect(whenText(localIso(2026, 10, 12, 9, 5), '2026-10-13')).toBe('ieri alle 09:05');
    expect(whenText(localIso(2026, 10, 3, 18, 0), '2026-10-13')).toBe('il 03/10/2026 alle 18:00');
    expect(whenText(null, '2026-10-13')).toBeNull();
  });
});

describe('stato del backup', () => {
  it('senza backup e con dati avvisa che i dati sono solo sul telefono', () => {
    const v = backupStatusView(status(), '2026-10-13');
    expect(v.title).toBe('Non hai ancora fatto un backup');
    expect(v.detail).toContain('solo su questo telefono');
    expect(v.tone).toBe('warning');
    expect(v.icon).toBe('alert');
  });

  it('senza dati invita a cominciare senza allarmare', () => {
    const v = backupStatusView(status({ hasData: false }), '2026-10-13');
    expect(v.tone).toBe('info');
    expect(v.detail).toBe(italian.backup.noDataHint);
  });

  it('con un backup recente e nessuna modifica e\' tutto in ordine', () => {
    const v = backupStatusView(status({ lastBackupAt: localIso(2026, 10, 13, 8, 0), daysSinceLastBackup: 0 }), '2026-10-13');
    expect(v).toMatchObject({ title: 'Ultimo backup: oggi alle 08:00', tone: 'ok', icon: 'check', detail: italian.backup.changesNone });
  });

  it('con modifiche e promemoria attivo diventa un avviso con il numero di modifiche', () => {
    const v = backupStatusView(status({ lastBackupAt: localIso(2026, 9, 1, 8, 0), changesSinceBackup: 7, needsReminder: true }), '2026-10-13');
    expect(v.tone).toBe('warning');
    expect(v.detail).toBe('Da allora hai cambiato 7 dati: conviene rifare il backup.');
    expect(backupStatusView(status({ lastBackupAt: localIso(2026, 9, 1, 8, 0), changesSinceBackup: 1 }), '2026-10-13').detail).toContain('1 dato:');
  });

  it('la riga delle impostazioni e il promemoria usano le stesse parole', () => {
    expect(backupRowSubtitle(status(), '2026-10-13')).toBe('Non hai ancora fatto un backup');
    expect(backupRowSubtitle(status({ lastBackupAt: localIso(2026, 10, 12, 9, 5) }), '2026-10-13')).toBe('Ultimo backup: ieri alle 09:05');
    expect(reminderMessage(status())).toContain('Non hai ancora un backup');
    expect(reminderMessage(status({ lastBackupAt: localIso(2026, 9, 1, 8, 0) }))).toContain('01/09/2026');
  });
});

describe('esportazione', () => {
  it('riassume nome, dimensione e allegati, e segnala quelli mancanti', () => {
    const lines = exportSummary({
      fileName: 'MyGarage-2026-10-13.zip',
      sizeBytes: 350 * 1024,
      attachmentFiles: 1,
      skippedFiles: [{ attachmentId: 'a', path: 'attachments/a.pdf', reason: 'missing' }],
    });
    expect(lines[0]).toContain('MyGarage-2026-10-13.zip');
    expect(lines[0]).toContain('350 KB');
    expect(lines[1]).toBe('1 file allegato incluso.');
    expect(lines[2]).toBe('1 allegato non era più sul telefono e non è nel backup.');
  });

  it('CSV: due formati con spiegazione e riepilogo di righe ed elenchi', () => {
    expect(csvVariantOptions.map((o) => o.value)).toEqual(['excel-it', 'data']);
    expect(csvVariantHint('excel-it')).toContain('gg/mm/aaaa');
    expect(csvVariantHint('data')).toContain('aaaa-mm-gg');
    expect(csvSummary({ files: [{ name: 'veicoli', rows: 2 }, { name: 'spese', rows: 5 }] })).toContain('7 righe in 2 elenchi');
    expect(csvSummary({ files: [{ name: 'veicoli', rows: 1 }] })).toContain('1 riga in 1 elenco');
  });
});

describe('anteprima del ripristino', () => {
  it('conta solo le voci presenti, con i plurali giusti', () => {
    expect(previewCounts(preview())).toEqual(['3 auto', '214 interventi', '1 rifornimento', '2 polizze', '36 allegati']);
  });

  it('mette insieme conteggi, data, versione, dimensione e situazione locale', () => {
    const lines = previewLines(preview({ localVehicles: 2 }));
    expect(lines[0]).toBe('3 auto, 214 interventi, 1 rifornimento, 2 polizze, 36 allegati');
    expect(lines).toContain('Creato il 12/10/2026 alle 09:05');
    expect(lines).toContain('Creato con la versione 1.0.0 di MyGarage');
    expect(lines).toContain('Dimensione del file: 2,0 MB');
    expect(lines).toContain('Su questo telefono ci sono già 2 auto.');
  });

  it('segnala file solo-dati, allegati senza file, cestino e backup vuoto', () => {
    expect(previewLines(preview({ jsonOnly: true }))).toContain(italian.backup.previewJsonOnly);
    expect(previewLines(preview({ attachmentsWithoutFile: 2 }))).toContain('2 allegati sono senza file e resteranno senza anteprima.');
    expect(previewLines(preview({ includesTrash: true }))).toContain(italian.backup.previewTrash);
    const empty = previewLines(preview({ summary: { vehicles: 0, services: 0, fuelLogs: 0, expenses: 0, policies: 0, reminders: 0, attachments: 0 } }));
    expect(empty[0]).toBe(italian.backup.previewNothing);
    expect(empty).toContain(italian.backup.previewLocalNone);
  });

  it('con un conflitto di targa non si puo\' unire e si elencano le targhe una volta sola', () => {
    const clash = preview({
      plateConflicts: [
        { plate: 'AB123CD', localVehicleId: 'l1', backupVehicleId: 'b1' },
        { plate: 'AB123CD', localVehicleId: 'l1', backupVehicleId: 'b2' },
        { plate: 'EF456GH', localVehicleId: 'l2', backupVehicleId: 'b3' },
      ],
    });
    expect(canMerge(preview())).toBe(true);
    expect(canMerge(clash)).toBe(false);
    expect(conflictPlates(clash)).toBe('AB123CD, EF456GH');
    expect(italian.backup.conflictText('AB123CD')).toContain('Sostituisci');
  });
});

describe('errori in italiano semplice', () => {
  const codes: BackupErrorCode[] = [
    'NOT_A_BACKUP',
    'BACKUP_TOO_NEW',
    'BAD_VERSION',
    'NO_UPGRADER',
    'CORRUPT',
    'UNSAFE_PATH',
    'TOO_BIG',
    'MISSING_FILE',
    'HASH_MISMATCH',
    'BAD_DATA',
    'FK_VIOLATION',
    'PLATE_CONFLICT',
    'VIN_CONFLICT',
    'ODOMETER_CONFLICT',
    'CONSTRAINT_VIOLATION',
    'SOURCE_UNREADABLE',
    'SAFETY_COPY_FAILED',
    'IO_ERROR',
    'ITEM_NOT_FOUND',
  ];

  it('ogni codice ha un testo in italiano, senza sigle tecniche', () => {
    for (const code of codes) {
      const text = describeBackupError({ code });
      expect(text.length, code).toBeGreaterThan(20);
      expect(text, code).not.toMatch(/SQL|constraint|UNIQUE|foreign key|sha|hash|zip-slip|errno|undefined|null/i);
      expect(text, code).not.toBe(italian.errors.generic);
    }
  });

  it('le indicazioni importanti ci sono: aggiorna l\'app, sostituisci, copia di sicurezza', () => {
    expect(describeBackupError({ code: 'BACKUP_TOO_NEW' })).toContain('Aggiorna MyGarage');
    expect(describeBackupError({ code: 'PLATE_CONFLICT' })).toContain('«Sostituisci»');
    expect(describeBackupError({ code: 'NOT_A_BACKUP' })).toContain('non è un backup di MyGarage');
    expect(describeBackupError({ code: 'SAFETY_COPY_FAILED' })).toContain('non ho cambiato niente');
  });

  it('un codice sconosciuto ricade sul messaggio generico', () => {
    expect(describeBackupError({ code: 'QUALCOSA' as BackupErrorCode })).toBe(italian.errors.generic);
  });
});

describe('risultato del ripristino', () => {
  it('riporta inseriti, aggiornati e mantenuti come da specifica', () => {
    const lines = importSummary({
      mode: 'merge',
      inserted: 214,
      updated: 3,
      keptLocal: 12,
      attachmentFilesInstalled: 36,
      attachmentsWithoutFile: ['x'],
      safetyCopyPath: 'backups/pre-import.db',
    });
    expect(lines[0]).toBe('Inseriti 214, aggiornati 3, mantenuti quelli già presenti 12.');
    expect(lines).toContain('36 file allegati ripristinati.');
    expect(lines).toContain('1 allegato è senza file e resta senza anteprima.');
    expect(lines).toContain(italian.backup.resultSafety);
  });

  it('senza copia di sicurezza lo dice, senza far credere che manchi qualcosa', () => {
    const lines = importSummary({ mode: 'merge', inserted: 0, updated: 0, keptLocal: 0, attachmentFilesInstalled: 0, attachmentsWithoutFile: [], safetyCopyPath: null });
    expect(lines).toEqual(['Inseriti 0, aggiornati 0, mantenuti quelli già presenti 0.', italian.backup.resultSafetyNone]);
  });
});

describe('cancellazione di tutti i dati', () => {
  it('serve la parola ELIMINA (anche in minuscolo e con spazi), non una frase simile', () => {
    expect(isWipeWord('ELIMINA')).toBe(true);
    expect(isWipeWord('  elimina ')).toBe(true);
    expect(isWipeWord('ELIMINA TUTTO')).toBe(false);
    expect(isWipeWord('')).toBe(false);
    expect(isWipeWord('CANCELLA')).toBe(false);
  });

  it('si torna al benvenuto solo se la verifica e\' completa e le notifiche sono state annullate', () => {
    expect(wipeOutcome({ complete: true, notificationsOk: true })).toEqual({ done: true, warnings: [] });
    const partial = wipeOutcome({ complete: false, notificationsOk: true });
    expect(partial.done).toBe(false);
    expect(partial.warnings).toEqual([italian.backup.wipeIncomplete]);
    const noNotif = wipeOutcome({ complete: true, notificationsOk: false });
    expect(noNotif.done).toBe(false);
    expect(noNotif.warnings).toEqual([italian.backup.wipeNotifications]);
  });

  it('avverte che i backup gia\' condivisi non si cancellano da qui', () => {
    expect(italian.backup.wipeShared).toContain('non si possono cancellare da qui');
  });
});

describe('«Più tardi» sul promemoria del backup', () => {
  afterEach(() => resetBackupReminderSnooze());

  it('nasconde il promemoria finche\' non si riapre l\'app', () => {
    expect(isBackupReminderSnoozed()).toBe(false);
    snoozeBackupReminder();
    expect(isBackupReminderSnoozed()).toBe(true);
    snoozeBackupReminder();
    expect(isBackupReminderSnoozed()).toBe(true);
    resetBackupReminderSnooze();
    expect(isBackupReminderSnoozed()).toBe(false);
  });
});
