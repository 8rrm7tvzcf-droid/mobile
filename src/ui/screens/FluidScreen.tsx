// S-24 Controllo livelli: lo stato di ogni fluido (semaforo con icona e testo), registrazione in 3 tocchi e storico.
// Onesta': l'OBD standard non legge il livello dell'olio ne' la pressione dei pneumatici, e qui lo diciamo con parole semplici.
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { getFluidStatus, listFluidChecks } from '@/usecases/fluids';
import { getVehicle } from '@/usecases/vehicles';
import { Banner, Button, Card, EmptyState, ListRow, QueryBoundary, Screen, SectionTitle, StatusBadge, Text, UndoBanner } from '../components';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { fluidNextCheckText, fluidRowA11y, fluidRowSubtitle, fluidRowTitle, fluidTone } from '../logic/fluidForm';
import { routes } from '../navigation/routes';

const HISTORY_SHOWN = 30;

export function FluidScreen({ vehicleId }: { vehicleId: string }): ReactNode {
  const router = useRouter();
  const query = useQuery(
    async (d) => {
      const vehicle = await getVehicle(d, vehicleId);
      if (!vehicle) return null;
      const [statuses, checks] = await Promise.all([getFluidStatus(d, vehicleId), listFluidChecks(d, vehicleId, { limit: HISTORY_SHOWN })]);
      return { unit: vehicle.distanceUnit, statuses, checks };
    },
    [vehicleId],
    it.common.loadError,
  );

  return (
    <Screen
      onRefresh={query.reload}
      refreshing={false}
      footer={<Button label={it.fluid.check} icon="droplet" testID="fluid-add" onPress={() => router.push(routes.fluidNew(vehicleId))} />}
    >
      <UndoBanner vehicleId={vehicleId} />
      <QueryBoundary query={query}>
        {(data) => {
          if (data === null) return <EmptyState icon="car" title={it.common.notFoundTitle} message={it.vehicle.notFound} />;
          const { unit, statuses, checks } = data;
          return (
            <>
              <Text variant="body" color="muted">
                {it.fluid.intro}
              </Text>
              <Banner tone="info" title={it.fluid.obdTitle} message={it.fluid.obdText} />

              {statuses.map((s) => {
                const t = fluidTone(s.kind);
                const next = fluidNextCheckText(s, unit);
                return (
                  <Card
                    key={s.fluid}
                    testID={`fluid-card-${s.fluid}`}
                    accessibilityLabel={`${s.fluidLabelIt}. ${s.labelIt}. ${s.detailIt}. ${it.fluid.check}`}
                    onPress={() => router.push(routes.fluidNew(vehicleId, s.fluid))}
                  >
                    <Text variant="heading">{s.fluidLabelIt}</Text>
                    <StatusBadge tone={t.tone} icon={t.icon} label={s.labelIt} />
                    {s.detailIt !== s.labelIt ? (
                      <Text variant="body" color="muted">
                        {s.detailIt}
                      </Text>
                    ) : null}
                    {s.suggestionIt ? <Text variant="body">{s.suggestionIt}</Text> : null}
                    {next ? (
                      <Text variant="caption" color="muted">
                        {next}
                      </Text>
                    ) : null}
                    <Text variant="caption" color="muted">
                      {s.obdNoteIt}
                    </Text>
                    <Text variant="label" color="info">
                      {it.fluid.check}
                    </Text>
                  </Card>
                );
              })}

              <SectionTitle>{it.fluid.historyTitle}</SectionTitle>
              {checks.length === 0 ? (
                <Text variant="body" color="muted">
                  {it.fluid.historyEmpty}
                </Text>
              ) : (
                checks.map((c) => (
                  <ListRow
                    key={c.id}
                    icon="droplet"
                    title={fluidRowTitle(c)}
                    subtitle={fluidRowSubtitle(c, unit)}
                    accessibilityLabel={fluidRowA11y(c, unit)}
                    onPress={() => router.push(routes.fluidCheck(vehicleId, c.id))}
                  />
                ))
              )}
            </>
          );
        }}
      </QueryBoundary>
    </Screen>
  );
}
