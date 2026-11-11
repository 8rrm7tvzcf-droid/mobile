import { useLocalSearchParams } from 'expo-router';
import { ServiceDetailScreen } from '@/ui/screens/ServiceDetailScreen';

export default function ServiceDetailRoute() {
  const { id, recordId } = useLocalSearchParams<{ id: string; recordId: string }>();
  return <ServiceDetailScreen vehicleId={id} recordId={recordId} />;
}
