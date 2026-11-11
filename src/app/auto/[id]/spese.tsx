import { useLocalSearchParams } from 'expo-router';
import { ExpenseListScreen } from '@/ui/screens/ExpenseListScreen';

export default function ExpenseListRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ExpenseListScreen vehicleId={id} />;
}
