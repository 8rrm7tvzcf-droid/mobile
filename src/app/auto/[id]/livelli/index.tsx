import { useLocalSearchParams } from 'expo-router';
import { FluidScreen } from '@/ui/screens/FluidScreen';

export default function FluidsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FluidScreen vehicleId={id} />;
}
