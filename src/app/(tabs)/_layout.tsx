import { Tabs } from 'expo-router/js-tabs';
import { useOnboardingGate } from '@/ui/hooks/onboarding';
import { Icon } from '@/ui/components';
import { it } from '@/ui/i18n/it';
import { useTheme } from '@/ui/theme/useTheme';

export default function TabsLayout() {
  useOnboardingGate();
  const palette = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.text,
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        sceneStyle: { backgroundColor: palette.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: it.tabs.today, tabBarIcon: ({ color, size }) => <Icon name="calendar" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="garage"
        options={{ title: it.tabs.garage, tabBarIcon: ({ color, size }) => <Icon name="car" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="registro"
        options={{ title: it.tabs.registry, tabBarIcon: ({ color, size }) => <Icon name="book" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="impostazioni"
        options={{ title: it.tabs.settings, tabBarIcon: ({ color, size }) => <Icon name="sliders" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
