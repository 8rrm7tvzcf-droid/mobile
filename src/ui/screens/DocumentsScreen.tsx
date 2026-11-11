// S-26 Documenti dell'auto (F-47): elenco per categoria con ricerca, aggiunta (foto, galleria o PDF) con categoria, titolo e
// scadenza facoltativa; tocco su un documento = apri/condividi, cambia titolo, scadenza, elimina nel cestino con «Annulla».
import { useState, type ReactNode } from 'react';
import { useApp } from '@/bootstrap';
import { listVehicleDocuments } from '@/usecases/attachments';
import { getVehicle } from '@/usecases/vehicles';
import {
  AddAttachmentSheet,
  Banner,
  Button,
  DocumentSheet,
  EmptyState,
  ListRow,
  QueryBoundary,
  Screen,
  SectionTitle,
  StatusBadge,
  Text,
  TextField,
  UndoBanner,
} from '../components';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { documentA11y, documentSubtitle, documentTitle, expiryView, groupDocuments, hasSearch, isPdf } from '../logic/documentsView';

export function DocumentsScreen({ vehicleId }: { vehicleId: string }): ReactNode {
  const { deps } = useApp();
  const today = deps.clock.todayLocal();
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery(
    async (d) => {
      const vehicle = await getVehicle(d, vehicleId);
      if (!vehicle) return null;
      return { list: await listVehicleDocuments(d, vehicleId, { search: text }) };
    },
    [vehicleId, text],
    it.common.loadError,
  );
  const searching = hasSearch(text);
  const openAdd = (): void => {
    setNotice(null);
    setAdding(true);
  };
  const selected = query.data?.list.find((a) => a.id === selectedId) ?? null;

  return (
    <Screen
      onRefresh={query.reload}
      refreshing={false}
      footer={<Button label={it.documents.add} icon="plus" testID="document-add" onPress={openAdd} />}
    >
      <UndoBanner vehicleId={vehicleId} kind="attachment" />
      {notice ? <Banner tone="ok" title={notice} /> : null}
      <QueryBoundary query={query}>
        {(data) => {
          if (data === null) return <EmptyState icon="car" title={it.common.notFoundTitle} message={it.vehicle.notFound} />;
          const { list } = data;
          if (list.length === 0 && !searching) {
            return (
              <EmptyState
                icon="folder"
                title={it.documents.emptyTitle}
                message={`${it.documents.emptyText} ${it.documents.privacy}`}
                actions={[{ label: it.documents.add, onPress: openAdd }]}
              />
            );
          }
          const groups = groupDocuments(list);
          return (
            <>
              <TextField label={it.documents.searchLabel} optional hint={it.documents.searchHint} value={text} onChangeText={setText} maxLength={60} testID="document-search" />
              <Text variant="caption" color="muted" testID="documents-summary">
                {it.documents.count(list.length)}
              </Text>
              {list.length === 0 ? (
                <Text variant="body" color="muted">
                  {it.documents.filteredEmpty}
                </Text>
              ) : null}
              {groups.map((g) => (
                <GroupBlock key={g.kind} title={g.title}>
                  {g.items.map((a) => {
                    const expiry = expiryView(a, today);
                    return (
                      <ListRow
                        key={a.id}
                        testID={`document-${a.id}`}
                        icon={isPdf(a.mimeType) ? 'file' : 'image'}
                        title={documentTitle(a)}
                        subtitle={documentSubtitle(a)}
                        accessibilityLabel={documentA11y(a, today)}
                        accessibilityHint={it.documents.open}
                        onPress={() => {
                          setNotice(null);
                          setSelectedId(a.id);
                        }}
                      >
                        {expiry ? <StatusBadge tone={expiry.tone} icon={expiry.icon} label={expiry.label} /> : null}
                      </ListRow>
                    );
                  })}
                </GroupBlock>
              ))}
              <Text variant="caption" color="muted">
                {it.documents.privacy}
              </Text>
            </>
          );
        }}
      </QueryBoundary>

      <AddAttachmentSheet
        visible={adding}
        parent={{ type: 'vehicle', id: vehicleId }}
        detailed
        defaultKind="other"
        onClose={() => setAdding(false)}
        onAdded={() => setNotice(it.documents.added)}
      />
      <DocumentSheet doc={selected} today={today} onClose={() => setSelectedId(null)} />
    </Screen>
  );
}

function GroupBlock({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      {children}
    </>
  );
}
