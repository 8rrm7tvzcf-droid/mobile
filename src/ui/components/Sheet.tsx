// Foglio dal basso per scelte e moduli brevi (conferme, "Fatto", "Rimanda"). Funziona anche sul web, dove Alert non c'e'.
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { it } from '../i18n/it';
import { MAX_CONTENT_WIDTH, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Button } from './Button';
import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  title: string;
  message?: string;
  onClose: () => void;
  children?: ReactNode;
}

export function Sheet({ visible, title, message, onClose, children }: SheetProps): ReactNode {
  const p = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType={Platform.OS === 'web' ? 'none' : 'fade'} onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: p.overlay }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={it.common.close}
        />
        <View
          style={[
            styles.panel,
            { backgroundColor: p.surface, borderColor: p.border, paddingBottom: space.lg + insets.bottom },
          ]}
          accessibilityViewIsModal
        >
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <Text variant="title">{title}</Text>
            {message ? (
              <Text variant="body" color="muted">
                {message}
              </Text>
            ) : null}
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmSheet({ visible, title, message, confirmLabel, destructive = false, busy = false, onConfirm, onCancel }: ConfirmSheetProps): ReactNode {
  return (
    <Sheet visible={visible} title={title} message={message} onClose={onCancel}>
      <Button label={confirmLabel} onPress={onConfirm} variant={destructive ? 'danger' : 'primary'} loading={busy} />
      <Button label={it.common.cancel} onPress={onCancel} variant="ghost" disabled={busy} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  panel: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    maxHeight: '88%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: space.lg,
    paddingHorizontal: space.lg,
  },
  content: { gap: space.md, paddingBottom: space.sm },
});
