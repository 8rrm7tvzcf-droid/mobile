// Adattatore della porta NotificationScheduler su expo-notifications 57 (SPEC 8.4): sottile, senza logica di piano.
// Regole: SOLO trigger DATE con istanti calcolati dal dominio; identifier = chiave deterministica `mg1:...`; tutto cio'
// che non inizia per `mg1:` non e' nostro e non si legge ne' si tocca; nessun allarme esatto (niente SCHEDULE_EXACT_ALARM).
// Canali Android: deadlines (alta), maintenance (default), checks (bassa), system (bassa), creati prima di chiedere il
// permesso (su Android 13+ il dialogo di sistema compare solo se esiste almeno un canale).
//
// Cambio di fuso: ogni notifica porta nei dati il fuso con cui e' stata calcolata. Se il fuso del dispositivo e' cambiato,
// listScheduled() restituisce un hash diverso da quello originale: la differenza idempotente del dominio cancella e
// riprogramma tutto da sola, senza stato da salvare (data.md 4.8, riga "Fuso orario diverso").
import * as Notifications from 'expo-notifications';
import { isOurKey, type NotificationChannel } from '@/domain/notifications';
import type { NotificationScheduler, PermissionState, PlannedNotification } from '@/domain/ports';
import { resolveDeviceTimeZone } from '../clock/deviceClock';
import { localToInstant } from '../clock/zoned';

/** Canali Android (id fissi: il dominio li usa in PlannedNotification.channel). I nomi sono quelli che l'utente vede nelle impostazioni di sistema. */
export const ANDROID_CHANNELS: Record<NotificationChannel, { name: string; description: string; importance: Notifications.AndroidImportance }> = {
  deadlines: {
    name: 'Scadenze di legge e assicurazione',
    description: 'Revisione, bollo, assicurazione e altre scadenze da non perdere.',
    importance: Notifications.AndroidImportance.HIGH,
  },
  maintenance: {
    name: 'Manutenzione',
    description: 'Tagliandi e interventi di manutenzione in arrivo.',
    importance: Notifications.AndroidImportance.DEFAULT,
  },
  checks: {
    name: 'Controlli periodici',
    description: 'Controlli rapidi come pressione dei pneumatici e livelli.',
    importance: Notifications.AndroidImportance.LOW,
  },
  system: {
    name: 'Promemoria di sistema',
    description: 'Avvisi di servizio dell\'app, ad esempio quando aprirla per aggiornare i promemoria.',
    importance: Notifications.AndroidImportance.LOW,
  },
};

const CHANNEL_IDS = Object.keys(ANDROID_CHANNELS) as NotificationChannel[];
const isChannel = (c: string): c is NotificationChannel => (CHANNEL_IDS as string[]).includes(c);

/** Una notifica con data gia' passata (o a meno di questo margine) non si programma: su Android scatterebbe subito o darebbe errore. */
const MIN_LEAD_MS = 2_000;

export class NotificationScheduleError extends Error {
  readonly failures: { key: string; message: string }[];
  constructor(action: 'programmare' | 'annullare', failures: { key: string; message: string }[]) {
    super(`Impossibile ${action} ${failures.length} notifiche (prima chiave: ${failures[0]?.key ?? '?'}: ${failures[0]?.message ?? '?'})`);
    this.name = 'NotificationScheduleError';
    this.failures = failures;
  }
}

