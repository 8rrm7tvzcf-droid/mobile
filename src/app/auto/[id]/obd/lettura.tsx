import { useLocalSearchParams } from 'expo-router';
import { ObdSnapshotScreen } from '@/ui/screens/obd/ObdSnapshotScreen';

export default function ObdReadingRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ObdSnapshotScreen vehicleId={id} />;
}
