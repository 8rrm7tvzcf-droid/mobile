import { useLocalSearchParams } from 'expo-router';
import { ServiceFormScreen } from '@/ui/screens/ServiceFormScreen';

export default function EditServiceRoute() {
  const { id, recordId } = useLocalSearchParams<{ id: string; recordId: string }>();
  return <ServiceFormScreen vehicleId={id} recordId={recordId} />;
}
