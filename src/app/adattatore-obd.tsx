import { useLocalSearchParams } from 'expo-router';
import { AdapterGuideScreen } from '@/ui/screens/obd/AdapterGuideScreen';

export default function AdapterGuideRoute() {
  const { auto } = useLocalSearchParams<{ auto?: string }>();
  return <AdapterGuideScreen vehicleId={auto} />;
}
