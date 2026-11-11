// Scheda: superficie con bordo sottile. Con `onPress` diventa un'area toccabile (>= 48 dp, ruolo "button").
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, space, type ToneKey } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Tinta di sfondo semantica (avvisi, riepiloghi). */
  tone?: ToneKey;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Card({ children, onPress, accessibilityLabel, accessibilityHint, tone, selected, style, testID }: CardProps): ReactNode {
  const p = useTheme();
  const base: ViewStyle = {
    backgroundColor: tone ? p.tone[tone].bg : p.surface,
    borderColor: selected ? p.primary : p.border,
    borderWidth: selected ? 2 : 1,
  };
  if (!onPress) {
    return (
      <View testID={testID} style={[styles.card, base, style]}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.card, base, { opacity: pressed ? 0.85 : 1 }, style]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
});
