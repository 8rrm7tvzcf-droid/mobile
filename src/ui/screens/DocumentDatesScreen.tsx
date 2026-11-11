// "Date dei documenti": una sola schermata per immatricolazione, revisione, bollo e assicurazione RC. Al posto del giro
// voce per voce del wizard: l'utente copia le date dai documenti (o dai siti ufficiali, aperti da qui) e le scadenze nascono.
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useApp } from '@/bootstrap';
import { listSetupCatalog, setupDeadlines, type SetupProposal } from '@/usecases/deadlines';
import { addPolicy, getInsuranceSummary } from '@/usecases/insurance';
import { getVehicle, updateVehicle } from '@/usecases/vehicles';
import { Banner, Button, Card, ChoiceGroup, EmptyState, ListRow, QueryBoundary, Screen, SectionTitle, Text, TextField } from '../components';
import { useBusy } from '../hooks/useBusy';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import {
  OFFICIAL_CHECKS,
  buildDocumentDates,
  documentDatesSections,
  emptyDocumentDates,
  type DocumentDatesErrors,
  type DocumentDatesValues,
  type OfficialCheck,
} from '../logic/documentDates';
import { describeError, describeThrown } from '../logic/errors';
import { routes } from '../navigation/routes';
import { space } from '../theme/tokens';

export interface DocumentDatesScreenProps {
  vehicleId: string;
}

export function DocumentDatesScreen({ vehicleId }: DocumentDatesScreenProps): ReactNode {
  const query = useQuery(
    async (d) => {
      const catalog = await listSetupCatalog(d, vehicleId);
      if (!catalog.ok) return null;
      const vehicle = await getVehicle(d, vehicleId);
      if (!vehicle) return null;
      const insurance = await getInsuranceSummary(d, vehicleId);
      return { proposals: catalog.value.proposals, vehicle, hasRca: insurance.hasRca };
    },
    [vehicleId],
    it.common.loadError,
  );

  return (
    <QueryBoundary query={query}>
      {(data) =>
        data === null ? (
          <Screen>
            <EmptyState icon="car" title={it.common.notFoundTitle} message={it.vehicle.notFound} />
          </Screen>
        ) : (
          <DatesForm
            vehicleId={vehicleId}
            vehicleName={data.vehicle.displayName}
            plate={data.vehicle.plate}
            firstRegistrationOn={data.vehicle.firstRegistrationOn}
            proposals={data.proposals}
            hasRca={data.hasRca}
          />
        )
      }
    </QueryBoundary>
  );
}

interface DatesFormProps {
  vehicleId: string;
  vehicleName: string;
  plate: string | null;
  firstRegistrationOn: string | null;
  proposals: SetupProposal[];
  hasRca: boolean;
}

