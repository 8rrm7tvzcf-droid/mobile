import { useLocalSearchParams } from 'expo-router';
import { FuelFormScreen } from '@/ui/screens/FuelFormScreen';

export default function EditFuelRoute() {
  const { id, logId } = useLocalSearchParams<{ id: string; logId: string }>();
  return <FuelFormScreen vehicleId={id} logId={logId} />;
}
