import { useLocalSearchParams } from 'expo-router';
import { VehicleFormScreen } from '@/ui/screens/VehicleFormScreen';

export default function EditVehicleRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <VehicleFormScreen vehicleId={id} />;
}
