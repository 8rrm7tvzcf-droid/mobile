import { describe, expect, it } from 'vitest';
import { isEmptyChanges, planReminderChanges } from '@/domain/reminders';
import type {
  OpenReminder,
  ReconcileInput,
  ReconcileItem,
  ReconcilePolicy,
  ReminderChanges,
} from '@/domain/reminders';
import { evaluateRule } from '@/domain/maintenance';
import type { OdometerPoint } from '@/domain/maintenance';

const TODAY = '2026-10-07';
const NOW_ISO = '2026-10-07T08:00:00.000Z';

const v3: OdometerPoint[] = [
  { on: '2026-03-01', km: 40000 },
  { on: '2026-07-01', km: 44880 },
  { on: '2026-10-01', km: 48560 },
];

const oilItem: ReconcileItem = {
  id: 'item-oil',
  name: 'Cambio olio',
  category: 'maintenance',
  rule: { scheduleType: 'interval_last_done', intervalKm: 15000, intervalMonths: 12, soonDays: 30, soonKm: 1500 },
  lastDone: { on: '2026-03-01', km: 40000 },
  notifyOffsetsDays: [14, 3, 0],
  isActive: true,
};

const baseInput = (over: Partial<ReconcileInput> = {}): ReconcileInput => ({
  today: TODAY,
  computedAt: NOW_ISO,
  vehicle: { id: 'veh-1', status: 'active' },
  items: [oilItem],
  odometer: v3,
  policies: [],
  payments: [],
  openReminders: [],
  ...over,
});

/** Simula la scrittura sul DB per verificare l'idempotenza (invariante I5). */
function applyChanges(open: readonly OpenReminder[], changes: ReminderChanges): OpenReminder[] {
  const gone = new Set([...changes.close.map((c) => c.id), ...changes.remove.map((r) => r.id)]);
  const patches = new Map(changes.update.map((u) => [u.id, u.patch]));
  const kept = open
    .filter((r) => !gone.has(r.id))
    .map((r) => ({ ...r, ...(patches.get(r.id) ?? {}) }) as OpenReminder);
  const created = changes.create.map(
    (c, i): OpenReminder => ({
      id: `new-${i}`,
      origin: 'generated',
      itemId: c.itemId,
      policyId: c.policyId,
      paymentId: c.paymentId,
      title: c.title,
      category: c.category,
      dueOn: c.dueOn,
      dueKm: c.dueKm,
      forecastOn: c.forecastOn,
      forecastConfidence: c.forecastConfidence,
      effectiveDueOn: c.effectiveDueOn,
      dueTrigger: c.dueTrigger,
      soonDays: c.soonDays,
      soonKm: c.soonKm,
      notifyOffsetsDays: c.notifyOffsetsDays,
    }),
  );
  return [...kept, ...created];
}

