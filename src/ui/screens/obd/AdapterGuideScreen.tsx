// Quale adattatore scegliere (guida statica, SPEC 5.3): BLE vs Bluetooth classico, il Bluetooth dell'auto non serve, cloni.
// Nessuna marca e nessun prezzo: la lista consigliata si pubblichera' solo dopo le prove con adattatori veri.
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Banner, Button, Card, Screen, Text } from '../../components';
import { it } from '../../i18n/it';
import { routes } from '../../navigation/routes';

export function AdapterGuideScreen({ vehicleId }: { vehicleId?: string }): ReactNode {
  const router = useRouter();
  const g = it.obd.guide;
  return (
    <Screen>
      <Text variant="body">{g.lead}</Text>

      {g.sections.map((section) => (
        <Card key={section.key} testID={`obd-guide-${section.key}`}>
          <Text variant="heading">{section.title}</Text>
          <Text variant="body">{section.text}</Text>
        </Card>
      ))}

      <Banner tone="info" title={g.realNote} />

      <Card>
        <Text variant="heading">{g.demoTitle}</Text>
        <Text variant="body" color="muted">
          {vehicleId ? g.demoText : g.noVehicle}
        </Text>
        {vehicleId ? <Button label={g.demoAction} icon="car" onPress={() => router.push(routes.vehicleObd(vehicleId))} /> : null}
      </Card>
    </Screen>
  );
}
