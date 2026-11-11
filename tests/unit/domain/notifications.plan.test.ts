import { describe, expect, it } from 'vitest';
import {
  channelForCategory,
  diffScheduled,
  fnv1a,
  isOurKey,
  KEY_PREFIX,
  notificationHash,
  OVERDUE_REPEAT,
  planNotifications,
  reminderKey,
  SENTINEL_KEY,
} from '@/domain/notifications';
import type { NotifiableReminder } from '@/domain/notifications';

/** Oggi 2026-10-07 alle 08:00 locali; ora di default 09:00. */
const NOW = { date: '2026-10-07', time: '08:00' } as const;

const r = (over: Partial<NotifiableReminder> & Pick<NotifiableReminder, 'id' | 'category' | 'effectiveDueOn' | 'notifyOffsetsDays'>): NotifiableReminder => ({
  status: 'open',
  notifyEnabled: true,
  ...over,
});

// Promemoria del vettore V12: R1 revisione 30/10 [30,14,7,0]; R2 tagliando 06/11 [14,3,0];
// R3 pressione gomme 08/10 [0] (categoria check); R4 RCA 10/05/2027 [30,14,7,1,0]
const R1 = r({ id: 'R1', category: 'legal', effectiveDueOn: '2026-10-30', notifyOffsetsDays: [30, 14, 7, 0] });
const R2 = r({ id: 'R2', category: 'maintenance', effectiveDueOn: '2026-11-06', notifyOffsetsDays: [14, 3, 0] });
const R3 = r({ id: 'R3', category: 'check', effectiveDueOn: '2026-10-08', notifyOffsetsDays: [0] });
const R4 = r({ id: 'R4', category: 'insurance', effectiveDueOn: '2027-05-10', notifyOffsetsDays: [30, 14, 7, 1, 0] });
const ALL = [R1, R2, R3, R4];

const keys = (items: { key: string }[]) => items.map((i) => i.key);

