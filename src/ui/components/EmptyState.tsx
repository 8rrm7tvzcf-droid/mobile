// Stato vuoto utile: spiega cosa manca e offre subito il passo successivo (mai una schermata bianca).
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface EmptyAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
}

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  message?: string;
  actions?: EmptyAction[];
}

export function EmptyState({ icon, title, message, actions = [] }: EmptyStateProps): ReactNode {
  const p = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={[styles.circle, { backgroundColor: p.primarySoft }]}>
        <Icon name={icon} color={p.onPrimarySoft} size={36} />
      </View>
      <Text variant="title" style={styles.center}>
        {title}
      </Text>
      {message ? (
        <Text variant="body" color="muted" style={styles.center}>
          {message}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {actions.map((a) => (
          <Button key={a.label} label={a.label} onPress={a.onPress} variant={a.variant ?? 'primary'} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.md, paddingVertical: space.xl, paddingHorizontal: space.sm },
  circle: { width: 80, height: 80, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.sm },
});
