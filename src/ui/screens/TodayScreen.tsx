// S-10 Oggi: banner, prossima scadenza, semafori per categoria, "Da fare", azione rapida "+".
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useApp } from '@/bootstrap';
import type { ReminderCategory } from '@/domain/reminders';
import { createDemoVehicle } from '@/usecases/demo';
import { getBackupStatus } from '@/usecases/backup';
import { getDashboard, type Dashboard, type DashboardBanner } from '@/usecases/queries';
import {
  BackupReminderBanner,
  Banner,
  Button,
  Card,
  ChoiceGroup,
  DeadlineRowItem,
  EmptyState,
  Icon,
  QueryBoundary,
  QuickAddSheet,
  Screen,
  SectionTitle,
  StatusBadge,
  Text,
  UndoBanner,
  type QuickAction,
} from '../components';
import { snoozeBackupReminder, useBackupReminderSnoozed } from '../hooks/backupReminder';
import { enableNotifications } from '../hooks/notifications';
import { setUpDemoDeadlines } from '../hooks/demoSetup';
import { markOnboardingDone } from '../hooks/onboarding';
import { useBusy } from '../hooks/useBusy';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { reminderMessage } from '../logic/backupView';
import { categoryA11yLabel, categoryLine, countsSummary, deadlineHref, filterByCategory } from '../logic/status';
import { routes } from '../navigation/routes';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

type Quick = { open: boolean; startWith: QuickAction | null };
const QUICK_CLOSED: Quick = { open: false, startWith: null };

