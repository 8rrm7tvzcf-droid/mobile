// Riga d'elenco: icona a sinistra, titolo e sottotitolo, contenuto a destra, freccia se toccabile. Altezza minima 56 dp.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface ListRowProps {
  title: string;
  subtitle?: string | null;
  icon?: IconName;
  trailing?: ReactNode;
  /** Contenuto sotto il testo (per esempio un semaforo). */
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  strike?: boolean;
  testID?: string;
}

export function ListRow({ title, subtitle, icon, trailing, children, onPress, accessibilityLabel, accessibilityHint, strike, testID }: ListRowProps): ReactNode {
  const p = useTheme();
  const body = (
    <>
      {icon ? (
        <View style={[styles.iconWrap, { backgroundColor: p.primarySoft }]}>
          <Icon name={icon} color={p.onPrimarySoft} size={22} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Text variant="bodyStrong" style={strike ? styles.strike : undefined}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="muted" style={strike ? styles.strike : undefined}>
            {subtitle}
          </Text>
        ) : null}
        {children}
      </View>
      {trailing}
      {onPress ? <Icon name="chevron-right" color={p.textMuted} size={20} /> : null}
    </>
  );
  const containerStyle = [styles.row, { backgroundColor: p.surface, borderColor: p.border }];
  if (!onPress) {
    return (
      <View testID={testID} style={containerStyle} accessible accessibilityLabel={accessibilityLabel}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join('. ')}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [...containerStyle, { opacity: pressed ? 0.85 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  iconWrap: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  strike: { textDecorationLine: 'line-through' },
});
