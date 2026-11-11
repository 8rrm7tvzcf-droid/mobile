// S-23 Spesa: categoria (di sistema o personalizzata), importo, data e note; modifica ed eliminazione con "Annulla".
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useApp } from '@/bootstrap';
import {
  addExpense,
  createExpenseCategory,
  deleteExpense,
  getExpense,
  listExpenseCategories,
  listExpenses,
  updateExpense,
  type ExpenseCategory,
  type ExpenseEntry,
  type ExpenseWriteResult,
} from '@/usecases/expenses';
import { getVehicle } from '@/usecases/vehicles';
import { AttachmentsSection, Banner, Button, ChoiceGroup, ConfirmSheet, EmptyState, QueryBoundary, Screen, Sheet, Text, TextField } from '../components';
import { pushUndo } from '../hooks/undo';
import { useBusy } from '../hooks/useBusy';
import { goBackOr } from '../navigation/actions';
import { routes } from '../navigation/routes';
import { useQuery } from '../hooks/useQuery';
import { useSnapshot } from '../hooks/useSnapshot';
import { it } from '../i18n/it';
import { describeError, describeThrown } from '../logic/errors';
import {
  DEFAULT_EXPENSE_CATEGORY,
  buildAddExpenseInput,
  buildUpdateExpenseInput,
  categoryOptions,
  cleanCategoryName,
  expenseErrorField,
  expenseRowTitle,
  formFromExpense,
  initialExpenseForm,
  type ExpenseFormErrors,
  type ExpenseFormValues,
} from '../logic/expenseForm';

interface Loaded {
  notFound: boolean;
  categories: ExpenseCategory[];
  expense: ExpenseEntry | null;
  /** Categoria da preselezionare in una nuova spesa: l'ultima usata. */
  lastCategoryId: string;
}

export function ExpenseFormScreen({ vehicleId, expenseId }: { vehicleId: string; expenseId?: string }): ReactNode {
  const query = useQuery<Loaded>(
    async (d) => {
      const missing: Loaded = { notFound: true, categories: [], expense: null, lastCategoryId: DEFAULT_EXPENSE_CATEGORY };
      if (!(await getVehicle(d, vehicleId))) return missing;
      const categories = await listExpenseCategories(d);
      if (expenseId) {
        const expense = await getExpense(d, expenseId);
        return expense && expense.vehicleId === vehicleId ? { notFound: false, categories, expense, lastCategoryId: expense.categoryId } : missing;
      }
      const last = (await listExpenses(d, vehicleId, null, { limit: 1 }))[0];
      const usable = last && categories.some((c) => c.id === last.categoryId) ? last.categoryId : DEFAULT_EXPENSE_CATEGORY;
      return { notFound: false, categories, expense: null, lastCategoryId: usable };
    },
    [vehicleId, expenseId],
    it.common.loadError,
  );
  const data = useSnapshot(query.data);
  return (
    <QueryBoundary query={{ ...query, data }}>
      {(loaded) =>
        loaded.notFound ? (
          <Screen>
            <EmptyState icon="car" title={it.common.notFoundTitle} message={expenseId ? it.expense.notFound : it.vehicle.notFound} />
          </Screen>
        ) : (
          <ExpenseForm vehicleId={vehicleId} {...loaded} />
        )
      }
    </QueryBoundary>
  );
}

