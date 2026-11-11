import { useLocalSearchParams } from 'expo-router';
import { SetupScreen } from '@/ui/screens/SetupScreen';

export default function SetupRoute() {
  const { id, primo } = useLocalSearchParams<{ id: string; primo?: string }>();
  return <SetupScreen vehicleId={id} first={primo === '1'} />;
}