export function TodayScreen(): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const p = useTheme();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [category, setCategory] = useState<ReminderCategory | null>(null);
  const [quick, setQuick] = useState<Quick>(QUICK_CLOSED);
  const demo = useBusy();
  const query = useQuery((d) => getDashboard(d, { vehicleId }), [vehicleId], it.common.loadError);
  const backup = useQuery((d) => getBackupStatus(d), [], it.common.loadError);
  const backupSnoozed = useBackupReminderSnoozed();

  const onBanner = async (b: DashboardBanner): Promise<void> => {
    switch (b.action.id) {
      case 'enable-notifications':
      case 'retry-notifications':
        await enableNotifications(deps);
        query.reload();
        break;
      case 'open-system-settings':
        await Linking.openSettings().catch(() => undefined);
        break;
      case 'update-odometer':
        if (b.vehicleId) router.push(routes.vehicleKm(b.vehicleId));
        break;
      default:
        router.push(routes.settings);
    }
  };

  const startDemo = (): void => {
    void demo.run(async () => {
      const res = await createDemoVehicle(deps);
      if (res.ok) {
        await markOnboardingDone(deps);
        const applied = await setUpDemoDeadlines(deps, res.value.vehicleId).catch(() => false);
        if (!applied) router.push(routes.setup(res.value.vehicleId));
      }
    });
  };

  const renderBody = (dash: Dashboard): ReactNode => {
    const showVehicle = dash.vehicles.length > 1 && vehicleId === null;
    const todo = filterByCategory(dash.todo, category);
    const categories = dash.categories.filter((c) => c.counts.total > 0);
    const target = dash.vehicles.length === 1 ? dash.vehicles[0] : dash.vehicles.find((v) => v.id === vehicleId);

    return (
      <>
        {dash.showVehicleSelector ? (
          <ChoiceGroup
            label={it.today.vehicleSelector}
            value={vehicleId ?? 'all'}
            onChange={(v) => {
              setVehicleId(v === 'all' ? null : v);
              setCategory(null);
            }}
            options={[{ value: 'all', label: it.today.allVehicles }, ...dash.vehicles.map((v) => ({ value: v.id, label: v.label }))]}
          />
        ) : null}

        <UndoBanner />

        {/* Il promemoria del backup e' il riquadro con due scelte qui sotto, al posto del banner generico. */}
        {backup.data?.needsReminder && !backupSnoozed ? (
          <BackupReminderBanner message={reminderMessage(backup.data)} onBackup={() => router.push(routes.backup)} onLater={snoozeBackupReminder} />
        ) : null}
        {dash.banners.filter((b) => b.kind !== 'backup').map((b) => (
          <Banner key={b.kind} tone={b.tone} title={b.title} message={b.message} actionLabel={b.action.label} onAction={() => void onBanner(b)} />
        ))}

        {dash.emptyState === 'no-vehicles' ? (
          <EmptyState
            icon="car"
            title={it.today.emptyNoVehiclesTitle}
            message={it.today.emptyNoVehiclesText}
            actions={[
              { label: it.welcome.addCar, onPress: () => router.push(routes.newVehicle) },
              { label: demo.busy ? it.welcome.demoBusy : it.welcome.tryDemo, onPress: startDemo, variant: 'secondary' },
            ]}
          />
        ) : null}

        {dash.emptyState === 'no-deadlines' ? (
          <EmptyState
            icon="calendar"
            title={it.today.emptyNoDeadlinesTitle}
            message={it.today.emptyNoDeadlinesText}
            actions={
              [
                {
                  label: it.today.setupDeadlines,
                  onPress: () => (target ? router.push(routes.setup(target.id)) : setQuick({ open: true, startWith: 'setup' })),
                },
              ]
            }
          />
        ) : null}

        {dash.next ? (
          <>
            <SectionTitle>{it.today.nextTitle}</SectionTitle>
            <Card>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${dash.next.title}. ${dash.next.label}. ${dash.next.text}`}
                onPress={() => router.push(dash.next ? deadlineHref(dash.next) : routes.deadline(''))}
                style={styles.nextBody}
              >
                <View style={styles.flex}>
                  <Text variant="heading">{dash.next.title}</Text>
                  {showVehicle || dash.vehicles.length > 1 ? (
                    <Text variant="caption" color="muted">
                      {dash.next.vehicleLabel}
                    </Text>
                  ) : null}
                  <StatusBadge tone={dash.next.tone} icon={dash.next.icon} label={dash.next.label} />
                  <Text variant="body" color="muted">
                    {dash.next.text}
                  </Text>
                </View>
                <Icon name="chevron-right" color={p.textMuted} size={20} />
              </Pressable>
              <View style={styles.actions}>
                <View style={styles.flex}>
                  <Button label={it.today.done} icon="check" onPress={() => router.push(routes.deadline(dash.next?.id ?? '', 'fatto'))} />
                </View>
                {dash.next.reminderId ? (
                  <View style={styles.flex}>
                    <Button label={it.today.snooze} icon="clock" variant="secondary" onPress={() => router.push(routes.deadline(dash.next?.id ?? '', 'rimanda'))} />
                  </View>
                ) : null}
              </View>
            </Card>
          </>
        ) : null}

        {categories.length > 0 ? (
          <>
            <SectionTitle>{it.today.categoriesTitle}</SectionTitle>
            <View style={styles.grid}>
              {categories.map((c) => {
                const selected = category === c.category;
                return (
                  <Pressable
                    key={c.category}
                    accessibilityRole="button"
                    accessibilityLabel={categoryA11yLabel(c, selected)}
                    accessibilityHint={selected ? it.today.categoryFilterActive : it.today.categoryFilterHint}
                    accessibilityState={{ selected }}
                    onPress={() => setCategory(selected ? null : c.category)}
                    style={({ pressed }) => [
                      styles.tile,
                      {
                        backgroundColor: p.surface,
                        borderColor: selected ? p.primary : p.border,
                        borderWidth: selected ? 2 : 1,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <Text variant="bodyStrong">{c.label}</Text>
                    <StatusBadge tone={c.tone} icon={c.icon} label={categoryLine(c)} />
                    <Text variant="caption" color="muted">
                      {countsSummary(c.counts)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {dash.hasVehicles && dash.emptyState !== 'no-deadlines' ? (
          <>
            <SectionTitle>{it.today.todoTitle}</SectionTitle>
            {category !== null ? <Button label={it.today.clearFilter} variant="ghost" icon="x" onPress={() => setCategory(null)} /> : null}
            {todo.length === 0 ? (
              <Text variant="body" color="muted">
                {category === null ? it.today.todoEmpty : it.today.todoEmptyFiltered}
              </Text>
            ) : (
              todo.map((row) => <DeadlineRowItem key={row.id} row={row} showVehicle={showVehicle} onPress={() => router.push(deadlineHref(row))} />)
            )}
          </>
        ) : null}

        <View style={styles.fabSpace} />
      </>
    );
  };

  return (
    <View style={styles.flex}>
      <Screen padBottom={false} onRefresh={query.reload} refreshing={false}>
        <QueryBoundary query={query}>{renderBody}</QueryBoundary>
      </Screen>

      {query.data?.hasVehicles ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={it.a11y.quickAdd}
          accessibilityHint={it.a11y.quickAddHint}
          onPress={() => setQuick({ open: true, startWith: null })}
          style={({ pressed }) => [styles.fab, { backgroundColor: p.primary, opacity: pressed ? 0.85 : 1 }]}
        >
          <Icon name="plus" color={p.onPrimary} size={28} />
        </Pressable>
      ) : null}

      <QuickAddSheet
        visible={quick.open}
        startWith={quick.startWith}
        onClose={() => setQuick(QUICK_CLOSED)}
        vehicles={query.data?.vehicles ?? []}
        vehicleId={vehicleId}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  nextBody: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: { flexGrow: 1, flexBasis: '45%', minHeight: 96, borderRadius: radius.lg, padding: space.md, gap: space.xs },
  fab: {
    position: 'absolute',
    right: space.lg,
    bottom: space.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    boxShadow: '0px 2px 6px rgba(0, 0, 0, 0.25)',
  },
  fabSpace: { height: 72 },
});
