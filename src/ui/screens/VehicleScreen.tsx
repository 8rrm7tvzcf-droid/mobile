// S-12 Scheda auto: dati, km con provenienza, scadenze, ultime letture, eliminazione.
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '@/bootstrap';
import { formatDateIt, formatDistance } from '@/domain/units';
import { removeDemoVehicle } from '@/usecases/demo';
import { getFluidStatus } from '@/usecases/fluids';
import { getInsuranceSummary } from '@/usecases/insurance';
import { getVehicleDeadlines } from '@/usecases/queries';
import { listServiceRecords } from '@/usecases/services';
import { getKmForecast, listOdometerReadings } from '@/usecases/odometer';
import { deleteVehicle, getVehicle } from '@/usecases/vehicles';
import { Banner, Button, Card, ConfirmSheet, DeadlineRowItem, EmptyState, ListRow, QueryBoundary, Screen, SectionTitle, Text } from '../components';
import { useBusy } from '../hooks/useBusy';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { describeError, describeThrown } from '../logic/errors';
import { fluidsNeedingAttention } from '../logic/fluidForm';
import { policiesSummaryText } from '../logic/policyForm';
import { readingA11yLabel, readingSubtitle, readingTitle } from '../logic/odometer';
import { countsSummary, deadlineHref } from '../logic/status';
import { dataRows, makeModelText } from '../logic/vehicleView';
import { routes } from '../navigation/routes';
import { space } from '../theme/tokens';

const DEADLINES_SHOWN = 5;

