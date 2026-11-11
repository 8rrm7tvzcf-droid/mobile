// S-14 Dettaglio intervento: dati, righe, cambio olio, esito della revisione, scadenze aggiornate con il prossimo intervallo,
// «Cosa hai fatto?» da rivedere, modifica ed elimina con «Annulla».
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '@/bootstrap';
import { formatDateIt, formatDistance, formatEuro } from '@/domain/units';
import {
  INSPECTION_RESULT_LABELS,
  deleteServiceRecord,
  getServiceRecord,
  setServiceCompletions,
  suggestItemsForLines,
  type ServiceItemSuggestion,
  type ServiceRecordDetail,
} from '@/usecases/services';
import { getVehicle } from '@/usecases/vehicles';
import { AttachmentsSection, Banner, Button, Card, CheckRow, ConfirmSheet, EmptyState, QueryBoundary, Screen, SectionTitle, Sheet, Text } from '../components';
import { pushUndo } from '../hooks/undo';
import { useBusy } from '../hooks/useBusy';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { describeError, describeThrown } from '../logic/errors';
import { lineAmountText, oilDetailText, preselectedIds, suggestionDescription, suggestionLines, toggleId } from '../logic/serviceForm';
import { goBackOr } from '../navigation/actions';
import { routes } from '../navigation/routes';
import { space } from '../theme/tokens';

