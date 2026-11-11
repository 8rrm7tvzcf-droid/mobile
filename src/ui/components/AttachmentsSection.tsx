// Sezione "Allegati" nei dettagli di interventi, polizze, spese e rifornimenti (F-04): elenco, aggiunta di foto o PDF,
// apertura con il foglio di condivisione e rimozione nel cestino con "Annulla".
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '@/bootstrap';
import { removeAttachment, listAttachments, type Attachment, type AttachmentParent } from '@/usecases/attachments';
import { openAttachment } from '../hooks/attachments';
import { pushUndo } from '../hooks/undo';
import { useBusy } from '../hooks/useBusy';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { DEFAULT_KIND_BY_PARENT, documentTitle, formatBytes, isPdf, mimeLabel } from '../logic/documentsView';
import { describeError, describeThrown } from '../logic/errors';
import { space } from '../theme/tokens';
import { AddAttachmentSheet } from './AddAttachmentSheet';
import { Banner } from './Banner';
import { Button } from './Button';
import { Card } from './Card';
import { Icon } from './Icon';
import { SectionTitle } from './Screen';
import { ConfirmSheet } from './Sheet';
import { Text } from './Text';
import { UndoBanner } from './UndoBanner';
import { useTheme } from '../theme/useTheme';

export interface AttachmentsSectionProps {
  parent: AttachmentParent;
  /** L'auto a cui appartiene il genitore (serve all'"Annulla"). */
  vehicleId: string;
}

export function AttachmentsSection({ parent, vehicleId }: AttachmentsSectionProps): ReactNode {
  const { deps } = useApp();
  const p = useTheme();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const [message, setMessage] = useState<{ tone: 'danger' | 'ok'; text: string } | null>(null);
  const working = useBusy();
  const query = useQuery((d) => listAttachments(d, parent), [parent.type, parent.id], it.common.loadError);
  const list = query.data ?? [];

  const open = (a: Attachment): void => {
    void working.run(async () => {
      setMessage(null);
      const error = await openAttachment(deps, a);
      if (error) setMessage({ tone: 'danger', text: error });
    });
  };

  const remove = (a: Attachment): void => {
    void working.run(async () => {
      try {
        const res = await removeAttachment(deps, a.id);
        setRemoving(null);
        if (!res.ok) return setMessage({ tone: 'danger', text: describeError(res.error).message });
        setMessage(null);
        pushUndo({ mode: 'deleted', kind: 'attachment', itemId: a.id, vehicleId, message: it.attachments.removedMessage });
      } catch (e) {
        setRemoving(null);
        setMessage({ tone: 'danger', text: describeThrown(e) });
      }
    });
  };

  return (
    <View style={styles.section} testID="attachments-section">
      <SectionTitle>{it.attachments.title}</SectionTitle>
      <UndoBanner vehicleId={vehicleId} kind="attachment" />
      {message ? <Banner tone={message.tone} title={message.text} /> : null}
      {query.error && query.data === undefined ? <Banner tone="danger" title={query.error} actionLabel={it.common.retry} onAction={query.reload} /> : null}
      {query.data !== undefined && list.length === 0 ? (
        <Text variant="body" color="muted">
          {it.attachments.empty}
        </Text>
      ) : null}
      {list.map((a) => (
        <Card key={a.id} testID={`attachment-${a.id}`}>
          <View style={styles.head}>
            <Icon name={isPdf(a.mimeType) ? 'file' : 'image'} color={p.onPrimarySoft} size={24} />
            <View style={styles.flex}>
              <Text variant="bodyStrong">{documentTitle(a)}</Text>
              <Text variant="caption" color="muted">
                {[mimeLabel(a.mimeType), formatBytes(a.sizeBytes)].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>
          <View style={styles.actions}>
            <View style={styles.flex}>
              <Button label={it.attachments.open} icon="share" variant="secondary" onPress={() => open(a)} accessibilityHint={documentTitle(a)} />
            </View>
            <View style={styles.flex}>
              <Button label={it.attachments.remove} icon="trash" variant="ghost" onPress={() => setRemoving(a)} accessibilityHint={documentTitle(a)} />
            </View>
          </View>
        </Card>
      ))}
      <Button label={it.attachments.add} icon="paperclip" variant="secondary" onPress={() => setAdding(true)} testID="attachment-add" />
      <Text variant="caption" color="muted">
        {it.attachments.hint}
      </Text>

      <AddAttachmentSheet
        visible={adding}
        parent={parent}
        detailed={false}
        defaultKind={DEFAULT_KIND_BY_PARENT[parent.type]}
        onClose={() => setAdding(false)}
        onAdded={() => setMessage({ tone: 'ok', text: it.attachments.added })}
      />
      <ConfirmSheet
        visible={removing !== null}
        title={it.attachments.removeTitle}
        message={it.attachments.removeText}
        confirmLabel={it.attachments.removeConfirm}
        destructive
        busy={working.busy}
        onConfirm={() => (removing ? remove(removing) : undefined)}
        onCancel={() => setRemoving(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
});
