// Hash di contenuto delle notifiche e differenza idempotente con quelle gia' programmate (data.md 4.3). Dominio puro.
import { isOurKey } from './plan';

/** FNV-1a a 32 bit sui code unit UTF-16, in esadecimale a 8 cifre. Non crittografico: serve solo a notare i cambiamenti. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Hash di contenuto: `fnv1a(data|ora|canale|titolo|testo)`. Se cambia il testo o la data la chiave resta la stessa ma
 * l'hash no: la notifica viene riprogrammata. Se non cambia nulla, nessuna chiamata al sistema.
 */
export function notificationHash(n: { date: string; time: string; channel: string; title: string; body: string }): string {
  return fnv1a([n.date, n.time, n.channel, n.title, n.body].join('|'));
}

export interface ScheduledRef {
  key: string;
  hash: string;
}

export interface ScheduleDiff<T extends ScheduledRef> {
  /** Chiavi da cancellare: assenti dai desiderati oppure con hash diverso (verranno riprogrammate). */
  cancel: string[];
  /** Notifiche da programmare: nuove o con hash cambiato. */
  schedule: T[];
}

/**
 * Differenza fra le notifiche desiderate e quelle presenti nel sistema: stesso hash -> invariata; hash diverso ->
 * riprogrammata; chiave assente dai desiderati -> cancellata. Le chiavi che non iniziano per `mg1:` non sono nostre e si ignorano.
 */
export function diffScheduled<T extends ScheduledRef>(desired: readonly T[], existing: readonly ScheduledRef[]): ScheduleDiff<T> {
  const have = new Map(existing.filter((e) => isOurKey(e.key)).map((e) => [e.key, e.hash]));
  const want = new Map(desired.map((d) => [d.key, d]));
  return {
    cancel: [...have.keys()].filter((k) => !want.has(k) || want.get(k)?.hash !== have.get(k)),
    schedule: desired.filter((d) => have.get(d.key) !== d.hash),
  };
}