export function ServiceDetailScreen({ vehicleId, recordId }: { vehicleId: string; recordId: string }): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [choose, setChoose] = useState<{ suggestions: ServiceItemSuggestion[]; selected: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const working = useBusy();
  const query = useQuery(
    async (d) => {
      const vehicle = await getVehicle(d, vehicleId);
      const record = await getServiceRecord(d, recordId);
      if (!vehicle || !record || record.vehicleId !== vehicleId) return null;
      return { unit: vehicle.distanceUnit, record };
    },
    [vehicleId, recordId],
    it.common.loadError,
  );

  const remove = (r: ServiceRecordDetail): void => {
    void working.run(async () => {
      try {
        const res = await deleteServiceRecord(deps, r.id);
        setConfirmDelete(false);
        if (!res.ok) return setError(describeError(res.error).message);
        pushUndo({ mode: 'deleted', kind: 'service', itemId: r.id, vehicleId, message: it.service.deletedMessage });
        goBackOr(router, routes.serviceList(vehicleId));
      } catch (e) {
        setConfirmDelete(false);
        setError(describeThrown(e));
      }
    });
  };

  const openChoose = (r: ServiceRecordDetail): void => {
    void working.run(async () => {
      try {
        const suggestions = await suggestItemsForLines(deps, vehicleId, suggestionLines(r), {
          kind: r.kind,
          title: r.title,
          inspectionResult: r.inspectionResult,
          serviceOn: r.serviceOn,
          excludeRecordId: r.id,
        });
        const current = r.completions.map((c) => c.itemId);
        setChoose({ suggestions, selected: current.length > 0 ? current : preselectedIds(suggestions) });
      } catch (e) {
        setError(describeThrown(e));
      }
    });
  };

  const confirmChoose = (r: ServiceRecordDetail): void => {
    if (!choose) return;
    void working.run(async () => {
      try {
        const res = await setServiceCompletions(deps, r.id, choose.selected);
        if (!res.ok) return setError(describeError(res.error).message);
        setChoose(null);
        query.reload();
      } catch (e) {
        setError(describeThrown(e));
      }
    });
  };

  return (
    <Screen onRefresh={query.reload} refreshing={false}>
      <QueryBoundary query={query}>
        {(data) => {
          if (data === null) return <EmptyState icon="wrench" title={it.common.notFoundTitle} message={it.service.notFound} />;
          const { unit, record: r } = data;
          return (
            <>
              {error ? <Banner tone="danger" title={error} /> : null}

              <Card testID="service-detail">
                <Text variant="title">{r.title}</Text>
                <Text variant="body" color="muted">
                  {[r.kindLabel, formatDateIt(r.serviceOn), r.km !== null ? formatDistance(r.km, unit) : null].filter(Boolean).join(' · ')}
                </Text>
                {r.workshop ? (
                  <Text variant="body">{[r.workshop.name, r.workshop.city, r.workshop.phone].filter(Boolean).join(' · ')}</Text>
                ) : null}
                <Text variant="largeTitle">{formatEuro(r.totalCents)}</Text>
                {r.linesTotalCents > 0 && r.linesTotalCents !== r.totalCents ? (
                  <Text variant="caption" color="muted">
                    {it.service.linesSum(formatEuro(r.linesTotalCents))}
                  </Text>
                ) : null}
              </Card>

              {r.inspectionResult ? (
                <Card>
                  <Text variant="label" color="muted">
                    {it.service.inspectionLabel}
                  </Text>
                  <Text variant="heading">{INSPECTION_RESULT_LABELS[r.inspectionResult]}</Text>
                </Card>
              ) : null}
              {r.inspectionNotice ? <Banner tone="info" title={r.inspectionNotice} /> : null}

              {r.oilChange ? (
                <Card testID="service-oil">
                  <Text variant="label" color="muted">
                    {it.service.oilSection}
                  </Text>
                  <Text variant="body">{oilDetailText(r.oilChange)}</Text>
                </Card>
              ) : null}

              {r.lines.length > 0 ? (
                <>
                  <SectionTitle>{it.service.linesSection}</SectionTitle>
                  <Card>
                    {r.lines.map((l) => (
                      <View key={l.id} style={styles.line} accessible accessibilityLabel={[l.description, lineAmountText(l)].filter(Boolean).join(', ')}>
                        <Text variant="body" style={styles.flex}>
                          {l.description}
                        </Text>
                        {lineAmountText(l) ? <Text variant="bodyStrong">{lineAmountText(l)}</Text> : null}
                      </View>
                    ))}
                  </Card>
                </>
              ) : null}

              <SectionTitle>{it.service.completedSection}</SectionTitle>
              {r.completions.length === 0 ? (
                <Text variant="body" color="muted">
                  {it.service.completedNone}
                </Text>
              ) : (
                r.completions.map((c) => (
                  <Card key={c.completionId}>
                    <Text variant="heading">{c.itemName}</Text>
                    {c.nextText ? <Text variant="body">{c.nextText}</Text> : null}
                  </Card>
                ))
              )}
              <Button label={it.service.whatChange} variant="secondary" loading={working.busy} onPress={() => openChoose(r)} />

              {r.invoiceNumber || r.warrantyUntilOn || r.notes ? (
                <Card>
                  {r.invoiceNumber ? <Text variant="body">{`${it.service.invoice}: ${r.invoiceNumber}`}</Text> : null}
                  {r.warrantyUntilOn ? <Text variant="body">{`${it.service.warranty} ${formatDateIt(r.warrantyUntilOn)}`}</Text> : null}
                  {r.notes ? <Text variant="body">{r.notes}</Text> : null}
                </Card>
              ) : null}

              <AttachmentsSection parent={{ type: 'service_record', id: r.id }} vehicleId={vehicleId} />

              <Button label={it.service.edit} icon="edit" variant="secondary" onPress={() => router.push(routes.serviceEdit(vehicleId, r.id))} />
              <Button label={it.service.delete} icon="trash" variant="ghost" onPress={() => setConfirmDelete(true)} />

              <ConfirmSheet
                visible={confirmDelete}
                title={it.service.deleteTitle}
                message={it.service.deleteText}
                confirmLabel={it.service.deleteConfirm}
                destructive
                busy={working.busy}
                onConfirm={() => remove(r)}
                onCancel={() => setConfirmDelete(false)}
              />
              <Sheet visible={choose !== null} title={it.service.whatTitle} message={it.service.whatIntro} onClose={() => setChoose(null)}>
                {choose && choose.suggestions.length === 0 ? (
                  <Text variant="body" color="muted">
                    {it.service.whatNoItems}
                  </Text>
                ) : null}
                {choose?.suggestions.map((s) => (
                  <CheckRow
                    key={s.itemId}
                    label={s.name}
                    description={suggestionDescription(s)}
                    checked={choose.selected.includes(s.itemId)}
                    onChange={() => setChoose({ ...choose, selected: toggleId(choose.selected, s.itemId) })}
                  />
                ))}
                <Button label={it.service.whatConfirm(choose?.selected.length ?? 0)} loading={working.busy} onPress={() => confirmChoose(r)} />
                <Button label={it.common.cancel} variant="ghost" onPress={() => setChoose(null)} />
              </Sheet>
            </>
          );
        }}
      </QueryBoundary>
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 32 },
  flex: { flex: 1 },
});
