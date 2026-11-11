import { useLocalSearchParams } from 'expo-router';
import { ExpenseFormScreen } from '@/ui/screens/ExpenseFormScreen';

export default function EditExpenseRoute() {
  const { id, expenseId } = useLocalSearchParams<{ id: string; expenseId: string }>();
  return <ExpenseFormScreen vehicleId={id} expenseId={expenseId} />;
}
