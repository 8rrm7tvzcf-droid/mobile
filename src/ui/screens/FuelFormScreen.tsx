// S-22 Rifornimento: inserimento in meno di 10 secondi (valori predefiniti, due valori su tre calcolano il terzo,
// consumo del tratto subito dopo il salvataggio con "Annulla") e modifica/eliminazione di un rifornimento.
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from '@/bootstrap';
import { fuelLabelIt, fuelTypesForVehicle, unitForFuel, type FuelType } from '@/domain/fuel';
import type { DistanceUnit } from '@/domain/units';
import {
  addFuelLog,
  deleteFuelLog,
  getFuelFormDefaults,
  getFuelLog,
  updateFuelLog,
  type FuelFormDefaults,
  type FuelLogEntry,
  type FuelWriteResult,
} from '@/usecases/fuel';
import { isOdometerConflict, type OdometerConflictError } from '@/usecases/odometer';
import { getVehicle } from '@/usecases/vehicles';
import {
  AttachmentsSection,
  Banner,
  Button,
  Card,
  ChoiceGroup,
  ConfirmSheet,
  EmptyState,
  OdometerConflictSheet,
  QueryBoundary,
  Screen,
  SwitchRow,
  Text,
  TextField,
} from '../components';
import { pushUndo } from '../hooks/undo';
import { useBusy } from '../hooks/useBusy';
import { goBackOr } from '../navigation/actions';
import { routes } from '../navigation/routes';
import { useQuery } from '../hooks/useQuery';
import { useSnapshot } from '../hooks/useSnapshot';
import { it } from '../i18n/it';
import { describeError, describeThrown } from '../logic/errors';
import {
  buildAddFuelInput,
  buildUpdateFuelInput,
  consumptionNote,
  formFromEntry,
  fuelErrorField,
  fuelRowTitle,
  initialFuelForm,
  resolveAmounts,
  switchFuelType,
  type AmountField,
  type FuelFormErrors,
  type FuelFormValues,
} from '../logic/fuelForm';

interface Loaded {
  fuelTypes: FuelType[];
  unit: DistanceUnit;
  defaults: FuelFormDefaults | null;
  log: FuelLogEntry | null;
  notFound: boolean;
}

export function FuelFormScreen({ vehicleId, logId }: { vehicleId: string; logId?: string }): ReactNode {
  const query = useQuery<Loaded>(
    async (d) => {
      const vehicle = await getVehicle(d, vehicleId);
      const missing: Loaded = { fuelTypes: [], unit: 'km', defaults: null, log: null, notFound: true };
      if (!vehicle) return missing;
      const fuelTypes = fuelTypesForVehicle({ fuelPrimary: vehicle.fuelPrimary, fuelSecondary: vehicle.fuelSecondary });
      if (logId) {
        const log = await getFuelLog(d, logId);
        return log && log.vehicleId === vehicleId ? { fuelTypes, unit: vehicle.distanceUnit, defaults: null, log, notFound: false } : missing;
      }
      const defaults = await getFuelFormDefaults(d, vehicleId);
      return defaults ? { fuelTypes: defaults.fuelTypes, unit: vehicle.distanceUnit, defaults, log: null, notFound: false } : missing;
    },
    [vehicleId, logId],
    it.common.loadError,
  );
  const data = useSnapshot(query.data);
  return (
    <QueryBoundary query={{ ...query, data }}>
      {(loaded) =>
        loaded.notFound ? (
          <Screen>
            <EmptyState icon="car" title={it.common.notFoundTitle} message={logId ? it.fuel.notFound : it.vehicle.notFound} />
          </Screen>
        ) : (
          <FuelForm vehicleId={vehicleId} {...loaded} />
        )
      }
    </QueryBoundary>
  );
}

