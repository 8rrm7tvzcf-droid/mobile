// Interventi (S-13 per gli interventi, F-35): elenco dal piu' recente con filtri per tipo, periodo e testo.
// Tocco su una riga = dettaglio. Sotto, il totale speso.
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useApp } from '@/bootstrap';
import { listServiceRecords } from '@/usecases/services';
import { getVehicle } from '@/usecases/vehicles';
import { Button, ChoiceGroup, EmptyState, ListRow, QueryBoundary, Screen, SectionTitle, Text, TextField, UndoBanner } from '../components';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { LIST_PERIODS, periodOptions, periodRange, type PeriodPreset } from '../logic/period';
import {
  SERVICE_FILTER_KINDS,
  serviceAmountText,
  serviceCompletedText,
  serviceFilterOptions,
  serviceRowA11y,
  serviceRowSubtitle,
  serviceSummaryText,
  type ServiceFilterKind,
} from '../logic/serviceForm';
import { routes } from '../navigation/routes';

export function ServiceListScreen({ vehicleId }: { vehicleId: string }): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const today = deps.clock.todayLocal();
  const [kind, setKind] = useState<ServiceFilterKind>('all');
  const [preset, setPreset] = useState<PeriodPreset>('all');
  const [text, setText] = useState('');
  const query = useQuery(
    async (d) => {
      const vehicle = await getVehicle(d, vehicleId);
      if (!vehicle) return null;
      const range = periodRange(preset, today);
      const list = await listServiceRecords(d, vehicleId, { kinds: SERVICE_FILTER_KINDS[kind], from: range.from, to: range.to, text });
      return { unit: vehicle.distanceUnit, list };
    },
    [vehicleId, kind, preset, text],
    it.common.loadError,
  );

  const add = (): void => router.push(routes.serviceNew(vehicleId));
  const filtered = kind !== 'all' || preset !== 'all' || text.trim() !== '';

  return (
    <Screen onRefresh={query.reload} refreshing={false} footer={<Button label={it.service.add} icon="plus" testID="service-add" onPress={add} />}>
      <UndoBanner vehicleId={vehicleId} />
      <QueryBoundary query={query}>
        {(data) => {
          if (data === null) return <EmptyState icon="car" title={it.common.notFoundTitle} message={it.vehicle.notFound} />;
          const { unit, list } = data;
          if (list.length === 0 && !filtered) {
            return (
              <EmptyState
                icon="wrench"
                title={it.service.emptyTitle}
                message={it.service.emptyText}
                actions={[
                  { label: it.service.add, onPress: add },
                  { label: it.service.addOil, onPress: () => router.push(routes.serviceNew(vehicleId, 'oil')), variant: 'secondary' },
                ]}
              />
            );
          }
          return (
            <>
              <ChoiceGroup label={it.service.filterKind} options={serviceFilterOptions} value={kind} onChange={setKind} />
              <ChoiceGroup label={it.registry.periodLabel} options={periodOptions(LIST_PERIODS)} value={preset} onChange={setPreset} />
              <TextField label={it.service.searchLabel} optional hint={it.service.searchHint} value={text} onChangeText={setText} maxLength={60} testID="service-search" />

              <SectionTitle>{it.service.listHeader}</SectionTitle>
              {list.length > 0 ? (
                <Text variant="caption" color="muted" testID="service-summary">
                  {serviceSummaryText(list)}
                </Text>
              ) : null}
              {list.length === 0 ? (
                <Text variant="body" color="muted">
                  {it.service.filteredEmpty}
                </Text>
              ) : (
                list.map((s) => {
                  const amount = serviceAmountText(s);
                  const completed = serviceCompletedText(s);
                  return (
                    <ListRow
                      key={s.id}
                      icon="wrench"
                      title={s.title}
                      subtitle={serviceRowSubtitle(s, unit)}
                      accessibilityLabel={serviceRowA11y(s, unit)}
                      trailing={amount ? <Text variant="bodyStrong">{amount}</Text> : undefined}
                      onPress={() => router.push(routes.serviceDetail(vehicleId, s.id))}
                    >
                      {completed ? (
                        <Text variant="caption" color="info">
                          {completed}
                        </Text>
                      ) : null}
                    </ListRow>
                  );
                })
              )}
            </>
          );
        }}
      </QueryBoundary>
    </Screen>
  );
}
