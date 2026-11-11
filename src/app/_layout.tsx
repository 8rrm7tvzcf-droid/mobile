import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProvider } from '@/bootstrap';
import { it } from '@/ui/i18n/it';
import { useColorSchemeName, useTheme } from '@/ui/theme/useTheme';

function Navigation() {
  const palette = useTheme();
  const scheme = useColorSchemeName();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: palette.primary,
      background: palette.background,
      card: palette.surface,
      text: palette.text,
      border: palette.border,
      notification: palette.danger,
    },
  };
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: palette.surface },
          headerTintColor: palette.text,
          headerTitleStyle: { fontWeight: '600' },
          headerBackTitle: it.common.back,
          contentStyle: { backgroundColor: palette.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="benvenuto" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="auto/nuova" options={{ title: it.vehicleForm.titleNew }} />
        <Stack.Screen name="auto/[id]/index" options={{ title: it.vehicle.title }} />
        <Stack.Screen name="auto/[id]/modifica" options={{ title: it.vehicleForm.titleEdit }} />
        <Stack.Screen name="auto/[id]/km" options={{ title: it.km.title }} />
        <Stack.Screen name="auto/[id]/scadenze" options={{ title: it.deadlines.listTitle }} />
        <Stack.Screen name="auto/[id]/rifornimenti" options={{ title: it.fuel.listTitle }} />
        <Stack.Screen name="auto/[id]/rifornimento/nuovo" options={{ title: it.fuel.newTitle }} />
        <Stack.Screen name="auto/[id]/rifornimento/[logId]" options={{ title: it.fuel.editTitle }} />
        <Stack.Screen name="auto/[id]/interventi" options={{ title: it.service.listTitle }} />
        <Stack.Screen name="auto/[id]/intervento/nuovo" options={{ title: it.service.newTitle }} />
        <Stack.Screen name="auto/[id]/intervento/[recordId]/index" options={{ title: it.service.detailTitle }} />
        <Stack.Screen name="auto/[id]/intervento/[recordId]/modifica" options={{ title: it.service.editTitle }} />
        <Stack.Screen name="auto/[id]/livelli/index" options={{ title: it.fluid.title }} />
        <Stack.Screen name="auto/[id]/livelli/nuovo" options={{ title: it.fluid.newTitle }} />
        <Stack.Screen name="auto/[id]/livelli/[checkId]" options={{ title: it.fluid.detailTitle }} />
        <Stack.Screen name="auto/[id]/assicurazioni" options={{ title: it.policy.listTitle }} />
        <Stack.Screen name="auto/[id]/polizza/nuova" options={{ title: it.policy.newTitle }} />
        <Stack.Screen name="auto/[id]/polizza/[policyId]/index" options={{ title: it.policy.detailTitle }} />
        <Stack.Screen name="auto/[id]/polizza/[policyId]/modifica" options={{ title: it.policy.editTitle }} />
        <Stack.Screen name="auto/[id]/polizza/[policyId]/rinnova" options={{ title: it.policy.renewTitle }} />
        <Stack.Screen name="auto/[id]/spese" options={{ title: it.expense.listTitle }} />
        <Stack.Screen name="auto/[id]/spesa/nuova" options={{ title: it.expense.newTitle }} />
        <Stack.Screen name="auto/[id]/spesa/[expenseId]" options={{ title: it.expense.editTitle }} />
        <Stack.Screen name="auto/[id]/costi" options={{ title: it.costs.title }} />
        <Stack.Screen name="auto/[id]/documenti" options={{ title: it.documents.title }} />
        <Stack.Screen name="backup" options={{ title: it.backup.title }} />
        <Stack.Screen name="cestino" options={{ title: it.trash.title }} />
        <Stack.Screen name="auto/[id]/imposta" options={{ title: it.setup.title }} />
        <Stack.Screen name="auto/[id]/date" options={{ title: it.documentDates.title }} />
        <Stack.Screen name="auto/[id]/obd/index" options={{ title: it.obd.intro.title }} />
        <Stack.Screen name="auto/[id]/obd/lettura" options={{ title: it.obd.snapshot.title }} />
        <Stack.Screen name="auto/[id]/obd/compatibilita" options={{ title: it.obd.compat.title }} />
        <Stack.Screen name="auto/[id]/obd/live" options={{ title: it.obd.live.title }} />
        <Stack.Screen name="adattatore-obd" options={{ title: it.obd.guide.title }} />
        <Stack.Screen name="scadenza/[id]" options={{ title: it.deadlines.detailTitle }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AppProvider>
      <Navigation />
    </AppProvider>
  );
}
