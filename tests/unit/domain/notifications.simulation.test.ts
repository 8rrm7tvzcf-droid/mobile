import { describe, expect, it } from 'vitest';
import { addDays } from '@/domain/dates';
import { diffScheduled, notificationHash, planNotifications } from '@/domain/notifications';
import type { NotifiableReminder } from '@/domain/notifications';
import type { ReminderCategory } from '@/domain/reminders';

/** Simulazione data.md 4.4 / 4.8: 28 promemoria (2 veicoli x 14 voci) x ~9 candidate sotto il tetto di 60. */
const TODAY = '2026-10-07';
const NOW = { date: TODAY, time: '08:00' } as const;

const TEMPLATES: { name: string; category: ReminderCategory; offsets: number[] }[] = [
  { name: 'revisione', category: 'legal', offsets: [60, 30, 14, 7, 0] },
  { name: 'bollo', category: 'legal', offsets: [30, 14, 7, 0] },
  { name: 'rca', category: 'insurance', offsets: [30, 14, 7, 1, 0] },
  { name: 'rata', category: 'insurance', offsets: [7, 1, 0] },
  { name: 'tagliando', category: 'maintenance', offsets: [30, 14, 7, 3, 0] },
  { name: 'olio', category: 'maintenance', offsets: [30, 14, 7, 3, 0] },
  { name: 'freni', category: 'maintenance', offsets: [30, 14, 7, 3, 0] },
  { name: 'filtri', category: 'maintenance', offsets: [30, 14, 7, 3, 0] },
  { name: 'cinghia', category: 'maintenance', offsets: [30, 14, 7, 3, 0] },
  { name: 'batteria', category: 'maintenance', offsets: [30, 14, 7, 3, 0] },
  { name: 'gomme invernali', category: 'tyres', offsets: [30, 14, 7, 0] },
  { name: 'gomme estive', category: 'tyres', offsets: [30, 14, 7, 0] },
  { name: 'pressione gomme', category: 'check', offsets: [14, 7, 0] },
  { name: 'livello olio', category: 'check', offsets: [14, 7, 0] },
];

function build(): NotifiableReminder[] {
  const out: NotifiableReminder[] = [];
  for (let v = 0; v < 2; v++) {
    TEMPLATES.forEach((t, i) => {
      const n = v * TEMPLATES.length + i;
      out.push({
        id: `v${v}-${t.name.replace(/ /g, '-')}`,
        category: t.category,
        status: 'open',
        notifyEnabled: true,
        // scadenze sparse fra 3 e ~400 giorni da oggi (deterministiche)
        effectiveDueOn: addDays(TODAY, 3 + ((n * 37) % 400)),
        notifyOffsetsDays: t.offsets,
      });
    });
  }
  return out;
}

