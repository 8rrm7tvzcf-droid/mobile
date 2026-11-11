// Testi, toni e conversione oraria: funzioni pure delle letture (nessun database).
import { describe, expect, it } from 'vitest';
import { evaluateThresholds } from '@/domain/maintenance';
import type { Evaluation } from '@/domain/maintenance';
import type { Clock } from '@/domain/ports';
import { describeEvaluation, legalInfoFor, toneOf, worstTone } from '@/usecases/queries/describe';
import { addMinutes, utcOffsetMinutes, utcToLocal } from '@/usecases/queries/localTime';

const TODAY = '2026-10-08';
const odo = [
  { on: '2026-07-10', km: 25000 },
  { on: '2026-10-01', km: 27000 },
];

describe('describeEvaluation', () => {
  it('a tempo con soglia a km lontana: scade il ... e seconda riga "oppure tra N km"', () => {
    const ev = evaluateThresholds({ today: TODAY, dueOn: '2026-12-01', dueKm: 40000, odometer: odo });
    const t = describeEvaluation(ev, 'km');
    expect(ev.state).toBe('ok');
    expect(t.label).toBe('In regola');
    expect(t.text).toBe('scade il 01/12/2026 (tra 54 giorni)');
    expect(t.secondaryText).toBe('oppure tra 13.000 km');
    expect(t.summary).toBe('In regola · scade il 01/12/2026 (tra 54 giorni)');
  });

  it('1 giorno: singolare', () => {
    const ev = evaluateThresholds({ today: TODAY, dueOn: '2026-10-09', dueKm: null });
    expect(describeEvaluation(ev, 'km').text).toBe('scade il 09/10/2026 (tra 1 giorno)');
    const late = evaluateThresholds({ today: TODAY, dueOn: '2026-10-07', dueKm: null });
    expect(describeEvaluation(late, 'km').text).toBe('da 1 giorno (scadenza 07/10/2026)');
  });

  it('a km: "tra circa N km (stima)" e la data prevista in seconda riga', () => {
    const ev = evaluateThresholds({ today: TODAY, dueOn: null, dueKm: 28200, odometer: odo });
    const t = describeEvaluation(ev, 'km');
    expect(ev.trigger).toBe('km');
    expect(t.text).toBe('tra circa 1.200 km (stima)');
    expect(t.secondaryText).toMatch(/^circa il /);
  });

  it('scaduto per stima: "Probabilmente scaduto"', () => {
    // previsione nel passato: l'ultima lettura e' vecchia e la scadenza a km non e' ancora raggiunta
    const ev = evaluateThresholds({
      today: TODAY, dueOn: null, dueKm: 26500,
      odometer: [{ on: '2026-05-01', km: 25000 }, { on: '2026-06-01', km: 26000 }],
    });
    expect(ev.state).toBe('overdue');
    expect(ev.estimated).toBe(true);
    const t = describeEvaluation(ev, 'km');
    expect(t.label).toBe('Probabilmente scaduto');
    expect(t.text).toMatch(/^stima in base ai km: prevista il \d{2}\/\d{2}\/2026$/);
  });

  it('scade oggi: con data certa e con stima in base ai km', () => {
    const base: Evaluation = {
      state: 'soon', dueOn: null, dueKm: 27500, forecastOn: TODAY, effectiveDueOn: TODAY, trigger: 'km', estimated: true, kmReached: false,
      daysLeft: 0, kmLeft: 300, currentKm: 27200, dueToday: true, forecastConfidence: 'medium', rate: 30, reasons: [],
    };
    const est = describeEvaluation(base, 'km');
    expect(est.label).toBe('Scade oggi');
    expect(est.text).toBe('prevista oggi (stima in base ai km)');
    const sure = describeEvaluation({ ...base, dueOn: TODAY, trigger: 'time', estimated: false }, 'km');
    expect(sure.text).toBe('scadenza del 08/10/2026');
  });

  it('da configurare: il primo motivo; senza motivi, un testo generico', () => {
    const ev = evaluateThresholds({ today: TODAY, dueOn: null, dueKm: null });
    expect(describeEvaluation(ev, 'km').text).toBe('Mancano dei dati per calcolare la scadenza.');
    const noOdo = evaluateThresholds({ today: TODAY, dueOn: null, dueKm: 30000 });
    const t = describeEvaluation(noOdo, 'km');
    expect(t.label).toBe('Da configurare');
    expect(t.reasons).toEqual([{ code: 'NO_ODOMETER', message: 'Inserisci i km attuali per stimare la scadenza.' }]);
  });

  it('toni: scade oggi e scaduto rossi, in arrivo giallo, ok verde, sconosciuto grigio; il peggiore vince', () => {
    expect(toneOf({ state: 'soon', dueToday: true })).toBe('danger');
    expect(toneOf({ state: 'soon', dueToday: false })).toBe('warning');
    expect(toneOf({ state: 'overdue', dueToday: false })).toBe('danger');
    expect(toneOf({ state: 'ok', dueToday: false })).toBe('ok');
    expect(toneOf({ state: 'unknown', dueToday: false })).toBe('unknown');
    expect(worstTone(['ok', 'unknown'])).toBe('ok');
    expect(worstTone(['unknown', 'unknown'])).toBe('unknown');
    expect(worstTone(['ok', 'warning', 'ok'])).toBe('warning');
    expect(worstTone(['warning', 'danger', 'ok'])).toBe('danger');
    expect(worstTone([])).toBe('unknown');
  });
});

