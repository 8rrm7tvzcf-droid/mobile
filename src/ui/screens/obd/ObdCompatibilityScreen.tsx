// Report di compatibilita' (F-59): cosa l'auto dichiara e cosa risponde davvero, piu' la scheda "Cosa si legge e cosa no".
// Se l'auto non risponde lo si dice chiaramente, senza dare la colpa all'utente (SPEC 5.6).
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { CapabilityReport, ObdFailure } from '@/bootstrap';
import { Banner, Button, Card, Screen, SectionTitle, Text } from '../../components';
import { useObdService, useObdState } from '../../hooks/useObd';
import { it } from '../../i18n/it';
import { availabilityStyle, checklistRows, compatSummary, failureText } from '../../logic/obdView';
import { routes } from '../../navigation/routes';
import { space } from '../../theme/tokens';
import { ProgressCard, ToneBadge } from './parts';

type Load = { status: 'loading' } | { status: 'ready'; report: CapabilityReport } | { status: 'error'; failure: ObdFailure };

export function ObdCompatibilityScreen({ vehicleId }: { vehicleId: string }): ReactNode {
  const router = useRouter();
  const service = useObdService();
  const obd = useObdState();
  const connected = obd.phase === 'ready';
  const [load, setLoad] = useState<Load>(() => {
    const cached = service.getState().phase === 'ready' ? service.lastCapabilities() : null;
    return cached ? { status: 'ready', report: cached } : { status: 'loading' };
  });
  const mounted = useRef(true);
  const c = it.obd.compat;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const check = useCallback(
    async (refresh: boolean): Promise<void> => {
      setLoad({ status: 'loading' });
      const r = await service.capabilities({ refresh });
      if (!mounted.current) return;
      setLoad(r.ok ? { status: 'ready', report: r.value } : { status: 'error', failure: r.error });
    },
    [service],
  );

  useEffect(() => {
    if (service.getState().phase === 'ready' && load.status === 'loading') void check(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen>
      <Text variant="body">{c.intro}</Text>

      {!connected ? (
        <Card tone="info">
          <Text variant="heading" color="info">
            {c.notConnectedTitle}
          </Text>
          <Text variant="body" color="info">
            {c.notConnectedText}
          </Text>
          <Button label={it.obd.connectAgain} icon="plug" variant="secondary" onPress={() => router.push(routes.vehicleObd(vehicleId))} />
        </Card>
      ) : load.status === 'loading' ? (
        <ProgressCard testID="obd-compat-loading" title={c.loading} text={it.obd.snapshot.steps[obd.readStep ?? 'capabilities']} />
      ) : load.status === 'error' ? (
        <Banner
          tone="danger"
          title={failureText(load.failure.code).title}
          message={failureText(load.failure.code).text}
          actionLabel={it.common.retry}
          onAction={() => void check(false)}
        />
      ) : (
        <ReportSections report={load.report} onRefresh={() => void check(true)} />
      )}

      <AvailabilityTable />
    </Screen>
  );
}

function ReportSections({ report, onRefresh }: { report: CapabilityReport; onRefresh: () => void }): ReactNode {
  const c = it.obd.compat;
  const sum = compatSummary(report);
  const rows = checklistRows(report);
  return (
    <>
      {sum.noEcu ? <Banner tone="warning" title={c.noEcuTitle} message={c.noEcuText} /> : null}
      {sum.suspectedClone ? <Banner tone="warning" title={c.cloneTitle} message={c.cloneText} /> : null}
      {sum.noPid && !sum.noEcu ? <Banner tone="warning" title={c.noPidTitle} message={c.noPidText} /> : null}

      <SectionTitle>{c.connectionTitle}</SectionTitle>
      <Card testID="obd-compat-connection">
        <Line label={c.protocol} value={report.protocol.name} />
        <Line label={c.ecus} value={sum.ecus || it.common.none} />
        <Line label={c.declared} value={c.declaredCount(sum.declared)} />
        <Line label={c.answered} value={c.declaredCount(sum.answered)} />
      </Card>

      <SectionTitle>{c.checklistTitle}</SectionTitle>
      <Card testID="obd-compat-checklist">
        {rows.map((r) => (
          <View key={r.key} style={styles.checkRow} accessible accessibilityLabel={`${r.label}: ${r.available ? c.availableTag : c.unavailableTag}${r.detail ? `. ${r.detail}` : ''}`}>
            <View style={styles.checkText}>
              <Text variant="bodyStrong">{r.label}</Text>
              {r.detail ? (
                <Text variant="caption" color="muted">
                  {r.detail}
                </Text>
              ) : null}
            </View>
            {r.available ? <ToneBadge tone="ok" icon="check" label={c.availableTag} /> : <ToneBadge tone="unknown" icon="x" label={c.unavailableTag} />}
          </View>
        ))}
      </Card>
      <Button label={c.refresh} icon="refresh" variant="secondary" onPress={onRefresh} />
    </>
  );
}

function Line({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <View style={styles.line} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="label" color="muted">
        {label}
      </Text>
      <Text variant="body">{value}</Text>
    </View>
  );
}

/** Scheda statica "Cosa si legge e cosa no" (SPEC 5.1), in italiano semplice: vale per qualsiasi auto. */
export function AvailabilityTable(): ReactNode {
  const t = it.obd.table;
  return (
    <>
      <SectionTitle>{t.title}</SectionTitle>
      <Text variant="body" color="muted">
        {t.intro}
      </Text>
      <Card testID="obd-table">
        {t.rows.map((r) => {
          const st = availabilityStyle(r.value);
          return (
            <View key={r.key} style={styles.checkRow} accessible accessibilityLabel={`${r.label}: ${st.label}. ${r.note}`}>
              <View style={styles.checkText}>
                <Text variant="bodyStrong">{r.label}</Text>
                <Text variant="caption" color="muted">
                  {r.note}
                </Text>
              </View>
              <ToneBadge tone={st.tone} icon={st.icon} label={st.label} />
            </View>
          );
        })}
      </Card>
      <Text variant="caption" color="muted">
        {t.footnote}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  checkRow: { gap: space.sm, paddingVertical: space.xs },
  checkText: { gap: 2 },
  line: { gap: 2, paddingVertical: space.xs },
});
