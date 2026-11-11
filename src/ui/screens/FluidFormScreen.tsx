// S-24 Registra un controllo in 3 tocchi: fluido -> esito (OK / basso / rabboccato / alto) -> Salva. Solo con «rabboccato»
// compaiono quantita' e prodotto; per la pressione dei pneumatici il valore in bar con la virgola. Data e km sono facoltativi.
import { useRouter } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useApp } from '@/bootstrap';
import { FLUID_INFO, isFluid, type Fluid } from '@/domain/fluids';
import { addFluidCheck, deleteFluidCheck, getFluidStatus, type AddFluidCheckResult } from '@/usecases/fluids';
import { isOdometerConflict, type OdometerConflictError } from '@/usecases/odometer';
import { getVehicle } from '@/usecases/vehicles';
import { Banner, Button, Card, ChoiceGroup, EmptyState, OdometerConflictSheet, QueryBoundary, Screen, StatusBadge, Text, TextField } from '../components';
import { useBusy } from '../hooks/useBusy';
import { useQuery } from '../hooks/useQuery';
import { useSnapshot } from '../hooks/useSnapshot';
import { it } from '../i18n/it';
import { describeError, describeThrown } from '../logic/errors';
import {
  buildAddFluidInput,
  fluidErrorField,
  fluidTone,
  initialFluidForm,
  isPressure,
  levelOptions,
  showsAddedFields,
  switchFluid,
  type FluidFormErrors,
  type FluidFormValues,
} from '../logic/fluidForm';
import { goBackOr } from '../navigation/actions';
import { routes } from '../navigation/routes';

interface Loaded {
  unit: 'km' | 'mi';
  fluids: { fluid: Fluid; label: string }[];
  notFound: boolean;
}

export function FluidFormScreen({ vehicleId, fluid }: { vehicleId: string; fluid?: string }): ReactNode {
  const query = useQuery<Loaded>(
    async (d) => {
      const vehicle = await getVehicle(d, vehicleId);
      if (!vehicle) return { unit: 'km', fluids: [], notFound: true };
      const statuses = await getFluidStatus(d, vehicleId);
      return { unit: vehicle.distanceUnit, fluids: statuses.map((s) => ({ fluid: s.fluid, label: s.fluidLabelIt })), notFound: false };
    },
    [vehicleId],
    it.common.loadError,
  );
  const data = useSnapshot(query.data);
  return (
    <QueryBoundary query={{ ...query, data }}>
      {(loaded) =>
        loaded.notFound ? (
          <Screen>
            <EmptyState icon="car" title={it.common.notFoundTitle} message={it.vehicle.notFound} />
          </Screen>
        ) : (
          <FluidForm vehicleId={vehicleId} initialFluid={fluid && isFluid(fluid) ? fluid : (loaded.fluids[0]?.fluid ?? 'engine_oil')} {...loaded} />
        )
      }
    </QueryBoundary>
  );
}

