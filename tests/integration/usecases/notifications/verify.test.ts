// verifyNotifications: permesso, attese contro presenti, prossima notifica, notifica di prova 'mg1:test'.
import { describe, expect, it } from 'vitest';
import { GUIDE_BLOCKED, GUIDE_DENIED, TEST_BODY, syncNotifications, verifyNotifications } from '@/usecases/notifications';
import { addManual, addVehicle, setup } from '../queries/helpers';
import type { Ctx } from '../queries/helpers';
import { FakeScheduler } from './fakeScheduler';

async function withReminder(nowIso?: string): Promise<{ c: Ctx; r: string }> {
  const c = await setup(nowIso);
  const v = await addVehicle(c);
  const r = await addManual(c, v, 'Gommista', '2026-10-22');
  return { c, r };
}

describe('notifica di prova', () => {
  it('programma mg1:test al primo minuto intero utile (5 s dopo, la porta riceve data e ora al minuto)', async () => {
    const { c } = await withReminder('2026-10-08T07:30:10.000Z');
    const s = new FakeScheduler();
    const rep = await verifyNotifications(c.depsWith(s));
    expect(rep).toMatchObject({
      permission: 'granted', testScheduled: true, testKey: 'mg1:test', testAt: { date: '2026-10-08', time: '07:31' }, testInSeconds: 50, nextAction: 'none', guide: null,
    });
    const t = s.store.get('mg1:test')!;
    expect(t).toMatchObject({ date: '2026-10-08', time: '07:31', channel: 'system', title: 'MyGarage', body: TEST_BODY });
    expect(t.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(s.calls.find((x) => x.op === 'schedule')!.timeZone).toBe('Europe/Rome');
  });

  it.each([
    ['2026-10-08T07:30:00.000Z', '07:31', 60],
    ['2026-10-08T07:30:55.000Z', '07:31', 5],
    ['2026-10-08T07:30:58.000Z', '07:32', 62],
  ] as const)('arrotondamento: alle %s la prova arriva alle %s (fra %i s)', async (now, time, secs) => {
    const { c } = await withReminder(now);
    const rep = await verifyNotifications(c.depsWith(new FakeScheduler()));
    expect(rep.testAt!.time).toBe(time);
    expect(rep.testInSeconds).toBe(secs);
  });

  it('a cavallo della mezzanotte passa al giorno dopo; il ritardo e\' un parametro', async () => {
    const c = await setup('2026-10-08T23:59:50.000Z');
    // 23:59:50 + 30 s = 00:00:20: il primo minuto intero utile e' 00:01 (fra 70 s)
    const rep = await verifyNotifications(c.depsWith(new FakeScheduler()), { delaySeconds: 30 });
    expect(rep.testAt).toEqual({ date: '2026-10-09', time: '00:01' });
    expect(rep.testInSeconds).toBe(70);
    // con 5 s: 23:59:55 -> 00:00 (fra 10 s)
    const quick = await verifyNotifications(c.depsWith(new FakeScheduler()));
    expect(quick.testAt).toEqual({ date: '2026-10-09', time: '00:00' });
    expect(quick.testInSeconds).toBe(10);
  });

  it('una sincronizzazione successiva non cancella la notifica di prova', async () => {
    const { c } = await withReminder();
    const s = new FakeScheduler();
    await verifyNotifications(c.depsWith(s));
    await syncNotifications(c.depsWith(s));
    expect(s.store.has('mg1:test')).toBe(true);
  });
});

describe('attese contro presenti', () => {
  it('prima della sync mancano tutte; dopo la sync nessuna; riporta la prossima notifica', async () => {
    const { c, r } = await withReminder();
    const s = new FakeScheduler();
    const before = await verifyNotifications(c.depsWith(s));
    expect(before).toMatchObject({ expected: 5, present: 0, missing: 5 });
    expect(before.next).toEqual({ date: '2026-10-15', time: '09:00', title: 'Gommista', body: 'Panda: scade il 22/10/2026 (tra 7 giorni)' });
    await syncNotifications(c.depsWith(s));
    const after = await verifyNotifications(c.depsWith(s));
    expect(after).toMatchObject({ expected: 5, present: 5, missing: 0 });
    // una notifica con contenuto diverso nel sistema conta come mancante
    s.store.set(`mg1:${r}:0`, { ...s.store.get(`mg1:${r}:0`)!, hash: 'deadbeef' });
    expect((await verifyNotifications(c.depsWith(s))).missing).toBe(1);
  });

  it('senza promemoria: nessuna attesa e nessuna prossima notifica', async () => {
    const c = await setup();
    const rep = await verifyNotifications(c.depsWith(new FakeScheduler()));
    expect(rep).toMatchObject({ expected: 0, present: 0, missing: 0, next: null, testScheduled: true });
  });
});

describe('permesso mancante: guida in italiano', () => {
  it('bloccato: nessuna prova, guida e azione "Apri impostazioni"', async () => {
    const { c } = await withReminder();
    const s = new FakeScheduler('blocked');
    const rep = await verifyNotifications(c.depsWith(s));
    expect(rep).toMatchObject({ permission: 'blocked', testScheduled: false, testAt: null, nextAction: 'open-system-settings', guide: GUIDE_BLOCKED, expected: 5 });
    expect(GUIDE_BLOCKED).toContain('impostazioni');
    expect(s.systemCalls).toEqual([]);
    expect(s.calls.some((x) => x.op === 'requestPermission')).toBe(false);
  });

  it('negato ma richiedibile: guida e azione "Riprova", senza richiedere da solo', async () => {
    const { c } = await withReminder();
    const s = new FakeScheduler('denied');
    const rep = await verifyNotifications(c.depsWith(s));
    expect(rep).toMatchObject({ permission: 'denied', testScheduled: false, nextAction: 'retry-permission', guide: GUIDE_DENIED });
    expect(s.systemCalls).toEqual([]);
    expect(s.calls.some((x) => x.op === 'requestPermission')).toBe(false);
  });

  it('non ancora chiesto: lo chiede (l\'utente ha premuto "Verifica") e prosegue se concesso', async () => {
    const { c } = await withReminder();
    const s = new FakeScheduler('undetermined');
    s.requestResult = 'granted';
    const rep = await verifyNotifications(c.depsWith(s));
    expect(s.calls.filter((x) => x.op === 'requestPermission')).toHaveLength(1);
    expect(rep).toMatchObject({ permission: 'granted', testScheduled: true });
  });

  it('non ancora chiesto e rifiutato: guida "Riprova"; con requestIfUndetermined = false non chiede', async () => {
    const { c } = await withReminder();
    const s = new FakeScheduler('undetermined');
    s.requestResult = 'denied';
    expect(await verifyNotifications(c.depsWith(s))).toMatchObject({ permission: 'denied', testScheduled: false, nextAction: 'retry-permission' });
    const s2 = new FakeScheduler('undetermined');
    const rep = await verifyNotifications(c.depsWith(s2), { requestIfUndetermined: false });
    expect(rep).toMatchObject({ permission: 'undetermined', testScheduled: false, nextAction: 'retry-permission' });
    expect(s2.calls.some((x) => x.op === 'requestPermission')).toBe(false);
  });

  it('un errore dello scheduler nella prova si propaga', async () => {
    const { c } = await withReminder();
    const s = new FakeScheduler();
    s.failOn = 'schedule';
    await expect(verifyNotifications(c.depsWith(s))).rejects.toThrow('schedule fallita');
  });
});
