// Semaforo di una scadenza: SEMPRE icona + testo, mai solo colore (SPEC 6.3.4, NFR-07).
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { DeadlineIcon, DeadlineTone } from '@/usecases/queries';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Icon } from './Icon';
import { Text } from './Text';

export interface StatusBadgeProps {
  tone: DeadlineTone;
  icon: DeadlineIcon;
  label: string;
}

export function StatusBadge({ tone, icon, label }: StatusBadgeProps): ReactNode {
  const p = useTheme();
  const colors = p.tone[tone];
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]} accessible accessibilityLabel={label}>
      <Icon name={icon} color={colors.fg} size={16} />
      <Text variant="label" color={tone} style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
    maxWidth: '100%',
  },
  label: { flexShrink: 1 },
});
