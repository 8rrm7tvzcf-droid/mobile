// S-72/S-73 Backup e dati: stato dell'ultimo backup, «Fai un backup ora», «Ripristina da un file» (anteprima, Sostituisci o
// Unisci, risultato), esportazione CSV e «Cancella tutti i dati» (si scrive ELIMINA). I dati restano sul telefono: il backup
// lo conserva l'utente dove preferisce, non c'e' nessun cloud.
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '@/bootstrap';
import type { PickedFile } from '@/domain/ports';
import {
  exportBackup,
  exportCsv,
  getBackupStatus,
  importBackup,
  inspectBackup,
  wipeAllData,
  type BackupPreview,
  type CsvVariant,
  type ExportBackupResult,
  type ExportCsvResult,
  type ImportMode,
  type ImportResult,
} from '@/usecases/backup';
import { Banner, Button, Card, ChoiceGroup, ConfirmSheet, Icon, QueryBoundary, Screen, SectionTitle, Sheet, Text, TextField } from '../components';
import { BACKUP_TYPES } from '../hooks/attachments';
import { useBusy } from '../hooks/useBusy';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import {
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
  previewLines,
  wipeOutcome,
} from '../logic/backupView';
import { describeThrown } from '../logic/errors';
import { routes } from '../navigation/routes';
import { space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

interface Shared<T> {
  result: T;
  shared: boolean;
}

export function BackupScreen(): ReactNode {
  const { deps } = useApp();
  const router = useRouter();
  const p = useTheme();
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const status = useQuery((d) => getBackupStatus(d), [], it.common.loadError);

  const exporting = useBusy();
  const picking = useBusy();
  const importing = useBusy();
  const csvWork = useBusy();
  const wiping = useBusy();
  const anyBusy = exporting.busy || picking.busy || importing.busy || csvWork.busy || wiping.busy;

  const [exported, setExported] = useState<Shared<ExportBackupResult> | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [preview, setPreview] = useState<{ uri: string; info: BackupPreview } | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [restored, setRestored] = useState<ImportResult | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const [csvVariant, setCsvVariant] = useState<CsvVariant>('excel-it');
  const [csv, setCsv] = useState<Shared<ExportCsvResult> | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeText, setWipeText] = useState('');
  const [wipeWarnings, setWipeWarnings] = useState<string[]>([]);
  const [wipeError, setWipeError] = useState<string | null>(null);

  const share = async (path: string, mimeType: string, title: string): Promise<boolean> => {
    try {
      await deps.fs.sharer.shareFile(path, mimeType, title);
      return true;
    } catch {
      return false;
    }
  };

  const onExport = (): void => {
    void exporting.run(async () => {
      setExportError(null);
      setExported(null);
      try {
        const res = await exportBackup(deps, { appVersion: version });
        if (!res.ok) return setExportError(describeBackupError(res.error));
        const shared = await share(res.value.path, res.value.mimeType, it.backup.shareTitle);
        setExported({ result: res.value, shared });
        status.reload();
      } catch (e) {
        setExportError(describeThrown(e));
      }
    });
  };

  const onShareAgain = (): void => {
    if (!exported) return;
    void exporting.run(async () => {
      const shared = await share(exported.result.path, exported.result.mimeType, it.backup.shareTitle);
      setExported({ ...exported, shared });
    });
  };

  // Il selettore parte subito al tocco (sul web e' l'unico momento in cui il browser lo permette).
  const onPick = (): void => {
    void picking.run(async () => {
      setRestoreError(null);
      setRestored(null);
      let file: PickedFile | null;
      try {
        file = await deps.fs.picker.pickDocument({ types: BACKUP_TYPES });
      } catch {
        return setRestoreError(it.backup.pickerError);
      }
      if (file === null) return;
      try {
        const res = await inspectBackup(deps, file.uri);
        if (!res.ok) return setRestoreError(describeBackupError(res.error));
        setPreview({ uri: file.uri, info: res.value });
      } catch (e) {
        setRestoreError(describeThrown(e));
      }
    });
  };

  const onImport = (mode: ImportMode): void => {
    if (!preview) return;
    void importing.run(async () => {
      try {
        const res = await importBackup(deps, preview.uri, { mode });
        setConfirmReplace(false);
        setPreview(null);
        if (!res.ok) return setRestoreError(describeBackupError(res.error));
        setRestored(res.value);
        status.reload();
      } catch (e) {
        setConfirmReplace(false);
        setPreview(null);
        setRestoreError(describeThrown(e));
      }
    });
  };

  const onCsvShareAgain = (): void => {
    if (!csv) return;
    void csvWork.run(async () => {
      const shared = await share(csv.result.path, csv.result.mimeType, it.backup.csvShareTitle);
      setCsv({ ...csv, shared });
    });
  };

  const onCsv = (): void => {
    void csvWork.run(async () => {
      setCsvError(null);
      setCsv(null);
      try {
        const res = await exportCsv(deps, { variant: csvVariant });
        if (!res.ok) return setCsvError(describeBackupError(res.error));
        const shared = await share(res.value.path, res.value.mimeType, it.backup.csvShareTitle);
        setCsv({ result: res.value, shared });
      } catch (e) {
        setCsvError(describeThrown(e));
      }
    });
  };

  const onWipe = (): void => {
    if (!isWipeWord(wipeText)) return;
    void wiping.run(async () => {
      setWipeError(null);
      setWipeWarnings([]);
      try {
        const outcome = wipeOutcome(await wipeAllData(deps));
        setWipeOpen(false);
        setWipeText('');
        if (outcome.done) return router.replace(routes.welcome);
        setWipeWarnings(outcome.warnings);
      } catch (e) {
        setWipeOpen(false);
        setWipeError(describeThrown(e));
      }
    });
  };

  return (
    <Screen onRefresh={status.reload} refreshing={false}>
      <QueryBoundary query={status}>
        {(data) => {
          const view = backupStatusView(data, deps.clock.todayLocal());
          return (
            <>
              <Card tone={view.tone} testID="backup-status">
                <View style={styles.head}>
                  <Icon name={view.icon} color={p.tone[view.tone].fg} size={24} />
                  <View style={styles.flex}>
                    <Text variant="heading" color={view.tone} testID="backup-status-title">
                      {view.title}
                    </Text>
                    {view.detail ? (
                      <Text variant="body" color={view.tone}>
                        {view.detail}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </Card>

              <SectionTitle>{it.backup.exportTitle}</SectionTitle>
              <Card>
                <Text variant="body">{it.backup.exportText}</Text>
                <Text variant="caption" color="muted">
                  {it.backup.exportWarning}
                </Text>
                <Button
                  label={exporting.busy ? it.backup.exportBusy : it.backup.exportAction}
                  icon="download"
                  loading={exporting.busy}
                  disabled={anyBusy && !exporting.busy}
                  onPress={onExport}
                  testID="backup-export"
                />
              </Card>
              {exportError ? <Banner tone="danger" title={exportError} /> : null}
              {exported ? (
                <Banner
                  tone={exported.shared ? 'ok' : 'warning'}
                  title={it.backup.exportDone}
                  message={[...exportSummary(exported.result), ...(exported.shared ? [] : [it.backup.exportShareFailed])].join(' ')}
                  actionLabel={it.backup.shareAgain}
                  onAction={onShareAgain}
                />
              ) : null}

              <SectionTitle>{it.backup.restoreTitle}</SectionTitle>
              <Card>
                <Text variant="body">{it.backup.restoreText}</Text>
                <Button
                  label={picking.busy ? it.backup.restoreChecking : it.backup.restoreAction}
                  icon="upload"
                  variant="secondary"
                  loading={picking.busy}
                  disabled={anyBusy && !picking.busy}
                  onPress={onPick}
                  testID="backup-restore"
                />
              </Card>
              {restoreError ? <Banner tone="danger" title={restoreError} /> : null}
              {restored ? <Banner tone="ok" title={it.backup.resultTitle} message={importSummary(restored).join(' ')} /> : null}

              <SectionTitle>{it.backup.csvTitle}</SectionTitle>
              <Card>
                <Text variant="body">{it.backup.csvText}</Text>
                <ChoiceGroup label={it.backup.csvFormat} options={csvVariantOptions} value={csvVariant} onChange={setCsvVariant} hint={csvVariantHint(csvVariant)} />
                <Text variant="caption" color="muted">
                  {it.backup.csvWarning}
                </Text>
                <Button
                  label={csvWork.busy ? it.backup.csvBusy : it.backup.csvAction}
                  icon="file"
                  variant="secondary"
                  loading={csvWork.busy}
                  disabled={anyBusy && !csvWork.busy}
                  onPress={onCsv}
                  testID="backup-csv"
                />
              </Card>
              {csvError ? <Banner tone="danger" title={csvError} /> : null}
              {csv ? (
                <Banner
                  tone={csv.shared ? 'ok' : 'warning'}
                  title={it.backup.csvDone}
                  message={[csvSummary(csv.result), ...(csv.shared ? [] : [it.backup.exportShareFailed])].join(' ')}
                  actionLabel={it.backup.shareAgain}
                  onAction={onCsvShareAgain}
                />
              ) : null}

              <SectionTitle>{it.backup.privacyTitle}</SectionTitle>
              <Card>
                <Text variant="body">{it.backup.privacyText}</Text>
              </Card>

              <SectionTitle>{it.backup.wipeTitle}</SectionTitle>
              <Card>
                <Text variant="body">{it.backup.wipeText}</Text>
                <Text variant="body" color="muted">
                  {it.backup.wipeShared}
                </Text>
                <Button label={it.backup.wipeAction} icon="trash" variant="danger" disabled={anyBusy} onPress={() => {
                    setWipeText('');
                    setWipeOpen(true);
                  }}
                  testID="backup-wipe" />
              </Card>
              {wipeError ? <Banner tone="danger" title={wipeError} /> : null}
              {wipeWarnings.map((w) => (
                <Banner key={w} tone="warning" title={w} />
              ))}
              {wipeWarnings.length > 0 ? <Button label={it.backup.wipeContinue} variant="secondary" onPress={() => router.replace(routes.welcome)} /> : null}
              <View style={styles.end} />

              <Sheet visible={preview !== null && !confirmReplace} title={it.backup.previewTitle} onClose={() => setPreview(null)}>
                {preview ? (
                  <>
                    <Card testID="backup-preview">
                      {previewLines(preview.info).map((line, i) => (
                        <Text key={line} variant={i === 0 ? 'bodyStrong' : 'body'} color={i === 0 ? 'text' : 'muted'}>
                          {line}
                        </Text>
                      ))}
                    </Card>
                    {!canMerge(preview.info) ? <Banner tone="warning" title={it.backup.conflictTitle} message={it.backup.conflictText(conflictPlates(preview.info))} /> : null}
                    <Text variant="label">{it.backup.chooseMode}</Text>
                    <Button label={it.backup.replace} icon="refresh" variant="danger" disabled={importing.busy} onPress={() => setConfirmReplace(true)} testID="backup-replace" />
                    <Text variant="caption" color="muted">
                      {it.backup.replaceHint}
                    </Text>
                    <Button
                      label={it.backup.merge}
                      icon="plus"
                      variant="secondary"
                      loading={importing.busy}
                      disabled={!canMerge(preview.info)}
                      onPress={() => onImport('merge')}
                      testID="backup-merge"
                    />
                    <Text variant="caption" color="muted">
                      {canMerge(preview.info) ? it.backup.mergeHint : it.backup.mergeBlocked}
                    </Text>
                    <Button label={it.common.cancel} variant="ghost" disabled={importing.busy} onPress={() => setPreview(null)} />
                  </>
                ) : null}
              </Sheet>
              <ConfirmSheet
                visible={confirmReplace}
                title={it.backup.replaceConfirmTitle}
                message={it.backup.replaceConfirmText(preview?.info.localVehicles ?? 0)}
                confirmLabel={importing.busy ? it.backup.importing : it.backup.replaceConfirm}
                destructive
                busy={importing.busy}
                onConfirm={() => onImport('replace')}
                onCancel={() => setConfirmReplace(false)}
              />
              <Sheet visible={wipeOpen} title={it.backup.wipeSheetTitle} message={`${it.backup.wipeSheetText} ${it.backup.wipeNoUndo}`} onClose={() => setWipeOpen(false)}>
                <Text variant="body" color="muted">
                  {it.backup.wipeShared}
                </Text>
                <TextField label={it.backup.wipeTypeLabel} kind="plate" hint={it.backup.wipeTypeHint} value={wipeText} onChangeText={setWipeText} maxLength={12} autoFocus testID="wipe-word" />
                <Button
                  label={wiping.busy ? it.backup.wipeBusy : it.backup.wipeConfirm}
                  icon="trash"
                  variant="danger"
                  loading={wiping.busy}
                  disabled={!isWipeWord(wipeText)}
                  onPress={onWipe}
                  testID="wipe-confirm"
                />
                <Button label={it.common.cancel} variant="ghost" disabled={wiping.busy} onPress={() => setWipeOpen(false)} />
              </Sheet>
            </>
          );
        }}
      </QueryBoundary>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  flex: { flex: 1, gap: space.xs },
  end: { height: space.xl },
});
