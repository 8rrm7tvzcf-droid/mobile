// S-70/S-71/S-74 Impostazioni minime: notifiche e verifica, auto di esempio, informazioni, privacy.
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useApp } from '@/bootstrap';
import { formatDateIt } from '@/domain/units';
import { listTrashedAttachments } from '@/usecases/attachments';
import { getBackupStatus } from '@/usecases/backup';
import { hasDemoVehicle, removeDemoVehicle } from '@/usecases/demo';
import { verifyNotifications, type VerifyReport } from '@/usecases/notifications';
import { getSetting, setSetting } from '@/usecases/settings';
import { listTrashedVehicles } from '@/usecases/vehicles';
import { Banner, Button, Card, ConfirmSheet, ListRow, QueryBoundary, Screen, SectionTitle, SwitchRow, Text } from '../components';
import { enableNotifications } from '../hooks/notifications';
import { useBusy } from '../hooks/useBusy';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { backupRowSubtitle } from '../logic/backupView';
import { describeThrown } from '../logic/errors';
import { routes } from '../navigation/routes';
import { space } from '../theme/tokens';

export function SettingsScreen(): ReactNode {
  const { deps } = useApp();
  const router = useRouter();
  const query = useQuery(
    async (d) => ({
      enabled: await getSetting(d, 'notify.enabled'),
      permission: await d.scheduler.getPermission(),
      hasDemo: await hasDemoVehicle(d),
      backup: await getBackupStatus(d),
      trashCount: (await listTrashedVehicles(d)).length + (await listTrashedAttachments(d)).length,
    }),
    [],
    it.common.loadError,
  );
  const verify = useBusy();
  const toggle = useBusy();
  const remove = useBusy();
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const onToggle = (value: boolean): void => {
    void toggle.run(async () => {
      try {
        if (value) {
          const state = await enableNotifications(deps);
          if (state !== 'granted') await setSetting(deps, 'notify.enabled', true);
        } else {
          await setSetting(deps, 'notify.enabled', false);
        }
      } catch (e) {
        setMessage(describeThrown(e));
      }
      query.reload();
    });
  };

  const onVerify = (): void => {
    void verify.run(async () => {
      try {
        setMessage(null);
        setReport(await verifyNotifications(deps));
        query.reload();
      } catch (e) {
        setMessage(describeThrown(e));
      }
    });
  };

  const onRemoveDemo = (): void => {
    void remove.run(async () => {
      const res = await removeDemoVehicle(deps);
      setConfirmDemo(false);
      setMessage(res.ok ? it.settings.demoRemoved : describeThrown(res.error));
      query.reload();
    });
  };

  return (
    <Screen padBottom={false} onRefresh={query.reload} refreshing={false}>
      <QueryBoundary query={query}>
        {(data) => (
          <>
            {message ? <Banner tone="info" title={message} /> : null}

            <SectionTitle>{it.settings.notificationsTitle}</SectionTitle>
            <Card>
              <SwitchRow
                label={it.settings.notificationsSwitch}
                description={it.settings.notificationsSwitchHint}
                value={data.enabled}
                onChange={onToggle}
                disabled={toggle.busy}
              />
              <Text variant="body" color="muted">
                {`${it.settings.permissionLabel}: ${it.settings.permission[data.permission]}`}
              </Text>
              {data.permission === 'blocked' ? (
                <Button label={it.settings.openSystemSettings} variant="secondary" onPress={() => void Linking.openSettings().catch(() => undefined)} />
              ) : null}
              {data.permission === 'denied' || data.permission === 'undetermined' ? (
                <Button label={it.settings.askPermission} variant="secondary" onPress={() => void enableNotifications(deps).then(query.reload)} />
              ) : null}
              <Button label={verify.busy ? it.settings.verifyBusy : it.settings.verify} icon="bell" loading={verify.busy} onPress={onVerify} accessibilityHint={it.settings.verifyHint} />
              <Text variant="caption" color="muted">
                {it.settings.verifyHint}
              </Text>
            </Card>

            {report ? <VerifyCard report={report} onOpenSettings={() => void Linking.openSettings().catch(() => undefined)} /> : null}

            <SectionTitle>{it.obd.entry.settingsTitle}</SectionTitle>
            <Card testID="settings-obd">
              <Text variant="body" color="muted">
                {it.obd.entry.settingsText}
              </Text>
              <Button label={it.obd.entry.settingsAction} icon="bluetooth" variant="secondary" onPress={() => router.push(routes.obdAdapter())} />
            </Card>

            <SectionTitle>{it.settings.backupSection}</SectionTitle>
            <ListRow
              testID="settings-backup"
              icon="folder"
              title={it.backup.title}
              subtitle={backupRowSubtitle(data.backup, deps.clock.todayLocal())}
              accessibilityHint={it.settings.backupRowHint}
              onPress={() => router.push(routes.backup)}
            />
            <ListRow
              testID="settings-trash"
              icon="trash"
              title={it.trash.rowTitle}
              subtitle={data.trashCount > 0 ? it.trash.rowCount(data.trashCount) : it.trash.rowEmpty}
              onPress={() => router.push(routes.trash)}
            />

            <SectionTitle>{it.settings.dataTitle}</SectionTitle>
            <Card>
              <Text variant="body" color="muted">
                {data.hasDemo ? it.settings.demoRemoveHint : it.settings.noDemo}
              </Text>
              {data.hasDemo ? <Button label={it.settings.demoRemove} variant="danger" icon="trash" onPress={() => setConfirmDemo(true)} /> : null}
            </Card>

            <SectionTitle>{it.settings.privacyTitle}</SectionTitle>
            <Card>
              <Text variant="body">{it.settings.privacyText}</Text>
            </Card>

            <SectionTitle>{it.settings.legalTitle}</SectionTitle>
            <Card>
              <Text variant="body">{it.settings.legalText}</Text>
            </Card>

            <SectionTitle>{it.settings.aboutTitle}</SectionTitle>
            <Card>
              <Text variant="bodyStrong">{it.appName}</Text>
              <Text variant="body" color="muted">
                {it.settings.version(version)}
              </Text>
            </Card>
            <View style={styles.end} />

            <ConfirmSheet
              visible={confirmDemo}
              title={it.vehicle.removeDemoTitle}
              message={it.vehicle.removeDemoText}
              confirmLabel={it.settings.demoRemove}
              destructive
              busy={remove.busy}
              onConfirm={onRemoveDemo}
              onCancel={() => setConfirmDemo(false)}
            />
          </>
        )}
      </QueryBoundary>
    </Screen>
  );
}

