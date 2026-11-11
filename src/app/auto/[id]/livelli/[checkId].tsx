import { useLocalSearchParams } from 'expo-router';
import { FluidCheckDetailScreen } from '@/ui/screens/FluidCheckDetailScreen';

export default function FluidCheckRoute() {
  const { id, checkId } = useLocalSearchParams<{ id: string; checkId: string }>();
  return <FluidCheckDetailScreen vehicleId={id} checkId={checkId} />;
}
