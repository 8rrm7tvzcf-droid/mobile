// S-30 Scadenze dell'auto: elenco per stato (scadute, in arrivo, in regola, da configurare).
import { useRouter } from 'expo-router';
import { Fragment, type ReactNode } from 'react';
import { getVehicleDeadlines } from '@/usecases/queries';
import { Button, DeadlineRowItem, EmptyState, QueryBoundary, Screen, SectionTitle } from '../components';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { deadlineHref, sectionsOf } from '../logic/status';
import { routes } from '../navigation/routes';

export function DeadlinesScreen({ vehicleId }: { vehicleId: string }): ReactNode {
  const router = useRouter();
  const query = useQuery((d) => getVehicleDeadlines(d, vehicleId), [vehicleId], it.common.loadError);
  return (
    <Screen onRefresh={query.reload} refreshing={false}>
      <QueryBoundary query={query}>
        {(data) => {
          if (data === null) return <EmptyState icon="car" title={it.common.notFoundTitle} message={it.vehicle.notFound} />;
          if (data.rows.length === 0) {
            return (
              <EmptyState
                icon="calendar"
                title={it.deadlines.emptyTitle}
                message={it.deadlines.emptyText}
                actions={[{ label: it.deadlines.setup, onPress: () => router.push(routes.setup(vehicleId)) }]}
              />
            );
          }
          return (
            <>
              {sectionsOf(data.groups).map((s) => (
                <Fragment key={s.group}>
                  <SectionTitle>{`${s.title} (${s.rows.length})`}</SectionTitle>
                  {s.rows.map((row) => (
                    <DeadlineRowItem key={row.id} row={row} onPress={() => router.push(deadlineHref(row))} />
                  ))}
                </Fragment>
              ))}
              <Button label={it.deadlines.setup} variant="secondary" icon="calendar" onPress={() => router.push(routes.setup(vehicleId))} />
            </>
          );
        }}
      </QueryBoundary>
    </Screen>
  );
}

