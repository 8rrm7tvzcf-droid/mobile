// Punto unico in cui il bootstrap importa i casi d'uso che i contratti tra gli agenti gli affidano:
//   '@/usecases/deadlines'     -> reconcileAll(d), reconcileVehicle(d, vehicleId)
//   '@/usecases/notifications' -> syncNotifications(d)
// Se uno dei due moduli cambia nome o firma, si corregge solo qui (e il typecheck lo segnala).
import { reconcileAll, reconcileVehicle } from '@/usecases/deadlines';
import { syncNotifications } from '@/usecases/notifications';
import type { ReplanPipeline } from './replan';

export const replanPipeline: ReplanPipeline = { reconcileAll, reconcileVehicle, syncNotifications };
