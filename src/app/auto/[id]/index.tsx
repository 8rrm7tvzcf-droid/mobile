import { useLocalSearchParams } from 'expo-router';
import { VehicleScreen } from '@/ui/screens/VehicleScreen';

export default function VehicleRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <VehicleScreen vehicleId={id} />;
}
