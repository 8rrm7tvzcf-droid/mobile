// Spese (S-23, F-41): elenco per periodo e categoria con il totale; tocco su una riga = modifica.
import { useRouter } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useApp } from '@/bootstrap';
import { formatEuro } from '@/domain/units';
import { listExpenses } from '@/usecases/expenses';
import { getVehicle } from '@/usecases/vehicles';
import { Button, Card, ChoiceGroup, EmptyState, ListRow, QueryBoundary, Screen, SectionTitle, Text, UndoBanner } from '../components';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { expenseRowA11y, expenseRowSubtitle, expenseRowTitle } from '../logic/expenseForm';
import { LIST_PERIODS, periodOptions, periodRange, type PeriodPreset } from '../logic/period';
import { routes } from '../navigation/routes';

const ALL = 'all';

export function ExpenseListScreen({ vehicleId }: { vehicleId: string }): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const today = deps.clock.todayLocal();
  const [preset, setPreset] = useState<PeriodPreset>('all');
  const [category, setCategory] = useState<string>(ALL);
  const query = useQuery(
    async (d) => {
      if (!(await getVehicle(d, vehicleId))) return null;
      return listExpenses(d, vehicleId, periodRange(preset, today));
    },
    [vehicleId, preset],
    it.common.loadError,
  );

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of query.data ?? []) seen.set(e.categoryId, e.categoryName);
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [query.data]);

  const add = (): void => router.push(routes.expenseNew(vehicleId));

  return (
    <Screen onRefresh={query.reload} refreshing={false} footer={<Button label={it.expense.add} icon="plus" testID="expense-add" onPress={add} />}>
      <UndoBanner vehicleId={vehicleId} />
      <QueryBoundary query={query}>
        {(all) => {
          if (all === null) return <EmptyState icon="car" title={it.common.notFoundTitle} message={it.vehicle.notFound} />;
          if (all.length === 0 && preset === 'all') {
            return <EmptyState icon="receipt" title={it.expense.emptyTitle} message={it.expense.emptyText} actions={[{ label: it.expense.add, onPress: add }]} />;
          }
          const activeCategory = categories.some((c) => c.value === category) ? category : ALL;
          const list = activeCategory === ALL ? all : all.filter((e) => e.categoryId === activeCategory);
          const total = list.reduce((sum, e) => sum + e.amountCents, 0);
          return (
            <>
              <ChoiceGroup label={it.expense.periodLabel} options={periodOptions(LIST_PERIODS)} value={preset} onChange={setPreset} />
              {categories.length > 1 ? (
                <ChoiceGroup
                  label={it.expense.categoryFilter}
                  options={[{ value: ALL, label: it.expense.allCategories }, ...categories]}
                  value={activeCategory}
                  onChange={setCategory}
                />
              ) : null}
              <Card>
                <Text variant="title">{formatEuro(total)}</Text>
                <Text variant="caption" color="muted">
                  {it.expense.total(formatEuro(total), list.length)}
                </Text>
              </Card>
              <SectionTitle>{it.expense.listTitle}</SectionTitle>
              {list.length === 0 ? (
                <Text variant="body" color="muted">
                  {it.expense.emptyFilteredText}
                </Text>
              ) : (
                list.map((e) => (
                  <ListRow
                    key={e.id}
                    icon="receipt"
                    title={expenseRowTitle(e)}
                    subtitle={expenseRowSubtitle(e)}
                    accessibilityLabel={expenseRowA11y(e)}
                    onPress={() => router.push(routes.expenseEdit(vehicleId, e.id))}
                  />
                ))
              )}
            </>
          );
        }}
      </QueryBoundary>
    </Screen>
  );
}
