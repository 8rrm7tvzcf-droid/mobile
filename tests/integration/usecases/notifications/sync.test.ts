// syncNotifications: permesso -> piano (finestra 60 + sentinella) -> testi -> differenza per hash -> scheduler FINTO.
import { describe, expect, it } from 'vitest';
import type { PlannedNotification } from '@/domain/ports';
import { syncNotifications } from '@/usecases/notifications';
import { addGenerated, addItem, addManual, addReading, addVehicle, setSetting, setup } from '../queries/helpers';
import type { Ctx } from '../queries/helpers';
import { FakeScheduler } from './fakeScheduler';

const ops = (s: FakeScheduler): string[] => s.systemCalls.map((c) => c.op);
const keysOf = (s: FakeScheduler): string[] => s.scheduledSorted().map((n) => n.key);
const byKey = (s: FakeScheduler, key: string): PlannedNotification => s.store.get(key)!;

/** Auto 'Panda' (targa AB123CD) con un promemoria manuale che scade fra 14 giorni (22/10/2026). */
async function oneReminder(c: Ctx, o: Record<string, string | number | null> = {}): Promise<{ v: string; r: string }> {
  const v = await addVehicle(c, { plate: 'AB123CD' });
  const r = await addManual(c, v, 'Gommista', '2026-10-22', o);
  return { v, r };
}