function ExpenseForm({ vehicleId, categories: initialCategories, expense, lastCategoryId }: { vehicleId: string } & Loaded): ReactNode {
  const router = useRouter();
  const { deps } = useApp();
  const today = deps.clock.todayLocal();
  const editing = expense !== null;
  const [categories, setCategories] = useState(initialCategories);
  const [values, setValues] = useState<ExpenseFormValues>(() => (expense ? formFromExpense(expense) : initialExpenseForm(today, lastCategoryId)));
  const [errors, setErrors] = useState<ExpenseFormErrors>({});
  const [saved, setSaved] = useState<ExpenseWriteResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newCategory, setNewCategory] = useState<{ name: string; error: string | null } | null>(null);
  const saving = useBusy();
  const creating = useBusy();

  const patch = (p: Partial<ExpenseFormValues>): void => setValues((v) => ({ ...v, ...p }));

  const save = (): void => {
    void saving.run(async () => {
      setErrors({});
      try {
        const res = expense
          ? await (async () => {
              const built = buildUpdateExpenseInput(values, today);
              return built.ok ? updateExpense(deps, expense.id, built.input) : built;
            })()
          : await (async () => {
              const built = buildAddExpenseInput(vehicleId, values, today);
              return built.ok ? addExpense(deps, built.input) : built;
            })();
        if ('errors' in res) return setErrors(res.errors);
        if (!res.ok) {
          const e = describeError(res.error);
          return setErrors({ [expenseErrorField(e.field)]: e.message });
        }
        if (res.value.warnings.length > 0) {
          setSaved(res.value);
          return;
        }
        if (!editing) pushUndo({ mode: 'added', kind: 'expense', itemId: res.value.expense.id, vehicleId, message: it.expense.savedMessage });
        goBackOr(router, routes.expenseList(vehicleId));
      } catch (e) {
        setErrors({ form: describeThrown(e) });
      }
    });
  };

  const undoSaved = (): void => {
    if (!saved) return;
    void saving.run(async () => {
      try {
        const res = await deleteExpense(deps, saved.expense.id);
        if (res.ok) goBackOr(router, routes.expenseList(vehicleId));
        else setErrors({ form: describeError(res.error).message });
      } catch (e) {
        setErrors({ form: describeThrown(e) });
      }
    });
  };

  const remove = (): void => {
    if (!expense) return;
    void saving.run(async () => {
      try {
        const res = await deleteExpense(deps, expense.id);
        setConfirmDelete(false);
        if (!res.ok) return setErrors({ form: describeError(res.error).message });
        pushUndo({ mode: 'deleted', kind: 'expense', itemId: expense.id, vehicleId, message: it.expense.deletedMessage });
        goBackOr(router, routes.expenseList(vehicleId));
      } catch (e) {
        setConfirmDelete(false);
        setErrors({ form: describeThrown(e) });
      }
    });
  };

  const addCategory = (): void => {
    if (!newCategory) return;
    const name = cleanCategoryName(newCategory.name);
    if (!name) return setNewCategory({ ...newCategory, error: it.expense.categoryNameRequired });
    void creating.run(async () => {
      try {
        const res = await createExpenseCategory(deps, { name });
        if (!res.ok) return setNewCategory({ name: newCategory.name, error: describeError(res.error).message });
        setCategories((list) => [...list.filter((c) => c.id !== 'sys_other'), res.value, ...list.filter((c) => c.id === 'sys_other')]);
        patch({ categoryId: res.value.id });
        setNewCategory(null);
      } catch (e) {
        setNewCategory({ name: newCategory.name, error: describeThrown(e) });
      }
    });
  };

  if (saved) {
    return (
      <Screen
        footer={
          <>
            <Button label={it.expense.done} icon="check" onPress={() => goBackOr(router, routes.expenseList(vehicleId))} />
            {!editing ? <Button label={it.expense.undoSaved} icon="undo" variant="ghost" loading={saving.busy} onPress={undoSaved} /> : null}
          </>
        }
      >
        <Banner tone="ok" title={it.expense.savedTitle} message={expenseRowTitle(saved.expense)} />
        {errors.form ? <Banner tone="danger" title={errors.form} /> : null}
        <Banner tone="warning" title={it.expense.warningTitle} message={saved.warnings.join(' ')} />
      </Screen>
    );
  }

  return (
    <Screen footer={<Button label={editing ? it.expense.saveChanges : it.expense.save} icon="check" loading={saving.busy} testID="expense-save" onPress={save} />}>
      {!editing ? (
        <Text variant="body" color="muted">
          {it.expense.intro}
        </Text>
      ) : null}
      {errors.form ? <Banner tone="danger" title={errors.form} /> : null}

      <ChoiceGroup
        label={it.expense.categoryLabel}
        options={categoryOptions(categories)}
        value={values.categoryId}
        onChange={(id) => patch({ categoryId: id })}
        error={errors.category ?? null}
      />
      <Button label={it.expense.newCategory} icon="plus" variant="secondary" onPress={() => setNewCategory({ name: '', error: null })} />

      <TextField
        label={it.expense.amountLabel}
        kind="money"
        required
        suffix="€"
        value={values.amount}
        onChangeText={(t) => {
          patch({ amount: t });
          setErrors((e) => ({ ...e, amount: undefined }));
        }}
        error={errors.amount ?? null}
        maxLength={12}
        autoFocus={!editing}
        testID="expense-amount"
      />
      <TextField
        label={it.expense.dateLabel}
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
      <TextField
        label={it.expense.descriptionLabel}
        optional
        hint={it.expense.descriptionHint}
        value={values.description}
        onChangeText={(t) => patch({ description: t })}
        maxLength={200}
        testID="expense-description"
      />
      <TextField label={it.expense.vendorLabel} optional value={values.vendor} onChangeText={(t) => patch({ vendor: t })} maxLength={80} />
      <TextField label={it.expense.notesLabel} optional multiline value={values.notes} onChangeText={(t) => patch({ notes: t })} maxLength={500} />

      {editing && expense ? <AttachmentsSection parent={{ type: 'expense', id: expense.id }} vehicleId={vehicleId} /> : null}

      {editing ? <Button label={it.expense.delete} icon="trash" variant="ghost" onPress={() => setConfirmDelete(true)} /> : null}

      <ConfirmSheet
        visible={confirmDelete}
        title={it.expense.deleteTitle}
        message={it.expense.deleteText}
        confirmLabel={it.expense.deleteConfirm}
        destructive
        busy={saving.busy}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
      <Sheet visible={newCategory !== null} title={it.expense.newCategoryTitle} onClose={() => setNewCategory(null)}>
        <TextField
          label={it.expense.categoryNameLabel}
          hint={it.expense.categoryNameHint}
          value={newCategory?.name ?? ''}
          onChangeText={(t) => setNewCategory({ name: t, error: null })}
          error={newCategory?.error ?? null}
          maxLength={40}
          autoFocus
        />
        <Button label={it.expense.categoryAdd} icon="check" loading={creating.busy} onPress={addCategory} />
        <Button label={it.common.cancel} variant="ghost" onPress={() => setNewCategory(null)} />
      </Sheet>
    </Screen>
  );
}
