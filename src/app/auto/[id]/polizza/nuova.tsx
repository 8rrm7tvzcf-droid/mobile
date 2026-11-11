import { useLocalSearchParams } from 'expo-router';
import { PolicyFormScreen } from '@/ui/screens/PolicyFormScreen';

export default function NewPolicyRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PolicyFormScreen vehicleId={id} mode="new" />;
}