describe('planReminderChanges: voci di manutenzione', () => {
  it('crea il promemoria aperto di una voce con tutti i campi calcolati (V3)', () => {
    const c = planReminderChanges(baseInput());
    expect(c.update).toEqual([]);
    expect(c.close).toEqual([]);
    expect(c.remove).toEqual([]);
    expect(c.create).toEqual([
      {
        origin: 'generated',
        itemId: 'item-oil',
        policyId: null,
        paymentId: null,
        title: 'Cambio olio',
        category: 'maintenance',
        dueOn: '2027-03-01',
        dueKm: 55000,
        forecastOn: '2027-03-11',
        forecastConfidence: 'medium',
        effectiveDueOn: '2027-03-01',
        dueTrigger: 'time',
        soonDays: 30,
        soonKm: 1500,
        notifyOffsetsDays: [14, 3, 0],
        computedAt: NOW_ISO,
      },
    ]);
  });

  it('e idempotente: applicate le modifiche, la seconda esecuzione e vuota', () => {
    const first = planReminderChanges(baseInput());
    const open = applyChanges([], first);
    const second = planReminderChanges(baseInput({ openReminders: open }));
    expect(isEmptyChanges(second)).toBe(true);
  });

  it('aggiorna solo cio che cambia: un nuovo km sposta la previsione, non il titolo ne altro', () => {
    const open = applyChanges([], planReminderChanges(baseInput()));
    const odo = [...v3, { on: '2026-10-06', km: 52000 }]; // piu' km del previsto: la previsione si avvicina
    const expected = evaluateRule({ today: TODAY, rule: oilItem.rule, lastDone: oilItem.lastDone, odometer: odo });
    const c = planReminderChanges(baseInput({ openReminders: open, odometer: odo }));
    expect(c.create).toEqual([]);
    expect(c.update).toHaveLength(1);
    const u = c.update[0]!;
    expect(u.id).toBe('new-0');
    expect(u.computedAt).toBe(NOW_ISO);
    expect(u.patch.forecastOn).toBe(expected.forecastOn);
    expect(u.patch.forecastOn).not.toBe('2027-03-11');
    expect(u.patch.effectiveDueOn).toBe(expected.effectiveDueOn);
    expect(u.patch.dueTrigger).toBe('km');
    // le colonne che non cambiano non compaiono nella patch
    for (const k of ['title', 'category', 'dueOn', 'dueKm', 'soonDays', 'soonKm', 'notifyOffsetsDays']) {
      expect(u.patch).not.toHaveProperty(k);
    }
  });

  it('la regola passa a unknown (nessun ultimo fatto): il promemoria aperto viene rimosso', () => {
    const open = applyChanges([], planReminderChanges(baseInput()));
    const c = planReminderChanges(
      baseInput({ openReminders: open, items: [{ ...oilItem, lastDone: null }] }),
    );
    expect(c.remove).toEqual([{ id: 'new-0', reason: 'item_unknown' }]);
    expect(c.create).toEqual([]);
    // senza promemoria aperto non c'e' nulla da fare
    expect(isEmptyChanges(planReminderChanges(baseInput({ items: [{ ...oilItem, lastDone: null }] })))).toBe(true);
  });

  it('voce con solo km e nessuna lettura: promemoria con dueKm ma senza data (resta "da configurare")', () => {
    const kmOnly: ReconcileItem = {
      ...oilItem,
      rule: { scheduleType: 'interval_last_done', intervalKm: 15000 },
    };
    const c = planReminderChanges(baseInput({ items: [kmOnly], odometer: [] }));
    expect(c.create).toHaveLength(1);
    expect(c.create[0]).toMatchObject({ dueOn: null, dueKm: 55000, effectiveDueOn: null, dueTrigger: null });
  });

  it('voce disattivata o cancellata: il promemoria generato diventa orfano e si rimuove', () => {
    const open = applyChanges([], planReminderChanges(baseInput()));
    const inactive = planReminderChanges(baseInput({ openReminders: open, items: [{ ...oilItem, isActive: false }] }));
    expect(inactive.remove).toEqual([{ id: 'new-0', reason: 'item_missing_or_inactive' }]);
    const deleted = planReminderChanges(baseInput({ openReminders: open, items: [] }));
    expect(deleted.remove).toEqual([{ id: 'new-0', reason: 'item_missing_or_inactive' }]);
  });

  it('rinominare la voce o cambiare i preavvisi aggiorna il promemoria generato', () => {
    const open = applyChanges([], planReminderChanges(baseInput()));
    const c = planReminderChanges(
      baseInput({ openReminders: open, items: [{ ...oilItem, name: 'Olio motore', notifyOffsetsDays: [30, 0] }] }),
    );
    expect(c.update).toEqual([
      { id: 'new-0', patch: { title: 'Olio motore', notifyOffsetsDays: [30, 0] }, computedAt: NOW_ISO },
    ]);
  });

  it('I1: un solo promemoria aperto per voce, i doppioni si rimuovono', () => {
    const open = applyChanges([], planReminderChanges(baseInput()));
    const dup: OpenReminder = { ...(open[0] as OpenReminder), id: 'dup-1' };
    const c = planReminderChanges(baseInput({ openReminders: [...open, dup] }));
    expect(c.remove).toEqual([{ id: 'dup-1', reason: 'duplicate' }]);
    expect(c.update).toEqual([]);
  });

  it('un promemoria generato senza origine (ne voce, ne polizza, ne rata) e incoerente: si rimuove', () => {
    const broken: OpenReminder = {
      id: 'x',
      origin: 'generated',
      title: 't',
      category: 'other',
      dueOn: '2026-12-01',
      dueKm: null,
      forecastOn: null,
      forecastConfidence: null,
      effectiveDueOn: '2026-12-01',
      dueTrigger: 'time',
      soonDays: 30,
      soonKm: 0,
      notifyOffsetsDays: [0],
    };
    expect(planReminderChanges(baseInput({ items: [], openReminders: [broken] })).remove).toEqual([
      { id: 'x', reason: 'no_source' },
    ]);
  });

  it('veicolo non attivo: nessuna modifica (non genera e non notifica)', () => {
    const open = applyChanges([], planReminderChanges(baseInput()));
    expect(isEmptyChanges(planReminderChanges(baseInput({ vehicle: { id: 'veh-1', status: 'sold' } })))).toBe(true);
    expect(
      isEmptyChanges(
        planReminderChanges(baseInput({ vehicle: { id: 'veh-1', status: 'sold' }, openReminders: open, items: [] })),
      ),
    ).toBe(true);
  });

  it('un promemoria saltato non risorge finche la scadenza e la stessa; dopo un completamento ne nasce uno nuovo', () => {
    const skipped = [{ itemId: 'item-oil', dueOn: '2027-03-01', dueKm: 55000 }];
    expect(isEmptyChanges(planReminderChanges(baseInput({ closedCycles: skipped })))).toBe(true);
    // completamento: nuova base -> nuova scadenza -> nuovo promemoria
    const afterDone = planReminderChanges(
      baseInput({
        closedCycles: skipped,
        items: [{ ...oilItem, lastDone: { on: '2026-10-01', km: 48560 } }],
      }),
    );
    expect(afterDone.create).toHaveLength(1);
    expect(afterDone.create[0]).toMatchObject({ dueOn: '2027-10-01', dueKm: 63560 });
  });

  it('serie di calendario (bollo) e data fissa: la scadenza e quella fissa', () => {
    const bollo: ReconcileItem = {
      id: 'item-bollo',
      name: 'Bollo auto',
      category: 'legal',
      rule: { scheduleType: 'interval_calendar', intervalMonths: 12, fixedDueOn: '2026-11-30' },
      lastDone: null,
      notifyOffsetsDays: [30, 7, 0],
      isActive: true,
    };
    const c = planReminderChanges(baseInput({ items: [bollo] }));
    expect(c.create).toHaveLength(1);
    expect(c.create[0]).toMatchObject({
      title: 'Bollo auto',
      category: 'legal',
      dueOn: '2026-11-30',
      dueKm: null,
      forecastConfidence: null,
      effectiveDueOn: '2026-11-30',
      dueTrigger: 'time',
    });
  });
});

