// S-20 Nuovo intervento, S-21 «Cosa hai fatto?» e risultato: tipo (chip), data, km, officina, totale, righe, cambio olio e
// revisione; dopo il salvataggio si scelgono le scadenze aggiornate e si legge il prossimo intervallo. Modifica inclusa.
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '@/bootstrap';
import { formatDistance } from '@/domain/units';
import { isOdometerConflict, type OdometerConflictError } from '@/usecases/odometer';
import {
  addServiceRecord,
  deleteServiceRecord,
  getServiceRecord,
  listWorkshops,
  setServiceCompletions,
  suggestItemsForLines,
  updateServiceRecord,
  type ServiceCompletionInfo,
  type ServiceItemSuggestion,
  type ServiceRecordDetail,
  type Workshop,
} from '@/usecases/services';
import { getVehicle } from '@/usecases/vehicles';
import {
  Banner,
  Button,
  Card,
  CheckRow,
  ChoiceGroup,
  EmptyState,
  OdometerConflictSheet,
  QueryBoundary,
  Screen,
  SectionTitle,
  SwitchRow,
  Text,
  TextField,
} from '../components';
import { useBusy } from '../hooks/useBusy';
import { useQuery } from '../hooks/useQuery';
import { useSnapshot } from '../hooks/useSnapshot';
import { it } from '../i18n/it';
import { describeError, describeThrown } from '../logic/errors';
import {
  NEW_WORKSHOP,
  applyPreset,
  availableLinePresets,
  buildAddServiceInput,
  buildUpdateServicePatch,
  customLine,
  formFromRecord,
  initialServiceForm,
  inspectionOptions,
  isInspection,
  lineFromPreset,
  preselectedIds,
  presetById,
  serviceErrorField,
  servicePresetOptions,
  suggestionDescription,
  suggestionLines,
  supportsOil,
  toggleId,
  type ServiceFormErrors,
  type ServiceFormValues,
} from '../logic/serviceForm';
import { goBackOr } from '../navigation/actions';
import { routes } from '../navigation/routes';
import { space } from '../theme/tokens';

interface Loaded {
  unit: 'km' | 'mi';
  currentKm: number | null;
  workshops: Workshop[];
  record: ServiceRecordDetail | null;
  notFound: boolean;
}

export interface ServiceFormScreenProps {
  vehicleId: string;
  /** Se c'e', si modifica quell'intervento. */
  recordId?: string;
  /** Chip gia' scelto (per esempio 'oil' da «Cambio olio»). */
  preset?: string;
}

export function ServiceFormScreen({ vehicleId, recordId, preset }: ServiceFormScreenProps): ReactNode {
  const query = useQuery<Loaded>(
    async (d) => {
      const vehicle = await getVehicle(d, vehicleId);
      const missing: Loaded = { unit: 'km', currentKm: null, workshops: [], record: null, notFound: true };
      if (!vehicle) return missing;
      const workshops = await listWorkshops(d, { order: 'recent' });
      if (recordId) {
        const record = await getServiceRecord(d, recordId);
        return record && record.vehicleId === vehicleId
          ? { unit: vehicle.distanceUnit, currentKm: null, workshops, record, notFound: false }
          : missing;
      }
      return { unit: vehicle.distanceUnit, currentKm: vehicle.currentKm?.km ?? null, workshops, record: null, notFound: false };
    },
    [vehicleId, recordId],
    it.common.loadError,
  );
  const data = useSnapshot(query.data);
  return (
    <QueryBoundary query={{ ...query, data }}>
      {(loaded) =>
        loaded.notFound ? (
          <Screen>
            <EmptyState icon="car" title={it.common.notFoundTitle} message={recordId ? it.service.notFound : it.vehicle.notFound} />
          </Screen>
        ) : (
          <ServiceFlow vehicleId={vehicleId} preset={preset} {...loaded} />
        )
      }
    </QueryBoundary>
  );
}

interface Outcome {
  record: ServiceRecordDetail;
  warnings: string[];
  kmIgnored: boolean;
  repeatReminder: boolean;
  isNew: boolean;
}

type Phase =
  | { name: 'form' }
  | ({ name: 'choose'; suggestions: ServiceItemSuggestion[]; selected: string[] } & Outcome)
  | ({ name: 'done'; completions: ServiceCompletionInfo[] } & Outcome);

