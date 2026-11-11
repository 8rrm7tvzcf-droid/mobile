// Testi delle notifiche (SPEC 8.4, data.md 4.10): titolo = nome della voce; corpo = "Panda: scade il 30/11/2026 (tra 14 giorni)".
// Privacy 'generic' (predefinita): il veicolo e' il SOPRANNOME, mai la targa (le notifiche compaiono sul blocco schermo).
// Nessun numero di km nel testo (potrebbe essere superato allo scatto): le scadenze a km sono "stimate".
import { diffDays } from '@/domain/dates';
import type { SentinelCandidate, NotificationCandidate } from '@/domain/notifications';
import { channelForCategory } from '@/domain/notifications';
import { formatDateIt, plural } from '@/domain/units';
import type { NotifiableWithContext } from './load';

export const APP_NAME = 'MyGarage';
export const SENTINEL_BODY = "Apri l'app per aggiornare i tuoi promemoria.";
export const TEST_BODY = 'Notifica di prova: gli avvisi funzionano.';
/** Schema del collegamento che apre la scheda della scadenza (SPEC 6.3.12). */
export const ROUTE_PREFIX = 'mygarage://reminder/';

export interface RenderedContent {
  channel: string;
  title: string;
  body: string;
  threadId?: string;
  route?: string;
}

const days = (n: number): string => plural(n, 'giorno', 'giorni');

/** Chi: soprannome (generic) oppure "soprannome · targa" (full). */
function whoOf(r: NotifiableWithContext, privacy: 'generic' | 'full'): string {
  return privacy === 'full' && r.plate ? `${r.vehicleLabel} · ${r.plate}` : r.vehicleLabel;
}

export function renderSentinel(_s: SentinelCandidate): RenderedContent {
  return { channel: 'system', title: APP_NAME, body: SENTINEL_BODY };
}

export function renderReminderNotification(
  c: NotificationCandidate,
  r: NotifiableWithContext,
  privacy: 'generic' | 'full',
): RenderedContent {
  const due = r.effectiveDueOn as string; // i candidati esistono solo con una scadenza
  // vince la previsione dei km: e' una stima, a meno che i km siano gia' stati raggiunti da una lettura reale (scadenza certa)
  const estimated = r.trigger === 'km' && !r.kmReached;
  let body: string;
  switch (c.kind) {
    case 'due':
      body = estimated ? 'scadenza prevista oggi (stima in base ai km)' : 'scade oggi';
      break;
    case 'lead': {
      const n = diffDays(c.date, due);
      body = estimated
        ? `scadenza stimata il ${formatDateIt(due)} (tra circa ${days(n)})`
        : `scade il ${formatDateIt(due)} (tra ${days(n)})`;
      break;
    }
    case 'overdue': {
      const n = diffDays(due, c.date);
      body = estimated ? `probabilmente scaduto da ${days(n)}` : `scaduto da ${days(n)}`;
      break;
    }
    case 'snoozed':
      body = "promemoria rimandato: è ora di occuparsene";
      break;
  }
  return {
    channel: channelForCategory(r.category),
    title: r.title,
    body: `${whoOf(r, privacy)}: ${body}`,
    threadId: r.vehicleId,
    route: `${ROUTE_PREFIX}${r.id}`,
  };
}
