import { describe, expect, it } from 'vitest';
import { dailyMax, estimateKmPerDay, kmAt, latestPoint, RATE_DEFAULTS } from '@/domain/maintenance';

const TODAY = '2026-10-07';

describe('maintenance: letture del contachilometri', () => {
  it('una lettura per giorno (la piu alta), solo fino a oggi, in ordine', () => {
    const pts = dailyMax(
      [
        { on: '2026-10-05', km: 100 },
        { on: '2026-10-01', km: 90 },
        { on: '2026-10-05', km: 120 },
        { on: '2026-10-09', km: 999 }, // futura: ignorata
      ],
      TODAY,
    );
    expect(pts).toEqual([
      { on: '2026-10-01', km: 90 },
      { on: '2026-10-05', km: 120 },
    ]);
    expect(latestPoint(pts)).toEqual({ on: '2026-10-05', km: 120 });
    expect(latestPoint([])).toBeNull();
  });

  it('kmAt interpola dentro l intervallo e non estrapola mai', () => {
    const pts = [
      { on: '2026-01-01', km: 10000 },
      { on: '2026-01-11', km: 10100 },
    ];
    expect(kmAt('2026-01-06', pts)).toBe(10050);
    expect(kmAt('2026-01-01', pts)).toBe(10000);
    expect(kmAt('2026-01-11', pts)).toBe(10100);
    expect(kmAt('2025-12-31', pts)).toBeNull(); // prima della prima lettura
    expect(kmAt('2026-01-12', pts)).toBeNull(); // dopo l'ultima
    expect(kmAt('2026-01-01', [{ on: '2026-01-01', km: 5 }])).toBe(5); // una sola lettura, giorno esatto
    expect(kmAt('2026-01-02', [{ on: '2026-01-01', km: 5 }])).toBeNull();
    expect(kmAt('2026-01-01', [])).toBeNull();
  });
});

