// S-03 Aggiungi / modifica auto. Obbligatori solo marca, modello e alimentazione; tutto il resto e' facoltativo.
// Dopo l'aggiunta si passa subito a "Imposta le scadenze" (SPEC 6.3.1).
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '@/bootstrap';
import { getSetting } from '@/usecases/settings';
import { addVehicle, getVehicle, updateVehicle } from '@/usecases/vehicles';
import { Banner, Button, ChoiceGroup, EmptyState, ListRow, QueryBoundary, RegistrationCardSheet, Screen, SectionTitle, TextField } from '../components';
import { markOnboardingDone } from '../hooks/onboarding';
import { useBusy } from '../hooks/useBusy';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { describeError, describeThrown } from '../logic/errors';
import type { ApplyResult } from '../logic/registrationCard';
import {
  buildAddInput,
  buildUpdateInput,
  emptyVehicleForm,
  formFieldOf,
  formFromVehicle,
  powertrainOptions,
  primaryFuelOptions,
  secondaryFuelOptions,
  withPowertrain,
  withPrimaryFuel,
  withSecondaryFuel,
  type VehicleFormErrors,
  type VehicleFormState,
} from '../logic/vehicleForm';
import { routes } from '../navigation/routes';

export interface VehicleFormScreenProps {
  /** Assente = nuova auto. */
  vehicleId?: string;
  /** Primo avvio: a fine percorso si arriva a "Oggi". */
  first?: boolean;
}

export function VehicleFormScreen({ vehicleId, first = false }: VehicleFormScreenProps): ReactNode {
  const editing = vehicleId !== undefined;
  const query = useQuery(async (d) => (vehicleId ? getVehicle(d, vehicleId) : null), [vehicleId], it.common.loadError);
  if (!editing) return <FormBody first={first} />;
  return (
    <Screen>
      <QueryBoundary query={query}>
        {(vehicle) =>
          vehicle === null ? (
            <EmptyState icon="car" title={it.common.notFoundTitle} message={it.vehicle.notFound} />
          ) : (
            <FormBody vehicleId={vehicleId} initial={formFromVehicle(vehicle)} first={false} embedded />
          )
        }
      </QueryBoundary>
    </Screen>
  );
}

interface FormBodyProps {
  vehicleId?: string;
  initial?: VehicleFormState;
  first: boolean;
  /** Dentro un <Screen> gia' presente (modifica): niente secondo contenitore. */
  embedded?: boolean;
}

