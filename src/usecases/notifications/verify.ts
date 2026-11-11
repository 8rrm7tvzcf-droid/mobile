// "Verifica notifiche" (S-71, SPEC 6.3.12, data.md 4.9): permesso, notifiche attese contro presenti nel sistema,
// prossima in arrivo e notifica di prova (`mg1:test`) fra pochi secondi. Se il permesso e' bloccato spiega cosa fare.
import { SENTINEL_KEY, TEST_KEY } from '@/domain/notifications';
import type { PermissionState, PlannedNotification } from '@/domain/ports';
import type { LocalDateTime } from '@/domain/reminders';
import type { NotificationDeps } from '../context';
import { addMinutes } from '../queries/localTime';
import { buildPlannedNotifications, contentHash } from './plan';
import { APP_NAME, TEST_BODY } from './render';

export const TEST_DELAY_SECONDS = 5;

export const GUIDE_BLOCKED =
  "Gli avvisi sono bloccati per MyGarage. Apri le impostazioni del telefono, tocca «Notifiche» e attiva «Consenti notifiche»; poi torna qui e riprova.";
export const GUIDE_DENIED =
  'Non hai ancora consentito gli avvisi: senza, potresti perdere una scadenza. Puoi riprovare adesso.';

export type VerifyNextAction = 'none' | 'retry-permission' | 'open-system-settings';

export interface VerifyOptions {
  /** Secondi dopo cui deve arrivare la prova (default 5). Il sistema riceve data e ora al minuto: arriva al primo minuto intero utile. */
  delaySeconds?: number;
  /** Se il permesso non e' mai stato chiesto, lo chiede (default true: l'utente ha premuto "Verifica"). */
  requestIfUndetermined?: boolean;
}

export interface VerifyReport {
  permission: PermissionState;
  /** Vero se la notifica di prova e' stata programmata. */
  testScheduled: boolean;
  testKey: string;
  /** Quando e' attesa la prova (ora locale, al minuto) e fra quanti secondi circa. */
  testAt: LocalDateTime | null;
  testInSeconds: number | null;
  /** Notifiche attese dal piano (sentinella compresa) e presenti nel sistema (prova esclusa). */
  expected: number;
  present: number;
  /** Attese ma assenti dal sistema oppure con contenuto diverso: la sincronizzazione le riallinea. */
  missing: number;
  /** Prossima notifica di promemoria in programma. */
  next: { date: string; time: string; title: string; body: string } | null;
  nextAction: VerifyNextAction;
  /** Guida in italiano quando il permesso manca; null se tutto va. */
  guide: string | null;
}

/**
 * Verifica le notifiche e invia la prova. Non fallisce se il permesso e' negato o bloccato: lo riporta con la guida.
 * Gli errori dello scheduler (es. impossibile programmare) si propagano.
 */
export async function verifyNotifications(d: NotificationDeps, options: VerifyOptions = {}): Promise<VerifyReport> {
  const delay = Math.max(1, Math.trunc(options.delaySeconds ?? TEST_DELAY_SECONDS));
  let permission = await d.scheduler.getPermission();
  if (permission === 'undetermined' && (options.requestIfUndetermined ?? true)) {
    permission = await d.scheduler.requestPermission();
  }

  const plan = await buildPlannedNotifications(d);
  const reminderItems = plan.items.filter((i) => i.key !== SENTINEL_KEY);
  const first = reminderItems[0];
  const base = {
    permission,
    testKey: TEST_KEY,
    expected: plan.items.length,
    next: first ? { date: first.date, time: first.time, title: first.title, body: first.body } : null,
  };

  if (permission !== 'granted') {
    const blocked = permission === 'blocked';
    return {
      ...base,
      testScheduled: false,
      testAt: null,
      testInSeconds: null,
      present: 0,
      missing: plan.items.length,
      nextAction: blocked ? 'open-system-settings' : 'retry-permission',
      guide: blocked ? GUIDE_BLOCKED : GUIDE_DENIED,
    };
  }

  // la porta riceve data e ora al MINUTO: la prova arriva al primo minuto intero che dista almeno `delay` secondi
  const nowSec = Number(d.clock.nowIso().slice(17, 19));
  const addMin = Math.ceil((nowSec + delay) / 60);
  const testAt = addMinutes(d.clock.nowLocal(), addMin);
  const testItem: PlannedNotification = {
    key: TEST_KEY,
    hash: '',
    date: testAt.date,
    time: testAt.time,
    channel: 'system',
    title: APP_NAME,
    body: TEST_BODY,
  };
  testItem.hash = contentHash(testItem, testItem.date, testItem.time, plan.timeZone);
  await d.scheduler.schedule([testItem], plan.timeZone);

  const scheduled = (await d.scheduler.listScheduled()).filter((e) => e.key !== TEST_KEY);
  const have = new Map(scheduled.map((e) => [e.key, e.hash]));
  const missing = plan.items.filter((i) => have.get(i.key) !== i.hash).length;
  return {
    ...base,
    testScheduled: true,
    testAt,
    testInSeconds: addMin * 60 - nowSec,
    present: scheduled.length,
    missing,
    nextAction: 'none',
    guide: null,
  };
}