export function VehicleScreen({ vehicleId }: { vehicleId: string }): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const query = useQuery(
    async (d) => {
      const vehicle = await getVehicle(d, vehicleId);
      if (!vehicle) return null;
      const [deadlines, readings, forecast, lastService, fluids, insurance] = await Promise.all([
        getVehicleDeadlines(d, vehicleId),
        listOdometerReadings(d, vehicleId, { limit: 8 }),
        getKmForecast(d, vehicleId),
        listServiceRecords(d, vehicleId, { limit: 1 }),
        getFluidStatus(d, vehicleId),
        getInsuranceSummary(d, vehicleId),
      ]);
      return { vehicle, deadlines, readings, forecast, lastService: lastService[0] ?? null, fluids, insurance };
    },
    [vehicleId],
    it.common.loadError,
  );
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const removing = useBusy();

  const remove = (isDemo: boolean): void => {
    void removing.run(async () => {
      try {
        const res = isDemo ? await removeDemoVehicle(deps) : await deleteVehicle(deps, vehicleId);
        if (!res.ok) {
          setError(describeError(res.error).message);
          setConfirm(false);
          return;
        }
        setConfirm(false);
        router.replace(routes.garage);
      } catch (e) {
        setError(describeThrown(e));
        setConfirm(false);
      }
    });
  };

  return (
    <Screen onRefresh={query.reload} refreshing={false}>
      <QueryBoundary query={query}>
        {(data) => {
          if (data === null) return <EmptyState icon="car" title={it.common.notFoundTitle} message={it.vehicle.notFound} />;
          const { vehicle, deadlines, readings, forecast, lastService, fluids, insurance } = data;
          const fluidsAttention = fluidsNeedingAttention(fluids);
          const policiesText = policiesSummaryText(insurance);
          const unit = vehicle.distanceUnit;
          const current = vehicle.currentKm;
          const rows = deadlines?.rows ?? [];
          return (
            <>
              {error ? <Banner tone="danger" title={error} /> : null}

              <Card>
                <Text variant="title">{vehicle.displayName}</Text>
                <Text variant="body" color="muted">
                  {[makeModelText(vehicle), vehicle.plate].filter(Boolean).join(' · ')}
                </Text>
                {vehicle.isDemo ? <Text variant="caption" color="info">{it.garage.demoTag}</Text> : null}
              </Card>

              <SectionTitle>{it.vehicle.kmTitle}</SectionTitle>
              <Card>
                {current ? (
                  <>
                    <Text variant="largeTitle">{formatDistance(current.km, unit)}</Text>
                    <Text variant="caption" color="muted">
                      {`${current.sourceLabel} · ${it.vehicle.kmAsOf(formatDateIt(current.readOn))}`}
                    </Text>
                    {forecast?.projectedKm ? (
                      <Text variant="body" color="muted">
                        {it.vehicle.kmEstimated(formatDistance(forecast.projectedKm, unit))}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text variant="body" color="muted">
                    {it.garage.noKm}
                  </Text>
                )}
                <Button label={it.vehicle.updateKm} icon="gauge" onPress={() => router.push(routes.vehicleKm(vehicleId))} />
              </Card>

              <SectionTitle>{it.vehicle.deadlinesTitle}</SectionTitle>
              {rows.length === 0 ? (
                <Card>
                  <Text variant="body" color="muted">
                    {it.vehicle.deadlinesEmpty}
                  </Text>
                  <Button label={it.documentDates.rowTitle} icon="calendar" onPress={() => router.push(routes.documentDates(vehicleId))} testID="vehicle-document-dates" />
                  <Button label={it.vehicle.setup} variant="secondary" icon="calendar" onPress={() => router.push(routes.setup(vehicleId))} />
                </Card>
              ) : (
                <>
                  {deadlines ? (
                    <Text variant="body" color="muted">
                      {countsSummary(deadlines.counts)}
                    </Text>
                  ) : null}
                  {rows.slice(0, DEADLINES_SHOWN).map((row) => (
                    <DeadlineRowItem key={row.id} row={row} onPress={() => router.push(deadlineHref(row))} />
                  ))}
                  <Button label={rows.length > DEADLINES_SHOWN ? `${it.common.seeAll} (${rows.length})` : it.common.seeAll} variant="secondary" onPress={() => router.push(routes.vehicleDeadlines(vehicleId))} />
                  <Button label={it.vehicle.setup} variant="ghost" icon="calendar" onPress={() => router.push(routes.setup(vehicleId))} />
                  <Button label={it.documentDates.rowTitle} variant="ghost" icon="calendar" onPress={() => router.push(routes.documentDates(vehicleId))} testID="vehicle-document-dates" />
                </>
              )}

              <SectionTitle>{it.registry.sectionTitle}</SectionTitle>
              <ListRow
                testID="vehicle-registry"
                icon="book"
                title={it.registry.sectionRegistry}
                subtitle={it.registry.sectionRegistryHint}
                onPress={() => router.push(routes.registry(vehicleId))}
              />
              <ListRow
                testID="vehicle-fuel"
                icon="fuel"
                title={it.registry.sectionFuel}
                subtitle={it.registry.sectionFuelHint}
                onPress={() => router.push(routes.fuelList(vehicleId))}
              />
              <ListRow
                testID="vehicle-expenses"
                icon="receipt"
                title={it.registry.sectionExpenses}
                subtitle={it.registry.sectionExpensesHint}
                onPress={() => router.push(routes.expenseList(vehicleId))}
              />
              <ListRow
                testID="vehicle-costs"
                icon="chart"
                title={it.registry.sectionCosts}
                subtitle={it.registry.sectionCostsHint}
                onPress={() => router.push(routes.costs(vehicleId))}
              />

              <ListRow
                testID="vehicle-documents"
                icon="folder"
                title={it.documents.rowTitle}
                subtitle={it.documents.rowHint}
                onPress={() => router.push(routes.documents(vehicleId))}
              />

              <SectionTitle>{it.registry.sectionMaintenanceTitle}</SectionTitle>
              <ListRow
                testID="vehicle-services"
                icon="wrench"
                title={it.registry.sectionServices}
                subtitle={lastService ? it.registry.sectionServicesLast(lastService.title, formatDateIt(lastService.serviceOn)) : it.registry.sectionServicesNone}
                onPress={() => router.push(routes.serviceList(vehicleId))}
              />
              <ListRow
                testID="vehicle-fluids"
                icon="droplet"
                title={it.registry.sectionFluids}
                subtitle={fluidsAttention > 0 ? it.registry.sectionFluidsAttention(fluidsAttention) : it.registry.sectionFluidsHint}
                onPress={() => router.push(routes.fluids(vehicleId))}
              />
              <ListRow
                testID="vehicle-policies"
                icon="shield"
                title={it.registry.sectionPolicies}
                subtitle={policiesText ?? it.registry.sectionPoliciesNone}
                onPress={() => router.push(routes.policies(vehicleId))}
              />

              <SectionTitle>{it.obd.entry.vehicleTitle}</SectionTitle>
              <Card testID="obd-entry">
                <Text variant="body" color="muted">
                  {it.obd.entry.vehicleText}
                </Text>
                <Button
                  label={it.obd.entry.vehicleAction}
                  icon="plug"
                  variant="secondary"
                  accessibilityHint={it.obd.entry.vehicleTitle}
                  onPress={() => router.push(routes.vehicleObd(vehicleId))}
                />
              </Card>

              <SectionTitle>{it.vehicle.readingsTitle}</SectionTitle>
              {readings.length === 0 ? (
                <Text variant="body" color="muted">
                  {it.vehicle.readingsEmpty}
                </Text>
              ) : (
                readings.map((r) => (
                  <ListRow key={r.id} title={readingTitle(r, unit)} subtitle={readingSubtitle(r)} strike={r.status === 'ignored'} accessibilityLabel={readingA11yLabel(r, unit)} />
                ))
              )}

              <SectionTitle>{it.vehicle.dataTitle}</SectionTitle>
              <Card>
                {dataRows(vehicle).map((row) => (
                  <View key={row.label} style={styles.dataRow} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
                    <Text variant="label" color="muted">
                      {row.label}
                    </Text>
                    <Text variant="body" style={styles.value}>
                      {row.value}
                    </Text>
                  </View>
                ))}
                <Button label={it.vehicle.edit} icon="edit" variant="secondary" onPress={() => router.push(routes.editVehicle(vehicleId))} />
              </Card>

              <Button
                label={vehicle.isDemo ? it.vehicle.removeDemo : it.vehicle.deleteCar}
                icon="trash"
                variant="ghost"
                onPress={() => setConfirm(true)}
              />

              <ConfirmSheet
                visible={confirm}
                title={vehicle.isDemo ? it.vehicle.removeDemoTitle : it.vehicle.deleteTitle(vehicle.displayName)}
                message={vehicle.isDemo ? it.vehicle.removeDemoText : it.vehicle.deleteText}
                confirmLabel={vehicle.isDemo ? it.vehicle.removeDemo : it.vehicle.deleteConfirm}
                destructive
                busy={removing.busy}
                onConfirm={() => remove(vehicle.isDemo)}
                onCancel={() => setConfirm(false)}
              />
            </>
          );
        }}
      </QueryBoundary>
    </Screen>
  );
}

const styles = StyleSheet.create({
  dataRow: { gap: 2, paddingVertical: space.xs },
  value: { flexShrink: 1 },
});