describe('legalInfoFor', () => {
  it('solo per le voci di legge e la RCA', () => {
    expect(legalInfoFor({ category: 'maintenance', templateId: 'tpl_oil_change', policyKind: null })).toBeNull();
    expect(legalInfoFor({ category: 'insurance', templateId: null, policyKind: 'kasko' })).toBeNull();
    expect(legalInfoFor({ category: 'insurance', templateId: null, policyKind: null })).toBeNull();
    expect(legalInfoFor({ category: 'legal', templateId: 'tpl_inspection', policyKind: null })!.ruleId).toBe('it.inspection.next');
    expect(legalInfoFor({ category: 'legal', templateId: 'tpl_gas_cylinder', policyKind: null })!.ruleId).toBe('it.gas.manual');
    expect(legalInfoFor({ category: 'insurance', templateId: null, policyKind: 'rca' })!.ruleId).toBe('it.rca.expiry_printed');
  });

  it('una voce di legge senza regola codificata riceve solo l\'avvertenza generica', () => {
    const l = legalInfoFor({ category: 'legal', templateId: 'tpl_sconosciuto', policyKind: null })!;
    expect(l).toMatchObject({ ruleId: null, sources: [], verifiedOn: null, confidence: null });
    expect(l.warning).toContain('non consulenza legale');
  });
});

describe('conversione oraria senza Intl', () => {
  const clockAt = (utc: string, local: { date: string; time: string }): Clock => ({
    nowIso: () => utc,
    todayLocal: () => local.date,
    nowLocal: () => local,
    timeZone: () => 'Europe/Rome',
  });

  it('scarto dall\'orologio: +120 d\'estate a Roma, +60 d\'inverno, e a cavallo della mezzanotte', () => {
    expect(utcOffsetMinutes(clockAt('2026-10-08T07:30:00.000Z', { date: '2026-10-08', time: '09:30' }))).toBe(120);
    expect(utcOffsetMinutes(clockAt('2026-12-08T07:30:00.000Z', { date: '2026-12-08', time: '08:30' }))).toBe(60);
    expect(utcOffsetMinutes(clockAt('2026-10-08T23:30:00.000Z', { date: '2026-10-09', time: '01:30' }))).toBe(120);
    expect(utcOffsetMinutes(clockAt('2026-10-08T07:30:00.000Z', { date: '2026-10-08', time: '07:30' }))).toBe(0);
  });

  it('utcToLocal riporta il giorno in avanti e indietro', () => {
    expect(utcToLocal('2026-10-08T22:30:00.000Z', 120)).toEqual({ date: '2026-10-09', time: '00:30' });
    expect(utcToLocal('2026-10-09T00:10:00.000Z', -300)).toEqual({ date: '2026-10-08', time: '19:10' });
    expect(utcToLocal('2026-12-31T23:59:30.000Z', 60)).toEqual({ date: '2027-01-01', time: '00:59' });
  });

  it('addMinutes', () => {
    expect(addMinutes({ date: '2026-02-28', time: '23:59' }, 2)).toEqual({ date: '2026-03-01', time: '00:01' });
    expect(addMinutes({ date: '2026-10-08', time: '00:05' }, -10)).toEqual({ date: '2026-10-07', time: '23:55' });
  });
});
