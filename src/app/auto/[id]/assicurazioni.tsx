import { useLocalSearchParams } from 'expo-router';
import { PolicyListScreen } from '@/ui/screens/PolicyListScreen';

export default function PolicyListRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PolicyListScreen vehicleId={id} />;
}
