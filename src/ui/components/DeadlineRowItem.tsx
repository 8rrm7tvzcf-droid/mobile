// Riga di una scadenza: titolo, auto (se serve), semaforo con icona e testo, dettaglio.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { DeadlineRow } from '@/usecases/queries';
import { rowA11yLabel, rowDetail } from '../logic/status';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Icon } from './Icon';
import { StatusBadge } from './StatusBadge';
import { Text } from './Text';

export interface DeadlineRowItemProps {
  row: DeadlineRow;
  showVehicle?: boolean;
  onPress: () => void;
}

export function DeadlineRowItem({ row, showVehicle = false, onPress }: DeadlineRowItemProps): ReactNode {
  const p = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rowA11yLabel(row, showVehicle)}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: p.surface, borderColor: p.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={styles.text}>
        <Text variant="bodyStrong">{row.title}</Text>
        {showVehicle ? (
          <Text variant="caption" color="muted">
            {row.vehicleLabel}
          </Text>
        ) : null}
        <StatusBadge tone={row.tone} icon={row.icon} label={row.label} />
        <Text variant="caption" color="muted">
          {rowDetail(row)}
        </Text>
      </View>
      <Icon name="chevron-right" color={p.textMuted} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  text: { flex: 1, gap: space.xs },
});
