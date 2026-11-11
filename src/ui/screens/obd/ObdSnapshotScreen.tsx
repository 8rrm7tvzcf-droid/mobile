// Lettura dell'auto (F-60): VIN, spia motore, codici guasto, condizioni del guasto e valori chiave, ognuno con la provenienza.
// Dopo la lettura la UI NON scrive nulla sul database; l'unica scrittura e' "Salva il VIN", chiesta e confermata dall'utente.
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp, type DtcSection, type ObdFailure, type Snapshot } from '@/bootstrap';
import { updateVehicle, getVehicle } from '@/usecases/vehicles';
import { Banner, Button, Card, ConfirmSheet, Icon, Screen, SectionTitle, Text } from '../../components';
import { useBusy } from '../../hooks/useBusy';
import { useObdService, useObdState } from '../../hooks/useObd';
import { useQuery } from '../../hooks/useQuery';
import { it } from '../../i18n/it';
import { describeError, describeThrown } from '../../logic/errors';
import {
  dtcSectionKind,
  dtcView,
  failureText,
  formatReadAt,
  milKind,
  pidName,
  pidValueText,
  snapshotHasData,
  snapshotHasIssues,
  snapshotLinkLost,
  valueRows,
  vinView,
} from '../../logic/obdView';
import { routes } from '../../navigation/routes';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { formatDistance } from '@/domain/units';
import { ProgressCard, ProvenanceTag, ToneBadge, ValueLine } from './parts';

type Load = { status: 'loading' } | { status: 'ready'; snapshot: Snapshot } | { status: 'error'; failure: ObdFailure };