describe('planReminderChanges: polizze e rate', () => {
  const rca2025: ReconcilePolicy = {
    id: 'pol-2025',
    kind: 'rca',
    company: 'Generali',
    startOn: '2025-05-10',
    endOn: '2026-05-10',
  };
  const rca2026: ReconcilePolicy = {
    id: 'pol-2026',
    kind: 'rca',
    company: 'Generali',
    startOn: '2026-05-10',
    endOn: '2027-05-10',
  };

  it('la polizza piu recente per tipo genera "Scadenza RCA <compagnia>" con preavvisi [30,14,7,1,0]', () => {
    const c = planReminderChanges(baseInput({ items: [], policies: [rca2025, rca2026] }));
    expect(c.create).toHaveLength(1);
    expect(c.create[0]).toMatchObject({
      origin: 'generated',
      policyId: 'pol-2026',
      itemId: null,
      paymentId: null,
      title: 'Scadenza RCA Generali',
      category: 'insurance',
      dueOn: '2027-05-10',
      effectiveDueOn: '2027-05-10',
      dueTrigger: 'time',
      notifyOffsetsDays: [30, 14, 7, 1, 0],
    });
  });

  it('il promemoria della polizza precedente passa a done (rinnovata) alla data di oggi', () => {
    const old: OpenReminder = {
      id: 'rem-old',
      origin: 'generated',
      policyId: 'pol-2025',
      title: 'Scadenza RCA Generali',
      category: 'insurance',
      dueOn: '2026-05-10',
      dueKm: null,
      forecastOn: null,
      forecastConfidence: null,
      effectiveDueOn: '2026-05-10',
      dueTrigger: 'time',
      soonDays: 30,
      soonKm: 0,
      notifyOffsetsDays: [30, 14, 7, 1, 0],
    };
    const c = planReminderChanges(baseInput({ items: [], policies: [rca2025, rca2026], openReminders: [old] }));
    expect(c.close).toEqual([{ id: 'rem-old', completedOn: TODAY, reason: 'policy_renewed' }]);
    expect(c.create).toHaveLength(1);
  });

  it('polizza annullata: non genera e rimuove il promemoria; polizza sparita: orfano', () => {
    const cancelled = { ...rca2026, cancelledOn: '2026-08-01' };
    const open: OpenReminder = {
      id: 'rem-26',
      origin: 'generated',
      policyId: 'pol-2026',
      title: 'Scadenza RCA Generali',
      category: 'insurance',
      dueOn: '2027-05-10',
      dueKm: null,
      forecastOn: null,
      forecastConfidence: null,
      effectiveDueOn: '2027-05-10',
      dueTrigger: 'time',
      soonDays: 30,
      soonKm: 0,
      notifyOffsetsDays: [30, 14, 7, 1, 0],
    };
    const c1 = planReminderChanges(baseInput({ items: [], policies: [cancelled], openReminders: [open] }));
    expect(c1.remove).toEqual([{ id: 'rem-26', reason: 'policy_cancelled' }]);
    expect(c1.create).toEqual([]);
    const c2 = planReminderChanges(baseInput({ items: [], policies: [], openReminders: [open] }));
    expect(c2.remove).toEqual([{ id: 'rem-26', reason: 'policy_missing' }]);
  });

  it('tipi diversi di polizza hanno ciascuno il proprio promemoria', () => {
    const kasko: ReconcilePolicy = { id: 'pol-k', kind: 'kasko', company: 'Zurich', startOn: '2026-01-01', endOn: '2027-01-01' };
    const c = planReminderChanges(baseInput({ items: [], policies: [rca2026, kasko] }));
    expect(c.create.map((r) => r.title).sort()).toEqual(['Scadenza Kasko Zurich', 'Scadenza RCA Generali']);
  });

  it('un cambio di data di fine polizza aggiorna il promemoria (cache)', () => {
    const first = planReminderChanges(baseInput({ items: [], policies: [rca2026] }));
    const open = applyChanges([], first);
    const c = planReminderChanges(
      baseInput({ items: [], policies: [{ ...rca2026, endOn: '2027-05-15' }], openReminders: open }),
    );
    expect(c.update).toEqual([
      { id: 'new-0', patch: { dueOn: '2027-05-15', effectiveDueOn: '2027-05-15' }, computedAt: NOW_ISO },
    ]);
  });

  it('rate: una per rata non pagata "Rata n/N" con preavvisi [7,1,0]; pagata -> done alla data di pagamento', () => {
    const payments = [
      { id: 'pay-1', policyId: 'pol-2026', installmentNo: 1, dueOn: '2026-05-10', paidOn: '2026-05-09' },
      { id: 'pay-2', policyId: 'pol-2026', installmentNo: 2, dueOn: '2026-11-10', paidOn: null },
    ];
    const c = planReminderChanges(baseInput({ items: [], policies: [rca2026], payments }));
    const rate = c.create.filter((r) => r.paymentId);
    expect(rate).toHaveLength(1);
    expect(rate[0]).toMatchObject({
      paymentId: 'pay-2',
      title: 'Rata 2/2',
      category: 'insurance',
      dueOn: '2026-11-10',
      notifyOffsetsDays: [7, 1, 0],
      soonDays: 7,
    });

    // la rata 2 viene pagata: il promemoria aperto passa a done con la data del pagamento
    const open = applyChanges([], c);
    const paid = payments.map((p) => (p.id === 'pay-2' ? { ...p, paidOn: '2026-11-08' } : p));
    const c2 = planReminderChanges(baseInput({ items: [], policies: [rca2026], payments: paid, openReminders: open }));
    expect(c2.close).toEqual([{ id: open.find((r) => r.paymentId === 'pay-2')!.id, completedOn: '2026-11-08', reason: 'installment_paid' }]);
  });

  it('rata cancellata o di polizza annullata: il promemoria si rimuove', () => {
    const payments = [{ id: 'pay-2', policyId: 'pol-2026', installmentNo: 2, dueOn: '2026-11-10', paidOn: null }];
    const open = applyChanges([], planReminderChanges(baseInput({ items: [], policies: [rca2026], payments })));
    const rateRem = open.find((r) => r.paymentId === 'pay-2')!;
    const gone = planReminderChanges(baseInput({ items: [], policies: [rca2026], payments: [], openReminders: open }));
    expect(gone.remove).toEqual([{ id: rateRem.id, reason: 'installment_missing' }]);
    const cancelled = planReminderChanges(
      baseInput({ items: [], policies: [{ ...rca2026, cancelledOn: '2026-09-01' }], payments, openReminders: open }),
    );
    expect(cancelled.remove.map((r) => r.id)).toContain(rateRem.id);
  });

  it('tutto idempotente anche con polizze e rate', () => {
    const payments = [
      { id: 'pay-1', policyId: 'pol-2026', installmentNo: 1, dueOn: '2026-05-10', paidOn: null },
      { id: 'pay-2', policyId: 'pol-2026', installmentNo: 2, dueOn: '2026-11-10', paidOn: null },
    ];
    const input = baseInput({ policies: [rca2025, rca2026], payments });
    const open = applyChanges([], planReminderChanges(input));
    expect(open.length).toBe(4); // olio + polizza + 2 rate
    expect(isEmptyChanges(planReminderChanges({ ...input, openReminders: open }))).toBe(true);
  });
});