function FluidForm({ vehicleId, initialFluid, unit, fluids }: { vehicleId: string; initialFluid: Fluid } & Loaded): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const today = deps.clock.todayLocal();
  const [values, setValues] = useState<FluidFormValues>(() => initialFluidForm(initialFluid, today));
  const [errors, setErrors] = useState<FluidFormErrors>({});
  const [conflict, setConflict] = useState<OdometerConflictError | null>(null);
  const [saved, setSaved] = useState<AddFluidCheckResult | null>(null);
  const saving = useBusy();

  const info = FLUID_INFO[values.fluid];
  const pressure = isPressure(values.fluid);
  const options = useMemo(() => levelOptions(values.fluid), [values.fluid]);
  const patch = (p: Partial<FluidFormValues>): void => setValues((v) => ({ ...v, ...p }));
  const clear = (...keys: (keyof FluidFormErrors)[]): void => setErrors((e) => ({ ...e, ...Object.fromEntries(keys.map((k) => [k, undefined])), form: undefined }));

  const save = (choice: 'plain' | 'skip-km' | 'ignore-previous' = 'plain'): void => {
    void saving.run(async () => {
      setErrors({});
      const built = buildAddFluidInput(vehicleId, values, { today, unit });
      if (!built.ok) return setErrors(built.errors);
      try {
        const res = await addFluidCheck(deps, {
          ...built.input,
          ...(choice === 'skip-km' ? { onOdometerConflict: 'skip_km' as const } : {}),
          ...(choice === 'ignore-previous' ? { onOdometerConflict: 'ignore-conflicting' as const } : {}),
        });
        if (res.ok) {
          setConflict(null);
          setSaved(res.value);
          return;
        }
        if (isOdometerConflict(res.error)) {
          setConflict(res.error);
          return;
        }
        const e = describeError(res.error);
        setErrors({ [fluidErrorField(e.field)]: e.message });
      } catch (e) {
        setErrors({ form: describeThrown(e) });
      }
    });
  };

  const undoSaved = (): void => {
    if (!saved) return;
    void saving.run(async () => {
      try {
        const res = await deleteFluidCheck(deps, saved.check.id);
        if (res.ok) goBackOr(router, routes.fluids(vehicleId));
        else setErrors({ form: describeError(res.error).message });
      } catch (e) {
        setErrors({ form: describeThrown(e) });
      }
    });
  };

  if (saved) {
    const t = fluidTone(saved.status.kind);
    return (
      <Screen
        footer={
          <>
            <Button label={it.fluid.done} icon="check" testID="fluid-done" onPress={() => goBackOr(router, routes.fluids(vehicleId))} />
            <Button label={it.fluid.undoSaved} icon="undo" variant="ghost" loading={saving.busy} onPress={undoSaved} />
          </>
        }
      >
        <Banner tone="ok" title={it.fluid.savedTitle} message={`${saved.check.fluidLabelIt}: ${saved.check.levelLabelIt}`} />
        {errors.form ? <Banner tone="danger" title={errors.form} /> : null}
        <Card testID="fluid-status">
          <Text variant="heading">{saved.check.fluidLabelIt}</Text>
          <StatusBadge tone={t.tone} icon={t.icon} label={saved.status.labelIt} />
          <Text variant="body" color="muted">
            {saved.status.detailIt}
          </Text>
          {saved.status.suggestionIt ? <Text variant="body">{saved.status.suggestionIt}</Text> : null}
        </Card>
        {saved.completions.map((c) => (
          <Banner key={c.completionId} tone="info" title={it.fluid.completedText(c.itemName)} />
        ))}
        {saved.kmIgnored ? <Banner tone="warning" title={it.service.warningTitle} message={it.km.conflictSkipKmHint} /> : null}
        {saved.warnings.length > 0 ? <Banner tone="warning" title={it.service.warningTitle} message={saved.warnings.join(' ')} /> : null}
      </Screen>
    );
  }

  return (
    <Screen footer={<Button label={it.fluid.save} icon="check" loading={saving.busy} testID="fluid-save" onPress={() => save()} />}>
      {errors.form ? <Banner tone="danger" title={errors.form} /> : null}

      <ChoiceGroup
        label={it.fluid.fluidLabel}
        options={fluids.map((f) => ({ value: f.fluid, label: f.label }))}
        value={values.fluid}
        onChange={(f) => {
          setValues((v) => switchFluid(v, f));
          setErrors({});
        }}
      />
      <Card>
        <Text variant="body">{info.hintIt}</Text>
        <Text variant="caption" color="muted">
          {info.obdNoteIt}
        </Text>
      </Card>

      {pressure ? (
        <TextField
          label={it.fluid.pressureLabel}
          kind="money"
          suffix="bar"
          optional
          hint={it.fluid.pressureHint}
          value={values.pressure}
          onChangeText={(t) => {
            patch({ pressure: t });
            clear('pressure');
          }}
          error={errors.pressure ?? null}
          maxLength={6}
          testID="fluid-pressure"
        />
      ) : null}

      <ChoiceGroup
        label={pressure ? it.fluid.pressureLevelLabel : it.fluid.levelLabel}
        options={options}
        value={values.level}
        onChange={(l) => {
          patch({ level: l });
          clear('level');
        }}
        error={errors.level ?? null}
      />

      {showsAddedFields(values) ? (
        <>
          <TextField
            label={it.fluid.addedLabel}
            kind="money"
            suffix={values.addedUnit}
            optional
            hint={it.fluid.addedHint}
            value={values.added}
            onChangeText={(t) => {
              patch({ added: t });
              clear('added');
            }}
            error={errors.added ?? null}
            maxLength={7}
            testID="fluid-added"
          />
          <ChoiceGroup<'ml' | 'L'>
            options={[
              { value: 'ml', label: 'ml' },
              { value: 'L', label: 'L' },
            ]}
            value={values.addedUnit}
            onChange={(u) => patch({ addedUnit: u })}
          />
          <TextField label={it.fluid.productLabel} optional hint={it.fluid.productHint} value={values.product} onChangeText={(t) => patch({ product: t })} maxLength={80} />
        </>
      ) : null}

      <TextField
        label={it.fluid.dateLabel}
        kind="date"
        value={values.date}
        selectTextOnFocus
        onChangeText={(t) => {
          patch({ date: t });
          clear('date');
        }}
        error={errors.date ?? null}
        maxLength={10}
      />
      <TextField
        label={it.fluid.kmLabel}
        kind="km"
        suffix={unit}
        optional
        hint={it.fluid.kmHint}
        value={values.km}
        onChangeText={(t) => {
          patch({ km: t });
          clear('km');
        }}
        error={errors.km ?? null}
        maxLength={9}
      />
      <TextField label={it.fluid.notesLabel} optional multiline value={values.notes} onChangeText={(t) => patch({ notes: t })} maxLength={500} />

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
