// S-42 Nuova polizza, modifica e rinnovo (F-52, F-53, F-54, F-55): date come stampate sul certificato, premio e numero di rate
// con anteprima, garanzie, massimale e franchigia, contatti per il sinistro. Nessun rinnovo tacito: si rinnova solo da qui.
import { useRouter } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { useApp } from '@/bootstrap';
import {
  addPolicy,
  deletePolicy,
  getPolicy,
  renewPolicy,
  updatePolicy,
  type PolicyDetail,
} from '@/usecases/insurance';
import { getVehicle } from '@/usecases/vehicles';
import { Banner, Button, Card, CheckRow, ChoiceGroup, EmptyState, QueryBoundary, Screen, SectionTitle, SwitchRow, Text, TextField } from '../components';
import { useBusy } from '../hooks/useBusy';
import { useQuery } from '../hooks/useQuery';
import { useSnapshot } from '../hooks/useSnapshot';
import { it } from '../i18n/it';
import { describeError, describeThrown } from '../logic/errors';
import {
  buildAddPolicyInput,
  buildRenewInput,
  buildUpdatePolicyInput,
  coverageChoices,
  formForRenewal,
  formFromPolicy,
  initialPolicyForm,
  installmentOptions,
  installmentPreview,
  policyErrorField,
  policyKindOptions,
  previewRowText,
  toggleCoverage,
  togglePaidNo,
  type PolicyFormErrors,
  type PolicyFormValues,
} from '../logic/policyForm';
import { goBackOr } from '../navigation/actions';
import { routes } from '../navigation/routes';
import type { InstallmentCount } from '@/usecases/insurance';

export type PolicyFormMode = 'new' | 'edit' | 'renew';

interface Loaded {
  policy: PolicyDetail | null;
  notFound: boolean;
}

export function PolicyFormScreen({ vehicleId, mode, policyId }: { vehicleId: string; mode: PolicyFormMode; policyId?: string }): ReactNode {
  const query = useQuery<Loaded>(
    async (d) => {
      const vehicle = await getVehicle(d, vehicleId);
      const missing: Loaded = { policy: null, notFound: true };
      if (!vehicle) return missing;
      if (mode === 'new') return { policy: null, notFound: false };
      const policy = policyId ? await getPolicy(d, policyId) : null;
      return policy && policy.vehicleId === vehicleId ? { policy, notFound: false } : missing;
    },
    [vehicleId, mode, policyId],
    it.common.loadError,
  );
  const data = useSnapshot(query.data);
  return (
    <QueryBoundary query={{ ...query, data }}>
      {(loaded) =>
        loaded.notFound ? (
          <Screen>
            <EmptyState icon="shield" title={it.common.notFoundTitle} message={mode === 'new' ? it.vehicle.notFound : it.policy.notFound} />
          </Screen>
        ) : (
          <PolicyForm vehicleId={vehicleId} mode={mode} policy={loaded.policy} />
        )
      }
    </QueryBoundary>
  );
}

