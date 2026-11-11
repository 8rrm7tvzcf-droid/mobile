import { useLocalSearchParams } from 'expo-router';
import { DeadlineDetailScreen } from '@/ui/screens/DeadlineDetailScreen';

export default function DeadlineRoute() {
  const { id, azione } = useLocalSearchParams<{ id: string; azione?: string }>();
  return <DeadlineDetailScreen deadlineId={id} action={azione} />;
}
