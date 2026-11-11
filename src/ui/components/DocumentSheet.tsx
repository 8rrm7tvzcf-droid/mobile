// Foglio di un documento (S-26): anteprima best effort (icona, nome, dimensione), apri/condividi, cambia titolo,
// scadenza ed elimina nel cestino con "Annulla". Tutto in un solo foglio con piu' "passi": i fogli non si annidano.
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '@/bootstrap';
import type { LocalDate } from '@/domain/dates';
import { removeAttachment, renameAttachment, setDocumentExpiry, type Attachment } from '@/usecases/attachments';
import { openAttachment } from '../hooks/attachments';
import { pushUndo } from '../hooks/undo';
import { useBusy } from '../hooks/useBusy';
import { it } from '../i18n/it';
import { documentSubtitle, documentTitle, expiryFieldText, expiryView, isPdf, parseExpiryField } from '../logic/documentsView';
import { describeError, describeThrown } from '../logic/errors';
import { space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Banner } from './Banner';
import { Button } from './Button';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { StatusBadge } from './StatusBadge';
import { Text } from './Text';
import { TextField } from './TextField';

type Step = 'menu' | 'rename' | 'expiry' | 'delete';

export interface DocumentSheetProps {
  /** Il documento aperto; `null` = foglio chiuso. */
  doc: Attachment | null;
  today: string;
  onClose: () => void;
}

export function DocumentSheet({ doc, today, onClose }: DocumentSheetProps): ReactNode {
  const { deps } = useApp();
  const p = useTheme();
  const [step, setStep] = useState<Step>('menu');
  const [title, setTitle] = useState('');
  const [expiry, setExpiry] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'danger' | 'ok'; text: string } | null>(null);
  const working = useBusy();
  const id = doc?.id ?? null;

  useEffect(() => {
    setStep('menu');
    setFieldError(null);
    setMessage(null);
  }, [id]);

  if (!doc) {
    return (
      <Sheet visible={false} title="" onClose={onClose}>
        {null}
      </Sheet>
    );
  }

  const expiryState = expiryView(doc, today);
  const toMenu = (text?: string): void => {
    setStep('menu');
    setFieldError(null);
    setMessage(text ? { tone: 'ok', text } : null);
  };

  const share = (): void => {
    void working.run(async () => {
      const error = await openAttachment(deps, doc);
      setMessage(error ? { tone: 'danger', text: error } : null);
    });
  };

  const saveTitle = (): void => {
    void working.run(async () => {
      try {
        const res = await renameAttachment(deps, doc.id, title);
        if (!res.ok) return setFieldError(describeError(res.error).message);
        toMenu(it.documents.saved);
      } catch (e) {
        setFieldError(describeThrown(e));
      }
    });
  };

  const saveExpiry = (clear: boolean): void => {
    void working.run(async () => {
      try {
        let value: LocalDate | null = null;
        if (!clear) {
          const parsed = parseExpiryField(expiry);
          if (!parsed.ok) return setFieldError(parsed.error);
          value = parsed.value;
        }
        const res = await setDocumentExpiry(deps, doc.id, value);
        if (!res.ok) return setFieldError(describeError(res.error).message);
        toMenu(it.documents.saved);
      } catch (e) {
        setFieldError(describeThrown(e));
      }
    });
  };

  const remove = (): void => {
    void working.run(async () => {
      try {
        const res = await removeAttachment(deps, doc.id);
        if (!res.ok) {
          toMenu();
          return setMessage({ tone: 'danger', text: describeError(res.error).message });
        }
        pushUndo({ mode: 'deleted', kind: 'attachment', itemId: doc.id, vehicleId: doc.vehicleId, message: it.documents.deletedMessage });
        onClose();
      } catch (e) {
        toMenu();
        setMessage({ tone: 'danger', text: describeThrown(e) });
      }
    });
  };

  if (step === 'rename') {
    return (
      <Sheet visible title={it.documents.renameTitle} onClose={() => toMenu()}>
        <TextField label={it.documents.titleLabel} hint={it.documents.titleHint} value={title} onChangeText={(t) => { setTitle(t); setFieldError(null); }} error={fieldError} maxLength={80} autoFocus testID="document-rename" />
        <Button label={it.documents.renameSave} icon="check" loading={working.busy} onPress={saveTitle} />
        <Button label={it.common.cancel} variant="ghost" disabled={working.busy} onPress={() => toMenu()} />
      </Sheet>
    );
  }

  if (step === 'expiry') {
    return (
      <Sheet visible title={it.documents.expiryTitle} message={it.documents.expiryText} onClose={() => toMenu()}>
        <TextField label={it.documents.expiryLabel} kind="date" value={expiry} onChangeText={(t) => { setExpiry(t); setFieldError(null); }} error={fieldError} maxLength={10} autoFocus testID="document-expiry-edit" />
        <Button label={it.documents.expirySave} icon="check" loading={working.busy} onPress={() => saveExpiry(false)} />
        {doc.expiresOn ? <Button label={it.documents.expiryRemove} icon="x" variant="secondary" disabled={working.busy} onPress={() => saveExpiry(true)} /> : null}
        <Button label={it.common.cancel} variant="ghost" disabled={working.busy} onPress={() => toMenu()} />
      </Sheet>
    );
  }

  if (step === 'delete') {
    return (
      <Sheet visible title={it.documents.deleteTitle} message={it.documents.deleteText} onClose={() => toMenu()}>
        <Button label={it.documents.deleteConfirm} icon="trash" variant="danger" loading={working.busy} onPress={remove} testID="document-delete-confirm" />
        <Button label={it.common.cancel} variant="ghost" disabled={working.busy} onPress={() => toMenu()} />
      </Sheet>
    );
  }

  return (
    <Sheet visible title={documentTitle(doc)} message={documentSubtitle(doc)} onClose={onClose}>
      {message ? <Banner tone={message.tone} title={message.text} /> : null}
      <View style={[styles.preview, { backgroundColor: p.surfaceAlt, borderColor: p.border }]} accessible accessibilityLabel={`${documentTitle(doc)}. ${it.documents.previewNote}`}>
        <Icon name={isPdf(doc.mimeType) ? 'file' : 'image'} color={p.onPrimarySoft} size={40} />
        <Text variant="bodyStrong" style={styles.center}>
          {doc.fileName}
        </Text>
        <Text variant="caption" color="muted" style={styles.center}>
          {it.documents.previewNote}
        </Text>
      </View>
      {expiryState ? <StatusBadge tone={expiryState.tone} icon={expiryState.icon} label={expiryState.label} /> : null}
      <Button label={it.documents.open} icon="share" loading={working.busy} accessibilityHint={it.documents.openHint} onPress={share} testID="document-open" />
      <Button
        label={it.documents.rename}
        icon="edit"
        variant="secondary"
        onPress={() => {
          setTitle(doc.title ?? '');
          setFieldError(null);
          setStep('rename');
        }}
      />
      <Button
        label={doc.expiresOn ? it.documents.expiryChange : it.documents.expirySet}
        icon="calendar"
        variant="secondary"
        onPress={() => {
          setExpiry(expiryFieldText(doc.expiresOn));
          setFieldError(null);
          setStep('expiry');
        }}
      />
      <Button label={it.documents.delete} icon="trash" variant="ghost" onPress={() => setStep('delete')} testID="document-delete" />
      <Button label={it.common.close} variant="ghost" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  preview: { alignItems: 'center', gap: space.sm, padding: space.lg, borderRadius: 16, borderWidth: 1 },
  center: { textAlign: 'center' },
});