describe('simulazione: 28 promemoria sotto il tetto di 60 notifiche', () => {
  const reminders = build();
  const all = planNotifications({ reminders, nowLocal: NOW, maxScheduled: 10_000 });
  const plan = planNotifications({ reminders, nowLocal: NOW, maxScheduled: 60 });

  it('ci sono davvero 28 promemoria e molte piu candidate del tetto', () => {
    expect(reminders).toHaveLength(28);
    expect(all.items.length).toBeGreaterThan(150);
    expect(all.sentinel).toBeNull();
  });

  it('il piano contiene 60 notifiche (59 + sentinella) e il resto rimane fuori', () => {
    expect(plan.items).toHaveLength(59);
    expect(plan.sentinel).not.toBeNull();
    expect(plan.items.length + 1).toBe(60);
    expect(plan.overflow).toBe(all.items.length - 59);
  });

  it('TUTTI i 28 promemoria hanno almeno una notifica (passata 1)', () => {
    const covered = new Set(plan.items.map((i) => i.reminderId));
    expect(covered.size).toBe(28);
    for (const r of reminders) expect(covered.has(r.id)).toBe(true);
  });

  it('per ogni promemoria e inclusa la sua PROSSIMA notifica', () => {
    for (const r of reminders) {
      const first = all.items.find((i) => i.reminderId === r.id);
      expect(first, r.id).toBeDefined();
      expect(plan.items.map((i) => i.key)).toContain(first!.key);
    }
  });

  it('la sentinella cade all istante della prima notifica rimasta fuori', () => {
    const chosen = new Set(plan.items.map((i) => i.key));
    const firstOut = all.items.find((i) => !chosen.has(i.key))!;
    expect(plan.sentinel).toEqual({
      key: 'mg1:sentinel',
      reminderId: null,
      kind: 'sentinel',
      date: firstOut.date,
      time: firstOut.time,
    });
  });

  it('le notifiche scelte sono future, uniche e in ordine cronologico; passata 2 = le piu vicine', () => {
    const keysOf = plan.items.map((i) => i.key);
    expect(new Set(keysOf).size).toBe(keysOf.length);
    const stamps = plan.items.map((i) => `${i.date}T${i.time}`);
    expect([...stamps].sort()).toEqual(stamps);
    expect(stamps.every((s) => s > `${NOW.date}T${NOW.time}`)).toBe(true);
    // ogni notifica esclusa e piu lontana (o pari) della piu lontana fra quelle "di riempimento"; verifichiamo
    // che nessuna esclusa preceda la sentinella
    const chosen = new Set(keysOf);
    const excluded = all.items.filter((i) => !chosen.has(i.key));
    expect(excluded.length).toBe(plan.overflow);
    const sentinelStamp = `${plan.sentinel!.date}T${plan.sentinel!.time}`;
    expect(excluded.every((i) => `${i.date}T${i.time}` >= sentinelStamp)).toBe(true);
  });

  it('l ordine in ingresso non cambia il piano', () => {
    const shuffled = [...reminders].sort((a, b) => (a.id < b.id ? 1 : -1));
    expect(planNotifications({ reminders: shuffled, nowLocal: NOW, maxScheduled: 60 })).toEqual(plan);
  });

  it('sincronizzazioni successive: la prima programma tutto, la seconda e a zero operazioni', () => {
    const desired = [...plan.items, plan.sentinel!].map((p) => ({
      key: p.key,
      hash: notificationHash({ date: p.date, time: p.time, channel: 'x', title: p.key, body: p.kind }),
    }));
    const first = diffScheduled(desired, []);
    expect(first.schedule).toHaveLength(60);
    expect(first.cancel).toEqual([]);
    const second = diffScheduled(desired, first.schedule);
    expect(second.schedule).toEqual([]);
    expect(second.cancel).toEqual([]);
  });

  it('la finestra scorre: avanzando di una settimana la sentinella si sposta in avanti', () => {
    const later = planNotifications({ reminders, nowLocal: { date: addDays(TODAY, 7), time: '08:00' }, maxScheduled: 60 });
    expect(later.sentinel).not.toBeNull();
    expect(`${later.sentinel!.date}T${later.sentinel!.time}` >= `${plan.sentinel!.date}T${plan.sentinel!.time}`).toBe(true);
  });
});

describe('piu promemoria che slot: la prima passata non puo coprire tutti', () => {
  it('70 promemoria con una sola notifica: 59 entrano, sentinella sul primo escluso', () => {
    const many: NotifiableReminder[] = Array.from({ length: 70 }, (_, i) => ({
      id: `m${String(i).padStart(2, '0')}`,
      category: 'check' as const,
      status: 'open' as const,
      notifyEnabled: true,
      effectiveDueOn: addDays(TODAY, 1 + i),
      notifyOffsetsDays: [0],
    }));
    const plan = planNotifications({ reminders: many, nowLocal: NOW, maxScheduled: 60 });
    expect(plan.items).toHaveLength(59);
    expect(plan.overflow).toBe(11);
    expect(plan.items.map((i) => i.reminderId)).toEqual(many.slice(0, 59).map((m) => m.id));
    expect(plan.sentinel).toMatchObject({ date: addDays(TODAY, 60), time: '09:00' });
  });
});
