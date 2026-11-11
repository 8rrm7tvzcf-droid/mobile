// Grafico a barre mensile semplice, disegnato con View: funziona uguale su Android, iOS e web.
// Il grafico e' solo un aiuto visivo e si nasconde ai lettori di schermo: la stessa informazione sta nel riepilogo
// scritto e nella tabella che lo accompagnano (SPEC 6.3.8: grafico con alternativa tabellare).
import type { ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { formatEuroWhole } from '@/domain/units';
import type { ChartBar } from '../logic/costsView';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Text } from './Text';

const PLOT_HEIGHT = 140;
const SLOT_MIN_WIDTH = 44;

const HIDDEN = Platform.select({
  web: { 'aria-hidden': true } as Record<string, unknown>,
  default: { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as Record<string, unknown>,
});

export interface BarChartProps {
  bars: readonly ChartBar[];
  /** Il valore della barra piu' alta, scritto in cima a sinistra come riferimento della scala. */
  maxCents: number;
  testID?: string;
}

export function BarChart({ bars, maxCents, testID }: BarChartProps): ReactNode {
  const p = useTheme();
  return (
    <View testID={testID} style={styles.wrap} {...HIDDEN}>
      <Text variant="caption" color="muted">
        {`0 – ${formatEuroWhole(maxCents)}`}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={bars.length > 8} contentContainerStyle={styles.scroll}>
        <View style={[styles.plot, { borderBottomColor: p.borderStrong }]}>
          {bars.map((b) => (
            <View key={b.month} style={styles.slot}>
              <View style={styles.barArea}>
                <View
                  style={[
                    styles.bar,
                    { height: Math.max(3, Math.round(b.ratio * PLOT_HEIGHT)), backgroundColor: b.cents > 0 ? p.primary : p.border },
                  ]}
                />
              </View>
              <Text variant="caption" color="muted" style={styles.label} numberOfLines={1}>
                {b.shortLabel}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  scroll: { minWidth: '100%' },
  plot: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1 },
  slot: { flex: 1, minWidth: SLOT_MIN_WIDTH, alignItems: 'center', gap: space.xs },
  barArea: { height: PLOT_HEIGHT, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '62%', maxWidth: 36, borderTopLeftRadius: radius.sm / 2, borderTopRightRadius: radius.sm / 2 },
  label: { textAlign: 'center' },
});
