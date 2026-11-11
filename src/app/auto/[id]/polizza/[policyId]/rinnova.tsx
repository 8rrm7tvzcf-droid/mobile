import { useLocalSearchParams } from 'expo-router';
import { PolicyFormScreen } from '@/ui/screens/PolicyFormScreen';

export default function RenewPolicyRoute() {
  const { id, policyId } = useLocalSearchParams<{ id: string; policyId: string }>();
  return <PolicyFormScreen vehicleId={id} policyId={policyId} mode="renew" />;
}
