import { useLocalSearchParams } from 'expo-router';
import { ServiceFormScreen } from '@/ui/screens/ServiceFormScreen';

export default function NewServiceRoute() {
  const { id, tipo } = useLocalSearchParams<{ id: string; tipo?: string }>();
  return <ServiceFormScreen vehicleId={id} preset={tipo} />;
}
