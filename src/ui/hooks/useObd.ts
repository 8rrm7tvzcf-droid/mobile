// Accesso della UI alla facciata OBD (src/bootstrap/obdService.ts): stato osservabile e schermo acceso durante i dati live.
// La UI non importa mai src/obd: tutto arriva da '@/bootstrap'.
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useSyncExternalStore } from 'react';
import { useApp, type ObdService, type ObdState } from '@/bootstrap';

export function useObdService(): ObdService {
  return useApp().obd.service;
}

/** Stato di connessione corrente: la schermata si ridisegna quando cambia. */
export function useObdState(): ObdState {
  const service = useObdService();
  return useSyncExternalStore(service.subscribe, service.getState, service.getState);
}

const KEEP_AWAKE_TAG = 'obd-live';

/**
 * Tiene lo schermo acceso finche' `active` e' vero (dati live). Dove non e' disponibile (alcuni browser) non fa nulla:
 * la lettura funziona lo stesso. Al termine, o quando la schermata si chiude, lo schermo torna normale.
 */
export function useKeepAwakeWhile(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    try {
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    } catch {
      // non disponibile: si prosegue senza
    }
    return () => {
      try {
        void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
      } catch {
        // gia' disattivato
      }
    };
  }, [active]);
}