function FuelForm({ vehicleId, fuelTypes, unit, defaults, log }: { vehicleId: string } & Loaded): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const today = deps.clock.todayLocal();
  const editing = log !== null;
  const initial = useMemo<FuelFormValues>(() => (log ? formFromEntry(log, unit) : initialFuelForm(defaults as FuelFormDefaults, unit)), [log, defaults, unit]);
  const original = useRef(initial);
  const [values, setValues] = useState<FuelFormValues>(initial);
  const [errors, setErrors] = useState<FuelFormErrors>({});
  const [conflict, setConflict] = useState<OdometerConflictError | null>(null);
  const [saved, setSaved] = useState<FuelWriteResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saving = useBusy();

  const quantityUnit = unitForFuel(values.fuelType);
  const resolution = useMemo(() => resolveAmounts(values, editing ? 'edit' : 'new'), [values, editing]);
  const options = useMemo(() => {
    const types = fuelTypes.includes(values.fuelType) ? fuelTypes : [...fuelTypes, values.fuelType];
    return types.map((t) => ({ value: t, label: fuelLabelIt(t) }));
  }, [fuelTypes, values.fuelType]);
  const stations = defaults?.recentStations.slice(0, 4) ?? [];

  const patch = (p: Partial<FuelFormValues>): void => setValues((v) => ({ ...v, ...p }));
  const setAmount = (field: AmountField, text: string): void => {
    setErrors((e) => ({ ...e, [field]: undefined, form: undefined }));
    setValues((v) => ({
      ...v,
      [field]: text,
      edited: text.trim() === '' ? v.edited.filter((f) => f !== field) : v.edited.includes(field) ? v.edited : [...v.edited, field],
    }));
  };

  const save = (choice: 'plain' | 'skip-km' | 'ignore-previous' = 'plain'): void => {
    void saving.run(async () => {
      setErrors({});
      const ctx = { today, unit };
      try {
        let res;
        if (log) {
          const built = buildUpdateFuelInput(values, original.current, ctx);
          if (!built.ok) return setErrors(built.errors);
          res = await updateFuelLog(deps, log.id, {
            ...built.input,
            ...(choice === 'skip-km' ? { onOdometerConflict: 'skip_km' as const } : {}),
            ...(choice === 'ignore-previous' ? { resolveConflicts: 'ignore-conflicting' as const } : {}),
          });
        } else {
          const built = buildAddFuelInput(vehicleId, values, ctx);
          if (!built.ok) return setErrors(built.errors);
          res = await addFuelLog(deps, {
            ...built.input,
            ...(choice === 'skip-km' ? { onOdometerConflict: 'skip_km' as const } : {}),
            ...(choice === 'ignore-previous' ? { resolveConflicts: 'ignore-conflicting' as const } : {}),
          });
        }
        if (res.ok) {
          setConflict(null);
          if (!editing || res.value.warnings.length > 0 || res.value.kmIgnored) setSaved(res.value);
          else goBackOr(router, routes.fuelList(vehicleId));
          return;
        }
        if (isOdometerConflict(res.error)) {
          setConflict(res.error);
          return;
        }
        const e = describeError(res.error);
        setErrors({ [fuelErrorField(e.field)]: e.message });
      } catch (e) {
        setErrors({ form: describeThrown(e) });
      }
    });
  };

  const undoSaved = (): void => {
    if (!saved) return;
    void saving.run(async () => {
      try {
        const res = await deleteFuelLog(deps, saved.fuelLog.id);
        if (res.ok) goBackOr(router, routes.fuelList(vehicleId));
        else setErrors({ form: describeError(res.error).message });
      } catch (e) {
        setErrors({ form: describeThrown(e) });
      }
    });
  };

  const remove = (): void => {
    if (!log) return;
    void saving.run(async () => {
      try {
        const res = await deleteFuelLog(deps, log.id);
        setConfirmDelete(false);
        if (!res.ok) return setErrors({ form: describeError(res.error).message });
        pushUndo({ mode: 'deleted', kind: 'fuel', itemId: log.id, vehicleId, message: it.fuel.deletedMessage });
        goBackOr(router, routes.fuelList(vehicleId));
      } catch (e) {
        setConfirmDelete(false);
        setErrors({ form: describeThrown(e) });
      }
    });
  };

  if (saved) {
    const note = consumptionNote(saved.fuelLog, unit, saved.consumption);
    return (
      <Screen
        footer={
          <>
            <Button label={it.fuel.done} icon="check" onPress={() => goBackOr(router, routes.fuelList(vehicleId))} />
            {!editing ? <Button label={it.fuel.undoSaved} icon="undo" variant="ghost" loading={saving.busy} onPress={undoSaved} /> : null}
          </>
        }
      >
        <Banner tone="ok" title={editing ? it.fuel.savedChangesTitle : it.fuel.savedTitle} message={fuelRowTitle(saved.fuelLog)} />
        {errors.form ? <Banner tone="danger" title={errors.form} /> : null}
        <Card testID="fuel-consumption">
          <Text variant="label" color="muted">
            {it.fuel.consumptionTitle}
          </Text>
          {note.value ? <Text variant="largeTitle">{note.value}</Text> : null}
          <Text variant="body" color="muted">
            {note.detail}
          </Text>
        </Card>
        {saved.kmIgnored ? <Banner tone="warning" title={it.fuel.warningTitle} message={it.km.conflictSkipKmHint} /> : null}
        {saved.warnings.length > 0 ? <Banner tone="warning" title={it.fuel.warningTitle} message={saved.warnings.join(' ')} /> : null}
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <Button
          label={editing ? it.fuel.saveChanges : it.fuel.save}
          icon="check"
          loading={saving.busy}
          testID="fuel-save"
          onPress={() => save()}
        />
      }
    >
      {!editing ? (
        <Text variant="body" color="muted">
          {it.fuel.intro}
        </Text>
      ) : null}
      {errors.form ? <Banner tone="danger" title={errors.form} /> : null}

      {options.length > 1 ? (
        <ChoiceGroup
          label={it.fuel.fuelLabel}
          options={options}
          value={values.fuelType}
          onChange={(t) => setValues((v) => (defaults ? switchFuelType(v, defaults, t) : { ...v, fuelType: t }))}
        />
      ) : null}

      <TextField
        label={it.fuel.quantityLabel(quantityUnit)}
        kind="money"
        suffix={quantityUnit}
        value={resolution.shown.quantity}
        onChangeText={(t) => setAmount('quantity', t)}
        selectTextOnFocus={!values.edited.includes('quantity')}
        error={errors.quantity ?? null}
        hint={resolution.computed === 'quantity' ? it.fuel.calculated : null}
        maxLength={10}
        autoFocus={!editing}
        testID="fuel-quantity"
      />
      <TextField
        label={it.fuel.unitPriceLabel(quantityUnit)}
        kind="money"
        suffix={`€/${quantityUnit}`}
        value={resolution.shown.unitPrice}
        onChangeText={(t) => setAmount('unitPrice', t)}
        selectTextOnFocus={!values.edited.includes('unitPrice')}
        error={errors.unitPrice ?? null}
        hint={resolution.computed === 'unitPrice' ? it.fuel.calculated : null}
        maxLength={8}
        testID="fuel-price"
      />
      <TextField
        label={it.fuel.totalLabel}
        kind="money"
        suffix="€"
        value={resolution.shown.total}
        onChangeText={(t) => setAmount('total', t)}
        selectTextOnFocus={!values.edited.includes('total')}
        error={errors.total ?? (resolution.mismatch ? it.fuel.totalDoesNotMatch : null)}
        hint={resolution.computed === 'total' ? it.fuel.calculated : null}
        maxLength={10}
        testID="fuel-total"
      />

      <TextField
        label={it.fuel.kmLabel}
        kind="km"
        suffix={unit}
        value={values.km}
        selectTextOnFocus
        onChangeText={(t) => {
          patch({ km: t });
          setErrors((e) => ({ ...e, km: undefined }));
        }}
        error={errors.km ?? null}
        hint={!editing && defaults?.suggestedKm ? it.fuel.kmHint(defaults.suggestedKm.label) : it.fuel.kmHintNone}
        maxLength={9}
        optional
        testID="fuel-km"
      />

      <ChoiceGroup
        label={it.fuel.fillLabel}
        options={[
          { value: 'full', label: it.fuel.full },
          { value: 'partial', label: it.fuel.partial },
        ]}
        value={values.isFull ? 'full' : 'partial'}
        onChange={(v) => patch({ isFull: v === 'full' })}
        hint={it.fuel.fullHint}
      />
      <SwitchRow label={it.fuel.missed} description={it.fuel.missedHint} value={values.missedBefore} onChange={(v) => patch({ missedBefore: v })} />

      <TextField
        label={it.fuel.dateLabel}
        kind="date"
        value={values.date}
        selectTextOnFocus
        onChangeText={(t) => {
          patch({ date: t });
          setErrors((e) => ({ ...e, date: undefined }));
        }}
        error={errors.date ?? null}
        maxLength={10}
      />
      <TextField label={it.fuel.stationLabel} optional value={values.station} onChangeText={(t) => patch({ station: t })} maxLength={80} />
      {stations.length > 1 ? (
        <ChoiceGroup options={stations.map((s) => ({ value: s, label: s }))} value={values.station} onChange={(s) => patch({ station: s })} />
      ) : null}
      <TextField label={it.fuel.gradeLabel} optional hint={it.fuel.gradeHint} value={values.grade} onChangeText={(t) => patch({ grade: t })} maxLength={40} />
      <TextField label={it.fuel.notesLabel} optional multiline value={values.notes} onChangeText={(t) => patch({ notes: t })} maxLength={500} />

      {editing && log ? <AttachmentsSection parent={{ type: 'fuel_log', id: log.id }} vehicleId={vehicleId} /> : null}

      {editing ? <Button label={it.fuel.delete} icon="trash" variant="ghost" onPress={() => setConfirmDelete(true)} /> : null}

      <ConfirmSheet
        visible={confirmDelete}
        title={it.fuel.deleteTitle}
        message={it.fuel.deleteText}
        confirmLabel={it.fuel.deleteConfirm}
        destructive
        busy={saving.busy}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
      <OdometerConflictSheet
        conflict={conflict}
        unit={unit}
        busy={saving.busy}
        onFix={() => setConflict(null)}
        onSkipKm={() => save('skip-km')}
        onIgnorePrevious={() => save('ignore-previous')}
      />
    </Screen>
  );
}
