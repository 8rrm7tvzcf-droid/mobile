// Campo di testo con etichetta, aiuto ed errore (con icona: l'errore non e' mai solo colore).
// `kind` sceglie la tastiera giusta: km e interi -> numerica; importi con virgola decimale -> decimale.
import type { ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { MIN_TOUCH, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { it } from '../i18n/it';
import { Icon } from './Icon';
import { Text } from './Text';

export type FieldKind = 'text' | 'km' | 'integer' | 'money' | 'date' | 'plate' | 'year';

export interface TextFieldProps
  extends Pick<TextInputProps, 'value' | 'onChangeText' | 'placeholder' | 'multiline' | 'maxLength' | 'returnKeyType' | 'onSubmitEditing' | 'autoFocus' | 'selectTextOnFocus'> {
  label: string;
  kind?: FieldKind;
  hint?: string | null;
  error?: string | null;
  /** Mostra "(facoltativo)" accanto all'etichetta. */
  optional?: boolean;
  required?: boolean;
  suffix?: string;
  testID?: string;
}

export function keyboardPropsFor(kind: FieldKind): Partial<TextInputProps> {
  switch (kind) {
    case 'km':
    case 'integer':
    case 'year':
      return { keyboardType: 'number-pad', inputMode: 'numeric', autoCorrect: false };
    case 'money':
      return { keyboardType: 'decimal-pad', inputMode: 'decimal', autoCorrect: false };
    case 'date':
      return { keyboardType: 'numbers-and-punctuation', autoCorrect: false };
    case 'plate':
      return { autoCapitalize: 'characters', autoCorrect: false };
    default:
      return { autoCapitalize: 'sentences' };
  }
}

export function TextField({
  label,
  kind = 'text',
  hint,
  error,
  optional = false,
  required = false,
  suffix,
  multiline,
  placeholder,
  testID,
  ...input
}: TextFieldProps): ReactNode {
  const p = useTheme();
  const a11yLabel = `${label}${required ? `, ${it.a11y.required}` : optional ? `, ${it.common.optional}` : ''}${error ? `. ${it.a11y.errorPrefix}: ${error}` : ''}`;
  return (
    <View style={styles.wrap}>
      <Text variant="label">
        {label}
        {optional ? <Text variant="caption" color="muted">{`  (${it.common.optional})`}</Text> : null}
      </Text>
      <View
        style={[
          styles.inputBox,
          { backgroundColor: p.surface, borderColor: error ? p.danger : p.borderStrong, borderWidth: error ? 2 : 1 },
          multiline ? styles.multiline : null,
        ]}
      >
        <TextInput
          {...input}
          {...keyboardPropsFor(kind)}
          testID={testID}
          multiline={multiline}
          placeholder={placeholder ?? (kind === 'date' ? it.common.dateHint : undefined)}
          placeholderTextColor={p.textMuted}
          accessibilityLabel={a11yLabel}
          accessibilityHint={hint ?? undefined}
          style={[styles.input, { color: p.text }, multiline ? styles.inputMultiline : null]}
        />
        {suffix ? (
          <Text variant="body" color="muted">
            {suffix}
          </Text>
        ) : null}
      </View>
      {error ? (
        <View style={styles.errorRow} accessibilityLiveRegion="polite">
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

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  inputBox: {
    minHeight: MIN_TOUCH,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  multiline: { alignItems: 'flex-start', paddingVertical: space.sm },
  input: { flex: 1, fontSize: 16, minHeight: MIN_TOUCH - 2, paddingVertical: space.sm },
  inputMultiline: { minHeight: 88, textAlignVertical: 'top' },
  errorRow: { flexDirection: 'row', gap: space.xs, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
