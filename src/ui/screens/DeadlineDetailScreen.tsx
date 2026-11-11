// S-31 Dettaglio scadenza: stato, regola, base di calcolo, storico e azioni Fatto / Rimanda / Salta (con Annulla).
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useApp } from '@/bootstrap';
import type { DistanceUnit } from '@/domain/units';
import { formatDateIt, formatDistance } from '@/domain/units';
import { clearSnooze, completeDeadline, reopenReminder, skipDeadline, snoozeDeadline, undoCompletion, utcIsoToLocal } from '@/usecases/deadlines';
import { getDeadlineDetail, type DeadlineDetail } from '@/usecases/queries';
import { getVehicle } from '@/usecases/vehicles';
import { Banner, Button, Card, ConfirmSheet, EmptyState, ListRow, QueryBoundary, Screen, SectionTitle, Sheet, StatusBadge, Text, TextField } from '../components';
import { useBusy } from '../hooks/useBusy';
import { useQuery } from '../hooks/useQuery';
import { it } from '../i18n/it';
import { completionSourceLabel, isMissingKmField, parseDoneForm, SNOOZE_OPTIONS, snoozeMessage, type DoneForm, type DoneFormErrors } from '../logic/deadlineActions';
import { officialCheckForTemplate } from '../logic/documentDates';
import { describeError, describeThrown } from '../logic/errors';
import { rowDetail } from '../logic/status';
import { routes } from '../navigation/routes';
import { space } from '../theme/tokens';

interface Outcome {
  text: string;
  /** Annulla l'azione appena fatta; assente se non si puo'. */
  undo: (() => Promise<unknown>) | null;
}

export interface DeadlineDetailScreenProps {
  deadlineId: string;
  /** Apre subito il foglio "Fatto" o "Rimanda". */
  action?: string;
}

export function DeadlineDetailScreen({ deadlineId, action }: DeadlineDetailScreenProps): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const query = useQuery(
    async (d) => {
      const res = await getDeadlineDetail(d, deadlineId);
      if (!res.ok) return null;
      const vehicle = await getVehicle(d, res.value.row.vehicleId);
      const snoozedOn = res.value.row.snoozedUntil ? utcIsoToLocal(res.value.row.snoozedUntil, d.clock) : null;
      return { detail: res.value, unit: vehicle?.distanceUnit ?? ('km' as DistanceUnit), snoozedOn };
    },
    [deadlineId],
    it.common.loadError,
  );
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const undoing = useBusy();

  const undo = (): void => {
    const fn = outcome?.undo;
    if (!fn) return;
    void undoing.run(async () => {
      try {
        await fn();
      } finally {
        setOutcome(null);
        query.reload();
      }
    });
  };

  const outcomeBanner = outcome ? (
    <>
      <Banner tone="ok" title={outcome.text} actionLabel={outcome.undo ? it.common.undo : undefined} onAction={undo} />
      <Button label={it.common.close} variant="secondary" onPress={() => router.back()} />
    </>
  ) : null;

  return (
    <Screen onRefresh={query.reload} refreshing={false}>
      <QueryBoundary query={query}>
        {(data) => {
          if (data === null) {
            return outcome ? outcomeBanner : <EmptyState icon="calendar" title={it.common.notFoundTitle} message={it.common.notFound} />;
          }
          return (
            <>
              {outcomeBanner}
              <DetailBody
                detail={data.detail}
                unit={data.unit}
                snoozedOn={data.snoozedOn}
                action={action}
                onOutcome={setOutcome}
                onGoKm={() => router.push(routes.vehicleKm(data.detail.row.vehicleId))}
              />
            </>
          );
        }}
      </QueryBoundary>
    </Screen>
  );
}

type SheetName = 'none' | 'done' | 'snooze' | 'skip';

interface DetailBodyProps {
  detail: DeadlineDetail;
  unit: DistanceUnit;
  snoozedOn: { date: string; time: string } | null;
  action?: string;
  onOutcome: (o: Outcome | null) => void;
  onGoKm: () => void;
}

