// S-13 Registro: la cronologia dell'auto scelta con filtri per tipo e periodo, raggruppata per mese.
// Tocco su una riga: rifornimenti, spese e scadenze si aprono; gli altri tipi (interventi, livelli, polizze) mostrano solo il titolo.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useApp } from '@/bootstrap';
import { getTimeline, type TimelineEntry } from '@/usecases/queries';
import { listVehicles } from '@/usecases/vehicles';
import {
  Button,
  ChoiceGroup,
  EmptyState,
  Icon,
  ListRow,
  QueryBoundary,
  QuickAddSheet,
  Screen,
  SectionTitle,
  Text,
  UndoBanner,
} from '../components';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { KIND_FILTER_KINDS, entryA11yLabel, entryAmountText, entryIcon, entryRoute, entrySubtitle, groupTimeline, kindFilterOptions, type KindFilter } from '../logic/registry';
import { LIST_PERIODS, periodOptions, periodRange, type PeriodPreset } from '../logic/period';
import { routes } from '../navigation/routes';
import { space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

const TIMELINE_LIMIT = 500;

function EntryRow({ entry, vehicleId }: { entry: TimelineEntry; vehicleId: string }): ReactNode {
  const router = useRouter();
  const route = entryRoute(entry, vehicleId);
  const amount = entryAmountText(entry);
  return (
    <ListRow
      testID={`registry-${entry.kind}`}
      icon={entryIcon(entry)}
      title={entry.title}
      subtitle={entrySubtitle(entry)}
      strike={entry.ignored}
      accessibilityLabel={entryA11yLabel(entry)}
      trailing={
        amount ? (
          <Text variant="bodyStrong" style={styles.amount}>
            {amount}
          </Text>
        ) : null
      }
      onPress={route ? () => router.push(route) : undefined}
    />
  );
}

export function RegistryScreen(): ReactNode {
  const router = useRouter();
  const p = useTheme();
  const { deps } = useApp();
  const today = deps.clock.todayLocal();
  const { auto } = useLocalSearchParams<{ auto?: string }>();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>('all');
  const [period, setPeriod] = useState<PeriodPreset>('all');
  const [quick, setQuick] = useState(false);

  // L'auto puo' arrivare dalla scheda auto (`/registro?auto=...`).
  useEffect(() => {
    if (auto) setVehicleId(auto);
  }, [auto]);

  const query = useQuery(
    async (d) => {
      const vehicles = (await listVehicles(d)).filter((v) => v.status === 'active');
      const current = vehicles.find((v) => v.id === vehicleId) ?? vehicles[0] ?? null;
      if (!current) return { vehicles, current: null, timeline: null };
      const range = periodRange(period, today);
      const timeline = await getTimeline(d, current.id, { kinds: KIND_FILTER_KINDS[kind], from: range.from, to: range.to, limit: TIMELINE_LIMIT });
      return { vehicles, current, timeline };
    },
    [vehicleId, kind, period],
    it.common.loadError,
  );

  const filtered = kind !== 'all' || period !== 'all';
  const showAll = (): void => {
    setKind('all');
    setPeriod('all');
  };

  return (
    <View style={styles.flex}>
      <Screen padBottom={false} onRefresh={query.reload} refreshing={false}>
        <QueryBoundary query={query}>
          {({ vehicles, current, timeline }) => {
            if (!current) {
              return (
                <EmptyState
                  icon="car"
                  title={it.registry.noVehiclesTitle}
                  message={it.registry.noVehiclesText}
                  actions={[{ label: it.garage.add, onPress: () => router.push(routes.newVehicle) }]}
                />
              );
            }
            const groups = groupTimeline(timeline?.entries ?? []);
            return (
              <>
                <UndoBanner vehicleId={current.id} />
                {vehicles.length > 1 ? (
                  <ChoiceGroup
                    label={it.registry.vehicleLabel}
                    options={vehicles.map((v) => ({ value: v.id, label: v.displayName }))}
                    value={current.id}
                    onChange={setVehicleId}
                  />
                ) : null}
                <ChoiceGroup label={it.registry.kindLabel} options={kindFilterOptions} value={kind} onChange={setKind} />
                <ChoiceGroup label={it.registry.periodLabel} options={periodOptions(LIST_PERIODS)} value={period} onChange={setPeriod} />
                <View style={styles.links}>
                  <Button inline variant="secondary" icon="fuel" label={it.registry.fuelLink} onPress={() => router.push(routes.fuelList(current.id))} />
                  <Button inline variant="secondary" icon="receipt" label={it.registry.expensesLink} onPress={() => router.push(routes.expenseList(current.id))} />
                  <Button inline variant="secondary" icon="chart" label={it.registry.costsLink} onPress={() => router.push(routes.costs(current.id))} />
                  <Button inline variant="secondary" icon="wrench" label={it.registry.servicesLink} onPress={() => router.push(routes.serviceList(current.id))} />
                  <Button inline variant="secondary" icon="droplet" label={it.registry.fluidsLink} onPress={() => router.push(routes.fluids(current.id))} />
                  <Button inline variant="secondary" icon="shield" label={it.registry.policiesLink} onPress={() => router.push(routes.policies(current.id))} />
                </View>

                {groups.length === 0 ? (
                  filtered ? (
                    <EmptyState
                      icon="book"
                      title={it.registry.emptyFilteredTitle}
                      message={it.registry.emptyFilteredText}
                      actions={[{ label: it.registry.showAll, onPress: showAll, variant: 'secondary' }]}
                    />
                  ) : (
                    <EmptyState
                      icon="book"
                      title={it.registry.emptyTitle}
                      message={it.registry.emptyText}
                      actions={[
                        { label: it.fuel.add, onPress: () => router.push(routes.fuelNew(current.id)) },
                        { label: it.expense.add, onPress: () => router.push(routes.expenseNew(current.id)), variant: 'secondary' },
                      ]}
                    />
                  )
                ) : (
                  groups.map((g) => (
                    <View key={g.key} style={styles.group}>
                      <SectionTitle>{g.title}</SectionTitle>
                      {g.totalText ? (
                        <Text variant="caption" color="muted">
                          {g.totalText}
                        </Text>
                      ) : null}
                      {g.entries.map((e) => (
                        <EntryRow key={`${e.kind}-${e.id}`} entry={e} vehicleId={current.id} />
                      ))}
                    </View>
                  ))
                )}
                <View style={styles.fabSpace} />
              </>
            );
          }}
        </QueryBoundary>
      </Screen>

      {query.data?.current ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={it.a11y.quickAdd}
          accessibilityHint={it.a11y.quickAddHint}
          testID="registry-add"
          onPress={() => setQuick(true)}
          style={({ pressed }) => [styles.fab, { backgroundColor: p.primary, opacity: pressed ? 0.85 : 1 }]}
        >
          <Icon name="plus" color={p.onPrimary} size={28} />
        </Pressable>
      ) : null}

      <QuickAddSheet
        visible={quick}
        onClose={() => setQuick(false)}
        vehicles={(query.data?.vehicles ?? []).map((v) => ({ id: v.id, label: v.displayName, plate: v.plate }))}
        vehicleId={query.data?.current?.id ?? null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  group: { gap: space.sm },
  amount: { flexShrink: 0 },
  fab: {
    position: 'absolute',
    right: space.lg,
    bottom: space.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    boxShadow: '0px 2px 6px rgba(0, 0, 0, 0.25)',
  },
  fabSpace: { height: 72 },
});
