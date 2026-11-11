// Mostra caricamento, errore (con "Riprova") o il contenuto: mai una schermata bianca.
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { QueryState } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Button } from './Button';
import { Text } from './Text';

export interface QueryBoundaryProps<T> {
  query: QueryState<T>;
  children: (data: T) => ReactNode;
}

export function QueryBoundary<T>({ query, children }: QueryBoundaryProps<T>): ReactNode {
  const p = useTheme();
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.error) {
    return (
      <View style={styles.center}>
        <Text variant="heading">{it.common.errorTitle}</Text>
        <Text variant="body" color="muted" style={styles.text}>
          {query.error}
        </Text>
        <Button label={it.common.retry} onPress={query.reload} variant="secondary" />
      </View>
    );
  }
  return (
    <View style={styles.center} accessibilityLabel={it.common.loading} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={p.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: space.md, paddingVertical: space.xxl },
  text: { textAlign: 'center' },
});
