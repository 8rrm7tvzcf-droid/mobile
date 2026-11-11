// Bus degli eventi di dominio (porta EventBus): sincrono, in memoria. Un ascoltatore che lancia un errore non
// impedisce agli altri di ricevere l'evento e non fa fallire chi ha emesso (l'emissione avviene DOPO il commit).
import type { DomainEvent, EventBus } from '@/domain/ports';

export interface SimpleEventBusOptions {
  /** Chiamato quando un ascoltatore lancia (default: console.error). */
  onListenerError?: (error: unknown, event: DomainEvent) => void;
}

export function createSimpleEventBus(opts: SimpleEventBusOptions = {}): EventBus {
  const listeners = new Set<(e: DomainEvent) => void>();
  const onError =
    opts.onListenerError ??
    ((error: unknown, event: DomainEvent): void => {
      console.error(`[eventi] ascoltatore fallito per '${event.type}'`, error);
    });
  return {
    emit(event) {
      for (const fn of [...listeners]) {
        // copia: un ascoltatore puo' iscriversi o disiscriversi durante l'emissione
        if (!listeners.has(fn)) continue;
        try {
          fn(event);
        } catch (e) {
          onError(e, event);
        }
      }
    },
    on(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
