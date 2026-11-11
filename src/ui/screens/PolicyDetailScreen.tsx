// S-41 Dettaglio polizza: stato e scadenza, rate con «Segna come pagata» (e annulla), garanzie, contatti per il sinistro,
// «Rinnova», modifica ed elimina con «Annulla». La tolleranza di 15 giorni dell'RC auto e' solo una nota informativa.
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useApp } from '@/bootstrap';
import { formatDateIt, formatEuro } from '@/domain/units';
import { deletePolicy, getPolicy, markInstallmentPaid, unmarkInstallmentPaid, type InstallmentView } from '@/usecases/insurance';
import { getVehicle } from '@/usecases/vehicles';
import { AttachmentsSection, Banner, Button, Card, ConfirmSheet, EmptyState, QueryBoundary, Screen, SectionTitle, StatusBadge, Text } from '../components';
import { pushUndo } from '../hooks/undo';
import { useBusy } from '../hooks/useBusy';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { describeError, describeThrown } from '../logic/errors';
import { coverageText, installmentBadge, installmentTitle, policyBadge, policyTitle } from '../logic/policyForm';
import { goBackOr } from '../navigation/actions';
import { routes } from '../navigation/routes';
import { space } from '../theme/tokens';

export function PolicyDetailScreen({ vehicleId, policyId }: { vehicleId: string; policyId: string }): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const working = useBusy();
  const query = useQuery(
    async (d) => {
      const vehicle = await getVehicle(d, vehicleId);
      const policy = await getPolicy(d, policyId);
      if (!vehicle || !policy || policy.vehicleId !== vehicleId) return null;
      return { policy };
    },
    [vehicleId, policyId],
    it.common.loadError,
  );

  const togglePaid = (i: InstallmentView): void => {
    void working.run(async () => {
      setError(null);
      setNotice(null);
      try {
        const res = i.paidOn === null ? await markInstallmentPaid(deps, { paymentId: i.id }) : await unmarkInstallmentPaid(deps, i.id);
        if (!res.ok) return setError(describeError(res.error).message);
        setNotice(i.paidOn === null ? it.policy.paidNotice : it.policy.unpaidNotice);
      } catch (e) {
        setError(describeThrown(e));
      }
    });
  };

  const remove = (): void => {
    void working.run(async () => {
      try {
        const res = await deletePolicy(deps, policyId);
        setConfirm(false);
        if (!res.ok) return setError(describeError(res.error).message);
        pushUndo({ mode: 'deleted', kind: 'policy', itemId: policyId, vehicleId, message: it.policy.deletedMessage });
        goBackOr(router, routes.policies(vehicleId));
      } catch (e) {
        setConfirm(false);
        setError(describeThrown(e));
      }
    });
  };

  const call = (phone: string): void => {
    void Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`).catch(() => undefined);
  };

  return (
    <Screen onRefresh={query.reload} refreshing={false}>
      <QueryBoundary query={query}>
        {(data) => {
          if (data === null) return <EmptyState icon="shield" title={it.common.notFoundTitle} message={it.policy.notFound} />;
          const p = data.policy;
          const badge = policyBadge(p);
          const canRenew = p.status !== 'renewed' && p.status !== 'cancelled';
          const phones: { label: string; value: string }[] = [
            { label: it.policy.claimsPhone, value: p.claimsPhone ?? '' },
            { label: it.policy.assistancePhone, value: p.assistancePhone ?? '' },
            { label: it.policy.agentPhone, value: p.agentPhone ?? '' },
          ].filter((x) => x.value !== '');
          const emails = [p.claimsEmail, p.agentEmail].filter((x): x is string => Boolean(x));
          return (
            <>
              {error ? <Banner tone="danger" title={error} /> : null}
              {notice ? <Banner tone="ok" title={notice} /> : null}

              <Card testID="policy-detail">
                <Text variant="title">{policyTitle(p)}</Text>
                <StatusBadge tone={badge.tone} icon={badge.icon} label={badge.label} />
                <Text variant="body">{it.policy.datesLine(formatDateIt(p.startOn), formatDateIt(p.endOn))}</Text>
                {p.policyNumber ? <Text variant="body" color="muted">{`${it.policy.numberLabel}: ${p.policyNumber}`}</Text> : null}
                {p.agencyName ? <Text variant="body" color="muted">{`${it.policy.agencyLabel}: ${p.agencyName}`}</Text> : null}
                {p.premiumCents > 0 ? <Text variant="body">{it.policy.premiumLine(formatEuro(p.premiumCents))}</Text> : null}
                {p.meritClass !== null ? <Text variant="body" color="muted">{it.policy.meritValue(p.meritClass)}</Text> : null}
                {p.blackBox ? <Text variant="body" color="muted">{it.policy.blackBox}</Text> : null}
              </Card>

              {p.status === 'renewed' ? <Banner tone="info" title={it.policy.renewedNote} /> : null}
              {p.expiry.note ? <Banner tone="info" title={it.policy.graceTitle} message={p.expiry.note} /> : null}
              {p.warningIt && canRenew ? <Banner tone="info" title={p.warningIt} /> : null}

              <SectionTitle>{it.policy.installmentsSection}</SectionTitle>
              {p.installments.length === 0 ? (
                <Text variant="body" color="muted">
                  {it.policy.installmentsNone}
                </Text>
              ) : (
                p.installments.map((i) => {
                  const b = installmentBadge(i);
                  return (
                    <Card key={i.id} testID={`policy-installment-${i.installmentNo}`}>
                      <Text variant="bodyStrong">{installmentTitle(i)}</Text>
                      <StatusBadge tone={b.tone} icon={b.icon} label={b.label} />
                      <Button
                        label={i.paidOn === null ? it.policy.markPaid : it.policy.unmarkPaid}
                        icon={i.paidOn === null ? 'check' : 'undo'}
                        variant={i.paidOn === null ? 'secondary' : 'ghost'}
                        loading={working.busy}
                        onPress={() => togglePaid(i)}
                      />
                    </Card>
                  );
                })
              )}

              <SectionTitle>{it.policy.coveragesSection}</SectionTitle>
              {p.coverages.length === 0 ? (
                <Text variant="body" color="muted">
                  {it.policy.coveragesNone}
                </Text>
              ) : (
                <Card>
                  {p.coverages.map((c) => (
                    <Text key={c.id} variant="body">
                      {coverageText(c)}
                    </Text>
                  ))}
                </Card>
              )}

              {phones.length > 0 || emails.length > 0 || p.agentName ? (
                <>
                  <SectionTitle>{it.policy.contactsSection}</SectionTitle>
                  <Card>
                    {phones.map((x) => (
                      <View key={x.label} style={styles.contact}>
                        <View style={styles.flex}>
                          <Text variant="caption" color="muted">
                            {x.label}
                          </Text>
                          <Text variant="bodyStrong">{x.value}</Text>
                        </View>
                        <Button inline variant="secondary" label={it.policy.call} onPress={() => call(x.value)} accessibilityHint={x.label} />
                      </View>
                    ))}
                    {p.agentName ? <Text variant="body">{`${it.policy.agentName}: ${p.agentName}`}</Text> : null}
                    {emails.map((e) => (
                      <Text key={e} variant="body" color="muted">
                        {e}
                      </Text>
                    ))}
                  </Card>
                </>
              ) : null}

              {p.notes ? (
                <Card>
                  <Text variant="body">{p.notes}</Text>
                </Card>
              ) : null}

              <AttachmentsSection parent={{ type: 'policy', id: p.id }} vehicleId={vehicleId} />

              <Text variant="caption" color="muted">
                {it.policy.verifyNote}
              </Text>

              {canRenew ? <Button label={it.policy.renew} icon="refresh" testID="policy-renew" onPress={() => router.push(routes.policyRenew(vehicleId, p.id))} /> : null}
              <Button label={it.common.edit} icon="edit" variant="secondary" onPress={() => router.push(routes.policyEdit(vehicleId, p.id))} />
              <Button label={it.policy.delete} icon="trash" variant="ghost" onPress={() => setConfirm(true)} />

              <ConfirmSheet
                visible={confirm}
                title={it.policy.deleteTitle}
                message={it.policy.deleteText}
                confirmLabel={it.policy.deleteConfirm}
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

const styles = StyleSheet.create({
  contact: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
});
