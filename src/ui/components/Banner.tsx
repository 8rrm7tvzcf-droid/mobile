// Avviso in cima alla pagina: icona + titolo + testo + un'azione. Tono "warning" o "info".
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface BannerProps {
  tone: 'warning' | 'info' | 'ok' | 'danger';
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: IconName;
}

const DEFAULT_ICON: Record<BannerProps['tone'], IconName> = { warning: 'alert', info: 'info', ok: 'check', danger: 'alert' };

export function Banner({ tone, title, message, actionLabel, onAction, icon }: BannerProps): ReactNode {
  const p = useTheme();
  const colors = p.tone[tone];
  return (
    <View style={[styles.box, { backgroundColor: colors.bg, borderColor: colors.fg }]} accessibilityRole="alert">
      <View style={styles.head}>
        <Icon name={icon ?? DEFAULT_ICON[tone]} color={colors.fg} size={22} />
        <View style={styles.flex}>
          <Text variant="bodyStrong" color={tone}>
            {title}
          </Text>
          {message ? (
            <Text variant="body" color={tone}>
              {message}
            </Text>
          ) : null}
        </View>
      </View>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant="ghost" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.md },
  head: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  flex: { flex: 1, gap: space.xs },
});