describe('syncNotifications: programmazione e idempotenza', () => {
  it('prima sync: programma preavviso, giorno e ripetizioni dopo la scadenza, con i testi italiani', async () => {
    const c = await setup();
    const { v, r } = await oneReminder(c);
    const s = new FakeScheduler();
    const rep = await syncNotifications(c.depsWith(s));
    expect(rep).toEqual({ permission: 'granted', planned: 5, scheduled: 5, cancelled: 0, skippedUnchanged: false });
    expect(keysOf(s)).toEqual([`mg1:${r}:7`, `mg1:${r}:0`, `mg1:${r}:+1`, `mg1:${r}:+3`, `mg1:${r}:+7`]);

    const lead = byKey(s, `mg1:${r}:7`);
    expect(lead).toMatchObject({
      date: '2026-10-15', time: '09:00', channel: 'maintenance', title: 'Gommista', body: 'Panda: scade il 22/10/2026 (tra 7 giorni)',
      threadId: v, route: `mygarage://reminder/${r}`,
    });
    expect(lead.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(byKey(s, `mg1:${r}:0`)).toMatchObject({ date: '2026-10-22', body: 'Panda: scade oggi' });
    expect(byKey(s, `mg1:${r}:+1`)).toMatchObject({ date: '2026-10-23', body: 'Panda: scaduto da 1 giorno' });
    expect(byKey(s, `mg1:${r}:+7`)).toMatchObject({ date: '2026-10-29', body: 'Panda: scaduto da 7 giorni' });
    expect(s.calls.find((x) => x.op === 'schedule')!.timeZone).toBe('Europe/Rome');
  });

  it('seconda sync senza cambiamenti: ZERO chiamate di scheduling', async () => {
    const c = await setup();
    await oneReminder(c);
    const s = new FakeScheduler();
    await syncNotifications(c.depsWith(s));
    s.resetCalls();
    const rep = await syncNotifications(c.depsWith(s));
    expect(rep).toEqual({ permission: 'granted', planned: 5, scheduled: 0, cancelled: 0, skippedUnchanged: true });
    expect(ops(s)).toEqual(['listScheduled']); // solo la lettura dello stato del sistema
  });

  it('completando un promemoria si cancellano solo le sue notifiche', async () => {
    const c = await setup();
    const { r: r1 } = await oneReminder(c);
    const v2 = await addVehicle(c, { nickname: 'Golf' });
    const r2 = await addManual(c, v2, 'Cambio gomme', '2026-11-10');
    const s = new FakeScheduler();
    await syncNotifications(c.depsWith(s));
    const r1Keys = keysOf(s).filter((k) => k.startsWith(`mg1:${r1}:`));
    const r2Before = keysOf(s).filter((k) => k.startsWith(`mg1:${r2}:`));
    expect(r1Keys.length).toBe(5);
    s.resetCalls();

    await c.db.run(`UPDATE reminders SET status = 'done', completed_on = ? WHERE id = ?`, ['2026-10-08', r1]);
    const rep = await syncNotifications(c.depsWith(s));
    expect(rep).toMatchObject({ scheduled: 0, cancelled: 5, skippedUnchanged: false });
    expect(s.calls.find((x) => x.op === 'cancel')!.keys!.sort()).toEqual([...r1Keys].sort());
    expect(keysOf(s).filter((k) => k.startsWith(`mg1:${r2}:`))).toEqual(r2Before);
    expect(s.calls.some((x) => x.op === 'schedule')).toBe(false);
  });

  it('spostando la scadenza di un promemoria si riprogramma solo il suo, l\'altro resta invariato', async () => {
    const c = await setup();
    const { r: r1 } = await oneReminder(c);
    const v2 = await addVehicle(c, { nickname: 'Golf' });
    const r2 = await addManual(c, v2, 'Cambio gomme', '2026-11-10');
    const s = new FakeScheduler();
    await syncNotifications(c.depsWith(s));
    const r2Before = new Map([...s.store].filter(([k]) => k.startsWith(`mg1:${r2}:`)));
    s.resetCalls();

    await c.db.run(`UPDATE reminders SET due_on = ?, effective_due_on = ? WHERE id = ?`, ['2026-10-25', '2026-10-25', r1]);
    const rep = await syncNotifications(c.depsWith(s));
    expect(rep.scheduled).toBeGreaterThan(0);
    expect(rep.skippedUnchanged).toBe(false);
    const touched = [...(s.calls.find((x) => x.op === 'schedule')?.keys ?? []), ...(s.calls.find((x) => x.op === 'cancel')?.keys ?? [])];
    expect(touched.every((k) => k.startsWith(`mg1:${r1}:`))).toBe(true);
    for (const [k, n] of r2Before) expect(s.store.get(k)).toEqual(n);
    expect(byKey(s, `mg1:${r1}:0`).date).toBe('2026-10-25');
  });

  it('con avvisi spenti nelle impostazioni cancella tutto', async () => {
    const c = await setup();
    await oneReminder(c);
    const s = new FakeScheduler();
    await syncNotifications(c.depsWith(s));
    expect(s.store.size).toBe(5);
    await setSetting(c, 'notify.enabled', false);
    const rep = await syncNotifications(c.depsWith(s));
    expect(rep).toEqual({ permission: 'granted', planned: 0, scheduled: 0, cancelled: 5, skippedUnchanged: false });
    expect(s.store.size).toBe(0);
  });

  it('un errore dello scheduler si propaga (lo registra il coordinatore)', async () => {
    const c = await setup();
    await oneReminder(c);
    const s = new FakeScheduler();
    s.failOn = 'schedule';
    await expect(syncNotifications(c.depsWith(s))).rejects.toThrow('schedule fallita');
  });

  it('non scrive mai sul database (nemmeno la cache notification_schedule)', async () => {
    const c = await setup();
    await oneReminder(c);
    const count = async (t: string): Promise<number> => (await c.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))!.n;
    const before = [await count('reminders'), await count('notification_schedule'), await count('app_settings')];
    await syncNotifications(c.depsWith(new FakeScheduler()));
    expect([await count('reminders'), await count('notification_schedule'), await count('app_settings')]).toEqual(before);
    expect(c.bus.events).toEqual([]);
  });
});

describe('syncNotifications: permesso', () => {
  it.each(['denied', 'blocked', 'undetermined'] as const)('permesso %s: non fallisce, nessuna chiamata di scheduling, lo riporta', async (permission) => {
    const c = await setup();
    await oneReminder(c);
    const s = new FakeScheduler(permission);
    const rep = await syncNotifications(c.depsWith(s));
    expect(rep).toEqual({ permission, planned: 5, scheduled: 0, cancelled: 0, skippedUnchanged: false });
    expect(s.systemCalls).toEqual([]);
    expect(s.calls.some((x) => x.op === 'requestPermission')).toBe(false); // la sync non chiede mai il permesso
  });

  it('quando il permesso arriva, la sync successiva programma tutto', async () => {
    const c = await setup();
    await oneReminder(c);
    const s = new FakeScheduler('denied');
    await syncNotifications(c.depsWith(s));
    s.permission = 'granted';
    const rep = await syncNotifications(c.depsWith(s));
    expect(rep).toMatchObject({ permission: 'granted', scheduled: 5 });
  });
});

