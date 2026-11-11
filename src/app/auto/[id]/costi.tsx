import { useLocalSearchParams } from 'expo-router';
import { CostsScreen } from '@/ui/screens/CostsScreen';

export default function CostsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CostsScreen vehicleId={id} />;
}
