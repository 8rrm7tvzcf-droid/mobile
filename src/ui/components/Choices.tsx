// Controlli di scelta: gruppo di opzioni (chip esclusivi), casella con testo e interruttore con testo.
// Tutti con area >= 48 dp, ruolo e stato per i lettori di schermo; la selezione ha anche una spunta, non solo il colore.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { MIN_TOUCH, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Icon } from './Icon';
import { Text } from './Text';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

export interface ChoiceGroupProps<T extends string> {
  label?: string;
  options: readonly ChoiceOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string | null;
  hint?: string;
}

export function ChoiceGroup<T extends string>({ label, options, value, onChange, error, hint }: ChoiceGroupProps<T>): ReactNode {
  const p = useTheme();
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {label ? <Text variant="label">{label}</Text> : null}
      <View style={styles.wrap}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ selected, checked: selected }}
              onPress={() => onChange(o.value)}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: selected ? p.primarySoft : p.surface,
                  borderColor: selected ? p.primary : p.borderStrong,
                  borderWidth: selected ? 2 : 1,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              {selected ? <Icon name="check" color={p.onPrimarySoft} size={18} /> : null}
              <Text variant="bodyStrong" color={selected ? 'onPrimarySoft' : 'text'} style={styles.chipText}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <View style={styles.errorRow}>
          <Icon name="alert" color={p.danger} size={18} />
          <Text variant="caption" color="danger" style={styles.flex}>
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text variant="caption" color="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export interface CheckRowProps {
  label: string;
  description?: string | null;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function CheckRow({ label, description, checked, onChange, disabled = false }: CheckRowProps): ReactNode {
  const p = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityHint={description ?? undefined}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [styles.checkRow, { opacity: disabled ? 0.55 : pressed ? 0.85 : 1 }]}
    >
      <View
        style={[
          styles.box,
          { borderColor: checked ? p.primary : p.borderStrong, backgroundColor: checked ? p.primary : p.surface },
        ]}
      >
        {checked ? <Icon name="check" color={p.onPrimary} size={18} /> : null}
      </View>
      <View style={styles.flex}>
        <Text variant="bodyStrong">{label}</Text>
        {description ? (
          <Text variant="caption" color="muted">
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export interface SwitchRowProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function SwitchRow({ label, description, value, onChange, disabled = false }: SwitchRowProps): ReactNode {
  const p = useTheme();
  return (
    <View style={styles.checkRow}>
      <View style={styles.flex}>
        <Text variant="bodyStrong">{label}</Text>
        {description ? (
          <Text variant="caption" color="muted">
            {description}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityRole="switch"
        trackColor={{ false: p.borderStrong, true: p.primary }}
        thumbColor={p.surface}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: MIN_TOUCH,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    justifyContent: 'center',
  },
  chipText: { flexShrink: 1 },
  checkRow: { minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.md },
  box: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  errorRow: { flexDirection: 'row', gap: space.xs, alignItems: 'flex-start' },
});
