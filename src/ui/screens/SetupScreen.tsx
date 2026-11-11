// S-04 "Imposta le scadenze" (SPEC 6.3.3): catalogo filtrato per alimentazione, "Quando l'hai fatto l'ultima volta?",
// regole italiane di revisione e bollo, riepilogo con semaforo per voce e invito ad attivare gli avvisi (S-05).
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '@/bootstrap';
import type { PermissionState } from '@/domain/ports';
import { formatDateIt } from '@/domain/units';
import { listSetupCatalog, setupDeadlines, type SetupDeadlinesResult, type SetupProposal } from '@/usecases/deadlines';
import { suggestLastDoneFromHistory, type LastDoneSuggestion } from '@/usecases/services';
import { getVehicle } from '@/usecases/vehicles';
import { Banner, Button, Card, CheckRow, ChoiceGroup, EmptyState, QueryBoundary, Screen, SectionTitle, StatusBadge, Text, TextField } from '../components';
import { enableNotifications } from '../hooks/notifications';
import { useBusy } from '../hooks/useBusy';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { describeError, describeThrown } from '../logic/errors';
import { iconOfState, labelOfState, toneOfState } from '../logic/status';
import {
  buildSetupInput,
  emptyAnswer,
  groupProposals,
  historyBacked,
  initialWizardState,
  selectedCount,
  type ItemAnswer,
  type LastDoneKind,
  type WizardErrors,
  type WizardState,
} from '../logic/setupWizard';
import { resetToToday } from '../navigation/actions';
import { routes } from '../navigation/routes';
import { space } from '../theme/tokens';

export interface SetupScreenProps {
  vehicleId: string;
  /** Primo avvio: a fine percorso si arriva a "Oggi". */
  first?: boolean;
}

export function SetupScreen({ vehicleId, first = false }: SetupScreenProps): ReactNode {
  const { deps } = useApp();
  const router = useRouter();
  const [result, setResult] = useState<SetupDeadlinesResult | null>(null);
  const query = useQuery(
    async (d) => {
      const catalog = await listSetupCatalog(d, vehicleId);
      if (!catalog.ok) return null;
      const vehicle = await getVehicle(d, vehicleId);
      if (!vehicle) return null;
      const history = await suggestLastDoneFromHistory(d, vehicleId);
      return { catalog: catalog.value, vehicle, history };
    },
    [vehicleId],
    it.common.loadError,
  );

  if (result) {
    return (
      <Screen
        footer={
          <>
            <Button label={it.setup.goToday} onPress={() => resetToToday(router)} />
            {first ? null : <Button label={it.setup.goVehicle} variant="secondary" onPress={() => router.back()} />}
          </>
        }
      >
        <Summary result={result} deps={deps} />
      </Screen>
    );
  }

  return (
    <QueryBoundary query={query}>
      {(data) =>
        data === null ? (
          <Screen>
            <EmptyState icon="car" title={it.common.notFoundTitle} message={it.vehicle.notFound} />
          </Screen>
        ) : (
          <Wizard
            vehicleId={vehicleId}
            vehicleName={data.vehicle.displayName}
            unit={data.vehicle.distanceUnit}
            proposals={data.catalog.proposals}
            history={data.history}
            onDone={setResult}
          />
        )
      }
    </QueryBoundary>
  );
}

interface WizardProps {
  vehicleId: string;
  vehicleName: string;
  unit: 'km' | 'mi';
  proposals: SetupProposal[];
  history: Record<string, LastDoneSuggestion>;
  onDone: (r: SetupDeadlinesResult) => void;
}