describe('vettori V12: pianificazione notifiche', () => {
  it('V12a con maxScheduled = 6: una per promemoria poi le piu vicine, sentinella al 30/10 alle 09:00', () => {
    const plan = planNotifications({ reminders: ALL, nowLocal: NOW, maxScheduled: 6 });
    expect(keys(plan.items)).toEqual(['mg1:R3:0', 'mg1:R1:14', 'mg1:R1:7', 'mg1:R2:14', 'mg1:R4:30']);
    expect(plan.items.map((i) => [i.date, i.time])).toEqual([
      ['2026-10-08', '09:00'],
      ['2026-10-16', '09:00'],
      ['2026-10-23', '09:00'],
      ['2026-10-23', '09:00'],
      ['2027-04-10', '09:00'],
    ]);
    expect(plan.sentinel).toEqual({ key: 'mg1:sentinel', reminderId: null, kind: 'sentinel', date: '2026-10-30', time: '09:00' });
    expect(plan.overflow).toBe(20);
    // il piano prende la PROSSIMA notifica di ogni promemoria (anche R4, lontanissima) prima di riempire con le piu vicine
    expect(new Set(plan.items.map((i) => i.reminderId))).toEqual(new Set(['R1', 'R2', 'R3', 'R4']));
  });

  it('V12a a parita di istante la scadenza legale precede la manutenzione (rango)', () => {
    const plan = planNotifications({ reminders: [R2, R1], nowLocal: NOW, maxScheduled: 60 });
    const at = plan.items.filter((i) => i.date === '2026-10-23').map((i) => i.key);
    expect(at).toEqual(['mg1:R1:7', 'mg1:R2:14']);
  });

  it('V12b con maxScheduled = 60 entrano tutte, nessuna sentinella', () => {
    const plan = planNotifications({ reminders: ALL, nowLocal: NOW, maxScheduled: 60 });
    expect(plan.items).toHaveLength(25);
    expect(plan.sentinel).toBeNull();
    expect(plan.overflow).toBe(0);
    // ordine cronologico
    const stamps = plan.items.map((i) => `${i.date}T${i.time}`);
    expect([...stamps].sort()).toEqual(stamps);
  });

  it('V12b con i soli 3 promemoria reali (revisione, tagliando, pressione) entrano tutte senza sentinella', () => {
    const plan = planNotifications({ reminders: [R1, R2, R3], nowLocal: NOW });
    expect(plan.items).toHaveLength(15);
    expect(plan.sentinel).toBeNull();
  });

  it('V12c R1 rimandata al 20/10 09:00: spariscono le precedenti, compare snz il 20/10 poi 23/10 e 30/10', () => {
    const snoozed = { ...R1, snoozedUntilLocal: { date: '2026-10-20', time: '09:00' } };
    const plan = planNotifications({ reminders: [snoozed], nowLocal: NOW });
    const mine = plan.items.filter((i) => i.reminderId === 'R1');
    expect(keys(mine).slice(0, 3)).toEqual(['mg1:R1:snz', 'mg1:R1:7', 'mg1:R1:0']);
    expect(mine.slice(0, 3).map((i) => i.date)).toEqual(['2026-10-20', '2026-10-23', '2026-10-30']);
    expect(mine[0]).toMatchObject({ kind: 'snoozed', time: '09:00' });
    expect(keys(mine)).not.toContain('mg1:R1:14');
    // le ripetizioni dopo la scadenza restano
    expect(keys(mine)).toContain('mg1:R1:+1');
  });

  it('V12c uno snooze gia finito (o con fine nel passato) non cambia nulla', () => {
    const past = { ...R1, snoozedUntilLocal: { date: '2026-10-07', time: '07:00' } };
    expect(planNotifications({ reminders: [past], nowLocal: NOW })).toEqual(planNotifications({ reminders: [R1], nowLocal: NOW }));
  });

  it('V12d un controllo scaduto da mesi non genera notifiche (i controlli non si ripetono a oltranza)', () => {
    const stale = r({ id: 'C1', category: 'check', effectiveDueOn: '2026-05-01', notifyOffsetsDays: [0] });
    const plan = planNotifications({ reminders: [stale], nowLocal: NOW });
    expect(plan.items).toEqual([]);
    expect(plan.sentinel).toBeNull();
    expect(OVERDUE_REPEAT.check).toEqual([]);
  });

  it('V12e RCA scaduta il 27/09: restano le ripetizioni +14 e +30 (i preavvisi sono nel passato)', () => {
    const expired = { ...R4, effectiveDueOn: '2026-09-27' };
    const plan = planNotifications({ reminders: [expired], nowLocal: NOW });
    expect(keys(plan.items)).toEqual(['mg1:R4:+14', 'mg1:R4:+30']);
    expect(plan.items.map((i) => i.date)).toEqual(['2026-10-11', '2026-10-27']);
    expect(plan.items.every((i) => i.kind === 'overdue')).toBe(true);
  });

  it('V12f diffScheduled: stesso hash invariata, hash diverso riprogrammata, assente cancellata, chiavi non nostre ignorate', () => {
    const desired = [
      { key: 'mg1:A:0', hash: 'h1' },
      { key: 'mg1:B:0', hash: 'h2new' },
      { key: 'mg1:D:0', hash: 'h4' },
    ];
    const existing = [
      { key: 'mg1:A:0', hash: 'h1' },
      { key: 'mg1:B:0', hash: 'h2old' },
      { key: 'mg1:C:0', hash: 'h3' },
      { key: 'other:1', hash: 'x' },
      { key: 'ag1:vecchia', hash: 'y' }, // formato precedente: non e' nostra
    ];
    const d = diffScheduled(desired, existing);
    expect(d.cancel.sort()).toEqual(['mg1:B:0', 'mg1:C:0']);
    expect(d.schedule).toEqual([
      { key: 'mg1:B:0', hash: 'h2new' },
      { key: 'mg1:D:0', hash: 'h4' },
    ]);
    // seconda sincronizzazione = 0 operazioni
    const again = diffScheduled(desired, desired);
    expect(again.cancel).toEqual([]);
    expect(again.schedule).toEqual([]);
  });
});

