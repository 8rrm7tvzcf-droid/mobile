import { useLocalSearchParams } from 'expo-router';
import { ServiceListScreen } from '@/ui/screens/ServiceListScreen';

export default function ServiceListRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ServiceListScreen vehicleId={id} />;
}