describe('syncNotifications: contenuto e privacy', () => {
  it('privacy generic (predefinita): soprannome e MAI la targa; senza soprannome "Marca Modello"', async () => {
    const c = await setup();
    await oneReminder(c);
    const v2 = await addVehicle(c, { nickname: null, make: 'Fiat', model: 'Tipo', plate: 'ZZ999ZZ' });
    await addManual(c, v2, 'Tagliando', '2026-10-22');
    const s = new FakeScheduler();
    await syncNotifications(c.depsWith(s));
    const bodies = [...s.store.values()].map((n) => n.body);
    expect(bodies.some((b) => b.startsWith('Panda: '))).toBe(true);
    expect(bodies.some((b) => b.startsWith('Fiat Tipo: '))).toBe(true);
    expect(bodies.join('|')).not.toMatch(/AB123CD|ZZ999ZZ/);
  });

  it('privacy full: aggiunge la targa dopo il soprannome', async () => {
    const c = await setup();
    const { r } = await oneReminder(c);
    await setSetting(c, 'notify.privacy', 'full');
    const s = new FakeScheduler();
    await syncNotifications(c.depsWith(s));
    expect(byKey(s, `mg1:${r}:7`).body).toBe('Panda · AB123CD: scade il 22/10/2026 (tra 7 giorni)');
  });

  it('cambiando la privacy si riscrivono i testi (hash diverso)', async () => {
    const c = await setup();
    await oneReminder(c);
    const s = new FakeScheduler();
    await syncNotifications(c.depsWith(s));
    s.resetCalls();
    await setSetting(c, 'notify.privacy', 'full');
    const rep = await syncNotifications(c.depsWith(s));
    expect(rep).toMatchObject({ scheduled: 5, cancelled: 5 });
  });

  it('scadenza a km: "stimata", senza cifre di km nel testo', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    await addReading(c, v, '2026-07-10', 25000);
    await addReading(c, v, '2026-10-01', 27000);
    const r = await addManual(c, v, 'Cambio olio', null, { due_km: 28200, effective_due_on: '2026-11-19', due_trigger: 'km' });
    const s = new FakeScheduler();
    await syncNotifications(c.depsWith(s));
    expect(byKey(s, `mg1:${r}:7`).body).toBe('Panda: scadenza stimata il 19/11/2026 (tra circa 7 giorni)');
    expect(byKey(s, `mg1:${r}:7`).date).toBe('2026-11-12');
    expect(byKey(s, `mg1:${r}:0`).body).toBe('Panda: scadenza prevista oggi (stima in base ai km)');
    expect(byKey(s, `mg1:${r}:+1`).body).toBe('Panda: probabilmente scaduto da 1 giorno');
    for (const n of s.store.values()) expect(n.body).not.toMatch(/\d\.?\d{3}\s*km|27000|28200/);
  });

  it('canali per categoria: legale e assicurazione = deadlines, controlli = checks, il resto = maintenance', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    const ids: Record<string, string> = {};
    for (const cat of ['legal', 'insurance', 'check', 'tyres', 'maintenance', 'other']) {
      ids[cat] = await addManual(c, v, `Voce ${cat}`, '2026-10-12', { category: cat, notify_offsets_days: '[0]' });
    }
    const s = new FakeScheduler();
    await syncNotifications(c.depsWith(s));
    const channel = (cat: string): string => byKey(s, `mg1:${ids[cat]}:0`).channel;
    expect([channel('legal'), channel('insurance'), channel('check'), channel('tyres'), channel('maintenance'), channel('other')]).toEqual([
      'deadlines', 'deadlines', 'checks', 'maintenance', 'maintenance', 'maintenance',
    ]);
  });

  it('un promemoria scaduto da giorni: solo le ripetizioni ancora future, con il testo "scaduto da N giorni"', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    const r = await addManual(c, v, 'Revisione', '2026-10-05', { category: 'legal' });
    const s = new FakeScheduler();
    await syncNotifications(c.depsWith(s));
    // legale: +1 (06/10) gia' passata; +3 = oggi alle 09:00 (fra poco), +7, +14, +30
    expect(keysOf(s)).toEqual([`mg1:${r}:+3`, `mg1:${r}:+7`, `mg1:${r}:+14`, `mg1:${r}:+30`]);
    expect(byKey(s, `mg1:${r}:+3`)).toMatchObject({ date: '2026-10-08', time: '09:00', channel: 'deadlines', body: 'Panda: scaduto da 3 giorni' });
  });

  it("orario personalizzato (notify.time) e orario del promemoria manuale; un orario non valido ripiega su 09:00", async () => {
    const c = await setup();
    const { r } = await oneReminder(c);
    const t = await addManual(c, (await c.db.get<{ id: string }>('SELECT id FROM vehicles'))!.id, 'Con orario', '2026-10-22', { due_time: '18:30' });
    await setSetting(c, 'notify.time', '08:15');
    const s = new FakeScheduler();
    await syncNotifications(c.depsWith(s));
    expect(byKey(s, `mg1:${r}:7`).time).toBe('08:15');
    expect(byKey(s, `mg1:${r}:0`).time).toBe('08:15');
    expect(byKey(s, `mg1:${t}:0`).time).toBe('18:30');
    await setSetting(c, 'notify.time', '25:99');
    await syncNotifications(c.depsWith(s));
    expect(byKey(s, `mg1:${r}:7`).time).toBe('09:00');
  });

  it('un cambio di fuso orario ripianifica tutto (gli istanti sarebbero sbagliati)', async () => {
    const c = await setup();
    await oneReminder(c);
    const s = new FakeScheduler();
    await syncNotifications(c.depsWith(s));
    s.resetCalls();
    Object.assign(c.clock, { timeZone: () => 'Europe/London' });
    const rep = await syncNotifications(c.depsWith(s));
    expect(rep).toMatchObject({ scheduled: 5, cancelled: 5 });
    expect(s.calls.find((x) => x.op === 'schedule')!.timeZone).toBe('Europe/London');
  });
});

