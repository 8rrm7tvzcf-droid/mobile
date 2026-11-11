import { useLocalSearchParams } from 'expo-router';
import { ObdIntroScreen } from '@/ui/screens/obd/ObdIntroScreen';

export default function ObdRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ObdIntroScreen vehicleId={id} />;
}