function PolicyForm({ vehicleId, mode, policy }: { vehicleId: string; mode: PolicyFormMode; policy: PolicyDetail | null }): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const today = deps.clock.todayLocal();
  const editing = mode === 'edit' && policy !== null;
  const initial = useRef<PolicyFormValues>(
    policy ? (mode === 'renew' ? formForRenewal(policy) : formFromPolicy(policy)) : initialPolicyForm(today),
  );
  const [values, setValues] = useState<PolicyFormValues>(initial.current);
  const [errors, setErrors] = useState<PolicyFormErrors>({});
  const [saved, setSaved] = useState<{ policy: PolicyDetail; estimated: boolean; renewed: boolean } | null>(null);
  const saving = useBusy();

  const patch = (p: Partial<PolicyFormValues>): void => setValues((v) => ({ ...v, ...p }));
  const clear = (...keys: (keyof PolicyFormErrors)[]): void => setErrors((e) => ({ ...e, ...Object.fromEntries(keys.map((k) => [k, undefined])), form: undefined }));
  const preview = installmentPreview(values);

  const save = (): void => {
    void saving.run(async () => {
      setErrors({});
      try {
        if (mode === 'edit' && policy) {
          const built = buildUpdatePolicyInput(policy.id, values, initial.current);
          if (!built.ok) return setErrors(built.errors);
          const res = await updatePolicy(deps, built.input);
          if (!res.ok) {
            const e = describeError(res.error);
            return setErrors({ [policyErrorField(e.field)]: e.message });
          }
          goBackOr(router, routes.policyDetail(vehicleId, policy.id));
          return;
        }
        if (mode === 'renew' && policy) {
          const built = buildRenewInput(policy.id, values);
          if (!built.ok) return setErrors(built.errors);
          const res = await renewPolicy(deps, built.input);
          if (!res.ok) {
            const e = describeError(res.error);
            return setErrors({ [policyErrorField(e.field)]: e.message });
          }
          setSaved({ policy: res.value.policy, estimated: res.value.endIsEstimated, renewed: true });
          return;
        }
        const built = buildAddPolicyInput(vehicleId, values);
        if (!built.ok) return setErrors(built.errors);
        const res = await addPolicy(deps, built.input);
        if (!res.ok) {
          const e = describeError(res.error);
          return setErrors({ [policyErrorField(e.field)]: e.message });
        }
        setSaved({ policy: res.value.policy, estimated: res.value.endIsEstimated, renewed: false });
      } catch (e) {
        setErrors({ form: describeThrown(e) });
      }
    });
  };

  const undoSaved = (): void => {
    if (!saved) return;
    void saving.run(async () => {
      try {
        const res = await deletePolicy(deps, saved.policy.id);
        if (res.ok) goBackOr(router, routes.policies(vehicleId));
        else setErrors({ form: describeError(res.error).message });
      } catch (e) {
        setErrors({ form: describeThrown(e) });
      }
    });
  };

  if (saved) {
    const p = saved.policy;
    return (
      <Screen
        footer={
          <>
            <Button label={it.policy.done} icon="check" testID="policy-done" onPress={() => goBackOr(router, routes.policies(vehicleId))} />
            <Button label={it.policy.undoSaved} icon="undo" variant="ghost" loading={saving.busy} onPress={undoSaved} />
          </>
        }
      >
        <Banner tone="ok" title={saved.renewed ? it.policy.savedRenewTitle : it.policy.savedTitle} message={`${p.kindLabel} · ${p.company}`} />
        {errors.form ? <Banner tone="danger" title={errors.form} /> : null}
        {saved.estimated ? <Banner tone="warning" title={it.policy.endEstimated} /> : null}
        <Card>
          <Text variant="body">{it.policy.reminderNote}</Text>
        </Card>
        {p.warningIt ? <Banner tone="info" title={p.warningIt} /> : null}
        <Text variant="caption" color="muted">
          {it.policy.verifyNote}
        </Text>
      </Screen>
    );
  }

  const title = mode === 'renew' ? it.policy.renewSave : editing ? it.policy.saveChanges : it.policy.save;
  return (
    <Screen footer={<Button label={title} icon="check" loading={saving.busy} testID="policy-save" onPress={save} />}>
      {mode === 'renew' ? (
        <Text variant="body" color="muted">
          {it.policy.renewHint}
        </Text>
      ) : null}
      {errors.form ? <Banner tone="danger" title={errors.form} /> : null}

      {mode === 'renew' ? null : <ChoiceGroup label={it.policy.kindLabel} options={policyKindOptions} value={values.kind} onChange={(k) => patch({ kind: k })} />}

      <TextField
        label={it.policy.companyLabel}
        value={values.company}
        onChangeText={(t) => {
          patch({ company: t });
          clear('company');
        }}
        error={errors.company ?? null}
        maxLength={80}
        testID="policy-company"
      />
      <TextField label={it.policy.agencyLabel} optional value={values.agency} onChangeText={(t) => patch({ agency: t })} maxLength={80} />
      <TextField label={it.policy.numberLabel} optional value={values.number} onChangeText={(t) => patch({ number: t })} maxLength={40} testID="policy-number" />

      <TextField
        label={it.policy.startLabel}
        kind="date"
        hint={it.policy.startHint}
        value={values.startOn}
        selectTextOnFocus
        onChangeText={(t) => {
          patch({ startOn: t });
          clear('startOn');
        }}
        error={errors.startOn ?? null}
        maxLength={10}
        testID="policy-start"
      />
      <TextField
        label={it.policy.endLabel}
        kind="date"
        optional
        hint={it.policy.endHint}
        value={values.endOn}
        onChangeText={(t) => {
          patch({ endOn: t });
          clear('endOn');
        }}
        error={errors.endOn ?? null}
        maxLength={10}
        testID="policy-end"
      />

      <TextField
        label={it.policy.premiumLabel}
        kind="money"
        suffix="€"
        optional
        hint={it.policy.premiumHint}
        value={values.premium}
        onChangeText={(t) => {
          patch({ premium: t });
          clear('premium');
        }}
        error={errors.premium ?? null}
        maxLength={12}
        testID="policy-premium"
      />
      <ChoiceGroup<string>
        label={it.policy.installmentsLabel}
        options={installmentOptions}
        value={String(values.installments)}
        onChange={(n) => patch({ installments: Number(n) as InstallmentCount, paidNos: [] })}
      />
      {preview.length > 0 ? (
        <Card testID="policy-preview">
          <Text variant="label" color="muted">
            {it.policy.previewTitle}
          </Text>
          {preview.map((i) => (
            <Text key={i.installmentNo} variant="body">
              {previewRowText(i, preview.length)}
            </Text>
          ))}
          {preview[0] && preview.length > 1 && preview[0].amountCents !== preview[1]?.amountCents ? (
            <Text variant="caption" color="muted">
              {it.policy.previewFirstExtra}
            </Text>
          ) : null}
          {!editing
            ? preview.map((i) => (
                <CheckRow
                  key={`paid-${i.installmentNo}`}
                  label={`${it.policy.alreadyPaid}: ${i.installmentNo}`}
                  checked={values.paidNos.includes(i.installmentNo)}
                  onChange={() => patch({ paidNos: togglePaidNo(values.paidNos, i.installmentNo) })}
                />
              ))
            : null}
        </Card>
      ) : null}

      <TextField
        label={it.policy.meritLabel}
        kind="integer"
        optional
        hint={it.policy.meritHint}
        value={values.meritClass}
        onChangeText={(t) => {
          patch({ meritClass: t });
          clear('meritClass');
        }}
        error={errors.meritClass ?? null}
        maxLength={2}
      />
      <SwitchRow label={it.policy.blackBox} value={values.blackBox} onChange={(b) => patch({ blackBox: b })} />

      <SectionTitle>{it.policy.coveragesTitle}</SectionTitle>
      <Text variant="caption" color="muted">
        {it.policy.coveragesHint}
      </Text>
      {coverageChoices.map((c) => (
        <CheckRow key={c.code} label={c.label} checked={values.coverages.includes(c.code)} onChange={() => patch({ coverages: toggleCoverage(values.coverages, c.code) })} />
      ))}
      <TextField
        label={it.policy.limitLabel}
        kind="money"
        suffix="€"
        optional
        value={values.limit}
        onChangeText={(t) => {
          patch({ limit: t });
          clear('limit');
        }}
        error={errors.limit ?? null}
        maxLength={14}
      />
      <TextField
        label={it.policy.deductibleLabel}
        kind="money"
        suffix="€"
        optional
        value={values.deductible}
        onChangeText={(t) => {
          patch({ deductible: t });
          clear('deductible');
        }}
        error={errors.deductible ?? null}
        maxLength={12}
      />

      <SectionTitle>{it.policy.contactsTitle}</SectionTitle>
      <TextField label={it.policy.claimsPhone} optional value={values.claimsPhone} onChangeText={(t) => patch({ claimsPhone: t })} maxLength={30} />
      <TextField
        label={it.policy.claimsEmail}
        optional
        value={values.claimsEmail}
        onChangeText={(t) => {
          patch({ claimsEmail: t });
          clear('claimsEmail');
        }}
        error={errors.claimsEmail ?? null}
        maxLength={120}
      />
      <TextField label={it.policy.assistancePhone} optional value={values.assistancePhone} onChangeText={(t) => patch({ assistancePhone: t })} maxLength={30} />
      <TextField label={it.policy.agentName} optional value={values.agentName} onChangeText={(t) => patch({ agentName: t })} maxLength={80} />
      <TextField label={it.policy.agentPhone} optional value={values.agentPhone} onChangeText={(t) => patch({ agentPhone: t })} maxLength={30} />
      <TextField
        label={it.policy.agentEmail}
        optional
        value={values.agentEmail}
        onChangeText={(t) => {
          patch({ agentEmail: t });
          clear('agentEmail');
        }}
        error={errors.agentEmail ?? null}
        maxLength={120}
      />
      <TextField label={it.policy.notesLabel} optional multiline value={values.notes} onChangeText={(t) => patch({ notes: t })} maxLength={500} />
      <Text variant="caption" color="muted">
        {it.policy.verifyNote}
      </Text>
    </Screen>
  );
}