function VerifyCard({ report, onOpenSettings }: { report: VerifyReport; onOpenSettings: () => void }): ReactNode {
  const allGood = report.guide === null && report.testScheduled && report.missing === 0;
  return (
    <Card tone={allGood ? 'ok' : 'warning'}>
      <Text variant="heading" color={allGood ? 'ok' : 'warning'}>
        {it.settings.verifyTitle}
      </Text>
      {report.guide ? (
        <Text variant="body" color="warning">
          {report.guide}
        </Text>
      ) : null}
      <Text variant="body" color={allGood ? 'ok' : 'warning'}>
        {report.testScheduled && report.testInSeconds !== null ? it.settings.verifyTestSent(report.testInSeconds) : it.settings.verifyTestNotSent}
      </Text>
      <Text variant="body" color={allGood ? 'ok' : 'warning'}>
        {it.settings.verifyCounts(report.present, report.expected)}
      </Text>
      {report.missing > 0 ? (
        <Text variant="body" color="warning">
          {it.settings.verifyMissing(report.missing)}
        </Text>
      ) : null}
      <Text variant="body" color={allGood ? 'ok' : 'warning'}>
        {report.next ? it.settings.verifyNext(report.next.title, formatDateIt(report.next.date), report.next.time) : it.settings.verifyNoNext}
      </Text>
      {allGood ? <Text variant="bodyStrong" color="ok">{it.settings.verifyOk}</Text> : null}
      {report.nextAction === 'open-system-settings' ? <Button label={it.settings.openSystemSettings} variant="secondary" onPress={onOpenSettings} /> : null}
      <Text variant="caption" color="muted">
        {it.settings.batteryTip}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  end: { height: space.xl },
});
