import { useLocalSearchParams } from 'expo-router';
import { DocumentsScreen } from '@/ui/screens/DocumentsScreen';

export default function DocumentsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DocumentsScreen vehicleId={id} />;
}
