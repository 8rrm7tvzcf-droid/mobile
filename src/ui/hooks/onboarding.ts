// Primo avvio (SPEC 6.3.1): chi non ha ancora auto ne' ha concluso la presentazione viene portato al benvenuto.
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useApp } from '@/bootstrap';
import { getSetting, setSetting } from '@/usecases/settings';
import { listVehicles } from '@/usecases/vehicles';
import type { QueryDeps } from './useQuery';
import { routes } from '../navigation/routes';

/** Segna la presentazione come conclusa (non riparte piu' da sola). */
export async function markOnboardingDone(deps: QueryDeps): Promise<void> {
  const done = await getSetting(deps, 'onboarding.done');
  if (!done) await setSetting(deps, 'onboarding.done', true);
}

/** Da usare nel layout delle schede: al primo avvio senza auto apre il benvenuto. */
export function useOnboardingGate(): void {
  const { deps } = useApp();
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const done = await getSetting(deps, 'onboarding.done');
      if (done || cancelled) return;
      const vehicles = await listVehicles(deps);
      if (cancelled) return;
      if (vehicles.length === 0) router.replace(routes.welcome);
      else await markOnboardingDone(deps);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [deps, router]);
}
