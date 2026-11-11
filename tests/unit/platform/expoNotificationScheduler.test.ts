import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlannedNotification } from '@/domain/ports';

const mocks = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  setNotificationChannelAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  getAllScheduledNotificationsAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
  setNotificationHandler: vi.fn(),
}));
vi.mock('expo-notifications', () => ({
  ...mocks,
  AndroidImportance: { LOW: 4, DEFAULT: 5, HIGH: 6 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

// il clock del dispositivo (importato dallo scheduler per il fuso di default) legge expo-localization
vi.mock('expo-localization', () => ({ getCalendars: () => [{ timeZone: 'Europe/Rome' }] }));

import {
  ANDROID_CHANNELS,
  createExpoNotificationScheduler,
  installNotificationHandler,
  mapPermission,
  NotificationScheduleError,
} from '@/platform/notifications/expoNotificationScheduler';

const NOW = Date.UTC(2026, 9, 8, 7, 30); // 08/10/2026 09:30 a Roma
const make = (tz = 'Europe/Rome') => createExpoNotificationScheduler({ getTimeZone: () => tz, now: () => NOW });

const planned = (over: Partial<PlannedNotification> = {}): PlannedNotification => ({
  key: 'mg1:rem1:-7',
  hash: 'aaaa1111',
  date: '2026-11-30',
  time: '09:00',
  channel: 'deadlines',
  title: 'Revisione',
  body: 'Panda: scade il 30/11/2026 (tra 7 giorni)',
  threadId: 'veh1',
  route: 'mygarage://reminder/rem1',
  ...over,
});

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.setNotificationChannelAsync.mockResolvedValue(null);
  mocks.scheduleNotificationAsync.mockResolvedValue('id');
  mocks.cancelScheduledNotificationAsync.mockResolvedValue(undefined);
});

describe('mapPermission', () => {
  it('traduce la risposta di expo-notifications nei quattro stati', () => {
    expect(mapPermission({ granted: true, status: 'granted', canAskAgain: true })).toBe('granted');
    expect(mapPermission({ granted: false, status: 'undetermined', canAskAgain: true })).toBe('undetermined');
    expect(mapPermission({ granted: false, status: 'denied', canAskAgain: true })).toBe('denied'); // Android: si puo' richiedere ancora
    expect(mapPermission({ granted: false, status: 'denied', canAskAgain: false })).toBe('blocked'); // solo dalle impostazioni
  });
});

describe('permessi e canali', () => {
  it('getPermission legge lo stato senza chiedere nulla', async () => {
    mocks.getPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied', canAskAgain: false });
    expect(await make().getPermission()).toBe('blocked');
    expect(mocks.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('requestPermission crea i 4 canali PRIMA del dialogo di sistema e chiede un permesso esplicito (non provvisorio)', async () => {
    mocks.requestPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted', canAskAgain: true });
    expect(await make().requestPermission()).toBe('granted');
    expect(mocks.setNotificationChannelAsync.mock.calls.map((c) => c[0])).toEqual(['deadlines', 'maintenance', 'checks', 'system']);
    const lastChannel = Math.max(...mocks.setNotificationChannelAsync.mock.invocationCallOrder);
    expect(lastChannel).toBeLessThan(mocks.requestPermissionsAsync.mock.invocationCallOrder[0] as number);
    const arg = mocks.requestPermissionsAsync.mock.calls[0]?.[0] as { ios: Record<string, boolean> };
    expect(arg.ios).toEqual({ allowAlert: true, allowBadge: true, allowSound: true });
    expect(arg.ios['allowProvisional']).toBeUndefined();
  });

  it('i canali hanno le importanze della SPEC 8.4', () => {
    expect(ANDROID_CHANNELS.deadlines.importance).toBe(6); // alta
    expect(ANDROID_CHANNELS.maintenance.importance).toBe(5); // default
    expect(ANDROID_CHANNELS.checks.importance).toBe(4); // bassa
    expect(ANDROID_CHANNELS.system.importance).toBe(4); // bassa
  });

  it('se i canali non si creano il permesso viene chiesto lo stesso', async () => {
    mocks.setNotificationChannelAsync.mockRejectedValue(new Error('no'));
    mocks.requestPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied', canAskAgain: true });
    expect(await make().requestPermission()).toBe('denied');
  });

  it('ensureChannels e\' idempotente: una sola serie di chiamate, e si riprova dopo un errore', async () => {
    const s = make();
    await s.ensureChannels();
    await s.ensureChannels();
    expect(mocks.setNotificationChannelAsync).toHaveBeenCalledTimes(4);

    mocks.setNotificationChannelAsync.mockReset();
    mocks.setNotificationChannelAsync.mockRejectedValueOnce(new Error('transitorio')).mockResolvedValue(null);
    const s2 = make();
    await expect(s2.ensureChannels()).rejects.toThrow('transitorio');
    await expect(s2.ensureChannels()).resolves.toBeUndefined();
  });
});

describe('listScheduled', () => {
  const sched = (identifier: string, data: Record<string, unknown> | null) => ({ identifier, content: { data }, trigger: null });

  it("restituisce solo le chiavi `mg1:` con il loro hash; le notifiche di altri non si vedono", async () => {
    mocks.getAllScheduledNotificationsAsync.mockResolvedValue([
      sched('mg1:rem1:-7', { hash: 'aaaa1111', tz: 'Europe/Rome' }),
      sched('mg1:sentinel', { hash: 'bbbb2222', tz: 'Europe/Rome' }),
      sched('altra-app:1', { hash: 'zzzz' }),
      sched('4F1A-UUID', null),
    ]);
    expect(await make().listScheduled()).toEqual([
      { key: 'mg1:rem1:-7', hash: 'aaaa1111' },
      { key: 'mg1:sentinel', hash: 'bbbb2222' },
    ]);
  });

  it("se il fuso del dispositivo e' cambiato l'hash cambia, cosi' il dominio riprogramma tutto", async () => {
    mocks.getAllScheduledNotificationsAsync.mockResolvedValue([sched('mg1:rem1:-7', { hash: 'aaaa1111', tz: 'Europe/Rome' })]);
    const [item] = await make('America/New_York').listScheduled();
    expect(item?.key).toBe('mg1:rem1:-7');
    expect(item?.hash).not.toBe('aaaa1111');
  });

  it('una notifica senza dati ha hash vuoto (verra\' riprogrammata)', async () => {
    mocks.getAllScheduledNotificationsAsync.mockResolvedValue([sched('mg1:old', null)]);
    expect(await make().listScheduled()).toEqual([{ key: 'mg1:old', hash: '' }]);
  });
});

describe('schedule', () => {
  it("usa un trigger DATE con l'istante UTC corretto, identifier = chiave e il canale della notifica", async () => {
    await make().schedule([planned()], 'Europe/Rome');
    expect(mocks.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const req = mocks.scheduleNotificationAsync.mock.calls[0]?.[0] as {
      identifier: string;
      content: { title: string; body: string; data: Record<string, unknown> };
      trigger: { type: string; date: Date; channelId: string };
    };
    expect(req.identifier).toBe('mg1:rem1:-7');
    expect(req.trigger.type).toBe('date');
    expect(req.trigger.date.toISOString()).toBe('2026-11-30T08:00:00.000Z'); // 09:00 CET
    expect(req.trigger.channelId).toBe('deadlines');
    expect(req.content.title).toBe('Revisione');
    expect(req.content.body).toContain('30/11/2026');
    expect(req.content.data).toMatchObject({ hash: 'aaaa1111', tz: 'Europe/Rome', route: 'mygarage://reminder/rem1' });
  });

  it("l'istante dipende dal fuso passato (ora legale in estate)", async () => {
    await make().schedule([planned({ date: '2027-07-01' })], 'Europe/Rome');
    const req = mocks.scheduleNotificationAsync.mock.calls[0]?.[0] as { trigger: { date: Date } };
    expect(req.trigger.date.toISOString()).toBe('2027-07-01T07:00:00.000Z');
  });

  it('salta le notifiche gia\' passate e non lancia', async () => {
    await make().schedule([planned({ date: '2026-10-08', time: '09:00' }), planned({ key: 'mg1:rem2:0', date: '2026-10-07' })], 'Europe/Rome');
    expect(mocks.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("un canale sconosciuto ripiega su 'maintenance' (altrimenti Android la metterebbe in un canale generico)", async () => {
    await make().schedule([planned({ channel: 'boh' })], 'Europe/Rome');
    const req = mocks.scheduleNotificationAsync.mock.calls[0]?.[0] as { trigger: { channelId: string } };
    expect(req.trigger.channelId).toBe('maintenance');
  });

  it('rifiuta le chiavi che non sono nostre', async () => {
    await expect(make().schedule([planned({ key: 'altra-app:1' })], 'Europe/Rome')).rejects.toBeInstanceOf(NotificationScheduleError);
    expect(mocks.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('un errore su una notifica non impedisce le altre; alla fine segnala quali sono fallite', async () => {
    mocks.scheduleNotificationAsync.mockRejectedValueOnce(new Error('troppi allarmi')).mockResolvedValue('ok');
    const err = await make()
      .schedule([planned({ key: 'mg1:a:0' }), planned({ key: 'mg1:b:0' }), planned({ key: 'mg1:c:0' })], 'Europe/Rome')
      .catch((e: unknown) => e);
    expect(mocks.scheduleNotificationAsync).toHaveBeenCalledTimes(3);
    expect(err).toBeInstanceOf(NotificationScheduleError);
    expect((err as NotificationScheduleError).failures).toEqual([{ key: 'mg1:a:0', message: 'troppi allarmi' }]);
  });

  it('con una lista vuota non chiama il sistema', async () => {
    await make().schedule([], 'Europe/Rome');
    expect(mocks.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('cancel', () => {
  it('annulla per chiave e ignora tutto cio\' che non inizia per mg1:', async () => {
    await make().cancel(['mg1:rem1:-7', 'altra-app:1', 'mg1:sentinel']);
    expect(mocks.cancelScheduledNotificationAsync.mock.calls.map((c) => c[0])).toEqual(['mg1:rem1:-7', 'mg1:sentinel']);
  });

  it('prosegue dopo un errore e lo segnala alla fine', async () => {
    mocks.cancelScheduledNotificationAsync.mockRejectedValueOnce(new Error('no')).mockResolvedValue(undefined);
    await expect(make().cancel(['mg1:a', 'mg1:b'])).rejects.toBeInstanceOf(NotificationScheduleError);
    expect(mocks.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
  });
});

describe('installNotificationHandler', () => {
  it("con l'app aperta mostra la notifica e non tocca il badge", async () => {
    installNotificationHandler();
    expect(mocks.setNotificationHandler).toHaveBeenCalledTimes(1);
    const handler = mocks.setNotificationHandler.mock.calls[0]?.[0] as { handleNotification: () => Promise<Record<string, boolean>> };
    expect(await handler.handleNotification()).toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });
});
