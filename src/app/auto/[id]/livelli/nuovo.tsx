import { useLocalSearchParams } from 'expo-router';
import { FluidFormScreen } from '@/ui/screens/FluidFormScreen';

export default function NewFluidCheckRoute() {
  const { id, fluido } = useLocalSearchParams<{ id: string; fluido?: string }>();
  return <FluidFormScreen vehicleId={id} fluid={fluido} />;
}
