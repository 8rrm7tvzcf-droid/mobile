// S-60 Costi: totale del periodo senza doppioni, costo al km (o il motivo per cui non si calcola), ripartizione per fonte e
// per categoria, grafico mensile con riepilogo scritto e tabella equivalente.
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '@/bootstrap';
import { formatEuro, formatMonthYearIt } from '@/domain/units';
import { getCostSeries, getCostSummary, type CostSeries, type CostSummary } from '@/usecases/costs';
import { getVehicle } from '@/usecases/vehicles';
import { Banner, BarChart, Button, Card, ChoiceGroup, EmptyState, QueryBoundary, Screen, SectionTitle, Text } from '../components';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { categoryRows, chartBars, chartSummary, perKmView, shareRowA11y, sourceRows, type ShareRow } from '../logic/costsView';
import { COST_PERIODS, periodOptions, periodRange, type PeriodPreset } from '../logic/period';
import { routes } from '../navigation/routes';
import { space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

function ShareList({ rows }: { rows: ShareRow[] }): ReactNode {
  const p = useTheme();
  return (
    <Card>
      {rows.map((r, i) => (
        <View
          key={r.key}
          style={[styles.shareRow, i > 0 ? { borderTopColor: p.border, borderTopWidth: 1 } : null]}
          accessible
          accessibilityLabel={shareRowA11y(r)}
        >
          <View style={styles.flex}>
            <Text variant="bodyStrong">{r.label}</Text>
            <Text variant="caption" color="muted">
              {`${r.share} · ${r.count}`}
            </Text>
          </View>
          <Text variant="bodyStrong">{r.amount}</Text>
        </View>
      ))}
    </Card>
  );
}

function MonthTable({ series }: { series: CostSeries }): ReactNode {
  const p = useTheme();
  return (
    <View accessibilityRole="list">
      <Text variant="label" color="muted" style={styles.tableTitle}>
        {it.costs.tableTitle}
      </Text>
      {series.points.map((m, i) => (
        <View
          key={m.month}
          style={[styles.monthRow, i > 0 ? { borderTopColor: p.border, borderTopWidth: 1 } : null]}
          accessible
          accessibilityLabel={`${formatMonthYearIt(m.month)}: ${formatEuro(m.cents)}`}
        >
          <Text variant="body" style={styles.flex}>
            {formatMonthYearIt(m.month)}
          </Text>
          <Text variant="bodyStrong">{formatEuro(m.cents)}</Text>
        </View>
      ))}
    </View>
  );
}

export function CostsScreen({ vehicleId }: { vehicleId: string }): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const today = deps.clock.todayLocal();
  const [preset, setPreset] = useState<PeriodPreset>('year');
  const query = useQuery(
    async (d) => {
      if (!(await getVehicle(d, vehicleId))) return null;
      const range = periodRange(preset, today);
      // Il grafico segue il periodo (senza mesi futuri vuoti); con "questo mese" mostra gli ultimi 12 mesi.
      const chartPeriod = preset === 'month' ? undefined : { from: range.from, to: range.to && range.to < today ? range.to : today };
      const [summary, series] = await Promise.all([getCostSummary(d, vehicleId, range), getCostSeries(d, vehicleId, chartPeriod)]);
      return summary && series ? { summary, series } : null;
    },
    [vehicleId, preset],
    it.common.loadError,
  );

  return (
    <Screen onRefresh={query.reload} refreshing={false}>
      <QueryBoundary query={query}>
        {(data) => {
          if (data === null) return <EmptyState icon="car" title={it.common.notFoundTitle} message={it.vehicle.notFound} />;
          const { summary, series } = data as { summary: CostSummary; series: CostSeries };
          const perKm = perKmView(summary.costPerKm);
          const bars = chartBars(series);
          return (
            <>
              <ChoiceGroup label={it.costs.periodLabel} options={periodOptions(COST_PERIODS)} value={preset} onChange={setPreset} />

              <Card testID="costs-total">
                <Text variant="label" color="muted">
                  {it.costs.totalTitle}
                </Text>
                <Text variant="largeTitle">{formatEuro(summary.totalCents)}</Text>
                <Text variant="caption" color="muted">
                  {it.costs.totalCount(summary.count)}
                </Text>
              </Card>

              {summary.count === 0 ? (
                <EmptyState
                  icon="euro"
                  title={it.costs.emptyTitle}
                  message={it.costs.emptyText}
                  actions={[
                    { label: it.costs.addFuel, onPress: () => router.push(routes.fuelNew(vehicleId)) },
                    { label: it.costs.addExpense, onPress: () => router.push(routes.expenseNew(vehicleId)), variant: 'secondary' },
                  ]}
                />
              ) : null}

              <SectionTitle>{it.costs.perKmTitle}</SectionTitle>
              <Card testID="costs-per-km">
                {perKm.ok ? <Text variant="title">{perKm.headline}</Text> : <Text variant="body">{perKm.headline}</Text>}
                <Text variant="caption" color="muted">
                  {perKm.detail}
                </Text>
                {perKm.needsKm ? (
                  <Button label={it.costs.updateKm} icon="gauge" variant="secondary" onPress={() => router.push(routes.vehicleKm(vehicleId))} />
                ) : null}
              </Card>

              {summary.possibleDuplicates.length > 0 ? (
                <Banner tone="info" title={it.costs.duplicatesTitle} message={it.costs.duplicatesText(summary.possibleDuplicates.length)} />
              ) : null}

              {summary.count > 0 ? (
                <>
                  <SectionTitle>{it.costs.bySourceTitle}</SectionTitle>
                  <ShareList rows={sourceRows(summary)} />
                  <SectionTitle>{it.costs.byCategoryTitle}</SectionTitle>
                  <ShareList rows={categoryRows(summary)} />
                </>
              ) : null}

              <SectionTitle>{it.costs.byMonthTitle}</SectionTitle>
              <Card testID="costs-chart">
                <Text variant="body">{chartSummary(series)}</Text>
                <Text variant="caption" color="muted">
                  {it.costs.chartRange(formatMonthYearIt(series.fromMonth), formatMonthYearIt(series.toMonth))}
                </Text>
                {series.totalCents > 0 ? <BarChart bars={bars} maxCents={series.maxCents} /> : null}
                <MonthTable series={series} />
              </Card>
            </>
          );
        }}
      </QueryBoundary>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingVertical: space.sm },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 40, paddingVertical: space.xs },
  tableTitle: { marginTop: space.sm, marginBottom: space.xs },
});
