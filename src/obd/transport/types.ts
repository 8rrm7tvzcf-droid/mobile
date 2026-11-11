// Tipi comuni ai trasporti. L'interfaccia `ObdTransport` e' nel contratto condiviso ('@/domain/ports').
import type { ObdTransport } from '@/domain/ports';

export type { ObdTransport };

/** Timer iniettabili (test deterministici; default: quelli globali). */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Trasporto che gestisce da solo la riconnessione (BLE, SPEC 8.7: backoff 1/2/4 s). `onClose` scatta
 * solo alla chiusura definitiva; la perdita del collegamento e il suo ripristino hanno eventi propri.
 * Dopo ogni `onReconnected` il chiamante DEVE rieseguire l'init completo dell'adattatore.
 */
export interface ReconnectingTransport extends ObdTransport {
  onLinkLost(fn: (reason?: string) => void): () => void;
  onReconnected(fn: () => void): () => void;
}

export function isReconnectingTransport(t: ObdTransport): t is ReconnectingTransport {
  const r = t as Partial<ReconnectingTransport>;
  return typeof r.onLinkLost === 'function' && typeof r.onReconnected === 'function';
}
