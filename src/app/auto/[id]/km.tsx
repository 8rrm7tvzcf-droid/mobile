import { useLocalSearchParams } from 'expo-router';
import { KmScreen } from '@/ui/screens/KmScreen';

export default function KmRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <KmScreen vehicleId={id} />;
}