function FormBody({ vehicleId, initial, first, embedded = false }: FormBodyProps): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const editing = vehicleId !== undefined;
  const [form, setForm] = useState<VehicleFormState>(initial ?? emptyVehicleForm());
  const [errors, setErrors] = useState<VehicleFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [cardNotice, setCardNotice] = useState<string | null>(null);
  const saving = useBusy();

  useEffect(() => {
    if (initial) setForm(initial);
    // Il modulo si riempie una volta sola, alla prima lettura dell'auto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  const set = <K extends keyof VehicleFormState>(key: K, value: VehicleFormState[K]): void => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const replace = (next: VehicleFormState): void => {
    setForm(next);
    setErrors({});
  };

  const applyCard = (result: ApplyResult): void => {
    replace(result.form);
    const kept = result.kept.length > 0 ? ` ${it.vehicleForm.card.keptNote(result.kept.map((key) => it.vehicleForm.card.fields[key]).join(', '))}` : '';
    setCardNotice(`${it.vehicleForm.card.done(result.filled.length)}${kept}`);
  };

  const submit = (): void => {
    void saving.run(async () => {
      setFormError(null);
      try {
        const unit = editing ? 'km' : await getSetting(deps, 'units.distance');
        const ctx = { today: deps.clock.todayLocal(), distanceUnit: unit };
        let res;
        if (editing && vehicleId) {
          const built = buildUpdateInput(form, ctx);
          if (!built.ok) {
            setErrors(built.errors);
            return;
          }
          res = await updateVehicle(deps, vehicleId, built.input);
        } else {
          const built = buildAddInput(form, ctx);
          if (!built.ok) {
            setErrors(built.errors);
            return;
          }
          res = await addVehicle(deps, built.input);
        }
        if (!res.ok) {
          const e = describeError(res.error);
          const field = formFieldOf(e.field);
          if (field) setErrors({ [field]: e.message });
          else setFormError(e.message);
          return;
        }
        if (editing) {
          router.back();
          return;
        }
        await markOnboardingDone(deps);
        router.replace(routes.setup(res.value.id, first));
      } catch (e) {
        setFormError(describeThrown(e));
      }
    });
  };

  const secondary = secondaryFuelOptions(form.fuelPrimary, form.powertrain);
  const motors = powertrainOptions(form.fuelPrimary);

  const fields = (
    <>
      {formError ? <Banner tone="danger" title={formError} /> : null}

      <ListRow icon="camera" title={it.vehicleForm.card.entryTitle} subtitle={it.vehicleForm.card.entrySubtitle} onPress={() => setCardOpen(true)} testID="vehicle-from-card" />
      {cardNotice ? <Banner tone="ok" title={cardNotice} /> : null}
      <RegistrationCardSheet visible={cardOpen} form={form} onClose={() => setCardOpen(false)} onApply={applyCard} />

      <SectionTitle>{it.vehicleForm.sectionIdentity}</SectionTitle>
      <TextField label={it.vehicleForm.nickname} optional hint={it.vehicleForm.nicknameHint} value={form.nickname} onChangeText={(v) => set('nickname', v)} error={errors.nickname} maxLength={40} />
      <TextField label={it.vehicleForm.make} required placeholder={it.vehicleForm.makeHint} value={form.make} onChangeText={(v) => set('make', v)} error={errors.make} maxLength={40} />
      <TextField label={it.vehicleForm.model} required placeholder={it.vehicleForm.modelHint} value={form.model} onChangeText={(v) => set('model', v)} error={errors.model} maxLength={40} />
      <TextField label={it.vehicleForm.modelYear} kind="year" optional maxLength={4} value={form.modelYear} onChangeText={(v) => set('modelYear', v)} error={errors.modelYear} />
      <TextField label={it.vehicleForm.plate} kind="plate" optional hint={it.vehicleForm.plateHint} maxLength={12} value={form.plate} onChangeText={(v) => set('plate', v)} error={errors.plate} />
      <TextField label={it.vehicleForm.vin} kind="plate" optional hint={it.vehicleForm.vinHint} maxLength={24} value={form.vin} onChangeText={(v) => set('vin', v)} error={errors.vin} testID="vehicle-vin" />
      <TextField
        label={it.vehicleForm.firstRegistration}
        kind="date"
        optional
        hint={it.vehicleForm.firstRegistrationHint}
        maxLength={10}
        value={form.firstRegistration}
        onChangeText={(v) => set('firstRegistration', v)}
        error={errors.firstRegistration}
      />

      <SectionTitle>{it.vehicleForm.sectionFuel}</SectionTitle>
      <ChoiceGroup
        label={it.vehicleForm.fuel}
        options={primaryFuelOptions(form.fuelPrimary)}
        value={form.fuelPrimary}
        onChange={(v) => replace(withPrimaryFuel(form, v))}
        error={errors.fuelPrimary}
      />
      {motors.length > 0 ? (
        <ChoiceGroup label={it.vehicleForm.powertrain} options={motors} value={form.powertrain} onChange={(v) => replace(withPowertrain(form, v))} error={errors.powertrain} />
      ) : null}
      {secondary.length > 0 ? (
        <ChoiceGroup
          label={it.vehicleForm.secondaryFuel}
          options={secondary}
          value={form.fuelSecondary ?? 'none'}
          onChange={(v) => replace(withSecondaryFuel(form, v))}
          error={errors.fuelSecondary}
        />
      ) : null}
      {editing ? null : (
        <TextField label={it.vehicleForm.currentKm} kind="km" optional hint={it.vehicleForm.currentKmHint} value={form.currentKm} onChangeText={(v) => set('currentKm', v)} error={errors.currentKm} maxLength={9} />
      )}
    </>
  );

  const button = (
    <Button
      label={editing ? it.vehicleForm.saveEdit : it.vehicleForm.save}
      onPress={submit}
      loading={saving.busy}
      accessibilityHint={saving.busy ? it.common.saving : undefined}
    />
  );

  if (embedded) {
    return (
      <>
        {fields}
        {button}
      </>
    );
  }
  return <Screen footer={button}>{fields}</Screen>;
}