describe('syncNotifications: snooze e promemoria esclusi', () => {
  it('un promemoria rimandato perde i preavvisi prima della fine e riceve un avviso "snz" alla fine', async () => {
    const c = await setup();
    const { r } = await oneReminder(c);
    await c.db.run('UPDATE reminders SET snoozed_until = ? WHERE id = ?', ['2026-10-16T09:00:00.000Z', r]);
    const s = new FakeScheduler();
    await syncNotifications(c.depsWith(s));
    expect(keysOf(s)).toEqual([`mg1:${r}:snz`, `mg1:${r}:0`, `mg1:${r}:+1`, `mg1:${r}:+3`, `mg1:${r}:+7`]);
    expect(byKey(s, `mg1:${r}:snz`)).toMatchObject({ date: '2026-10-16', time: '09:00', body: 'Panda: promemoria rimandato: è ora di occuparsene' });
  });

  it('lo snooze "dopo N km" termina quando i km sono raggiunti: tornano le notifiche normali', async () => {
    const c = await setup();
    const { v, r } = await oneReminder(c);
    await c.db.run('UPDATE reminders SET snoozed_until = ?, snooze_until_km = ? WHERE id = ?', ['2026-11-07T09:00:00.000Z', 27500, r]);
    await addReading(c, v, '2026-10-05', 27000);
    const s = new FakeScheduler();
    await syncNotifications(c.depsWith(s));
    expect(keysOf(s)).toEqual([`mg1:${r}:snz`]); // ancora rimandato: nulla prima del 07/11, solo l'avviso di fine snooze
    await addReading(c, v, '2026-10-07', 27600);
    await syncNotifications(c.depsWith(s));
    expect(keysOf(s)).toEqual([`mg1:${r}:7`, `mg1:${r}:0`, `mg1:${r}:+1`, `mg1:${r}:+3`, `mg1:${r}:+7`]);
  });

  it('esclude auto vendute o nel cestino, voci spente o senza avvisi, promemoria chiusi o cancellati', async () => {
    const c = await setup();
    const sold = await addVehicle(c, { status: 'sold', sold_on: '2026-09-01' });
    await addManual(c, sold, 'Auto venduta', '2026-10-22');
    const trash = await addVehicle(c, { deleted_at: '2026-09-01T10:00:00.000Z' });
    await addManual(c, trash, 'Nel cestino', '2026-10-22');
    const v = await addVehicle(c);
    await addManual(c, v, 'Chiuso', '2026-10-22', { status: 'done', completed_on: '2026-10-01' });
    await addManual(c, v, 'Cancellato', '2026-10-22', { deleted_at: '2026-10-02T10:00:00.000Z' });
    const off = await addItem(c, v, { name: 'Spenta', is_active: 0 });
    await addGenerated(c, v, off, 'Spenta', { due_on: '2026-10-22', effective_due_on: '2026-10-22' });
    const quiet = await addItem(c, v, { name: 'Senza avvisi', notify_enabled: 0 });
    await addGenerated(c, v, quiet, 'Senza avvisi', { due_on: '2026-10-22', effective_due_on: '2026-10-22' });
    await addManual(c, v, 'Solo km senza previsione', null, { due_km: 30000 }); // nessuna data effettiva: niente notifiche
    const s = new FakeScheduler();
    const rep = await syncNotifications(c.depsWith(s));
    expect(rep).toMatchObject({ planned: 0, scheduled: 0, skippedUnchanged: true });
    expect(s.store.size).toBe(0);
  });

  it('una voce attiva con avvisi accesi notifica come un promemoria normale', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    const item = await addItem(c, v, { name: 'Cambio olio' });
    const r = await addGenerated(c, v, item, 'Cambio olio', { due_on: '2026-10-22', effective_due_on: '2026-10-22', due_trigger: 'time' });
    const s = new FakeScheduler();
    await syncNotifications(c.depsWith(s));
    expect(byKey(s, `mg1:${r}:7`).title).toBe('Cambio olio');
  });
});