function DetailBody({ detail, unit, snoozedOn, action, onOutcome, onGoKm }: DetailBodyProps): ReactNode {
  const { deps } = useApp();
  const { row } = detail;
  const officialCheck = officialCheckForTemplate(row.templateId);
  const today = deps.clock.todayLocal();
  const reminderId = row.reminderId;
  const initial: SheetName = action === 'fatto' ? 'done' : action === 'rimanda' && reminderId ? 'snooze' : 'none';
  const [sheet, setSheet] = useState<SheetName>(initial);
  const [form, setForm] = useState<DoneForm>({ date: formatDateIt(today), km: '', notes: '' });
  const [formErrors, setFormErrors] = useState<DoneFormErrors>({});
  const [conflict, setConflict] = useState(false);
  const [snoozeError, setSnoozeError] = useState<{ message: string; needsKm: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const work = useBusy();
  const history = detail.history;

  const reminderOnly = reminderId !== null;

  const submitDone = (skipKm: boolean): void => {
    void work.run(async () => {
      setError(null);
      const parsed = parseDoneForm(form, { today, unit });
      if (!parsed.ok) {
        setFormErrors(parsed.errors);
        return;
      }
      setFormErrors({});
      try {
        const target = reminderId ? { reminderId } : { itemId: row.itemId ?? undefined };
        const res = await completeDeadline(deps, {
          ...target,
          doneOn: parsed.input.doneOn,
          doneKm: parsed.input.doneKm,
          notes: parsed.input.notes,
          onOdometerConflict: skipKm ? 'skip_km' : 'fail',
        });
        if (res.ok) {
          setSheet('none');
          setConflict(false);
          const next = res.value.next?.effectiveDueOn ?? null;
          const completionId = res.value.completionId;
          onOutcome({
            text: next ? `${it.deadlines.doneSaved} ${it.deadlines.doneNext(formatDateIt(next))}` : it.deadlines.doneSaved,
            undo: completionId ? () => undoCompletion(deps, completionId) : null,
          });
          return;
        }
        if (res.error.code === 'ODO_NON_MONOTONIC') {
          // km incoerenti con le letture vicine: finestra a scelte (correggi / salva senza aggiornare i km)
          setConflict(true);
          return;
        }
        const e = describeError(res.error);
        if (e.field === 'date') setFormErrors({ date: e.message });
        else if (e.field === 'doneKm' || e.field === 'km') setFormErrors({ km: e.message });
        else setError(e.message);
      } catch (e) {
        setError(describeThrown(e));
      }
    });
  };

  const submitSnooze = (choice: (typeof SNOOZE_OPTIONS)[number]['choice']): void => {
    if (!reminderId) return;
    void work.run(async () => {
      setSnoozeError(null);
      try {
        const res = await snoozeDeadline(deps, { reminderId, choice });
        if (!res.ok) {
          const e = describeError(res.error);
          setSnoozeError({ message: isMissingKmField(e.field) ? it.deadlines.snoozeNeedsKm : e.message, needsKm: isMissingKmField(e.field) });
          return;
        }
        setSheet('none');
        onOutcome({ text: snoozeMessage(res.value, unit), undo: () => clearSnooze(deps, reminderId) });
      } catch (e) {
        setSnoozeError({ message: describeThrown(e), needsKm: false });
      }
    });
  };

  const submitSkip = (): void => {
    if (!reminderId) return;
    void work.run(async () => {
      try {
        const res = await skipDeadline(deps, reminderId);
        setSheet('none');
        if (!res.ok) {
          setError(describeError(res.error).message);
          return;
        }
        onOutcome({ text: it.deadlines.skipped, undo: () => reopenReminder(deps, reminderId) });
      } catch (e) {
        setSheet('none');
        setError(describeThrown(e));
      }
    });
  };

  const clearRemind = (): void => {
    if (!reminderId) return;
    void work.run(async () => {
      const res = await clearSnooze(deps, reminderId);
      if (!res.ok) setError(describeError(res.error).message);
      else onOutcome({ text: it.deadlines.snoozeCleared, undo: null });
    });
  };

  return (
    <>
      {error ? <Banner tone="danger" title={error} /> : null}

      <Card>
        <Text variant="title">{row.title}</Text>
        <Text variant="caption" color="muted">
          {row.vehicleLabel}
        </Text>
        <StatusBadge tone={row.tone} icon={row.icon} label={row.label} />
        <Text variant="body">{rowDetail(row)}</Text>
        {row.snoozed ? (
          <Text variant="body" color="muted">
            {snoozedOn ? it.deadlines.snoozedUntil(`${formatDateIt(snoozedOn.date)} ${snoozedOn.time}`) : it.deadlines.actionSnooze}
          </Text>
        ) : null}
      </Card>

      <View style={styles.actions}>
        <Button label={it.deadlines.actionDone} icon="check" onPress={() => setSheet('done')} />
        {reminderOnly ? (
          row.snoozed ? (
            <Button label={it.deadlines.actionClearSnooze} icon="undo" variant="secondary" onPress={clearRemind} loading={work.busy} />
          ) : (
            <Button label={it.deadlines.actionSnooze} icon="clock" variant="secondary" onPress={() => setSheet('snooze')} />
          )
        ) : null}
        {reminderOnly ? <Button label={it.deadlines.actionSkip} icon="skip" variant="ghost" onPress={() => setSheet('skip')} /> : null}
      </View>

      {row.reasons.length > 0 ? <Banner tone="info" title={it.deadlines.reasons} message={row.reasons.map((r) => r.message).join(' ')} /> : null}
      {detail.row.kind === 'item' && row.state === 'unknown' ? <Text variant="body" color="muted">{it.deadlines.notConfigured}</Text> : null}

      {officialCheck ? (
        <ListRow
          icon="info"
          title={officialCheck.title}
          subtitle={officialCheck.subtitle}
          onPress={() => void Linking.openURL(officialCheck.url).catch(() => undefined)}
          testID="official-check"
        />
      ) : null}

      {row.legal ? (
        <Card tone="info">
          <Text variant="heading" color="info">
            {it.deadlines.legalTitle}
          </Text>
          <Text variant="body" color="info">
            {row.legal.warning}
          </Text>
          {row.legal.verifiedOn ? (
            <Text variant="caption" color="info">
              {it.deadlines.legalVerified(formatDateIt(row.legal.verifiedOn))}
            </Text>
          ) : null}
          {row.legal.sources.map((s) => (
            <ListRow key={s.url} title={s.label} subtitle={it.deadlines.legalOpen} onPress={() => void Linking.openURL(s.url).catch(() => undefined)} />
          ))}
        </Card>
      ) : null}

      {detail.rule ? <InfoBlock title={it.deadlines.rule} text={detail.rule.text} /> : null}
      {detail.basis.text ? <InfoBlock title={it.deadlines.basis} text={detail.basis.text} /> : null}
      {detail.forecast ? <InfoBlock title={it.deadlines.forecast} text={detail.forecast.text} /> : null}
      {detail.notes ? <InfoBlock title={it.deadlines.notes} text={detail.notes} /> : null}

      <SectionTitle>{it.deadlines.history}</SectionTitle>
      {history.length === 0 ? (
        <Text variant="body" color="muted">
          {it.deadlines.historyEmpty}
        </Text>
      ) : (
        history.map((h) => (
          <ListRow
            key={h.id}
            title={h.doneKm !== null ? `${formatDateIt(h.doneOn)} · ${formatDistance(h.doneKm, unit)}` : formatDateIt(h.doneOn)}
            subtitle={[completionSourceLabel(h.source), h.notes].filter(Boolean).join(' · ')}
          />
        ))
      )}

      <Sheet visible={sheet === 'done' && !conflict} title={it.deadlines.doneTitle} message={it.deadlines.doneText} onClose={() => setSheet('none')}>
        <TextField label={it.deadlines.doneDate} kind="date" value={form.date} onChangeText={(v) => setForm((f) => ({ ...f, date: v }))} error={formErrors.date} maxLength={10} />
        <TextField label={it.deadlines.doneKm} kind="km" optional suffix={unit} value={form.km} onChangeText={(v) => setForm((f) => ({ ...f, km: v }))} error={formErrors.km} maxLength={9} />
        <TextField label={it.deadlines.doneNotes} optional value={form.notes} onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))} maxLength={200} />
        <Button label={it.deadlines.doneSave} icon="check" loading={work.busy} onPress={() => submitDone(false)} />
        <Button label={it.common.cancel} variant="ghost" onPress={() => setSheet('none')} disabled={work.busy} />
      </Sheet>

      <Sheet visible={conflict} title={it.deadlines.doneConflictTitle} message={it.deadlines.doneConflictText} onClose={() => setConflict(false)}>
        <Button label={it.deadlines.doneConflictFix} onPress={() => setConflict(false)} />
        <Button label={it.deadlines.doneConflictSkip} variant="secondary" loading={work.busy} onPress={() => submitDone(true)} />
      </Sheet>

      <Sheet visible={sheet === 'snooze'} title={it.deadlines.snoozeTitle} message={it.deadlines.snoozeText} onClose={() => setSheet('none')}>
        {snoozeError ? <Banner tone="warning" title={snoozeError.message} actionLabel={snoozeError.needsKm ? it.deadlines.snoozeAddKm : undefined} onAction={snoozeError.needsKm ? onGoKm : undefined} /> : null}
        {SNOOZE_OPTIONS.map((o) => (
          <Button key={o.id} label={o.label} variant="secondary" disabled={work.busy} onPress={() => submitSnooze(o.choice)} />
        ))}
        <Button label={it.common.cancel} variant="ghost" onPress={() => setSheet('none')} />
      </Sheet>

      <ConfirmSheet
        visible={sheet === 'skip'}
        title={it.deadlines.skipTitle}
        message={it.deadlines.skipText}
        confirmLabel={it.deadlines.skipConfirm}
        busy={work.busy}
        onConfirm={submitSkip}
        onCancel={() => setSheet('none')}
      />
    </>
  );
}

function InfoBlock({ title, text }: { title: string; text: string }): ReactNode {
  return (
    <Card>
      <Text variant="label" color="muted">
        {title}
      </Text>
      <Text variant="body">{text}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { gap: space.sm },
});
