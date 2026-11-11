// Prova di riproduzione: "Rimanda a domani 09:00" scelto la sera del 24/10/2026 (CEST, +2) deve finire alle 09:00 del
// 25/10 (CET, +1, il giorno del cambio dell'ora). `snoozeDeadline` converte l'ora locale in UTC con lo scarto di ADESSO
// (+2) e `loadDeadlineRows` la rilegge con lo scarto di quel momento (+1): la fine dello snooze slitta di un'ora e il
// promemoria torna in "Da fare" alle 08:00 invece che alle 09:00.
import { describe, expect, it } from 'vitest';
import { reconcileVehicle, snoozeDeadline } from '@/usecases/deadlines';
import { getVehicleDeadlines } from '@/usecases/queries';
import { addItem, addOdo, addVehicle, makeEnv, openReminders, unwrap } from '../../integration/usecases/deadlines/helpers';

/** Orologio di Europe/Rome: +120 minuti fino al 2026-10-25T01:00Z, poi +60. */
function romeClock(env: Awaited<ReturnType<typeof makeEnv>>) {
  let utcMs = Date.parse('2026-10-24T18:00:00.000Z');
  const offsetMin = () => (utcMs < Date.parse('2026-10-25T01:00:00.000Z') ? 120 : 60);
  const local = () => new Date(utcMs + offsetMin() * 60000).toISOString();
  const c = env.clock;
  c.nowIso = () => new Date(utcMs).toISOString();
  c.todayLocal = () => local().slice(0, 10);
  c.nowLocal = () => ({ date: local().slice(0, 10), time: local().slice(11, 16) });
  return { setUtc: (iso: string) => void (utcMs = Date.parse(iso)) };
}

describe('snooze attraverso il cambio dell\'ora legale', () => {
  it('lo snooze "domani 09:00" non finisce prima delle 09:00 locali del 25/10/2026', async () => {
    const env = await makeEnv();
    const t = romeClock(env);
    const v = await addVehicle(env, { nickname: 'Panda' });
    await addOdo(env, v, '2026-10-01', 20000);
    await addItem(env, v, { name: 'Revisione', category: 'legal', interval_km: null, interval_months: 24, period_end: 'end_of_month', baseline_on: '2024-09-10' });
    await reconcileVehicle(env.deps, v);
    const [rem] = await openReminders(env.db, v);

    // 24/10 20:00 locali (18:00Z, CEST): rimanda a domani alle 09:00 locali
    const s = unwrap(await snoozeDeadline(env.deps, { reminderId: rem!['id'] as string, choice: { type: 'tomorrow' } }));
    expect(s.untilLocal).toEqual({ date: '2026-10-25', time: '09:00' });

    // 25/10 08:30 locali (07:30Z, CET): la fine dello snooze (09:00) e' ancora nel futuro
    t.setUtc('2026-10-25T07:30:00.000Z');
    const vd = await getVehicleDeadlines(env.deps, v);
    const row = vd!.rows.find((r) => r.reminderId === rem!['id'])!;
    expect(row.snoozed).toBe(true); // ottenuto false: lo snooze risulta finito alle 08:00
  });
});
