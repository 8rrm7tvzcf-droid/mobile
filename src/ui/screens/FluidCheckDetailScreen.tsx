// Dettaglio di un controllo livelli registrato, con eliminazione e «Annulla» (il controllo si ricrea com'era).
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useApp } from '@/bootstrap';
import { deleteFluidCheck, getFluidCheck } from '@/usecases/fluids';
import { getVehicle } from '@/usecases/vehicles';
import { Banner, Button, Card, ConfirmSheet, EmptyState, QueryBoundary, Screen, Text } from '../components';
import { pushUndo } from '../hooks/undo';
import { useBusy } from '../hooks/useBusy';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { describeError, describeThrown } from '../logic/errors';
import { fluidRestoreInput, fluidRowSubtitle } from '../logic/fluidForm';
import { goBackOr } from '../navigation/actions';
import { routes } from '../navigation/routes';

export function FluidCheckDetailScreen({ vehicleId, checkId }: { vehicleId: string; checkId: string }): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const working = useBusy();
  const query = useQuery(
    async (d) => {
      const vehicle = await getVehicle(d, vehicleId);
      const check = await getFluidCheck(d, checkId);
      if (!vehicle || !check || check.vehicleId !== vehicleId) return null;
      return { unit: vehicle.distanceUnit, check };
    },
    [vehicleId, checkId],
    it.common.loadError,
  );

  return (
    <Screen>
      <QueryBoundary query={query}>
        {(data) => {
          if (data === null) return <EmptyState icon="droplet" title={it.common.notFoundTitle} message={it.fluid.notFound} />;
          const { unit, check } = data;
          const remove = (): void => {
            void working.run(async () => {
              try {
                const res = await deleteFluidCheck(deps, check.id);
                setConfirm(false);
                if (!res.ok) return setError(describeError(res.error).message);
                pushUndo({ mode: 'deleted', kind: 'fluid', itemId: check.id, vehicleId, message: it.fluid.deletedMessage, payload: fluidRestoreInput(check) });
                goBackOr(router, routes.fluids(vehicleId));
              } catch (e) {
                setConfirm(false);
                setError(describeThrown(e));
              }
            });
          };
          return (
            <>
              {error ? <Banner tone="danger" title={error} /> : null}
              <Card testID="fluid-check-detail">
                <Text variant="title">{check.fluidLabelIt}</Text>
                <Text variant="largeTitle">{check.levelLabelIt}</Text>
                <Text variant="body" color="muted">
                  {fluidRowSubtitle(check, unit)}
                </Text>
                {check.notes ? <Text variant="body">{check.notes}</Text> : null}
              </Card>
              <Button label={it.fluid.delete} icon="trash" variant="ghost" onPress={() => setConfirm(true)} />
              <ConfirmSheet
                visible={confirm}
                title={it.fluid.deleteTitle}
                message={it.fluid.deleteText}
                confirmLabel={it.fluid.deleteConfirm}
                destructive
                busy={working.busy}
                onConfirm={remove}
                onCancel={() => setConfirm(false)}
              />
            </>
          );
        }}
      </QueryBoundary>
    </Screen>
  );
}
