// S-40 Assicurazioni dell'auto: polizze con stato e scadenza (semaforo con icona e testo), rate da pagare, tolleranza dell'RC auto
// come nota informativa e l'avvertenza di verificare la copertura sul servizio ufficiale. Tocco su una polizza = dettaglio.
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { formatEuro } from '@/domain/units';
import { getInsuranceSummary, listPolicies } from '@/usecases/insurance';
import { getVehicle } from '@/usecases/vehicles';
import { Banner, Button, Card, EmptyState, QueryBoundary, Screen, SectionTitle, StatusBadge, Text, UndoBanner } from '../components';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { nextInstallmentText, policyA11y, policyBadge, policySubtitle, policyTitle } from '../logic/policyForm';
import { routes } from '../navigation/routes';

export function PolicyListScreen({ vehicleId }: { vehicleId: string }): ReactNode {
  const router = useRouter();
  const query = useQuery(
    async (d) => {
      const vehicle = await getVehicle(d, vehicleId);
      if (!vehicle) return null;
      const [policies, summary] = await Promise.all([listPolicies(d, vehicleId), getInsuranceSummary(d, vehicleId)]);
      return { policies, summary };
    },
    [vehicleId],
    it.common.loadError,
  );
  const add = (): void => router.push(routes.policyNew(vehicleId));

  return (
    <Screen onRefresh={query.reload} refreshing={false} footer={<Button label={it.policy.add} icon="plus" testID="policy-add" onPress={add} />}>
      <UndoBanner vehicleId={vehicleId} />
      <QueryBoundary query={query}>
        {(data) => {
          if (data === null) return <EmptyState icon="car" title={it.common.notFoundTitle} message={it.vehicle.notFound} />;
          const { policies, summary } = data;
          if (policies.length === 0) {
            return (
              <>
                <EmptyState icon="shield" title={it.policy.emptyTitle} message={it.policy.emptyText} actions={[{ label: it.policy.add, onPress: add }]} />
                <Text variant="caption" color="muted">
                  {it.policy.verifyNote}
                </Text>
              </>
            );
          }
          const current = policies.filter((p) => p.status !== 'renewed' && p.status !== 'cancelled');
          const past = policies.filter((p) => p.status === 'renewed' || p.status === 'cancelled');
          const row = (p: (typeof policies)[number]): ReactNode => {
            const b = policyBadge(p);
            const next = nextInstallmentText(p);
            return (
              <Card key={p.id} testID={`policy-card-${p.kind}`} accessibilityLabel={policyA11y(p)} onPress={() => router.push(routes.policyDetail(vehicleId, p.id))}>
                <Text variant="heading">{policyTitle(p)}</Text>
                <StatusBadge tone={b.tone} icon={b.icon} label={b.label} />
                <Text variant="body" color="muted">
                  {policySubtitle(p)}
                </Text>
                {next ? <Text variant="caption">{next}</Text> : null}
              </Card>
            );
          };
          return (
            <>
              {!summary.hasRca ? (
                <Banner tone="warning" title={it.policy.noRcaTitle} message={it.policy.noRcaText} actionLabel={it.policy.add} onAction={add} />
              ) : null}
              {summary.rcaGraceNote ? <Banner tone="info" title={it.policy.graceTitle} message={summary.rcaGraceNote} /> : null}
              {summary.unpaid.count > 0 ? (
                <Banner
                  tone={summary.unpaid.overdueCount > 0 ? 'danger' : 'info'}
                  title={it.policy.unpaidInstallments(summary.unpaid.count, formatEuro(summary.unpaid.totalCents))}
                  message={summary.unpaid.overdueCount > 0 ? it.policy.unpaidOverdue(summary.unpaid.overdueCount) : undefined}
                />
              ) : null}

              {current.length > 0 ? (
                <>
                  <SectionTitle>{it.policy.currentTitle}</SectionTitle>
                  {current.map(row)}
                </>
              ) : null}
              {past.length > 0 ? (
                <>
                  <SectionTitle>{it.policy.pastTitle}</SectionTitle>
                  {past.map(row)}
                </>
              ) : null}
              <Text variant="caption" color="muted">
                {it.policy.verifyNote}
              </Text>
            </>
          );
        }}
      </QueryBoundary>
    </Screen>
  );
}
