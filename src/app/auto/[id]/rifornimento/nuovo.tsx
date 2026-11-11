import { useLocalSearchParams } from 'expo-router';
import { FuelFormScreen } from '@/ui/screens/FuelFormScreen';

export default function NewFuelRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FuelFormScreen vehicleId={id} />;
}
