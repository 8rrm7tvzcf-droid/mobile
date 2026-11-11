// S-11 Garage: elenco delle auto con semaforo, ultimo km e prossima scadenza.
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { getDashboard, type VehicleSummary } from '@/usecases/queries';
import { Button, EmptyState, Icon, QueryBoundary, Screen, StatusBadge, Text } from '../components';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { countsSummary, toneWord } from '../logic/status';
import { routes } from '../navigation/routes';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

function VehicleCard({ v, onPress }: { v: VehicleSummary; onPress: () => void }): ReactNode {
  const p = useTheme();
  const none = v.counts.total === 0;
  const badgeLabel = none ? it.garage.allClear : toneWord(v.tone);
  const km = v.currentKmText ?? it.garage.noKm;
  const a11y = `${v.label}. ${v.plate ?? ''} ${km}. ${badgeLabel}. ${none ? '' : countsSummary(v.counts)}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: p.surface, borderColor: p.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={styles.flex}>
        <Text variant="heading">{v.label}</Text>
        <Text variant="caption" color="muted">
          {[v.plate, km].filter(Boolean).join(' · ')}
        </Text>
        {v.isDemo ? (
          <Text variant="caption" color="info">
            {it.garage.demoTag}
          </Text>
        ) : null}
        <StatusBadge tone={none ? 'unknown' : v.tone} icon={none ? 'help' : v.icon} label={badgeLabel} />
        {v.next ? (
          <Text variant="caption" color="muted">
            {`${it.garage.nextPrefix} ${v.next.title} · ${v.next.text}`}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-right" color={p.textMuted} size={20} />
    </Pressable>
  );
}

export function GarageScreen(): ReactNode {
  const router = useRouter();
  const query = useQuery((d) => getDashboard(d), [], it.common.loadError);
  return (
    <Screen padBottom={false} onRefresh={query.reload} refreshing={false}>
      <QueryBoundary query={query}>
        {(dash) =>
          dash.vehicles.length === 0 ? (
            <EmptyState
              icon="car"
              title={it.garage.emptyTitle}
              message={it.garage.emptyText}
              actions={[{ label: it.garage.add, onPress: () => router.push(routes.newVehicle) }]}
            />
          ) : (
            <>
              {dash.vehicles.map((v) => (
                <VehicleCard key={v.id} v={v} onPress={() => router.push(routes.vehicle(v.id))} />
              ))}
              <Button label={it.garage.add} icon="plus" variant="secondary" onPress={() => router.push(routes.newVehicle)} />
            </>
          )
        }
      </QueryBoundary>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: space.xs },
  card: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1 },
});