function Wizard({ vehicleId, vehicleName, unit, proposals, history, onDone }: WizardProps): ReactNode {
  const { deps } = useApp();
  const [state, setState] = useState<WizardState>(() => initialWizardState(proposals, history, unit));
  const fromHistory = historyBacked(proposals, history, unit);
  const hasHistory = Object.keys(fromHistory).length > 0;
  const [errors, setErrors] = useState<WizardErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const saving = useBusy();
  const groups = groupProposals(proposals);
  const count = selectedCount(state);

  // Il catalogo puo' cambiare mentre il wizard e' aperto (voci create altrove): le risposte nuove partono vuote.
  useEffect(() => {
    setState((s) => {
      const next = { ...s };
      for (const p of proposals) if (!next[p.templateId]) next[p.templateId] = emptyAnswer(p.preselected && p.existingItemId === null);
      return next;
    });
  }, [proposals]);

  const patch = (id: string, change: Partial<ItemAnswer>): void => {
    setState((s) => ({ ...s, [id]: { ...(s[id] ?? emptyAnswer(false)), ...change } }));
    setErrors((e) => ({ ...e, [id]: {} }));
  };

  const submit = (): void => {
    void saving.run(async () => {
      setFormError(null);
      const built = buildSetupInput(vehicleId, proposals, state, { today: deps.clock.todayLocal(), unit });
      if (!built.ok) {
        setErrors(built.errors);
        return;
      }
      if (built.input.items.length === 0) {
        setFormError(it.setup.nothingSelected);
        return;
      }
      try {
        const res = await setupDeadlines(deps, built.input);
        if (!res.ok) {
          setFormError(describeError(res.error).message);
          return;
        }
        onDone(res.value);
      } catch (e) {
        setFormError(describeThrown(e));
      }
    });
  };

  return (
    <Screen
      footer={
        <Button
          label={count > 0 ? it.setup.createCount(count) : it.setup.create}
          icon="check"
          disabled={count === 0}
          loading={saving.busy}
          onPress={submit}
        />
      }
    >
      <Text variant="body" color="muted">
        {it.setup.introFor(vehicleName)}
      </Text>
      {formError ? <Banner tone="danger" title={formError} /> : null}
      {hasHistory ? <Banner tone="info" title={it.setup.fromHistory} message={it.setup.fromHistoryHint} /> : null}

      {groups.map((g) => (
        <View key={g.category} style={styles.group}>
          <SectionTitle>{g.label}</SectionTitle>
          {g.items.map((p) => {
            const a = state[p.templateId] ?? emptyAnswer(false);
            const existing = p.existingItemId !== null;
            return (
              <Card key={p.templateId} selected={a.selected && !existing}>
                <CheckRow
                  label={p.name}
                  description={existing ? it.setup.alreadyThere : p.note}
                  checked={a.selected || existing}
                  disabled={existing}
                  onChange={(v) => patch(p.templateId, { selected: v })}
                />
                {a.selected && !existing ? (
                  <>
                    {fromHistory[p.templateId] ? (
                      <Text variant="label" color="info" testID={`setup-history-${p.templateId}`}>
                        {`${it.setup.fromHistory} · ${fromHistory[p.templateId]?.serviceTitle} del ${formatDateIt(fromHistory[p.templateId]?.doneOn ?? '')}`}
                      </Text>
                    ) : null}
                    <Question p={p} a={a} unit={unit} errors={errors[p.templateId] ?? {}} onChange={(change) => patch(p.templateId, change)} />
                  </>
                ) : null}
              </Card>
            );
          })}
        </View>
      ))}
      <Text variant="caption" color="muted">
        {it.setup.indicative}
      </Text>
      <Text variant="caption" color="muted">
        {it.setup.noInsuranceNote}
      </Text>
    </Screen>
  );
}

interface QuestionProps {
  p: SetupProposal;
  a: ItemAnswer;
  unit: 'km' | 'mi';
  errors: Partial<Record<'doneOn' | 'doneKm' | 'nextDueOn' | 'lastInspectionOn', string>>;
  onChange: (change: Partial<ItemAnswer>) => void;
}

