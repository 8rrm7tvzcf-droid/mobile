// Testo con le varianti tipografiche del tema. I font scalano con le impostazioni del sistema.
import type { ReactNode } from 'react';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { typography, type Palette, type TextVariant, type ToneKey } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

export type TextColor = 'text' | 'muted' | 'primary' | 'onPrimary' | 'onPrimarySoft' | ToneKey;

export function colorOf(p: Palette, color: TextColor): string {
  switch (color) {
    case 'text':
      return p.text;
    case 'muted':
      return p.textMuted;
    case 'primary':
      return p.primary;
    case 'onPrimary':
      return p.onPrimary;
    case 'onPrimarySoft':
      return p.onPrimarySoft;
    default:
      return p.tone[color].fg;
  }
}

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: TextColor;
}

export function Text({ variant = 'body', color = 'text', style, children, ...rest }: TextProps): ReactNode {
  const palette = useTheme();
  const spec = typography[variant];
  return (
    <RNText
      {...rest}
      accessibilityRole={rest.accessibilityRole ?? (variant === 'title' || variant === 'largeTitle' || variant === 'heading' ? 'header' : undefined)}
      style={[{ color: colorOf(palette, color), fontSize: spec.fontSize, lineHeight: spec.lineHeight, fontWeight: spec.fontWeight }, style]}
    >
      {children}
    </RNText>
  );
}
