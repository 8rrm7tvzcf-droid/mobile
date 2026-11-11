import { useLocalSearchParams } from 'expo-router';
import { VehicleFormScreen } from '@/ui/screens/VehicleFormScreen';

export default function NewVehicleRoute() {
  const { primo } = useLocalSearchParams<{ primo?: string }>();
  return <VehicleFormScreen first={primo === '1'} />;
}