describe('planReminderChanges: promemoria manuali', () => {
  const manual: OpenReminder = {
    id: 'man-1',
    origin: 'manual',
    title: 'Cambio gomme invernali',
    category: 'tyres',
    dueOn: null,
    dueKm: 60000,
    forecastOn: null,
    forecastConfidence: null,
    effectiveDueOn: null,
    dueTrigger: null,
    soonDays: 30,
    soonKm: 1500,
    notifyOffsetsDays: [14, 0],
  };

  it('aggiorna SOLO previsione, scadenza effettiva e trigger (I2: mai i dati dell utente)', () => {
    const odo: OdometerPoint[] = [
      { on: '2026-04-10', km: 50000 },
      { on: '2026-10-07', km: 55490 },
    ];
    const c = planReminderChanges(baseInput({ items: [], odometer: odo, openReminders: [manual] }));
    expect(c.update).toHaveLength(1);
    expect(c.update[0]).toEqual({
      id: 'man-1',
      patch: { forecastOn: '2027-03-04', forecastConfidence: 'low', effectiveDueOn: '2027-03-04', dueTrigger: 'km' },
      computedAt: NOW_ISO,
    });
    expect(c.update[0]!.patch).not.toHaveProperty('title');
    expect(c.update[0]!.patch).not.toHaveProperty('dueKm');
    expect(c.update[0]!.patch).not.toHaveProperty('notifyOffsetsDays');
  });

  it('un promemoria manuale solo a data: effective = data, trigger time; idempotente', () => {
    const dated: OpenReminder = { ...manual, id: 'man-2', dueOn: '2026-12-24', dueKm: null, category: 'other' };
    const c = planReminderChanges(baseInput({ items: [], openReminders: [dated] }));
    expect(c.update).toEqual([
      { id: 'man-2', patch: { effectiveDueOn: '2026-12-24', dueTrigger: 'time' }, computedAt: NOW_ISO },
    ]);
    const settled = { ...dated, effectiveDueOn: '2026-12-24', dueTrigger: 'time' as const };
    expect(isEmptyChanges(planReminderChanges(baseInput({ items: [], openReminders: [settled] })))).toBe(true);
  });

  it('i promemoria manuali non vengono mai rimossi ne chiusi dal motore', () => {
    const c = planReminderChanges(baseInput({ items: [], openReminders: [manual] }));
    expect(c.remove).toEqual([]);
    expect(c.close).toEqual([]);
  });
});
