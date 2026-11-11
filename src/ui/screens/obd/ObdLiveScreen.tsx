// Dati dal vivo ad auto ferma: giri, temperatura del liquido, tensione. Avvia/Ferma, frequenza moderata (2 volte al secondo),
// schermo acceso finche' i dati sono in corso. Non salva nulla.
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LiveStopReason } from '@/bootstrap';
import { Banner, Button, Card, Screen, Text } from '../../components';
import { useKeepAwakeWhile, useObdService, useObdState } from '../../hooks/useObd';
import { it } from '../../i18n/it';
import { EMPTY_LIVE, formatClock, mergeLive, pidValueText, voltageText, type LiveValues } from '../../logic/obdView';
import { routes } from '../../navigation/routes';
import { space } from '../../theme/tokens';
import { ToneBadge, ValueLine } from './parts';

/** Dopo quanti campioni un valore ancora assente si considera "non risponde". */
const SAMPLES_BEFORE_MISSING = 6;

export function ObdLiveScreen({ vehicleId }: { vehicleId: string }): ReactNode {
  const router = useRouter();
  const service = useObdService();
  const obd = useObdState();
  const [values, setValues] = useState<LiveValues>(EMPTY_LIVE);
  const [stopReason, setStopReason] = useState<LiveStopReason | null>(null);
  const [startError, setStartError] = useState(false);
  const mounted = useRef(true);
  const l = it.obd.live;
  const connected = obd.phase === 'ready';

  useKeepAwakeWhile(obd.live);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // lasciando la schermata il flusso si ferma: nessuna lettura continua in secondo piano
      void service.stopLive();
    };
  }, [service]);

  const start = useCallback(async (): Promise<void> => {
    setStartError(false);
    setStopReason(null);
    setValues(EMPTY_LIVE);
    const r = await service.startLive(
      (sample) => {
        if (mounted.current) setValues((v) => mergeLive(v, sample));
      },
      {
        onStop: (reason) => {
          if (mounted.current && reason !== 'stopped') setStopReason(reason);
        },
      },
    );
    if (!r.ok && mounted.current) setStartError(true);
  }, [service]);

  if (!connected) {
    return (
      <Screen>
        <Card tone="info">
          <Text variant="heading" color="info">
            {l.notConnectedTitle}
          </Text>
          <Text variant="body" color="info">
            {l.notConnectedText}
          </Text>
          <Button label={it.obd.connectAgain} icon="plug" variant="secondary" onPress={() => router.replace(routes.vehicleObd(vehicleId))} />
        </Card>
      </Screen>
    );
  }

  const running = obd.live;
  const missing = (v: unknown): boolean => v === null && values.samples >= SAMPLES_BEFORE_MISSING;
  const when = values.lastAt ? formatClock(values.lastAt) : '';

  return (
    <Screen>
      {obd.demo ? <Banner tone="info" title={it.obd.snapshot.demoTitle} message={it.obd.snapshot.demoText} icon="car" /> : null}
      <Text variant="body">{l.intro}</Text>
      <Banner tone="warning" title={l.safety} icon="alert" />

      {stopReason === 'link-lost' ? <Banner tone="danger" title={l.lostTitle} message={l.lostText} /> : null}
      {stopReason === 'no-pids' ? <Banner tone="warning" title={l.noPidsTitle} message={l.noPidsText} /> : null}
      {startError ? <Banner tone="danger" title={l.startError} actionLabel={it.common.retry} onAction={() => void start()} /> : null}

      <View style={styles.statusRow} accessibilityLiveRegion="polite">
        {running ? <ToneBadge tone="ok" icon="activity" label={l.running} /> : <ToneBadge tone="unknown" icon="square" label={l.stopped} />}
        {values.lastAt ? (
          <Text variant="caption" color="muted">
            {l.updatedAt(when)}
          </Text>
        ) : null}
      </View>

      <Card testID="obd-live-values">
        <LiveLine label={l.rpm} reading={values.rpm ? { text: pidValueText(values.rpm.value), source: values.rpm.source } : null} waiting={running} missing={missing(values.rpm)} />
        <LiveLine
          label={l.coolant}
          reading={values.coolant ? { text: pidValueText(values.coolant.value), source: values.coolant.source } : null}
          waiting={running}
          missing={missing(values.coolant)}
        />
        <LiveLine
          label={l.moduleVoltage}
          reading={values.moduleVoltage ? { text: pidValueText(values.moduleVoltage.value), source: values.moduleVoltage.source } : null}
          waiting={running}
          missing={missing(values.moduleVoltage)}
        />
        <LiveLine
          label={l.adapterVoltage}
          reading={values.adapterVoltage ? { text: voltageText(values.adapterVoltage.value), source: values.adapterVoltage.source } : null}
          waiting={running}
          missing={missing(values.adapterVoltage)}
        />
        <Text variant="caption" color="muted">
          {it.obd.snapshot.voltageNote}
        </Text>
      </Card>

      {!running && values.samples === 0 ? (
        <Text variant="body" color="muted">
          {l.stoppedHint}
        </Text>
      ) : null}
      {running ? (
        <Text variant="caption" color="muted">
          {l.keepAwake}
        </Text>
      ) : null}

      {running ? (
        <Button label={l.stop} icon="square" variant="danger" onPress={() => void service.stopLive()} />
      ) : (
        <Button label={l.start} icon="play" onPress={() => void start()} />
      )}
    </Screen>
  );
}

function LiveLine({
  label,
  reading,
  waiting,
  missing,
}: {
  label: string;
  reading: { text: string; source: 'read' | 'estimated' | 'entered' } | null;
  waiting: boolean;
  missing: boolean;
}): ReactNode {
  const l = it.obd.live;
  if (reading) {
    return <ValueLine label={label} value={reading.text} source={reading.source} a11y={`${label}: ${reading.text}. ${it.obd.provenance[reading.source]}.`} />;
  }
  const text = missing ? l.notAnswering : waiting ? l.waiting : '–';
  return (
    <View style={styles.empty} accessible accessibilityLabel={`${label}: ${text}`}>
      <Text variant="label" color="muted">
        {label}
      </Text>
      <Text variant="body" color="muted">
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' },
  empty: { gap: 2, paddingVertical: space.xs },
});
