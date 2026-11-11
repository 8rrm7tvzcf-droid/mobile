// Foglio "Aggiungi un documento / allegato": sceglie da dove prendere il file (fotocamera, galleria, PDF) e lo salva.
// Con `detailed` chiede anche categoria, titolo e scadenza facoltativa (schermata Documenti, S-26); altrimenti solo la fonte.
// Il selettore si apre subito al tocco del pulsante (sul web il browser lo permette solo in quel momento).
import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '@/bootstrap';
import type { LocalDate } from '@/domain/dates';
import type { Attachment, AttachmentKind, AttachmentParent } from '@/usecases/attachments';
import { pickAndAdd, type PickSource } from '../hooks/attachments';
import { useBusy } from '../hooks/useBusy';
import { it } from '../i18n/it';
import { kindOptions, parseExpiryField } from '../logic/documentsView';
import { Banner } from './Banner';
import { Button } from './Button';
import { ChoiceGroup } from './Choices';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { TextField } from './TextField';

export interface AddAttachmentSheetProps {
  visible: boolean;
  parent: AttachmentParent;
  /** Chiede anche categoria, titolo e scadenza. */
  detailed: boolean;
  /** Categoria proposta (e usata se `detailed` e' falso). */
  defaultKind: AttachmentKind;
  onClose: () => void;
  onAdded: (attachment: Attachment) => void;
}

export function AddAttachmentSheet({ visible, parent, detailed, defaultKind, onClose, onAdded }: AddAttachmentSheetProps): ReactNode {
  const { deps } = useApp();
  const [kind, setKind] = useState<AttachmentKind>(defaultKind);
  const [title, setTitle] = useState('');
  const [expiry, setExpiry] = useState('');
  const [expiryError, setExpiryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const working = useBusy();

  useEffect(() => {
    if (!visible) return;
    setKind(defaultKind);
    setTitle('');
    setExpiry('');
    setExpiryError(null);
    setError(null);
  }, [visible, defaultKind]);

  const choose = (source: PickSource): void => {
    // Niente `await` prima del selettore: sul web deve partire nello stesso gesto del tocco.
    void working.run(async () => {
      setError(null);
      setExpiryError(null);
      let expiresOn: LocalDate | null = null;
      if (detailed) {
        const parsed = parseExpiryField(expiry);
        if (!parsed.ok) {
          setExpiryError(parsed.error);
          return;
        }
        expiresOn = parsed.value;
      }
      const result = await pickAndAdd(deps, source, {
        parent,
        kind: source === 'pdf' && kind === 'photo' ? 'other' : kind,
        title: detailed ? title : null,
        expiresOn,
      });
      if (result.status === 'added') {
        onAdded(result.attachment);
        onClose();
      } else if (result.status === 'error') {
        setError(result.message);
      }
    });
  };

  return (
    <Sheet visible={visible} title={detailed ? it.documents.addTitle : it.attachments.addTitle} onClose={onClose}>
      {error ? <Banner tone="danger" title={error} /> : null}
      {detailed ? (
        <>
          <ChoiceGroup label={it.documents.kindLabel} options={kindOptions} value={kind} onChange={setKind} />
          <TextField label={it.documents.titleLabel} optional hint={it.documents.titleHint} value={title} onChangeText={setTitle} maxLength={80} testID="document-title" />
          <TextField
            label={it.documents.expiryLabel}
            kind="date"
            optional
            hint={it.documents.expiryHint}
            value={expiry}
            onChangeText={(t) => {
              setExpiry(t);
              setExpiryError(null);
            }}
            error={expiryError}
            maxLength={10}
            testID="document-expiry"
          />
        </>
      ) : null}
      <Text variant="label">{it.documents.sourceLabel}</Text>
      <Button label={it.documents.takePhoto} icon="camera" variant="secondary" disabled={working.busy} onPress={() => choose('camera')} testID="add-camera" />
      <Button label={it.documents.fromGallery} icon="image" variant="secondary" disabled={working.busy} onPress={() => choose('gallery')} testID="add-gallery" />
      <Button label={it.documents.pickPdf} icon="file" variant="secondary" disabled={working.busy} onPress={() => choose('pdf')} testID="add-pdf" />
      {working.busy ? (
        <Text variant="caption" color="muted" accessibilityLiveRegion="polite">
          {it.documents.adding}
        </Text>
      ) : null}
      <Text variant="caption" color="muted">
        {it.documents.privacy}
      </Text>
      <Button label={it.common.cancel} variant="ghost" disabled={working.busy} onPress={onClose} />
    </Sheet>
  );
}
