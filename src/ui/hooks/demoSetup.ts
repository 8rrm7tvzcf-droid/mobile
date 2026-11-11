// Auto di esempio: applica il wizard «Imposta le scadenze» gia' compilato dallo storico, cosi' l'Oggi mostra subito i semafori
// colorati invece di voci «Da configurare». Se qualcosa non va, il chiamante apre il wizard normale.
import { listSetupCatalog, setupDeadlines } from '@/usecases/deadlines';
import { suggestLastDoneFromHistory } from '@/usecases/services';
import { getVehicle } from '@/usecases/vehicles';
import { buildSetupInput, demoWizardState } from '../logic/setupWizard';
import type { QueryDeps } from './useQuery';

export async function setUpDemoDeadlines(deps: QueryDeps, vehicleId: string): Promise<boolean> {
  const catalog = await listSetupCatalog(deps, vehicleId);
  if (!catalog.ok) return false;
  const vehicle = await getVehicle(deps, vehicleId);
  if (!vehicle) return false;
  const history = await suggestLastDoneFromHistory(deps, vehicleId);
  const unit = vehicle.distanceUnit;
  const state = demoWizardState(catalog.value.proposals, history, unit);
  const built = buildSetupInput(vehicleId, catalog.value.proposals, state, { today: deps.clock.todayLocal(), unit });
  if (!built.ok || built.input.items.length === 0) return false;
  const res = await setupDeadlines(deps, built.input);
  return res.ok;
}
