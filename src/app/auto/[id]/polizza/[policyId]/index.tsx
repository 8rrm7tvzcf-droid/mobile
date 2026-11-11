import { useLocalSearchParams } from 'expo-router';
import { PolicyDetailScreen } from '@/ui/screens/PolicyDetailScreen';

export default function PolicyDetailRoute() {
  const { id, policyId } = useLocalSearchParams<{ id: string; policyId: string }>();
  return <PolicyDetailScreen vehicleId={id} policyId={policyId} />;
}
