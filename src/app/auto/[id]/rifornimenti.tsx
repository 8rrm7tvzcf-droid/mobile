import { useLocalSearchParams } from 'expo-router';
import { FuelListScreen } from '@/ui/screens/FuelListScreen';

export default function FuelListRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FuelListScreen vehicleId={id} />;
}
