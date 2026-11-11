// Permesso delle notifiche chiesto "in contesto" (SPEC 6.3.12): dopo aver spiegato cosa arrivera'.
import type { PermissionState } from '@/domain/ports';
import { setSetting } from '@/usecases/settings';
import type { QueryDeps } from './useQuery';

/**
 * Chiede il permesso al sistema; se concesso accende l'interruttore degli avvisi.
 * Poi avvisa il bus: la sincronizzazione delle notifiche riparte e le schermate si aggiornano.
 */
export async function enableNotifications(deps: QueryDeps): Promise<PermissionState> {
  const state = await deps.scheduler.requestPermission();
  if (state === 'granted') await setSetting(deps, 'notify.enabled', true);
  deps.events.emit({ type: 'data-changed', scope: 'settings' });
  return state;
}