export function ObdSnapshotScreen({ vehicleId }: { vehicleId: string }): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const service = useObdService();
  const obd = useObdState();
  const vehicle = useQuery((d) => getVehicle(d, vehicleId), [vehicleId], it.common.loadError);
  const [load, setLoad] = useState<Load>(() => {
    const cached = service.getState().phase === 'ready' ? service.lastSnapshot() : null;
    return cached ? { status: 'ready', snapshot: cached } : { status: 'loading' };
  });
  const [confirmVin, setConfirmVin] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saving = useBusy();
  const mounted = useRef(true);
  const s = it.obd.snapshot;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const read = useCallback(async (): Promise<void> => {
    setLoad({ status: 'loading' });
    setMessage(null);
    const r = await service.snapshot();
    if (!mounted.current) return;
    setLoad(r.ok ? { status: 'ready', snapshot: r.value } : { status: 'error', failure: r.error });
  }, [service]);

  useEffect(() => {
    if (load.status === 'loading') void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnect = (): void => {
    void service.close().then(() => {
      if (mounted.current) router.replace(routes.vehicleObd(vehicleId));
    });
  };

  const saveVin = (vin: string): void => {
    void saving.run(async () => {
      try {
        const res = await updateVehicle(deps, vehicleId, { vin });
        setConfirmVin(false);
        if (res.ok) {
          setError(null);
          setMessage(s.vinSaved);
        } else {
          setMessage(null);
          setError(describeError(res.error).message);
        }
      } catch (e) {
        setConfirmVin(false);
        setMessage(null);
        setError(describeThrown(e));
      }
    });
  };

  if (load.status === 'loading') {
    return (
      <Screen>
        <ProgressCard
          testID="obd-reading"
          title={s.reading}
          text={s.steps[obd.readStep ?? 'capabilities']}
          hint={s.readingHint}
        />
      </Screen>
    );
  }

  if (load.status === 'error') {
    const f = failureText(load.failure.code);
    return (
      <Screen>
        <Banner tone="danger" title={f.title} message={f.text} actionLabel={it.common.retry} onAction={load.failure.code === 'NOT_CONNECTED' ? undefined : () => void read()} />
        <Button label={it.obd.connectAgain} variant="secondary" icon="plug" onPress={() => router.replace(routes.vehicleObd(vehicleId))} />
      </Screen>
    );
  }

  const snap = load.snapshot;
  const savedVin = vehicle.data?.vin ?? null;
  const vin = vinView(snap, savedVin);
  const linkLost = snapshotLinkLost(snap) || obd.phase === 'reconnecting' || obd.phase === 'closed';
  const when = formatReadAt(snap.readAt);

  return (
    <Screen>
      {obd.demo ? <Banner tone="info" title={s.demoTitle} message={s.demoText} icon="car" /> : null}
      {error ? <Banner tone="danger" title={error} /> : null}
      {message ? <Banner tone="ok" title={message} /> : null}

      {linkLost ? (
        <Banner tone="warning" title={s.linkLostTitle} message={s.linkLostText} actionLabel={it.obd.connectAgain} onAction={() => router.replace(routes.vehicleObd(vehicleId))} />
      ) : null}

      {!snapshotHasData(snap) ? (
        <Card tone="warning" testID="obd-no-data">
          <Text variant="heading" color="warning">
            {s.noDataTitle}
          </Text>
          <Text variant="body" color="warning">
            {s.noDataText}
          </Text>
          <Button label={it.common.retry} icon="refresh" onPress={() => void read()} />
        </Card>
      ) : (
        <>
          {snapshotHasIssues(snap) && !linkLost ? (
            <Banner tone="warning" title={s.partialTitle} message={s.partialText} actionLabel={s.refresh} onAction={() => void read()} />
          ) : null}

          <MilCard snapshot={snap} when={when} />
          <VinCard snapshot={snap} vin={vin} canSave={vehicle.data !== undefined && vehicle.data !== null} onSave={() => setConfirmVin(true)} when={when} />
          <DtcCards snapshot={snap} />
          <FreezeCard snapshot={snap} />
          <ValuesCard
            snapshot={snap}
            when={when}
            vehicleId={vehicleId}
            km={vehicle.data?.currentKm ? { km: vehicle.data.currentKm.km, sourceLabel: vehicle.data.currentKm.sourceLabel, unit: vehicle.data.distanceUnit } : null}
          />
        </>
      )}

      <View style={styles.actions}>
        <Button label={s.refresh} icon="refresh" variant="secondary" onPress={() => void read()} />
        <Button label={s.liveLink} icon="activity" variant="secondary" onPress={() => router.push(routes.vehicleObdLive(vehicleId))} />
        <Button label={s.compatLink} icon="list" variant="secondary" onPress={() => router.push(routes.vehicleObdCompat(vehicleId))} />
        <Button label={s.disconnect} variant="ghost" onPress={disconnect} />
      </View>

      <ConfirmSheet
        visible={confirmVin}
        title={s.vinSaveTitle}
        message={obd.demo ? s.vinSaveDemoText : s.vinSaveText}
        confirmLabel={s.vinSave}
        busy={saving.busy}
        onConfirm={() => {
          if (vin.kind === 'read') saveVin(vin.vin);
        }}
        onCancel={() => setConfirmVin(false)}
      />
    </Screen>
  );
}

// ----------------------------------------------------------------------------- sezioni

function MilCard({ snapshot, when }: { snapshot: Snapshot; when: string }): ReactNode {
  const s = it.obd.snapshot;
  const kind = milKind(snapshot);
  const status = snapshot.status?.value;
  const tone = kind === 'on' ? 'warning' : kind === 'off' ? 'ok' : 'unknown';
  const icon = kind === 'on' ? 'alert' : kind === 'off' ? 'check' : 'help';
  const label = kind === 'on' ? s.milOn : kind === 'off' ? s.milOff : s.milUnknown;
  const text = kind === 'on' ? s.milOnText(status?.dtcCount ?? 0) : kind === 'off' ? s.milOffText : s.milUnknownText;
  return (
    <>
      <SectionTitle>{s.milTitle}</SectionTitle>
      <Card tone={tone} testID="obd-mil">
        <ToneBadge tone={tone} icon={icon} label={label} />
        <Text variant="body" color={tone}>
          {text}
        </Text>
        {status ? (
          <Text variant="body" color={tone}>
            {status.ready ? s.monitorsReady : s.monitorsNotReady(status.incomplete.length)}
          </Text>
        ) : null}
        {status && !status.ready ? (
          <Text variant="caption" color={tone}>
            {s.monitorsNote}
          </Text>
        ) : null}
        {snapshot.status ? <ProvenanceTag source={snapshot.status.source} when={when} /> : null}
      </Card>
    </>
  );
}

function VinCard({
  snapshot,
  vin,
  canSave,
  onSave,
  when,
}: {
  snapshot: Snapshot;
  vin: ReturnType<typeof vinView>;
  canSave: boolean;
  onSave: () => void;
  when: string;
}): ReactNode {
  const s = it.obd.snapshot;
  return (
    <>
      <SectionTitle>{s.vinTitle}</SectionTitle>
      <Card testID="obd-vin">
        {vin.kind === 'read' && snapshot.vin ? (
          <>
            <ValueLine label={s.vinLabel} value={vin.vin} source={snapshot.vin.source} when={when} a11y={`${s.vinTitle}: ${vin.vin}. ${it.obd.provenance[snapshot.vin.source]}.`} />
            {vin.compare === 'same' ? (
              <ToneBadge tone="ok" icon="check" label={s.vinSame} />
            ) : null}
            {vin.compare === 'differs' ? <Banner tone="warning" title={s.vinDiffers(vin.saved ?? '')} /> : null}
            {vin.compare === 'saved-none' && canSave ? <Button label={s.vinSave} icon="check" variant="secondary" onPress={onSave} /> : null}
          </>
        ) : (
          <Text variant="body" color="muted">
            {vin.kind === 'invalid' ? s.vinInvalid : vin.kind === 'error' ? s.vinError : s.vinMissing}
          </Text>
        )}
      </Card>
    </>
  );
}

function DtcCards({ snapshot }: { snapshot: Snapshot }): ReactNode {
  const s = it.obd.snapshot;
  const groups: { key: string; title: string; hint: string; section: DtcSection }[] = [
    { key: 'stored', title: s.stored, hint: s.storedHint, section: snapshot.dtc.stored },
    { key: 'pending', title: s.pending, hint: s.pendingHint, section: snapshot.dtc.pending },
    { key: 'permanent', title: s.permanent, hint: s.permanentHint, section: snapshot.dtc.permanent },
  ];
  return (
    <>
      <SectionTitle>{s.dtcTitle}</SectionTitle>
      <Text variant="caption" color="muted">
        {s.dtcScope}
      </Text>
      {groups.map((g) => (
        <DtcGroup key={g.key} title={g.title} hint={g.hint} section={g.section} />
      ))}
      <Text variant="caption" color="muted">
        {s.dtcNoClear}
      </Text>
    </>
  );
}

function DtcGroup({ title, hint, section }: { title: string; hint: string; section: DtcSection }): ReactNode {
  const s = it.obd.snapshot;
  const p = useTheme();
  const kind = dtcSectionKind(section);
  return (
    <Card testID={`obd-dtc-${title}`}>
      <View style={styles.rowBetween}>
        <Text variant="heading" style={styles.flexShrink}>
          {title}
        </Text>
        {kind === 'ok' ? (
          <ToneBadge tone="warning" icon="alert" label={s.dtcCount(section.codes.length)} />
        ) : kind === 'empty' ? (
          <ToneBadge tone="ok" icon="check" label={s.dtcNone} />
        ) : (
          <ToneBadge tone="unknown" icon="help" label={kind === 'unsupported' ? s.dtcUnsupported : s.dtcError} />
        )}
      </View>
      <Text variant="caption" color="muted">
        {hint}
      </Text>
      {kind === 'ok'
        ? section.codes.map((code) => {
            const v = dtcView(code);
            return (
              <View key={code} style={[styles.dtcRow, { borderTopColor: p.border }]} accessible accessibilityLabel={v.a11y}>
                <View style={styles.rowBetween}>
                  <Text variant="title">{v.code}</Text>
                  <Text variant="label" color="muted">
                    {v.generic ? s.dtcGeneric : s.dtcMaker}
                  </Text>
                </View>
                <Text variant="label" color="muted">
                  {v.system}
                </Text>
                <Text variant="body">{v.text}</Text>
              </View>
            );
          })
        : null}
    </Card>
  );
}

function FreezeCard({ snapshot }: { snapshot: Snapshot }): ReactNode {
  const s = it.obd.snapshot;
  const ff = snapshot.freezeFrame;
  if (snapshot.freezeFrameStatus === 'skipped') return null;
  return (
    <>
      <SectionTitle>{s.freezeTitle}</SectionTitle>
      <Card testID="obd-freeze">
        {ff && ff.value.dtc ? (
          <>
            <Text variant="body">{s.freezeText(ff.value.dtc)}</Text>
            {ff.value.values.map((v) => (
              <View key={v.id} style={styles.kv} accessible accessibilityLabel={`${pidName(v)}: ${pidValueText(v)}`}>
                <Text variant="body" color="muted" style={styles.flexShrink}>
                  {pidName(v)}
                </Text>
                <Text variant="bodyStrong">{pidValueText(v)}</Text>
              </View>
            ))}
            <ProvenanceTag source={ff.source} when={formatReadAt(ff.readAt)} />
          </>
        ) : (
          <Text variant="body" color="muted">
            {snapshot.freezeFrameStatus === 'unsupported' ? s.freezeUnsupported : snapshot.freezeFrameStatus === 'error' ? s.freezeError : s.freezeNone}
          </Text>
        )}
      </Card>
    </>
  );
}

function ValuesCard({
  snapshot,
  when,
  vehicleId,
  km,
}: {
  snapshot: Snapshot;
  when: string;
  vehicleId: string;
  km: { km: number; sourceLabel: string; unit: 'km' | 'mi' } | null;
}): ReactNode {
  const s = it.obd.snapshot;
  const router = useRouter();
  const p = useTheme();
  const rows = valueRows(snapshot);
  const hasOdometer = snapshot.pids.odometer !== undefined;
  const hasFuel = snapshot.pids.fuel_level !== undefined;
  return (
    <>
      <SectionTitle>{s.valuesTitle}</SectionTitle>
      <Card testID="obd-values">
        {rows.length === 0 ? (
          <Text variant="body" color="muted">
            {s.valuesNone}
          </Text>
        ) : (
          rows.map((r) => <ValueLine key={r.id} label={r.label} value={r.value} source={r.source} when={when} a11y={r.a11y} />)
        )}
        {!hasFuel ? (
          <View style={styles.missing} accessible accessibilityLabel={`${s.fuelLabel}. ${s.fuelMissing}`}>
            <Icon name="help" color={p.textMuted} size={16} />
            <Text variant="caption" color="muted" style={styles.flexShrink}>
              {`${s.fuelLabel}: ${s.fuelMissing}`}
            </Text>
          </View>
        ) : null}
        {!hasOdometer ? (
          <View style={styles.missing} accessible accessibilityLabel={`${s.odometerLabel}. ${s.odometerMissing}`}>
            <Icon name="help" color={p.textMuted} size={16} />
            <Text variant="caption" color="muted" style={styles.flexShrink}>
              {`${s.odometerLabel}: ${s.odometerMissing}`}
            </Text>
          </View>
        ) : null}
        {!hasOdometer && km ? (
          <Text variant="body">{s.kmInCard(formatDistance(km.km, km.unit), km.sourceLabel)}</Text>
        ) : null}
        {!hasOdometer ? <Button label={s.updateKm} icon="gauge" variant="secondary" onPress={() => router.push(routes.vehicleKm(vehicleId))} /> : null}
        <Text variant="caption" color="muted">
          {s.voltageNote}
        </Text>
      </Card>
      <Card>
        <Text variant="bodyStrong">{s.withheldTitle}</Text>
        <Text variant="body" color="muted">
          {s.withheldText}
        </Text>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  actions: { gap: space.sm, marginTop: space.md },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  flexShrink: { flexShrink: 1 },
  dtcRow: { gap: 2, paddingTop: space.md, borderTopWidth: 1 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: space.xs },
  missing: { flexDirection: 'row', gap: space.xs, alignItems: 'flex-start' },
});