function DatesForm({ vehicleId, vehicleName, plate, firstRegistrationOn, proposals, hasRca }: DatesFormProps): ReactNode {
  const { deps } = useApp();
  const router = useRouter();
  const [values, setValues] = useState<DocumentDatesValues>(() => emptyDocumentDates(firstRegistrationOn));
  const [errors, setErrors] = useState<DocumentDatesErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const saving = useBusy();
  const sections = documentDatesSections({ proposals, hasRca });

  const patch = (change: Partial<DocumentDatesValues>): void => {
    setValues((v) => ({ ...v, ...change }));
    setErrors((e) => {
      const next = { ...e };
      for (const key of Object.keys(change) as (keyof DocumentDatesValues)[]) delete next[key];
      return next;
    });
  };

  const submit = (): void => {
    void saving.run(async () => {
      setFormError(null);
      const built = buildDocumentDates({ vehicleId, today: deps.clock.todayLocal(), firstRegistrationOn, proposals, hasRca }, values);
      if (!built.ok) {
        setErrors(built.errors);
        setFormError(built.errors.form ?? null);
        return;
      }
      setErrors({});
      const { plan } = built;
      const stop = (step: string, error: Parameters<typeof describeError>[0]): void => setFormError(`${it.documentDates.stepFailed(step)} ${describeError(error).message}`);
      try {
        if (plan.vehiclePatch) {
          const res = await updateVehicle(deps, vehicleId, plan.vehiclePatch);
          if (!res.ok) return stop(it.documentDates.stepVehicle, res.error);
        }
        if (plan.setup) {
          const res = await setupDeadlines(deps, plan.setup);
          if (!res.ok) return stop(it.documentDates.stepDeadlines, res.error);
        }
        if (plan.policy) {
          const res = await addPolicy(deps, plan.policy);
          if (!res.ok) return stop(it.documentDates.stepPolicy, res.error);
        }
        router.replace(routes.vehicleDeadlines(vehicleId));
      } catch (e) {
        setFormError(describeThrown(e));
      }
    });
  };

  return (
    <Screen footer={<Button label={it.documentDates.save} icon="check" loading={saving.busy} onPress={submit} testID="document-dates-save" />}>
      <Text variant="body" color="muted">
        {it.documentDates.intro(vehicleName)}
      </Text>
      {formError ? <Banner tone="danger" title={formError} /> : null}

      <View style={styles.group}>
        <SectionTitle>{it.documentDates.registrationTitle}</SectionTitle>
        <Card>
          <TextField
            label={it.documentDates.registrationLabel}
            kind="date"
            optional
            hint={it.documentDates.registrationHint}
            value={values.firstRegistration}
            onChangeText={(v) => patch({ firstRegistration: v })}
            error={errors.firstRegistration}
            maxLength={10}
            testID="dd-registration"
          />
        </Card>
      </View>

      {sections.inspection || sections.inspectionExists ? (
        <View style={styles.group}>
          <SectionTitle>{it.documentDates.inspectionTitle}</SectionTitle>
          <Card>
            {sections.inspection ? (
              <>
                <TextField
                  label={it.setup.inspectionLast}
                  kind="date"
                  optional
                  hint={it.setup.inspectionLastHint}
                  value={values.lastInspectionOn}
                  onChangeText={(v) => patch({ lastInspectionOn: v })}
                  error={errors.lastInspectionOn}
                  maxLength={10}
                  testID="dd-inspection-last"
                />
                <TextField
                  label={it.setup.inspectionNextDoc}
                  kind="date"
                  optional
                  value={values.inspectionNextOn}
                  onChangeText={(v) => patch({ inspectionNextOn: v })}
                  error={errors.inspectionNextOn}
                  maxLength={10}
                  testID="dd-inspection-next"
                />
                <OfficialCheckRow check={OFFICIAL_CHECKS.inspection} plate={plate} />
              </>
            ) : (
              <Text variant="body" color="muted">
                {it.documentDates.alreadyThere}
              </Text>
            )}
          </Card>
        </View>
      ) : null}

      {sections.roadTax || sections.roadTaxExists ? (
        <View style={styles.group}>
          <SectionTitle>{it.documentDates.roadTaxTitle}</SectionTitle>
          <Card>
            {sections.roadTax ? (
              <>
                <ChoiceGroup<string>
                  label={it.setup.roadTaxMonth}
                  hint={it.setup.roadTaxHint}
                  value={values.paymentMonth === null ? null : String(values.paymentMonth)}
                  onChange={(v) => patch({ paymentMonth: Number(v) })}
                  options={it.setup.monthNames.map((name, i) => ({ value: String(i + 1), label: name }))}
                />
                <OfficialCheckRow check={OFFICIAL_CHECKS.road_tax} plate={plate} />
              </>
            ) : (
              <Text variant="body" color="muted">
                {it.documentDates.alreadyThere}
              </Text>
            )}
          </Card>
        </View>
      ) : null}

      <View style={styles.group}>
        <SectionTitle>{it.documentDates.insuranceTitle}</SectionTitle>
        <Card>
          {sections.policy ? (
            <>
              <Text variant="caption" color="muted">
                {it.documentDates.policyHint}
              </Text>
              <TextField
                label={it.documentDates.policyCompany}
                value={values.policyCompany}
                onChangeText={(v) => patch({ policyCompany: v })}
                error={errors.policyCompany}
                maxLength={80}
                testID="dd-policy-company"
              />
              <TextField
                label={it.documentDates.policyStart}
                kind="date"
                value={values.policyStartOn}
                onChangeText={(v) => patch({ policyStartOn: v })}
                error={errors.policyStartOn}
                maxLength={10}
                testID="dd-policy-start"
              />
              <TextField
                label={it.documentDates.policyEnd}
                kind="date"
                value={values.policyEndOn}
                onChangeText={(v) => patch({ policyEndOn: v })}
                error={errors.policyEndOn}
                maxLength={10}
                testID="dd-policy-end"
              />
            </>
          ) : (
            <Text variant="body" color="muted">
              {it.documentDates.policyAlreadyThere}
            </Text>
          )}
        </Card>
      </View>

      <Text variant="caption" color="muted">
        {it.setup.indicative}
      </Text>
    </Screen>
  );
}

/** Apre il sito ufficiale nel browser e mostra la targa selezionabile. L'app non invia nulla. */
function OfficialCheckRow({ check, plate }: { check: OfficialCheck; plate: string | null }): ReactNode {
  return (
    <View style={styles.check}>
      <ListRow
        icon="info"
        title={check.title}
        subtitle={check.subtitle}
        onPress={() => void Linking.openURL(check.url).catch(() => undefined)}
        testID={`official-check-${check.id}`}
      />
      {plate ? (
        <Text variant="label" color="muted" selectable>
          {it.documentDates.plateIs(plate)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  check: { gap: space.xs },
});
