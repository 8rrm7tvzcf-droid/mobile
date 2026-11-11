import { useLocalSearchParams } from 'expo-router';
import { ExpenseFormScreen } from '@/ui/screens/ExpenseFormScreen';

export default function NewExpenseRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ExpenseFormScreen vehicleId={id} />;
}
