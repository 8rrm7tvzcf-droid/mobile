// Contenitore di schermata: sfondo del tema, scorrimento, margini (16 dp), zona sicura in basso, tastiera e piede fisso.
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_CONTENT_WIDTH, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Text } from './Text';

export interface ScreenProps {
  children: ReactNode;
  /** Barra fissa in basso (azione principale). */
  footer?: ReactNode;
  /** Nelle schede la barra in basso gestisce gia' la zona sicura. */
  padBottom?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}

export function Screen({ children, footer, padBottom = true, refreshing, onRefresh }: ScreenProps): ReactNode {
  const p = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = padBottom ? insets.bottom : 0;
  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: p.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: space.xl + (footer ? 0 : bottom) }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} /> : undefined}
      >
        {children}
      </ScrollView>
      {footer ? (
        <View style={[styles.footer, { backgroundColor: p.surface, borderTopColor: p.border, paddingBottom: space.md + bottom }]}>
          <View style={styles.footerInner}>{footer}</View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** Intestazione di sezione (con ruolo "header" per saltare tra le sezioni). */
export function SectionTitle({ children }: { children: string }): ReactNode {
  return (
    <Text variant="heading" accessibilityRole="header" style={styles.section}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: {
    padding: space.lg,
    gap: space.lg,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
  footer: { borderTopWidth: 1, paddingTop: space.md, paddingHorizontal: space.lg },
  footerInner: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', gap: space.sm },
  section: { marginTop: space.sm },
});