describe('candidate: chiavi, preavvisi e ripetizioni', () => {
  it('chiavi mg1:<id>:<offset>, +N per le ripetizioni, snz per lo snooze', () => {
    expect(KEY_PREFIX).toBe('mg1:');
    expect(SENTINEL_KEY).toBe('mg1:sentinel');
    expect(reminderKey('01ABC', '30')).toBe('mg1:01ABC:30');
    expect(reminderKey('01ABC', '+7')).toBe('mg1:01ABC:+7');
    expect(isOurKey('mg1:xyz')).toBe(true);
    expect(isOurKey('ag1:xyz')).toBe(false);
    expect(isOurKey('expo-notification')).toBe(false);
  });

  it('un legale ha preavvisi e ripetizioni +1,+3,+7,+14,+30; una manutenzione +1,+3,+7', () => {
    const legal = planNotifications({ reminders: [R1], nowLocal: { date: '2026-10-01', time: '00:00' }, maxScheduled: 100 });
    // il preavviso di 30 giorni cadrebbe il 30/09, gia passato rispetto all'1/10: non entra
    expect(keys(legal.items)).toEqual([
      'mg1:R1:14',
      'mg1:R1:7',
      'mg1:R1:0',
      'mg1:R1:+1',
      'mg1:R1:+3',
      'mg1:R1:+7',
      'mg1:R1:+14',
      'mg1:R1:+30',
    ]);
    const maint = planNotifications({ reminders: [R2], nowLocal: NOW, maxScheduled: 100 });
    expect(keys(maint.items)).toEqual(['mg1:R2:14', 'mg1:R2:3', 'mg1:R2:0', 'mg1:R2:+1', 'mg1:R2:+3', 'mg1:R2:+7']);
  });

  it('il giorno 0 usa l orario del promemoria manuale; gli altri avvisi l ora di default', () => {
    const manual = r({ id: 'M', category: 'other', effectiveDueOn: '2026-10-20', notifyOffsetsDays: [1, 0], dueTime: '18:30' });
    const plan = planNotifications({ reminders: [manual], nowLocal: NOW, maxScheduled: 100 });
    expect(plan.items.find((i) => i.key === 'mg1:M:1')).toMatchObject({ date: '2026-10-19', time: '09:00', kind: 'lead' });
    expect(plan.items.find((i) => i.key === 'mg1:M:0')).toMatchObject({ date: '2026-10-20', time: '18:30', kind: 'due' });
  });

  it('l ora dei preavvisi e configurabile (notify.time)', () => {
    const plan = planNotifications({ reminders: [R3], nowLocal: NOW, notifyTime: '10:15' });
    expect(plan.items[0]).toMatchObject({ key: 'mg1:R3:0', time: '10:15' });
  });

  it('solo le candidate FUTURE: un istante gia passato oggi non entra, quello alle 09:00 di oggi si', () => {
    const today = r({ id: 'T', category: 'maintenance', effectiveDueOn: '2026-10-07', notifyOffsetsDays: [0] });
    expect(planNotifications({ reminders: [today], nowLocal: { date: '2026-10-07', time: '08:59' }, maxScheduled: 100 }).items[0]?.key).toBe('mg1:T:0');
    expect(planNotifications({ reminders: [today], nowLocal: { date: '2026-10-07', time: '09:00' }, maxScheduled: 100 }).items[0]?.key).toBe('mg1:T:+1');
  });

  it('ignora promemoria non aperti, con notifiche disattivate o senza scadenza (stato unknown)', () => {
    const done = { ...R1, id: 'D', status: 'done' as const };
    const skipped = { ...R1, id: 'S', status: 'skipped' as const };
    const off = { ...R1, id: 'O', notifyEnabled: false };
    const noDate = { ...R1, id: 'N', effectiveDueOn: null };
    expect(planNotifications({ reminders: [done, skipped, off, noDate], nowLocal: NOW }).items).toEqual([]);
  });

  it('offset duplicati si fondono, e l ordine dei preavvisi in ingresso non conta', () => {
    const a = r({ id: 'X', category: 'maintenance', effectiveDueOn: '2026-12-01', notifyOffsetsDays: [0, 7, 7, 14] });
    const b = r({ id: 'X', category: 'maintenance', effectiveDueOn: '2026-12-01', notifyOffsetsDays: [14, 7, 0] });
    expect(planNotifications({ reminders: [a], nowLocal: NOW })).toEqual(planNotifications({ reminders: [b], nowLocal: NOW }));
  });

  it('promemoria senza preavvisi: restano solo le ripetizioni dopo la scadenza', () => {
    const none = r({ id: 'Z', category: 'maintenance', effectiveDueOn: '2026-10-05', notifyOffsetsDays: [] });
    const plan = planNotifications({ reminders: [none], nowLocal: NOW });
    expect(keys(plan.items)).toEqual(['mg1:Z:+3', 'mg1:Z:+7']);
  });

  it('maxScheduled minore di 1: nessuna notifica e nessuna sentinella', () => {
    const plan = planNotifications({ reminders: ALL, nowLocal: NOW, maxScheduled: 0 });
    expect(plan.items).toEqual([]);
    expect(plan.sentinel).toBeNull();
    expect(plan.overflow).toBe(25);
  });

  it('maxScheduled = 1: solo la sentinella (uno slot riservato)', () => {
    const plan = planNotifications({ reminders: ALL, nowLocal: NOW, maxScheduled: 1 });
    expect(plan.items).toEqual([]);
    expect(plan.sentinel).toMatchObject({ key: 'mg1:sentinel', date: '2026-10-08', time: '09:00' });
  });

  it('e una funzione pura: stesso input, stesso piano, anche con i promemoria in ordine diverso', () => {
    const a = planNotifications({ reminders: ALL, nowLocal: NOW, maxScheduled: 6 });
    const b = planNotifications({ reminders: [...ALL].reverse(), nowLocal: NOW, maxScheduled: 6 });
    expect(b).toEqual(a);
  });
});

