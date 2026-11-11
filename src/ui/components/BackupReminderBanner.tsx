// Promemoria del backup nell'Oggi (SPEC 6.3.4, F-06): dati presenti, qualche modifica e tanti giorni senza backup.
// Due scelte chiare: «Fai il backup» (apre la schermata) e «Più tardi» (nasconde il promemoria fino alla prossima apertura).
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { it } from '../i18n/it';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

export interface BackupReminderBannerProps {
  message: string;
  onBackup: () => void;
  onLater: () => void;
}

export function BackupReminderBanner({ message, onBackup, onLater }: BackupReminderBannerProps): ReactNode {
  const p = useTheme();
  const colors = p.tone.warning;
  return (
    <View style={[styles.box, { backgroundColor: colors.bg, borderColor: colors.fg }]} accessibilityRole="alert" testID="backup-reminder">
      <View style={styles.head}>
        <Icon name="alert" color={colors.fg} size={22} />
        <View style={styles.flex}>
          <Text variant="bodyStrong" color="warning">
            {it.backup.reminderTitle}
          </Text>
          <Text variant="body" color="warning">
            {message}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <View style={styles.flex}>
          <Button label={it.backup.reminderAction} icon="download" onPress={onBackup} testID="backup-reminder-now" />
        </View>
        <View style={styles.flex}>
          <Button label={it.backup.reminderLater} variant="ghost" onPress={onLater} testID="backup-reminder-later" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.md },
  head: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  flex: { flex: 1, gap: space.xs },
  actions: { flexDirection: 'row', gap: space.sm },
});
