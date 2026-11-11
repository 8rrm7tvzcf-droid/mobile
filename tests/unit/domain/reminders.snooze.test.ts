import { describe, expect, it } from 'vitest';
import { activeSnoozeUntil, computeSnooze, isSnoozed, SNOOZE_DEFAULT_KM } from '@/domain/reminders';

const NOW = { date: '2026-10-07', time: '14:30' } as const;

describe('snooze: preset', () => {
  it('Domani alle 09:00', () => {
    const r = computeSnooze({ type: 'tomorrow' }, NOW);
    expect(r).toEqual({ ok: true, value: { untilLocal: { date: '2026-10-08', time: '09:00' }, untilKm: null } });
  });

  it('Fra 3 giorni e Fra 1 settimana', () => {
    const d3 = computeSnooze({ type: 'days', days: 3 }, NOW);
    const d7 = computeSnooze({ type: 'days', days: 7 }, NOW);
    expect(d3.ok && d3.value.untilLocal).toEqual({ date: '2026-10-10', time: '09:00' });
    expect(d7.ok && d7.value.untilLocal).toEqual({ date: '2026-10-14', time: '09:00' });
  });

  it('attraversa fine mese e il cambio dell ora senza deriva', () => {
    const r = computeSnooze({ type: 'days', days: 3 }, { date: '2026-10-24', time: '23:00' });
    expect(r.ok && r.value.untilLocal.date).toBe('2026-10-27');
    const m = computeSnooze({ type: 'tomorrow' }, { date: '2026-10-31', time: '10:00' });
    expect(m.ok && m.value.untilLocal.date).toBe('2026-11-01');
  });

  it('l ora di default si puo cambiare (notify.time)', () => {
    const r = computeSnooze({ type: 'tomorrow' }, NOW, { notifyTime: '08:30' });
    expect(r.ok && r.value.untilLocal.time).toBe('08:30');
  });

  it('Dopo N km (default +500): salva i km e una scadenza di sicurezza a +30 giorni', () => {
    const r = computeSnooze({ type: 'after_km' }, NOW, { currentKm: 48560 });
    expect(SNOOZE_DEFAULT_KM).toBe(500);
    expect(r).toEqual({ ok: true, value: { untilLocal: { date: '2026-11-06', time: '09:00' }, untilKm: 49060 } });
    const r2 = computeSnooze({ type: 'after_km', km: 1000 }, NOW, { currentKm: 48560 });
    expect(r2.ok && r2.value.untilKm).toBe(49560);
  });

  it('Dopo N km senza lettura: errore NO_ODOMETER, nessun km inventato', () => {
    expect(computeSnooze({ type: 'after_km' }, NOW)).toEqual({ ok: false, error: { code: 'NO_ODOMETER' } });
  });

  it('valori non validi', () => {
    expect(computeSnooze({ type: 'days', days: 0 }, NOW)).toEqual({ ok: false, error: { code: 'INVALID_SNOOZE' } });
    expect(computeSnooze({ type: 'days', days: 1.5 }, NOW)).toEqual({ ok: false, error: { code: 'INVALID_SNOOZE' } });
    expect(computeSnooze({ type: 'after_km', km: -5 }, NOW, { currentKm: 100 })).toEqual({
      ok: false,
      error: { code: 'INVALID_SNOOZE' },
    });
  });
});

describe('snooze: stato attivo', () => {
  const until = { date: '2026-10-10', time: '09:00' };

  it('rimandato fino alla fine dello snooze, poi torna visibile', () => {
    expect(isSnoozed({ snoozedUntilLocal: until }, NOW)).toBe(true);
    expect(isSnoozed({ snoozedUntilLocal: until }, { date: '2026-10-10', time: '08:59' })).toBe(true);
    expect(isSnoozed({ snoozedUntilLocal: until }, { date: '2026-10-10', time: '09:00' })).toBe(false);
    expect(isSnoozed({ snoozedUntilLocal: until }, { date: '2026-10-11', time: '00:00' })).toBe(false);
    expect(isSnoozed({}, NOW)).toBe(false);
    expect(isSnoozed({ snoozedUntilLocal: null }, NOW)).toBe(false);
  });

  it('dopo N km: finisce quando i km sono raggiunti, oppure alla scadenza di sicurezza', () => {
    const s = { snoozedUntilLocal: { date: '2026-11-06', time: '09:00' }, snoozeUntilKm: 49060 };
    expect(isSnoozed(s, NOW, 48600)).toBe(true);
    expect(isSnoozed(s, NOW, 49060)).toBe(false); // km raggiunti
    expect(isSnoozed(s, NOW, null)).toBe(true); // km sconosciuti: vale la data
    expect(isSnoozed(s, { date: '2026-11-06', time: '09:00' }, 48600)).toBe(false); // sicurezza
  });

  it('activeSnoozeUntil passa la fine dello snooze solo se ancora attivo (per planNotifications)', () => {
    expect(activeSnoozeUntil({ snoozedUntilLocal: until }, NOW)).toEqual(until);
    expect(activeSnoozeUntil({ snoozedUntilLocal: until }, { date: '2026-10-12', time: '10:00' })).toBeNull();
    expect(
      activeSnoozeUntil({ snoozedUntilLocal: { date: '2026-11-06', time: '09:00' }, snoozeUntilKm: 49060 }, NOW, 50000),
    ).toBeNull();
  });
});