/** Traduce la risposta dei permessi di expo-notifications negli stati dell'app. */
export function mapPermission(p: { granted: boolean; status: string; canAskAgain: boolean }): PermissionState {
  if (p.granted) return 'granted';
  if (p.status === 'undetermined') return 'undetermined';
  // 'denied': se il sistema non chiedera' piu' (iOS dopo il primo rifiuto, Android dopo il secondo) l'utente deve passare dalle impostazioni
  return p.canAskAgain ? 'denied' : 'blocked';
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface ExpoSchedulerOptions {
  /** Fuso corrente del dispositivo (default: expo-localization, poi Intl). */
  getTimeZone?: () => string;
  /** Istante corrente in ms (default: Date.now). */
  now?: () => number;
}

export interface ExpoNotificationScheduler extends NotificationScheduler {
  /** Crea (o aggiorna nome e descrizione dei) canali Android. Su iOS e web non fa nulla. Si puo' chiamare piu' volte. */
  ensureChannels(): Promise<void>;
}

export function createExpoNotificationScheduler(opts: ExpoSchedulerOptions = {}): ExpoNotificationScheduler {
  const getTimeZone = opts.getTimeZone ?? ((): string => resolveDeviceTimeZone());
  const now = opts.now ?? Date.now;
  let channelsReady: Promise<void> | null = null;

  const ensureChannels = (): Promise<void> => {
    channelsReady ??= (async () => {
      for (const id of CHANNEL_IDS) {
        const c = ANDROID_CHANNELS[id];
        await Notifications.setNotificationChannelAsync(id, { name: c.name, description: c.description, importance: c.importance });
      }
    })().catch((e: unknown) => {
      channelsReady = null; // si riprova alla prossima chiamata
      throw e;
    });
    return channelsReady;
  };

  return {
    ensureChannels,

    async getPermission() {
      return mapPermission(await Notifications.getPermissionsAsync());
    },

    async requestPermission() {
      try {
        await ensureChannels();
      } catch {
        // senza canali il dialogo potrebbe non comparire su Android 13+, ma il tentativo non va impedito
      }
      // Permesso esplicito (non provvisorio): una consegna silenziosa non e' adatta alle scadenze di legge (SPEC 8.4).
      return mapPermission(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } }));
    },

    async listScheduled() {
      const all = await Notifications.getAllScheduledNotificationsAsync();
      const tz = getTimeZone();
      return all
        .filter((n) => isOurKey(n.identifier))
        .map((n) => {
          const data = (n.content.data ?? {}) as Record<string, unknown>;
          const hash = typeof data['hash'] === 'string' ? data['hash'] : '';
          const storedTz = typeof data['tz'] === 'string' ? data['tz'] : null;
          return { key: n.identifier, hash: storedTz !== null && storedTz !== tz ? `${hash}@${storedTz}` : hash };
        });
    },

    async schedule(items: PlannedNotification[], timeZone: string) {
      const failures: { key: string; message: string }[] = [];
      for (const item of items) {
        try {
          if (!isOurKey(item.key)) throw new Error('la chiave deve iniziare per mg1:');
          const when = localToInstant(item.date, item.time, timeZone);
          if (when.getTime() <= now() + MIN_LEAD_MS) continue;
          const channel: NotificationChannel = isChannel(item.channel) ? item.channel : 'maintenance';
          await Notifications.scheduleNotificationAsync({
            identifier: item.key,
            content: {
              title: item.title,
              body: item.body,
              sound: channel === 'deadlines' || channel === 'maintenance' ? 'default' : false,
              data: { hash: item.hash, tz: timeZone, route: item.route ?? null, threadId: item.threadId ?? null },
            },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: channel },
          });
        } catch (e) {
          failures.push({ key: item.key, message: messageOf(e) }); // le altre notifiche vanno comunque programmate
        }
      }
      if (failures.length > 0) throw new NotificationScheduleError('programmare', failures);
    },

    async cancel(keys: string[]) {
      const failures: { key: string; message: string }[] = [];
      for (const key of keys) {
        if (!isOurKey(key)) continue; // non e' nostra: non si tocca
        try {
          await Notifications.cancelScheduledNotificationAsync(key);
        } catch (e) {
          failures.push({ key, message: messageOf(e) });
        }
      }
      if (failures.length > 0) throw new NotificationScheduleError('annullare', failures);
    },
  };
}

/**
 * Cosa fare quando arriva una notifica con l'app aperta: mostrarla comunque (e' una scadenza), senza toccare il badge
 * (il badge lo calcola l'app dai promemoria). Da chiamare una volta all'avvio, prima di qualsiasi altra cosa.
 */
export function installNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}
