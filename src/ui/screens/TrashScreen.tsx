// Cestino (F-05): auto e documenti eliminati restano 30 giorni. Si possono ripristinare o eliminare definitivamente (con conferma).
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '@/bootstrap';
import { listTrashedAttachments, purgeAttachment, restoreAttachment, type TrashedAttachment } from '@/usecases/attachments';
import { listTrashedVehicles, purgeVehicle, restoreVehicle } from '@/usecases/vehicles';
import type { TrashedVehicle } from '@/usecases/vehicles';
import { Banner, Button, Card, ConfirmSheet, EmptyState, Icon, QueryBoundary, Screen, SectionTitle, Text } from '../components';
import { useBusy } from '../hooks/useBusy';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { documentTitle, formatBytes, isPdf, kindLabel, mimeLabel, trashDaysText } from '../logic/documentsView';
import { describeError, describeThrown } from '../logic/errors';
import { space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

type Purge = { kind: 'vehicle'; item: TrashedVehicle } | { kind: 'attachment'; item: TrashedAttachment };

export function TrashScreen(): ReactNode {
  const { deps } = useApp();
  const p = useTheme();
  const working = useBusy();
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [purge, setPurge] = useState<Purge | null>(null);
  const query = useQuery(
    async (d) => ({ vehicles: await listTrashedVehicles(d), attachments: await listTrashedAttachments(d) }),
    [],
    it.common.loadError,
  );

  const act = (run: () => Promise<{ ok: true } | { ok: false; error: Parameters<typeof describeError>[0] }>, okText: string): void => {
    void working.run(async () => {
      try {
        const res = await run();
        setPurge(null);
        setMessage(res.ok ? { tone: 'ok', text: okText } : { tone: 'danger', text: describeError(res.error).message });
        query.reload();
      } catch (e) {
        setPurge(null);
        setMessage({ tone: 'danger', text: describeThrown(e) });
      }
    });
  };

  const restoreVehicleRow = (v: TrashedVehicle): void => act(() => restoreVehicle(deps, v.id), it.trash.restored);
  const restoreAttachmentRow = (a: TrashedAttachment): void => act(() => restoreAttachment(deps, a.id), it.trash.restored);
  const confirmPurge = (): void => {
    if (!purge) return;
    if (purge.kind === 'vehicle') act(() => purgeVehicle(deps, purge.item.id), it.trash.purged);
    else act(() => purgeAttachment(deps, purge.item.id), it.trash.purged);
  };

  return (
    <Screen onRefresh={query.reload} refreshing={false}>
      <QueryBoundary query={query}>
        {({ vehicles, attachments }) => (
          <>
            {message ? <Banner tone={message.tone} title={message.text} /> : null}
            {vehicles.length === 0 && attachments.length === 0 ? (
              <EmptyState icon="trash" title={it.trash.emptyTitle} message={it.trash.emptyText} />
            ) : (
              <Text variant="body" color="muted">
                {it.trash.intro}
              </Text>
            )}

            {vehicles.length > 0 ? <SectionTitle>{it.trash.vehiclesTitle}</SectionTitle> : null}
            {vehicles.map((v) => (
              <Card key={v.id} testID={`trash-vehicle-${v.id}`}>
                <View style={styles.head}>
                  <Icon name="car" color={p.onPrimarySoft} size={24} />
                  <View style={styles.flex}>
                    <Text variant="bodyStrong">{v.displayName}</Text>
                    {v.plate ? (
                      <Text variant="caption" color="muted">
                        {v.plate}
                      </Text>
                    ) : null}
                    <Text variant="caption" color={v.daysLeft <= 3 ? 'warning' : 'muted'}>
                      {trashDaysText(v.daysLeft)}
                    </Text>
                  </View>
                </View>
                <RowActions
                  busy={working.busy}
                  name={v.displayName}
                  onRestore={() => restoreVehicleRow(v)}
                  onPurge={() => setPurge({ kind: 'vehicle', item: v })}
                />
              </Card>
            ))}

            {attachments.length > 0 ? <SectionTitle>{it.trash.attachmentsTitle}</SectionTitle> : null}
            {attachments.map((a) => (
              <Card key={a.id} testID={`trash-attachment-${a.id}`}>
                <View style={styles.head}>
                  <Icon name={isPdf(a.mimeType) ? 'file' : 'image'} color={p.onPrimarySoft} size={24} />
                  <View style={styles.flex}>
                    <Text variant="bodyStrong">{documentTitle(a)}</Text>
                    <Text variant="caption" color="muted">
                      {[kindLabel(a.kind), mimeLabel(a.mimeType), formatBytes(a.sizeBytes)].filter(Boolean).join(' · ')}
                    </Text>
                    <Text variant="caption" color={a.daysLeft <= 3 ? 'warning' : 'muted'}>
                      {trashDaysText(a.daysLeft)}
                    </Text>
                  </View>
                </View>
                <RowActions
                  busy={working.busy}
                  name={documentTitle(a)}
                  onRestore={() => restoreAttachmentRow(a)}
                  onPurge={() => setPurge({ kind: 'attachment', item: a })}
                />
              </Card>
            ))}

            <ConfirmSheet
              visible={purge !== null}
              title={purge ? (purge.kind === 'vehicle' ? it.trash.purgeVehicleTitle(purge.item.displayName) : it.trash.purgeAttachmentTitle) : ''}
              message={purge ? (purge.kind === 'vehicle' ? it.trash.purgeVehicleText : it.trash.purgeAttachmentText) : undefined}
              confirmLabel={it.trash.purge}
              destructive
              busy={working.busy}
              onConfirm={confirmPurge}
              onCancel={() => setPurge(null)}
            />
          </>
        )}
      </QueryBoundary>
    </Screen>
  );
}

function RowActions({ busy, name, onRestore, onPurge }: { busy: boolean; name: string; onRestore: () => void; onPurge: () => void }): ReactNode {
  return (
    <View style={styles.actions}>
      <Button label={it.trash.restore} icon="undo" variant="secondary" disabled={busy} accessibilityHint={name} onPress={onRestore} />
      <Button label={it.trash.purge} icon="trash" variant="ghost" disabled={busy} accessibilityHint={name} onPress={onPurge} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, gap: 2 },
  actions: { gap: space.sm, marginTop: space.xs },
});
