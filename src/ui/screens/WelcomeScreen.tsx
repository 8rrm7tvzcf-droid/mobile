// S-02 Benvenuto: tre schermate brevi e saltabili, poi "Aggiungi la tua auto" o "Prova con un'auto di esempio".
// Nessun account e nessun permesso richiesto qui (SPEC 6.3.1).
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/bootstrap';
import { createDemoVehicle } from '@/usecases/demo';
import { Banner, Button, Icon, Screen, Text } from '../components';
import { setUpDemoDeadlines } from '../hooks/demoSetup';
import { markOnboardingDone } from '../hooks/onboarding';
import { useBusy } from '../hooks/useBusy';
import { it } from '../i18n/it';
import { describeError, describeThrown } from '../logic/errors';
import { resetToToday } from '../navigation/actions';
import { routes } from '../navigation/routes';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

export function WelcomeScreen(): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const p = useTheme();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const demo = useBusy();
  const steps = it.welcome.steps;
  const last = step === steps.length - 1;
  const current = steps[step] ?? steps[0];

  const startDemo = (): void => {
    void demo.run(async () => {
      try {
        const res = await createDemoVehicle(deps);
        if (!res.ok) {
          setError(describeError(res.error).message);
          return;
        }
        await markOnboardingDone(deps);
        // Le scadenze si impostano da sole dallo storico dell'auto di esempio: l'Oggi parte gia' con i semafori colorati.
        const applied = await setUpDemoDeadlines(deps, res.value.vehicleId).catch(() => false);
        if (applied) resetToToday(router);
        else router.replace(routes.setup(res.value.vehicleId, true));
      } catch (e) {
        setError(describeThrown(e));
      }
    });
  };

  const later = (): void => {
    void markOnboardingDone(deps)
      .catch(() => undefined)
      .then(() => resetToToday(router));
  };

  const footer = last ? (
    <>
      <Button label={it.welcome.addCar} icon="car" onPress={() => router.push(routes.newVehicleFirst)} />
      <Button label={demo.busy ? it.welcome.demoBusy : it.welcome.tryDemo} variant="secondary" loading={demo.busy} onPress={startDemo} />
      <Button label={it.welcome.later} variant="ghost" onPress={later} disabled={demo.busy} />
    </>
  ) : (
    <>
      <Button label={it.common.next} onPress={() => setStep(step + 1)} />
      <Button label={it.welcome.skipIntro} variant="ghost" onPress={() => setStep(steps.length - 1)} />
    </>
  );

  return (
    <Screen footer={footer}>
      <View style={{ height: insets.top }} />
      <View style={styles.hero}>
        <View style={[styles.circle, { backgroundColor: p.primarySoft }]}>
          <Icon name={current?.icon ?? 'car'} color={p.onPrimarySoft} size={56} />
        </View>
        <Text variant="caption" color="muted" accessibilityLiveRegion="polite">
          {it.welcome.stepOf(step + 1, steps.length)}
        </Text>
        <Text variant="largeTitle" style={styles.center}>
          {current?.title}
        </Text>
        <Text variant="body" color="muted" style={styles.center}>
          {current?.text}
        </Text>
        {last ? (
          <Text variant="caption" color="muted" style={styles.center}>
            {it.welcome.demoHint}
          </Text>
        ) : null}
      </View>
      {error ? <Banner tone="danger" title={error} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.md, paddingTop: space.xl },
  circle: { width: 120, height: 120, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
});
