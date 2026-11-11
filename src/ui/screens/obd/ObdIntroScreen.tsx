// Collega l'auto (OBD): introduzione onesta (cosa si legge e cosa no), prova con l'auto simulata e, piu' avanti, l'adattatore vero.
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { DEMO_SCENARIOS, type DemoScenario } from '@/bootstrap';
import { Banner, Button, Card, ChoiceGroup, ListRow, Screen, SectionTitle, Text } from '../../components';
import { useObdService, useObdState } from '../../hooks/useObd';
import { it } from '../../i18n/it';
import { failureText } from '../../logic/obdView';
import { routes } from '../../navigation/routes';
import { space } from '../../theme/tokens';
import { IconList, ProgressCard, ToneBadge } from './parts';

export function ObdIntroScreen({ vehicleId }: { vehicleId: string }): ReactNode {
  const router = useRouter();
  const service = useObdService();
  const obd = useObdState();
  const [scenario, setScenario] = useState<DemoScenario>('petrol');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const connecting = obd.phase === 'connecting';
  const connected = obd.phase === 'ready' && obd.demo;
  const t = it.obd.intro;

  const connect = (): void => {
    void service.openDemo(scenario).then((r) => {
      if (r.ok && mounted.current) router.replace(routes.vehicleObdReading(vehicleId));
    });
  };

  const failure = obd.phase === 'failed' && obd.failure ? failureText(obd.failure.code) : null;

  return (
    <Screen>
      <Card>
        <Text variant="body">{t.lead}</Text>
      </Card>

      <SectionTitle>{t.canTitle}</SectionTitle>
      <Card>
        <IconList items={t.can} icon="check" tone="ok" />
      </Card>

      <SectionTitle>{t.cannotTitle}</SectionTitle>
      <Card>
        <IconList items={t.cannot} icon="x" tone="unknown" />
        <Text variant="body" color="muted">
          {t.cannotNote}
        </Text>
      </Card>

      <Banner tone="info" title={t.readOnly} message={t.safety} icon="shield" />

      {connected ? (
        <Card tone="ok">
          <Text variant="heading" color="ok">
            {t.connectedTitle}
          </Text>
          <Text variant="body" color="ok">
            {t.connectedText}
          </Text>
          <Button label={t.connectedAction} onPress={() => router.replace(routes.vehicleObdReading(vehicleId))} />
          <Button label={it.obd.snapshot.disconnect} variant="ghost" onPress={() => void service.close()} />
        </Card>
      ) : null}

      {failure ? <Banner tone="danger" title={failure.title} message={failure.text} actionLabel={it.common.retry} onAction={connect} /> : null}

      {connecting ? (
        <ProgressCard
          testID="obd-connecting"
          title={it.obd.connecting.title}
          text={obd.connectStep ? it.obd.connecting.steps[obd.connectStep] : it.obd.connecting.starting}
          hint={it.obd.connecting.hint}
          cancelLabel={it.obd.connecting.cancel}
          onCancel={() => void service.close()}
        />
      ) : null}

      <SectionTitle>{t.demoTitle}</SectionTitle>
      <Card>
        <Text variant="body" color="muted">
          {t.demoText}
        </Text>
        <ChoiceGroup
          label={t.scenarioLabel}
          options={DEMO_SCENARIOS.map((value) => ({ value, label: t.scenarios[value] }))}
          value={scenario}
          onChange={setScenario}
        />
        <Button label={t.demoButton} icon="car" onPress={connect} disabled={connecting} />
      </Card>

      <SectionTitle>{t.realTitle}</SectionTitle>
      <Card>
        <View style={styles.badgeRow}>
          <ToneBadge tone="unknown" icon="bluetooth" label={t.realBadge} />
        </View>
        <Text variant="body" color="muted">
          {t.realText}
        </Text>
        <Button label={t.realTitle} icon="bluetooth" variant="secondary" disabled onPress={() => undefined} accessibilityHint={t.realBadge} />
      </Card>

      <ListRow title={t.guideLink} icon="help" onPress={() => router.push(routes.obdAdapter(vehicleId))} />
      <ListRow title={t.compatLink} icon="list" onPress={() => router.push(routes.vehicleObdCompat(vehicleId))} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  badgeRow: { marginBottom: space.xs },
});