describe('syncNotifications: finestra e sentinella', () => {
  it('oltre 60 candidate: 59 notifiche piu\' la sentinella "Apri l\'app"', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    for (let i = 0; i < 70; i++) {
      await addManual(c, v, `Voce ${String(i).padStart(2, '0')}`, `2027-0${1 + (i % 9)}-15`, { notify_offsets_days: '[0]' });
    }
    const s = new FakeScheduler();
    const rep = await syncNotifications(c.depsWith(s));
    expect(rep.planned).toBe(60);
    expect(s.store.size).toBe(60);
    const sentinel = byKey(s, 'mg1:sentinel');
    expect(sentinel).toMatchObject({ channel: 'system', title: 'MyGarage', body: "Apri l'app per aggiornare i tuoi promemoria." });
    expect(sentinel.threadId).toBeUndefined();
    // tutti i promemoria hanno almeno un avviso (prima passata)
    const reminders = new Set([...s.store.keys()].filter((k) => k !== 'mg1:sentinel').map((k) => k.split(':')[1]));
    expect(reminders.size).toBe(59);
    // seconda sync: invariata
    s.resetCalls();
    expect((await syncNotifications(c.depsWith(s))).skippedUnchanged).toBe(true);
  });

  it('il tetto e\' notify.maxScheduled', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    for (let i = 0; i < 12; i++) await addManual(c, v, `Voce ${i}`, '2027-01-15', { notify_offsets_days: '[0]' });
    await setSetting(c, 'notify.maxScheduled', 10);
    const s = new FakeScheduler();
    const rep = await syncNotifications(c.depsWith(s));
    expect(rep.planned).toBe(10);
    expect(s.store.has('mg1:sentinel')).toBe(true);
  });

  it('rientrando sotto il tetto la sentinella viene cancellata', async () => {
    const c = await setup();
    const v = await addVehicle(c);
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push(await addManual(c, v, `Voce ${i}`, '2027-01-15', { notify_offsets_days: '[0]' }));
    await setSetting(c, 'notify.maxScheduled', 10);
    const s = new FakeScheduler();
    await syncNotifications(c.depsWith(s));
    expect(s.store.has('mg1:sentinel')).toBe(true);
    for (const id of ids.slice(0, 10)) await c.db.run(`UPDATE reminders SET status = 'done', completed_on = '2026-10-08' WHERE id = ?`, [id]);
    await syncNotifications(c.depsWith(s));
    expect(s.store.has('mg1:sentinel')).toBe(false);
  });
});

describe('syncNotifications: chiavi non nostre', () => {
  it('ignora le chiavi che non iniziano per mg1:, non tocca la notifica di prova e toglie le nostre obsolete', async () => {
    const c = await setup();
    await oneReminder(c);
    const s = new FakeScheduler();
    const stub = (key: string): PlannedNotification => ({ key, hash: 'aaaaaaaa', date: '2026-12-01', time: '09:00', channel: 'system', title: 't', body: 'b' });
    for (const key of ['altra-app:1', 'mg1:test', 'mg1:vecchio:0']) s.store.set(key, stub(key));
    await syncNotifications(c.depsWith(s));
    expect(s.store.has('altra-app:1')).toBe(true);
    expect(s.store.has('mg1:test')).toBe(true);
    expect(s.store.has('mg1:vecchio:0')).toBe(false);
    expect(s.calls.find((x) => x.op === 'cancel')!.keys).toEqual(['mg1:vecchio:0']);
  });
});
