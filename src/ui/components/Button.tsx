// Pulsante con area di tocco di almeno 48 dp, etichetta sempre testuale e ruolo "button".
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { MIN_TOUCH, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Icon, type IconName } from './Icon';
import { Text, type TextColor } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  /** Occupa tutta la larghezza (default). */
  inline?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  loading = false,
  inline = false,
  accessibilityHint,
  style,
  testID,
}: ButtonProps): ReactNode {
  const p = useTheme();
  const inactive = disabled || loading;

  let background = p.primary;
  let textColor: TextColor = 'onPrimary';
  let iconColor = p.onPrimary;
  let borderColor = 'transparent';
  if (variant === 'secondary') {
    background = p.primarySoft;
    textColor = 'onPrimarySoft';
    iconColor = p.onPrimarySoft;
  } else if (variant === 'danger') {
    background = p.danger;
    iconColor = p.onDanger;
  } else if (variant === 'ghost') {
    background = 'transparent';
    textColor = 'primary';
    iconColor = p.primary;
    borderColor = p.borderStrong;
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: background, borderColor, opacity: inactive ? 0.55 : pressed ? 0.85 : 1 },
        inline ? styles.inline : null,
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? <ActivityIndicator color={iconColor} /> : icon ? <Icon name={icon} color={iconColor} size={20} /> : null}
        {variant === 'danger' ? (
          <Text variant="bodyStrong" style={{ color: p.onDanger, flexShrink: 1, textAlign: 'center' }}>
            {label}
          </Text>
        ) : (
          <Text variant="bodyStrong" color={textColor} style={{ flexShrink: 1, textAlign: 'center' }}>
            {label}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  inline: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
});
