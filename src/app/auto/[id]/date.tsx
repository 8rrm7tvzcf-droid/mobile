import { useLocalSearchParams } from 'expo-router';
import { DocumentDatesScreen } from '@/ui/screens/DocumentDatesScreen';

export default function DocumentDatesRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DocumentDatesScreen vehicleId={id} />;
}