describe('maintenance: estimateKmPerDay (data.md 3.4)', () => {
  it('20 giorni di dati + stima utente: miscela col prior, confidenza low', () => {
    const r = estimateKmPerDay(
      [
        { on: '2026-09-17', km: 30000 },
        { on: '2026-10-07', km: 30400 },
      ],
      TODAY,
      { annualKmEstimate: 12000 },
    );
    expect(r.source).toBe('blended');
    expect(r.priorSource).toBe('user_estimate');
    expect(r.spanDays).toBe(20);
    expect(r.kmPerDay).toBeCloseTo(30.015, 2); // 0,222 x 20 + 0,778 x 32,88
    expect(r.confidence).toBe('low');
  });

  it('una lettura sola: solo il prior della stima utente, low', () => {
    const r = estimateKmPerDay([{ on: TODAY, km: 30400 }], TODAY, { annualKmEstimate: 12000 });
    expect(r.source).toBe('prior');
    expect(r.kmPerDay).toBeCloseTo(12000 / 365, 6);
    expect(r.confidence).toBe('low');
  });

  it('nessun dato: 12000/365 come segnaposto a bassa confidenza', () => {
    const r = estimateKmPerDay([], TODAY);
    expect(r.priorSource).toBe('default');
    expect(r.kmPerDay).toBeCloseTo(32.877, 3);
    expect(r.confidence).toBe('low');
    expect(r.staleDays).toBeNull();
    expect(r.points).toBe(0);
  });

  it('dalla prima immatricolazione: km / giorni (solo se l auto ha almeno 1 anno)', () => {
    const r = estimateKmPerDay([{ on: TODAY, km: 60000 }], TODAY, { firstRegistrationOn: '2021-10-07' });
    expect(r.priorSource).toBe('lifetime_average');
    expect(r.kmPerDay).toBeCloseTo(60000 / 1826, 6); // 32,86
    // sotto l'anno non si usa: torna al default
    const young = estimateKmPerDay([{ on: TODAY, km: 3000 }], TODAY, { firstRegistrationOn: '2026-06-01' });
    expect(young.priorSource).toBe('default');
  });

  it('la stima dell utente vince sulla media dall immatricolazione', () => {
    const r = estimateKmPerDay([{ on: TODAY, km: 60000 }], TODAY, {
      annualKmEstimate: 20000,
      firstRegistrationOn: '2021-10-07',
    });
    expect(r.priorSource).toBe('user_estimate');
    expect(r.kmPerDay).toBeCloseTo(20000 / 365, 6);
  });

  it('auto ferma: 5.000 km invariati in 180 giorni -> confidenza none, nessuna previsione', () => {
    const r = estimateKmPerDay(
      [
        { on: '2026-04-10', km: 5000 },
        { on: '2026-07-01', km: 5000 },
        { on: '2026-10-01', km: 5000 },
      ],
      TODAY,
      { annualKmEstimate: 12000 },
    );
    expect(r.confidence).toBe('none');
    expect(r.kmPerDay).toBeLessThan(0.5);
  });

  it('gita breve: il winsorizing taglia il picco (37,13 contro 42,22 senza clamp), confidenza high', () => {
    const readings = [
      { on: '2026-04-07', km: 20000 },
      { on: '2026-07-07', km: 23000 },
      { on: '2026-08-07', km: 24000 },
      { on: '2026-09-07', km: 25000 },
      { on: '2026-09-15', km: 26500 }, // 8 giorni, 187,5 km/g
      { on: '2026-10-07', km: 27300 },
    ];
    const clamped = estimateKmPerDay(readings, TODAY);
    const raw = estimateKmPerDay(readings, TODAY, {}, { clampMultiple: 1e9 });
    expect(clamped.kmPerDay).toBeCloseTo(37.13, 2);
    expect(raw.kmPerDay).toBeCloseTo(42.22, 2);
    expect(clamped.confidence).toBe('high');
    expect(clamped.source).toBe('measured');
  });

  it('segmenti sotto 7 giorni si fondono: due letture a 1 giorno di distanza non esplodono', () => {
    const r = estimateKmPerDay(
      [
        { on: '2026-10-06', km: 30000 },
        { on: '2026-10-07', km: 30300 }, // 300 km in 1 giorno
      ],
      TODAY,
      { annualKmEstimate: 12000 },
    );
    // un solo segmento di 1 giorno: lambda = 1/90, quasi tutto prior
    expect(r.spanDays).toBe(1);
    expect(r.kmPerDay).toBeLessThan(32.877 + 300 / 90 + 0.01);
    expect(r.confidence).toBe('low');
  });

  it('ultima lettura vecchia (> 60 giorni): la confidenza scende di un livello', () => {
    const readings = [
      { on: '2026-03-20', km: 10000 }, // ancora: ultima lettura prima della finestra di 180 giorni
      { on: '2026-04-15', km: 11200 },
      { on: '2026-05-15', km: 12400 },
      { on: '2026-06-15', km: 13600 },
      { on: '2026-07-20', km: 15000 }, // 79 giorni fa
    ];
    const fresh = estimateKmPerDay(readings, '2026-07-25');
    expect(fresh.staleDays).toBe(5);
    expect(fresh.confidence).toBe('high'); // span >= 120 giorni e >= 4 punti
    const stale = estimateKmPerDay(readings, TODAY);
    expect(stale.staleDays).toBe(79);
    expect(stale.confidence).toBe('medium');
  });

  it('il tetto di sanita limita la stima a 1500 km/giorno', () => {
    const r = estimateKmPerDay(
      [
        { on: '2026-09-01', km: 10000 },
        { on: '2026-10-07', km: 90000 },
      ],
      TODAY,
      { annualKmEstimate: 12000 },
      { fullTrustDays: 10 },
    );
    expect(r.kmPerDay).toBe(RATE_DEFAULTS.maxKmPerDay);
  });

  it('letture non monotone non producono tassi negativi o NaN', () => {
    const r = estimateKmPerDay(
      [
        { on: '2026-08-01', km: 50000 },
        { on: '2026-09-01', km: 49000 }, // errore di digitazione
        { on: '2026-10-01', km: 50500 },
      ],
      TODAY,
      { annualKmEstimate: 12000 },
    );
    expect(Number.isFinite(r.kmPerDay)).toBe(true);
    expect(r.kmPerDay).toBeGreaterThanOrEqual(0);
  });
});
