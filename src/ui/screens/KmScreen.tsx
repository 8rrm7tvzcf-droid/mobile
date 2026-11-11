// S-25 Aggiorna km: lettura manuale con avviso di coerenza mentre si scrive e finestra a scelte in caso di conflitto.
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '@/bootstrap';
import { formatDateIt, formatDistance, parseDateIt } from '@/domain/units';
import { addOdometerReading, checkOdometerReading, isOdometerConflict, type OdometerCheck, type OdometerConflictError } from '@/usecases/odometer';
import { getVehicle } from '@/usecases/vehicles';
import { Banner, Button, EmptyState, OdometerConflictSheet, QueryBoundary, Screen, Text, TextField } from '../components';
import { useBusy } from '../hooks/useBusy';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { describeError, describeThrown } from '../logic/errors';
import { checkMessages, parseKmField, rangeHint } from '../logic/odometer';
import type { DistanceUnit } from '@/domain/units';

export function KmScreen({ vehicleId }: { vehicleId: string }): ReactNode {
  const query = useQuery((d) => getVehicle(d, vehicleId), [vehicleId], it.common.loadError);
  return (
    <QueryBoundary query={query}>
      {(vehicle) =>
        vehicle === null ? (
          <Screen>
            <EmptyState icon="car" title={it.common.notFoundTitle} message={it.vehicle.notFound} />
          </Screen>
        ) : (
          <KmForm
            vehicleId={vehicleId}
            unit={vehicle.distanceUnit}
            last={vehicle.currentKm ? { km: vehicle.currentKm.km, readOn: vehicle.currentKm.readOn } : null}
          />
        )
      }
    </QueryBoundary>
  );
}

interface KmFormProps {
  vehicleId: string;
  unit: DistanceUnit;
  last: { km: number; readOn: string } | null;
}

function KmForm({ vehicleId, unit, last }: KmFormProps): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const today = deps.clock.todayLocal();
  const [kmText, setKmText] = useState('');
  const [dateText, setDateText] = useState(formatDateIt(today));
  const [note, setNote] = useState('');
  const [check, setCheck] = useState<OdometerCheck | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ km?: string; date?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<OdometerConflictError | null>(null);
  const [savedWarnings, setSavedWarnings] = useState<string[] | null>(null);
  const saving = useBusy();

  const km = parseKmField(kmText, unit);
  const readOn = parseDateIt(dateText);

  // Controllo di coerenza "a caldo", senza scrivere nulla.
  useEffect(() => {
    if (km === null || readOn === null) {
      setCheck(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      checkOdometerReading(deps, { vehicleId, km, readOn }).then(
        (res) => {
          if (!cancelled) setCheck(res.ok ? res.value : null);
        },
        () => undefined,
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [deps, vehicleId, km, readOn]);

  const messages = check ? checkMessages(check) : null;

  const save = (resolve: boolean): void => {
    void saving.run(async () => {
      setFormError(null);
      const errors: { km?: string; date?: string } = {};
      if (km === null) errors.km = it.km.invalidKm;
      if (readOn === null) errors.date = it.common.dateExample;
      else if (readOn > today) errors.date = it.common.futureDate;
      setFieldErrors(errors);
      if (km === null || readOn === null || errors.date) return;
      try {
        const res = await addOdometerReading(deps, {
          vehicleId,
          km,
          readOn,
          note: note.trim() === '' ? null : note.trim(),
          ...(resolve ? { resolveConflicts: 'ignore-conflicting' as const } : {}),
        });
        if (res.ok) {
          setConflict(null);
          if (res.value.warnings.length > 0) setSavedWarnings(res.value.warnings.map((w) => w.message));
          else router.back();
          return;
        }
        if (isOdometerConflict(res.error)) {
          setConflict(res.error);
          return;
        }
        const e = describeError(res.error);
        if (e.field === 'km') setFieldErrors({ km: e.message });
        else if (e.field === 'date') setFieldErrors({ date: e.message });
        else setFormError(e.message);
      } catch (e) {
        setFormError(describeThrown(e));
      }
    });
  };

  if (savedWarnings) {
    return (
      <Screen footer={<Button label={it.common.close} onPress={() => router.back()} />}>
        <Banner tone="ok" title={it.km.savedTitle} />
        <Banner tone="warning" title={it.km.warningTitle} message={savedWarnings.join(' ')} />
      </Screen>
    );
  }

  return (
    <Screen footer={<Button label={it.km.save} icon="check" loading={saving.busy} onPress={() => save(false)} />}>
      <Text variant="body" color="muted">
        {it.km.intro}
      </Text>
      {last ? (
        <Text variant="caption" color="muted">
          {it.km.last(formatDistance(last.km, unit), formatDateIt(last.readOn))}
        </Text>
      ) : null}
      {formError ? <Banner tone="danger" title={formError} /> : null}
      <TextField
        label={it.km.kmLabel}
        kind="km"
        required
        suffix={unit}
        value={kmText}
        onChangeText={(v) => {
          setKmText(v);
          setFieldErrors((e) => ({ ...e, km: undefined }));
        }}
        error={fieldErrors.km ?? messages?.errors[0] ?? null}
        hint={check ? rangeHint(check.allowedRange, unit) : null}
        maxLength={9}
        autoFocus
      />
      {messages && messages.warnings.length > 0 ? <Banner tone="warning" title={it.km.warningTitle} message={messages.warnings.join(' ')} /> : null}
      <TextField
        label={it.km.dateLabel}
        kind="date"
        value={dateText}
        onChangeText={(v) => {
          setDateText(v);
          setFieldErrors((e) => ({ ...e, date: undefined }));
        }}
        error={fieldErrors.date}
        maxLength={10}
      />
      <TextField label={it.km.noteLabel} optional hint={it.km.noteHint} value={note} onChangeText={setNote} maxLength={200} />

      <OdometerConflictSheet conflict={conflict} unit={unit} busy={saving.busy} onFix={() => setConflict(null)} onIgnorePrevious={() => save(true)} />
    </Screen>
  );
}