describe('hash di contenuto e canali', () => {
  it('fnv1a: vettori standard FNV-1a a 32 bit', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('foobar')).toBe('bf9cf968');
  });

  it('notificationHash cambia con data, ora, canale, titolo o testo; resta uguale se non cambia nulla', () => {
    const base = { date: '2026-10-16', time: '09:00', channel: 'deadlines', title: 'Revisione', body: 'Panda: scade il 30/10/2026 (tra 14 giorni)' };
    const h = notificationHash(base);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(notificationHash({ ...base })).toBe(h);
    expect(notificationHash({ ...base, date: '2026-10-17' })).not.toBe(h);
    expect(notificationHash({ ...base, time: '09:01' })).not.toBe(h);
    expect(notificationHash({ ...base, channel: 'maintenance' })).not.toBe(h);
    expect(notificationHash({ ...base, title: 'Revisione auto' })).not.toBe(h);
    expect(notificationHash({ ...base, body: 'Panda: scade il 31/10/2026 (tra 15 giorni)' })).not.toBe(h);
  });

  it('i canali seguono la categoria: scadenze di legge e assicurazione in deadlines, controlli in checks', () => {
    expect(channelForCategory('legal')).toBe('deadlines');
    expect(channelForCategory('insurance')).toBe('deadlines');
    expect(channelForCategory('maintenance')).toBe('maintenance');
    expect(channelForCategory('tyres')).toBe('maintenance');
    expect(channelForCategory('other')).toBe('maintenance');
    expect(channelForCategory('check')).toBe('checks');
  });
});
