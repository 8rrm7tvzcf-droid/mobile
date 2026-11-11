import { useLocalSearchParams } from 'expo-router';
import { DeadlinesScreen } from '@/ui/screens/DeadlinesScreen';

export default function DeadlinesRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DeadlinesScreen vehicleId={id} />;
}
