// Rifornimenti e consumi (S-22, F-39): consumo medio, ultimo, migliore e peggiore per serbatoio, spesa in carburante
// e l'elenco dei rifornimenti con il consumo di ogni pieno. Tocco su una riga = modifica.
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '@/bootstrap';
import { formatEuro } from '@/domain/units';
import { getFuelSummary, listFuelLogs } from '@/usecases/fuel';
import { getVehicle } from '@/usecases/vehicles';
import { Banner, Button, Card, ChoiceGroup, EmptyState, ListRow, QueryBoundary, Screen, SectionTitle, Text, UndoBanner } from '../components';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { fuelConsumptionText, fuelRowA11y, fuelRowSubtitle, fuelRowTitle, tankLines } from '../logic/fuelForm';
import { LIST_PERIODS, periodOptions, periodRange, type PeriodPreset } from '../logic/period';
import { routes } from '../navigation/routes';
import { space } from '../theme/tokens';

export function FuelListScreen({ vehicleId }: { vehicleId: string }): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const today = deps.clock.todayLocal();
  const [preset, setPreset] = useState<PeriodPreset>('all');
  const query = useQuery(
    async (d) => {
      const vehicle = await getVehicle(d, vehicleId);
      if (!vehicle) return null;
      const range = periodRange(preset, today);
      const [logs, summary] = await Promise.all([listFuelLogs(d, vehicleId, range), getFuelSummary(d, vehicleId, range)]);
      return { unit: vehicle.distanceUnit, logs, summary };
    },
    [vehicleId, preset],
    it.common.loadError,
  );

  const add = (): void => router.push(routes.fuelNew(vehicleId));

  return (
    <Screen
      onRefresh={query.reload}
      refreshing={false}
      footer={<Button label={it.fuel.add} icon="plus" testID="fuel-add" onPress={add} />}
    >
      <UndoBanner vehicleId={vehicleId} />
      <QueryBoundary query={query}>
        {(data) => {
          if (data === null) return <EmptyState icon="car" title={it.common.notFoundTitle} message={it.vehicle.notFound} />;
          const { unit, logs, summary } = data;
          const tanks = summary?.tanks ?? [];
          if (logs.length === 0 && preset === 'all') {
            return (
              <EmptyState
                icon="fuel"
                title={it.fuel.emptyTitle}
                message={it.fuel.emptyText}
                actions={[{ label: it.fuel.add, onPress: add }]}
              />
            );
          }
          return (
            <>
              <ChoiceGroup label={it.fuel.periodLabel} options={periodOptions(LIST_PERIODS)} value={preset} onChange={setPreset} />

              {summary ? (
                <>
                  <SectionTitle>{it.fuel.summaryTitle}</SectionTitle>
                  {summary.caveat ? <Banner tone="info" title={summary.caveat} /> : null}
                  {tanks.length === 0 ? (
                    <Card>
                      <Text variant="body" color="muted">
                        {it.fuel.noConsumptionYet}
                      </Text>
                    </Card>
                  ) : (
                    tanks.map((t) => {
                      const lines = tankLines(t);
                      return (
                        <Card key={t.tank} testID={`fuel-tank-${t.tank}`}>
                          <Text variant="heading">{t.label}</Text>
                          <Text variant="caption" color="muted">
                            {it.fuel.tankLogs(t.logCount)}
                          </Text>
                          {lines.length === 0 ? (
                            <Text variant="body" color="muted">
                              {it.fuel.noConsumptionYet}
                            </Text>
                          ) : (
                            lines.map((l) => (
                              <View key={l.label} style={styles.line} accessible accessibilityLabel={`${l.label}: ${l.value}`}>
                                <Text variant="body" color="muted" style={styles.flex}>
                                  {l.label}
                                </Text>
                                <Text variant="bodyStrong">{l.value}</Text>
                              </View>
                            ))
                          )}
                          {t.costPer100KmCents !== null ? (
                            <Text variant="caption" color="muted">
                              {it.fuel.costPer100(formatEuro(t.costPer100KmCents))}
                            </Text>
                          ) : null}
                        </Card>
                      );
                    })
                  )}
                  {summary.bifuel && summary.combinedCostPer100KmCents !== null ? (
                    <Text variant="caption" color="muted">
                      {it.fuel.combinedCost(formatEuro(summary.combinedCostPer100KmCents))}
                    </Text>
                  ) : null}
                  <Card>
                    <Text variant="label" color="muted">
                      {it.fuel.spentTitle}
                    </Text>
                    <Text variant="title">{formatEuro(summary.totalCostCents)}</Text>
                    <Text variant="caption" color="muted">
                      {it.fuel.spentText(formatEuro(summary.totalCostCents), summary.logCount)}
                    </Text>
                  </Card>
                </>
              ) : null}

              <SectionTitle>{it.fuel.listHeader}</SectionTitle>
              {logs.length === 0 ? (
                <Text variant="body" color="muted">
                  {it.registry.emptyFilteredText}
                </Text>
              ) : (
                logs.map((l) => {
                  const consumption = fuelConsumptionText(l);
                  return (
                    <ListRow
                      key={l.id}
                      icon="fuel"
                      title={fuelRowTitle(l)}
                      subtitle={fuelRowSubtitle(l, unit)}
                      accessibilityLabel={fuelRowA11y(l, unit)}
                      onPress={() => router.push(routes.fuelEdit(vehicleId, l.id))}
                    >
                      {consumption ? (
                        <Text variant="label" color="info">
                          {`${it.fuel.consumptionTitle}: ${consumption}`}
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

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 28 },
  flex: { flex: 1 },
});