function ServiceFlow({ vehicleId, preset, unit, currentKm, workshops, record }: { vehicleId: string; preset?: string } & Loaded): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const today = deps.clock.todayLocal();
  const editing = record !== null;
  const initial = useMemo<ServiceFormValues>(
    () => (record ? formFromRecord(record, unit) : initialServiceForm({ today, km: currentKm, unit }, preset && presetById(preset) ? preset : null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record, unit, currentKm, preset],
  );
  const original = useRef(initial);
  const [values, setValues] = useState<ServiceFormValues>(initial);
  const [errors, setErrors] = useState<ServiceFormErrors>({});
  const [conflict, setConflict] = useState<OdometerConflictError | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'form' });
  const working = useBusy();

  const patch = (p: Partial<ServiceFormValues>): void => setValues((v) => ({ ...v, ...p }));
  const clear = (...keys: (keyof ServiceFormErrors)[]): void => setErrors((e) => ({ ...e, ...Object.fromEntries(keys.map((k) => [k, undefined])), form: undefined }));

  const loadSuggestions = async (r: ServiceRecordDetail): Promise<ServiceItemSuggestion[]> =>
    suggestItemsForLines(deps, vehicleId, suggestionLines(r), {
      kind: r.kind,
      title: r.title,
      inspectionResult: r.inspectionResult,
      serviceOn: r.serviceOn,
      excludeRecordId: r.id,
    });

  const save = (choice: 'plain' | 'skip-km' | 'ignore-previous' = 'plain'): void => {
    void working.run(async () => {
      setErrors({});
      const ctx = { today, unit };
      const conflictChoice = choice === 'skip-km' ? ({ onOdometerConflict: 'skip_km' } as const) : choice === 'ignore-previous' ? ({ onOdometerConflict: 'ignore_conflicting' } as const) : {};
      try {
        let res;
        if (record) {
          const built = buildUpdateServicePatch(values, original.current, ctx);
          if (!built.ok) return setErrors(built.errors);
          res = await updateServiceRecord(deps, record.id, { ...built.input, ...conflictChoice });
        } else {
          const built = buildAddServiceInput(vehicleId, values, ctx);
          if (!built.ok) return setErrors(built.errors);
          res = await addServiceRecord(deps, { ...built.input, ...conflictChoice });
        }
        if (res.ok) {
          setConflict(null);
          const r = res.value;
          const outcome: Outcome = {
            record: r.record,
            warnings: r.warnings.map((w) => w.message),
            kmIgnored: r.kmIgnored,
            repeatReminder: r.repeatReminderId !== null,
            isNew: !editing,
          };
          if (editing) {
            setPhase({ name: 'done', completions: r.completions, ...outcome });
            return;
          }
          const suggestions = await loadSuggestions(r.record);
          if (suggestions.length === 0) setPhase({ name: 'done', completions: r.completions, ...outcome });
          else setPhase({ name: 'choose', suggestions, selected: preselectedIds(suggestions), ...outcome });
          return;
        }
        if (isOdometerConflict(res.error)) {
          setConflict(res.error);
          return;
        }
        const e = describeError(res.error);
        setErrors({ [serviceErrorField(e.field)]: e.message });
      } catch (e) {
        setErrors({ form: describeThrown(e) });
      }
    });
  };

  const openChoose = (p: Phase & { name: 'done' }): void => {
    void working.run(async () => {
      try {
        const suggestions = await loadSuggestions(p.record);
        setPhase({ ...p, name: 'choose', suggestions, selected: p.completions.map((c) => c.itemId) });
      } catch (e) {
        setErrors({ form: describeThrown(e) });
      }
    });
  };

  const confirmChoose = (p: Phase & { name: 'choose' }): void => {
    void working.run(async () => {
      try {
        const res = await setServiceCompletions(deps, p.record.id, p.selected);
        if (!res.ok) return setErrors({ form: describeError(res.error).message });
        setPhase({ ...p, name: 'done', completions: res.value.completions, warnings: [...p.warnings, ...res.value.warnings.map((w) => w.message)] });
      } catch (e) {
        setErrors({ form: describeThrown(e) });
      }
    });
  };

  const undoSaved = (r: ServiceRecordDetail): void => {
    void working.run(async () => {
      try {
        const res = await deleteServiceRecord(deps, r.id);
        if (res.ok) goBackOr(router, routes.serviceList(vehicleId));
        else setErrors({ form: describeError(res.error).message });
      } catch (e) {
        setErrors({ form: describeThrown(e) });
      }
    });
  };

  const finish = (): void => goBackOr(router, routes.serviceList(vehicleId));

  // ------------------------------------------------------------ S-21 «Cosa hai fatto?»
  if (phase.name === 'choose') {
    const p = phase;
    return (
      <Screen
        footer={<Button label={it.service.whatConfirm(p.selected.length)} icon="check" loading={working.busy} testID="service-what-confirm" onPress={() => confirmChoose(p)} />}
      >
        <Banner tone="ok" title={editing ? it.service.savedChangesTitle : it.service.savedTitle} message={p.record.title} />
        {errors.form ? <Banner tone="danger" title={errors.form} /> : null}
        <Text variant="title">{it.service.whatTitle}</Text>
        <Text variant="body" color="muted">
          {it.service.whatIntro}
        </Text>
        {p.record.inspectionNotice ? <Banner tone="info" title={p.record.inspectionNotice} /> : null}
        {p.suggestions.map((s) => (
          <Card key={s.itemId} selected={p.selected.includes(s.itemId)}>
            <CheckRow
              label={s.name}
              description={suggestionDescription(s)}
              checked={p.selected.includes(s.itemId)}
              onChange={() => setPhase({ ...p, selected: toggleId(p.selected, s.itemId) })}
            />
            {s.preselected ? (
              <Text variant="caption" color="info">
                {it.service.whatSuggested}
              </Text>
            ) : null}
          </Card>
        ))}
      </Screen>
    );
  }

  // ------------------------------------------------------------ risultato con il prossimo intervallo
  if (phase.name === 'done') {
    const p = phase;
    return (
      <Screen
        footer={
          <>
            <Button label={it.service.done} icon="check" testID="service-done" onPress={finish} />
            <Button label={it.service.whatChange} variant="secondary" loading={working.busy} onPress={() => openChoose(p)} />
            {p.isNew ? <Button label={it.service.undoSaved} icon="undo" variant="ghost" loading={working.busy} onPress={() => undoSaved(p.record)} /> : null}
          </>
        }
      >
        <Banner tone="ok" title={p.isNew ? it.service.savedTitle : it.service.savedChangesTitle} message={p.record.title} />
        {errors.form ? <Banner tone="danger" title={errors.form} /> : null}
        <SectionTitle>{it.service.nextTitle}</SectionTitle>
        {p.completions.length === 0 ? (
          <Card>
            <Text variant="body" color="muted">
              {it.service.nextNone}
            </Text>
          </Card>
        ) : (
          p.completions.map((c, i) => (
            <Card key={c.completionId} testID={`service-next-${i}`}>
              <Text variant="heading">{c.itemName}</Text>
              <Text variant="body">{c.nextText ?? it.service.nextNone}</Text>
            </Card>
          ))
        )}
        {p.record.inspectionNotice ? <Banner tone="info" title={p.record.inspectionNotice} /> : null}
        {p.repeatReminder ? <Banner tone="warning" title={it.service.repeatReminder} /> : null}
        {p.kmIgnored ? <Banner tone="warning" title={it.service.warningTitle} message={it.km.conflictSkipKmHint} /> : null}
        {p.warnings.length > 0 ? <Banner tone="warning" title={it.service.warningTitle} message={p.warnings.join(' ')} /> : null}
      </Screen>
    );
  }

  // ------------------------------------------------------------ modulo
  const workshopOptions = [
    { value: '', label: it.service.workshopNone },
    ...workshops.slice(0, 6).map((w) => ({ value: w.id, label: w.name })),
    ...(record?.workshop && !workshops.some((w) => w.id === record.workshop?.id) ? [{ value: record.workshop.id, label: record.workshop.name }] : []),
    { value: NEW_WORKSHOP, label: it.service.workshopNew },
  ];
  const presets = availableLinePresets(values.lines);
  const lineChoices = [...presets.map((p) => ({ value: p.description, label: p.description })), { value: '__custom', label: it.service.customLine }];

  return (
    <Screen
      footer={<Button label={editing ? it.service.saveChanges : it.service.save} icon="check" loading={working.busy} testID="service-save" onPress={() => save()} />}
    >
      {!editing ? (
        <Text variant="body" color="muted">
          {it.service.intro}
        </Text>
      ) : null}
      {errors.form ? <Banner tone="danger" title={errors.form} /> : null}

      <ChoiceGroup
        label={it.service.typeLabel}
        options={servicePresetOptions}
        value={values.presetId}
        onChange={(id) => {
          setValues((v) => applyPreset(v, id));
          clear('type', 'inspection');
        }}
        error={errors.type ?? null}
      />
      <TextField label={it.service.titleLabel} optional value={values.title} onChangeText={(t) => patch({ title: t })} maxLength={120} testID="service-title" />

      {isInspection(values) ? (
        <ChoiceGroup
          label={it.service.inspectionLabel}
          options={inspectionOptions}
          value={values.inspectionResult}
          onChange={(r) => {
            patch({ inspectionResult: r });
            clear('inspection');
          }}
          error={errors.inspection ?? null}
        />
      ) : null}

      <TextField
        label={it.service.dateLabel}
        kind="date"
        value={values.date}
        selectTextOnFocus
        onChangeText={(t) => {
          patch({ date: t });
          clear('date');
        }}
        error={errors.date ?? null}
        maxLength={10}
        testID="service-date"
      />
      <TextField
        label={it.service.kmLabel}
        kind="km"
        suffix={unit}
        value={values.km}
        selectTextOnFocus
        onChangeText={(t) => {
          patch({ km: t });
          clear('km');
        }}
        error={errors.km ?? null}
        hint={!editing && currentKm !== null ? it.service.kmHint(formatDistance(currentKm, unit)) : it.service.kmHintNone}
        maxLength={9}
        optional
        testID="service-km"
      />

      <ChoiceGroup
        label={it.service.workshopLabel}
        options={workshopOptions}
        value={values.workshop}
        onChange={(w) => {
          patch({ workshop: w });
          clear('workshop');
        }}
      />
      {values.workshop === NEW_WORKSHOP ? (
        <TextField
          label={it.service.workshopNameLabel}
          value={values.newWorkshop}
          onChangeText={(t) => {
            patch({ newWorkshop: t });
            clear('workshop');
          }}
          error={errors.workshop ?? null}
          maxLength={80}
          testID="service-workshop-name"
        />
      ) : null}

      <TextField
        label={it.service.totalLabel}
        kind="money"
        suffix="€"
        value={values.total}
        onChangeText={(t) => {
          patch({ total: t });
          clear('total');
        }}
        error={errors.total ?? null}
        hint={it.service.totalHint}
        maxLength={12}
        optional
        testID="service-total"
      />

      {supportsOil(values) ? (
        <Card>
          <SwitchRow label={it.service.oilSwitch} description={it.service.oilSwitchHint} value={values.oilOn} onChange={(on) => patch({ oilOn: on })} />
          {values.oilOn ? (
            <View style={styles.stack}>
              <TextField
                label={it.service.oilSpec}
                optional
                hint={it.service.oilSpecHint}
                value={values.oilSpec}
                onChangeText={(t) => patch({ oilSpec: t })}
                maxLength={100}
                testID="service-oil-spec"
              />
              <TextField
                label={it.service.oilLitres}
                kind="money"
                suffix="L"
                optional
                value={values.oilLitres}
                onChangeText={(t) => {
                  patch({ oilLitres: t });
                  clear('oilLitres');
                }}
                error={errors.oilLitres ?? null}
                maxLength={7}
                testID="service-oil-litres"
              />
              <SwitchRow label={it.service.oilFilter} value={values.oilFilter} onChange={(f) => patch({ oilFilter: f })} />
            </View>
          ) : null}
        </Card>
      ) : null}

      <SectionTitle>{it.service.linesTitle}</SectionTitle>
      <Text variant="caption" color="muted">
        {it.service.linesHint}
      </Text>
      {values.lines.map((l) => {
        const e = errors.lines?.[l.key] ?? {};
        return (
          <Card key={l.key}>
            <TextField
              label={it.service.lineDescription}
              value={l.description}
              onChangeText={(t) => setValues((v) => ({ ...v, lines: v.lines.map((x) => (x.key === l.key ? { ...x, description: t } : x)) }))}
              error={e.description ?? null}
              maxLength={200}
            />
            <TextField
              label={it.service.lineAmount}
              kind="money"
              suffix="€"
              optional
              value={l.amount}
              onChangeText={(t) => setValues((v) => ({ ...v, lines: v.lines.map((x) => (x.key === l.key ? { ...x, amount: t } : x)) }))}
              error={e.amount ?? null}
              maxLength={12}
            />
            <Button
              label={it.service.lineRemove}
              icon="trash"
              variant="ghost"
              onPress={() => setValues((v) => ({ ...v, lines: v.lines.filter((x) => x.key !== l.key) }))}
            />
          </Card>
        );
      })}
      <ChoiceGroup<string>
        label={it.service.addLineTitle}
        options={lineChoices}
        value={null}
        onChange={(choice) => {
          if (choice === '__custom') setValues((v) => ({ ...v, lines: [...v.lines, customLine()] }));
          else {
            const p = presets.find((x) => x.description === choice);
            if (p) setValues((v) => ({ ...v, lines: [...v.lines, lineFromPreset(p)] }));
          }
        }}
      />

      <SectionTitle>{it.service.moreTitle}</SectionTitle>
      <TextField label={it.service.invoiceLabel} optional value={values.invoice} onChangeText={(t) => patch({ invoice: t })} maxLength={40} />
      <TextField
        label={it.service.warrantyLabel}
        kind="date"
        optional
        value={values.warrantyUntil}
        onChangeText={(t) => {
          patch({ warrantyUntil: t });
          clear('warranty');
        }}
        error={errors.warranty ?? null}
        maxLength={10}
      />
      <TextField label={it.service.notesLabel} optional multiline value={values.notes} onChangeText={(t) => patch({ notes: t })} maxLength={1000} />

      <OdometerConflictSheet
        conflict={conflict}
        unit={unit}
        busy={working.busy}
        onFix={() => setConflict(null)}
        onSkipKm={() => save('skip-km')}
        onIgnorePrevious={() => save('ignore-previous')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md, marginTop: space.md },
});
