import { useLocalSearchParams } from 'expo-router';
import { ObdCompatibilityScreen } from '@/ui/screens/obd/ObdCompatibilityScreen';

export default function ObdCompatibilityRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ObdCompatibilityScreen vehicleId={id} />;
}
