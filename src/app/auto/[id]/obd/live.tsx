import { useLocalSearchParams } from 'expo-router';
import { ObdLiveScreen } from '@/ui/screens/obd/ObdLiveScreen';

export default function ObdLiveRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ObdLiveScreen vehicleId={id} />;
}
