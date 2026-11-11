// Navigazioni composte: torna a "Oggi" ripulendo la pila (dopo il primo avvio non si deve poter tornare al benvenuto).
import type { Href, useRouter } from 'expo-router';
import { routes } from './routes';

export function resetToToday(router: ReturnType<typeof useRouter>): void {
  try {
    if (router.canDismiss()) router.dismissAll();
  } catch {
    // niente da chiudere: si prosegue
  }
  router.replace(routes.today);
}

/** Torna indietro; se non c'e' una schermata precedente (apertura diretta, web) va alla schermata indicata. */
export function goBackOr(router: ReturnType<typeof useRouter>, fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