function Question({ p, a, unit, errors, onChange }: QuestionProps): ReactNode {
  switch (p.question) {
    case 'last_done':
      return (
        <View style={styles.question}>
          <ChoiceGroup<LastDoneKind>
            label={it.setup.questionLastDone}
            value={a.lastDone}
            onChange={(v) => onChange({ lastDone: v })}
            options={[
              { value: 'done', label: it.setup.answerDone },
              { value: 'unknown', label: it.setup.answerUnknown },
              { value: 'never', label: it.setup.answerNever },
            ]}
            hint={a.lastDone === 'unknown' ? it.setup.unknownHint : undefined}
          />
          {a.lastDone === 'done' ? (
            <>
              <TextField label={it.setup.doneOn} kind="date" value={a.doneOn} onChangeText={(v) => onChange({ doneOn: v })} error={errors.doneOn} maxLength={10} />
              <TextField label={it.setup.doneKm} kind="km" optional suffix={unit} value={a.doneKm} onChangeText={(v) => onChange({ doneKm: v })} error={errors.doneKm} maxLength={9} />
            </>
          ) : null}
        </View>
      );
    case 'inspection':
      return (
        <View style={styles.question}>
          {p.suggestedDueOn ? (
            <Text variant="caption" color="muted">
              {it.setup.inspectionSuggested(formatDateIt(p.suggestedDueOn))}
            </Text>
          ) : null}
          <TextField
            label={it.setup.inspectionLast}
            kind="date"
            optional
            hint={it.setup.inspectionLastHint}
            value={a.lastInspectionOn}
            onChangeText={(v) => onChange({ lastInspectionOn: v })}
            error={errors.lastInspectionOn}
            maxLength={10}
          />
          <TextField label={it.setup.inspectionNextDoc} kind="date" optional value={a.nextDueOn} onChangeText={(v) => onChange({ nextDueOn: v })} error={errors.nextDueOn} maxLength={10} />
        </View>
      );
    case 'road_tax':
      return (
        <View style={styles.question}>
          <ChoiceGroup<string>
            label={it.setup.roadTaxMonth}
            hint={it.setup.roadTaxHint}
            value={a.paymentMonth === null ? null : String(a.paymentMonth)}
            onChange={(v) => onChange({ paymentMonth: Number(v) })}
            options={it.setup.monthNames.map((name, i) => ({ value: String(i + 1), label: name }))}
          />
          {p.suggestedDueOn ? (
            <Text variant="caption" color="muted">
              {it.setup.roadTaxSuggested(formatDateIt(p.suggestedDueOn))}
            </Text>
          ) : null}
        </View>
      );
    default:
      return (
        <View style={styles.question}>
          <TextField label={it.setup.nextDue} kind="date" optional hint={it.setup.nextDueHint} value={a.nextDueOn} onChangeText={(v) => onChange({ nextDueOn: v })} error={errors.nextDueOn} maxLength={10} />
        </View>
      );
  }
}

function Summary({ result, deps }: { result: SetupDeadlinesResult; deps: ReturnType<typeof useApp>['deps'] }): ReactNode {
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const asking = useBusy();

  useEffect(() => {
    let cancelled = false;
    deps.scheduler.getPermission().then(
      (p) => {
        if (!cancelled) setPermission(p);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [deps]);

  const ask = (): void => {
    void asking.run(async () => {
      try {
        const state = await enableNotifications(deps);
        setPermission(state);
        setNotice(state === 'granted' ? it.setup.notifyDone : it.setup.notifyDenied);
      } catch (e) {
        setNotice(describeThrown(e));
      }
    });
  };

  const showNotify = result.createdCount + result.existingCount > 0 && permission !== null && permission !== 'granted' && notice === null;

  return (
    <>
      <Text variant="largeTitle">{it.setup.summaryTitle}</Text>
      <Text variant="body" color="muted">
        {result.createdCount > 0 ? it.setup.summaryText(result.createdCount, result.toConfigureCount) : it.setup.summaryNoneNew}
      </Text>
      {result.items.map((item) => (
        <Card key={item.itemId}>
          <Text variant="bodyStrong">{item.name}</Text>
          <StatusBadge tone={toneOfState(item.state)} icon={iconOfState(item.state)} label={labelOfState(item.state)} />
          {item.effectiveDueOn ? (
            <Text variant="caption" color="muted">
              {`${it.deadlines.dueDate}: ${formatDateIt(item.effectiveDueOn)}`}
            </Text>
          ) : null}
          {item.warning ? (
            <Text variant="caption" color="muted">
              {item.warning}
            </Text>
          ) : null}
        </Card>
      ))}
      {showNotify ? (
        <Card tone="info">
          <Text variant="heading" color="info">
            {it.setup.notifyTitle}
          </Text>
          <Text variant="body" color="info">
            {it.setup.notifyText}
          </Text>
          <Button label={it.setup.notifyAction} icon="bell" loading={asking.busy} onPress={ask} />
        </Card>
      ) : null}
      {notice ? <Banner tone={permission === 'granted' ? 'ok' : 'info'} title={notice} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  question: { gap: space.md, marginTop: space.sm },
});
