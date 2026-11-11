import { describe, expect, it } from 'vitest';
import {
  ODOMETER_SOURCES,
  allowedKmRange,
  currentKm,
  findInconsistentReadings,
  findMonotonicConflicts,
  kmTravelled,
  kmTravelledAllTime,
  latestReading,
  latestReadingOnOrBefore,
  sourceLabelIt,
  toDomainError,
  validReadings,
  validateOdometerReading,
  type OdometerReading,
} from '@/domain/odometer';

const TODAY = '2026-10-07';
let seq = 0;
const R = (
  readOn: string,
  km: number,
  extra: Partial<Pick<OdometerReading, 'id' | 'source' | 'status'>> = {},
): OdometerReading => ({
  id: extra.id ?? `r${++seq}`,
  readOn,
  km,
  source: extra.source ?? 'manual',
  status: extra.status ?? 'valid',
});

// i vettori di data.md 1.4: 10.000 (01/01), 15.000 (01/06), retrodatazione valida in mezzo
const base = () => [R('2026-01-01', 10000, { id: 'a' }), R('2026-06-01', 15000, { id: 'b' })];

describe('odometer: monotonia (come il trigger ODO_NON_MONOTONIC)', () => {
  it('una lettura retrodatata in mezzo e valida', () => {
    const v = validateOdometerReading({ readOn: '2026-03-01', km: 12000 }, base(), { today: TODAY });
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.conflicts).toEqual([]);
    expect(v.previous?.id).toBe('a');
    expect(v.next?.id).toBe('b');
  });

  it('rifiuta 16.000 km il 2026-03-02 (la lettura successiva ha meno km)', () => {
    const v = validateOdometerReading({ readOn: '2026-03-02', km: 16000 }, base(), { today: TODAY });
    expect(v.ok).toBe(false);
    expect(v.errors.map((e) => e.code)).toEqual(['NON_MONOTONIC']);
    expect(v.conflicts.map((c) => c.id)).toEqual(['b']);
    expect(v.errors[0]!.message).toContain('01/06/2026');
    expect(v.errors[0]!.message).toContain('15.000');
  });

  it('rifiuta 14.000 km il 2026-07-01 (la lettura precedente ha piu km)', () => {
    const v = validateOdometerReading({ readOn: '2026-07-01', km: 14000 }, base(), { today: TODAY });
    expect(v.ok).toBe(false);
    expect(v.conflicts.map((c) => c.id)).toEqual(['b']);
    expect(v.errors[0]!.code).toBe('NON_MONOTONIC');
  });

  it('nello stesso giorno nessun vincolo, anche con km piu bassi', () => {
    expect(validateOdometerReading({ readOn: '2026-06-01', km: 14990 }, base(), { today: TODAY }).ok).toBe(true);
    expect(validateOdometerReading({ readOn: '2026-06-01', km: 15010 }, base(), { today: TODAY }).ok).toBe(true);
    expect(validateOdometerReading({ readOn: '2026-01-01', km: 10000 }, base(), { today: TODAY }).ok).toBe(true);
  });

  it('una lettura ignored viene accettata e non e soggetta a monotonia', () => {
    const v = validateOdometerReading({ readOn: '2026-07-01', km: 14000, status: 'ignored' }, base(), { today: TODAY });
    expect(v.ok).toBe(true);
    expect(v.conflicts).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it('le letture ignored esistenti non creano conflitti', () => {
    const existing = [...base(), R('2026-04-01', 99999, { id: 'bad', status: 'ignored' })];
    expect(validateOdometerReading({ readOn: '2026-07-01', km: 16000 }, existing, { today: TODAY }).ok).toBe(true);
    expect(findMonotonicConflicts({ readOn: '2026-07-01', km: 16000 }, existing)).toEqual([]);
  });

  it('una modifica che romperebbe la monotonia e rifiutata; ignorare l errore la risolve', () => {
    const existing = base();
    // si prova a cambiare la lettura 'a' (10.000 il 01/01) in 16.000: supera 'b' (15.000 il 01/06)
    const v = validateOdometerReading({ id: 'a', readOn: '2026-01-01', km: 16000 }, existing, { today: TODAY });
    expect(v.ok).toBe(false);
    expect(v.conflicts.map((c) => c.id)).toEqual(['b']);
    // la modifica non confligge con se stessa
    expect(validateOdometerReading({ id: 'a', readOn: '2026-01-01', km: 10500 }, existing, { today: TODAY }).ok).toBe(true);
    // «È un errore della lettura precedente»: si ignora 'b' e la modifica passa
    const afterIgnore = existing.map((r) => (r.id === 'b' ? { ...r, status: 'ignored' as const } : r));
    expect(validateOdometerReading({ id: 'a', readOn: '2026-01-01', km: 16000 }, afterIgnore, { today: TODAY }).ok).toBe(true);
  });

  it('riattivare una lettura ignorata rivalida la monotonia', () => {
    const existing = [...base(), R('2026-03-01', 30000, { id: 'x', status: 'ignored' })];
    const v = validateOdometerReading({ id: 'x', readOn: '2026-03-01', km: 30000, status: 'valid' }, existing, { today: TODAY });
    expect(v.ok).toBe(false);
    expect(v.conflicts.map((c) => c.id)).toEqual(['b']);
  });

  it('piu conflitti: si elencano tutti e il messaggio cita i due piu vicini', () => {
    const existing = [
      R('2026-01-01', 20000, { id: 'p1' }),
      R('2026-02-01', 21000, { id: 'p2' }),
      R('2026-09-01', 5000, { id: 'n1' }),
    ];
    // il registro e gia incoerente di suo: cio che conta e il confronto con il candidato
    const v = validateOdometerReading({ readOn: '2026-05-01', km: 8000 }, existing, { today: TODAY });
    expect(v.conflicts.map((c) => c.id).sort()).toEqual(['n1', 'p1', 'p2']);
    expect(v.errors[0]!.message).toContain('01/02/2026'); // la precedente piu vicina (p2)
    expect(v.errors[0]!.message).toContain('01/09/2026'); // la successiva piu vicina (n1)
    expect(v.errors[0]!.message).not.toContain('01/01/2026'); // p1 non e citata, ma e in `related`
    expect(v.errors[0]!.related).toHaveLength(3);
  });
});

describe('odometer: validita di base', () => {
  const none: OdometerReading[] = [];
  it('km non interi, negativi o fuori scala', () => {
    for (const km of [-1, 12.5, 2_000_001, Number.NaN]) {
      const v = validateOdometerReading({ readOn: '2026-01-01', km }, none, { today: TODAY });
      expect(v.ok).toBe(false);
      expect(v.errors[0]!.code).toBe('INVALID_KM');
    }
    expect(validateOdometerReading({ readOn: '2026-01-01', km: 0 }, none, { today: TODAY }).ok).toBe(true);
    expect(validateOdometerReading({ readOn: '2026-01-01', km: 2_000_000 }, none, { today: TODAY }).ok).toBe(true);
  });

  it('data non valida o futura', () => {
    expect(validateOdometerReading({ readOn: '2026-02-30', km: 100 }, none, { today: TODAY }).errors[0]!.code).toBe('INVALID_DATE');
    expect(validateOdometerReading({ readOn: '7/10/2026', km: 100 }, none, { today: TODAY }).errors[0]!.code).toBe('INVALID_DATE');
    const f = validateOdometerReading({ readOn: '2026-10-08', km: 100 }, none, { today: TODAY });
    expect(f.ok).toBe(false);
    expect(f.errors[0]!.code).toBe('FUTURE_DATE');
    expect(validateOdometerReading({ readOn: TODAY, km: 100 }, none, { today: TODAY }).ok).toBe(true);
  });

  it('la prima lettura di un veicolo e sempre valida', () => {
    const v = validateOdometerReading({ readOn: '2026-01-01', km: 123456 }, none, { today: TODAY });
    expect(v.ok).toBe(true);
    expect(v.previous).toBeNull();
    expect(v.next).toBeNull();
  });

  it('traduzione in errori di dominio tipizzati (ports)', () => {
    const mono = validateOdometerReading({ readOn: '2026-07-01', km: 14000 }, base(), { today: TODAY });
    const e = toDomainError(mono);
    expect(e?.code).toBe('ODO_NON_MONOTONIC');
    expect(e && e.code === 'ODO_NON_MONOTONIC' ? e.message : '').toContain('non sono coerenti');
    const fut = validateOdometerReading({ readOn: '2027-01-01', km: 100 }, none, { today: TODAY });
    expect(toDomainError(fut)).toEqual({ code: 'FUTURE_DATE' });
    expect(toDomainError(validateOdometerReading({ readOn: '2026-01-01', km: 1 }, none, { today: TODAY }))).toBeNull();
  });
});

describe('odometer: plausibilita (avvisi non bloccanti)', () => {
  it('una cifra di troppo rispetto alla lettura precedente', () => {
    const v = validateOdometerReading({ readOn: '2026-06-02', km: 150000 }, base(), { today: TODAY });
    expect(v.ok).toBe(true); // non blocca
    expect(v.warnings.map((w) => w.code)).toEqual(['IMPLAUSIBLE_JUMP']);
    expect(v.warnings[0]!.related[0]!.id).toBe('b');
    expect(v.warnings[0]!.message).toContain('cifra di troppo');
  });

  it('un viaggio lungo ma possibile non da avvisi (1.000 km in un giorno)', () => {
    const v = validateOdometerReading({ readOn: '2026-06-02', km: 16000 }, base(), { today: TODAY });
    expect(v.warnings).toEqual([]);
  });

  it('soglia in km al giorno personalizzabile, e proporzionale ai giorni', () => {
    // 15.000 -> 20.000 in 10 giorni = 500 km/giorno: ok a 1500, avviso a 400
    const cand = { readOn: '2026-06-11', km: 20000 };
    expect(validateOdometerReading(cand, base(), { today: TODAY }).warnings).toEqual([]);
    expect(validateOdometerReading(cand, base(), { today: TODAY, maxKmPerDay: 400 }).warnings).toHaveLength(1);
  });

  it('salto implausibile verso la lettura successiva', () => {
    const existing = [R('2026-01-01', 10000, { id: 'a' }), R('2026-01-03', 90000, { id: 'z' })];
    const v = validateOdometerReading({ readOn: '2026-01-02', km: 10500 }, existing, { today: TODAY });
    expect(v.ok).toBe(true);
    expect(v.warnings).toHaveLength(1);
    expect(v.warnings[0]!.related[0]!.id).toBe('z');
  });

  it('stesso giorno: differenza di piu di 1.500 km tra due letture', () => {
    const v = validateOdometerReading({ readOn: '2026-06-01', km: 25000 }, base(), { today: TODAY });
    expect(v.warnings.map((w) => w.code)).toContain('IMPLAUSIBLE_JUMP');
  });

  it('oltre un milione di km si chiede conferma', () => {
    const v = validateOdometerReading({ readOn: '2026-01-01', km: 1_200_000 }, [], { today: TODAY });
    expect(v.ok).toBe(true);
    expect(v.warnings.map((w) => w.code)).toEqual(['VERY_HIGH_KM']);
  });
});

describe('odometer: km attuali, intervallo ammesso, provenienza', () => {
  const readings = [
    R('2026-01-01', 10000, { id: 'a', source: 'manual' }),
    R('2026-06-01', 15000, { id: 'b', source: 'fuel' }),
    R('2026-06-01', 15020, { id: 'c', source: 'obd' }),
    R('2026-08-01', 99999, { id: 'bad', source: 'manual', status: 'ignored' }),
  ];

  it('ordina le valide per data e km, scartando le ignorate', () => {
    expect(validReadings(readings).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('km attuali: ultima data, a parita km piu alti, mai le ignorate', () => {
    expect(latestReading(readings)?.id).toBe('c');
    expect(currentKm(readings)).toEqual({ km: 15020, readOn: '2026-06-01', source: 'obd', sourceLabel: "Letto dall'auto" });
    expect(currentKm([])).toBeNull();
    expect(latestReading([R('2026-01-01', 1, { status: 'ignored' })])).toBeNull();
  });

  it('ultima lettura fino a una data', () => {
    expect(latestReadingOnOrBefore(readings, '2026-05-31')?.id).toBe('a');
    expect(latestReadingOnOrBefore(readings, '2026-06-01')?.id).toBe('c');
    expect(latestReadingOnOrBefore(readings, '2025-12-31')).toBeNull();
  });

  it('intervallo ammesso per una data', () => {
    expect(allowedKmRange(readings, '2026-03-01')).toEqual({ min: 10000, max: 15000 });
    expect(allowedKmRange(readings, '2025-01-01')).toEqual({ min: 0, max: 10000 });
    expect(allowedKmRange(readings, '2026-12-01')).toEqual({ min: 15020, max: 2_000_000 });
    expect(allowedKmRange(readings, '2026-06-01')).toEqual({ min: 10000, max: 2_000_000 }); // stesso giorno: nessun vincolo
    expect(allowedKmRange(readings, '2026-01-01', 'a')).toEqual({ min: 0, max: 15000 }); // modifica di 'a' stessa
  });

  it('etichette di provenienza in italiano per tutte le sorgenti', () => {
    for (const s of ODOMETER_SOURCES) expect(sourceLabelIt(s).length).toBeGreaterThan(3);
    expect(sourceLabelIt('fuel')).toBe('Da un rifornimento');
    expect(sourceLabelIt('import')).toBe('Importato');
  });
});

describe('odometer: incoerenze in un registro importato', () => {
  it('un registro coerente non segnala nulla', () => {
    expect(findInconsistentReadings([...base(), R('2026-06-01', 14990), R('2026-09-01', 16000)])).toEqual([]);
  });

  it('segnala il picco anomalo e chi lo contraddice', () => {
    const rs = [
      R('2026-01-01', 10000, { id: 'a' }),
      R('2026-02-01', 99000, { id: 'typo' }),
      R('2026-03-01', 11000, { id: 'c' }),
      R('2026-04-01', 12000, { id: 'd' }),
    ];
    const bad = findInconsistentReadings(rs);
    // 'typo' e piu alto di tutte le successive; 'c' e 'd' sono piu basse di una precedente
    expect(bad.map((b) => b.reading.id).sort()).toEqual(['c', 'd', 'typo']);
    const typo = bad.find((b) => b.reading.id === 'typo')!;
    expect(typo.conflictsWith.map((c) => c.id)).toEqual(['c']);
    const c = bad.find((b) => b.reading.id === 'c')!;
    expect(c.conflictsWith.map((x) => x.id)).toEqual(['typo']);
  });

  it('coincide con la regola pairwise del trigger su un registro casuale deterministico', () => {
    // generatore lineare congruente: nessun Math.random
    let s = 12345;
    const rnd = (n: number) => ((s = (s * 1103515245 + 12345) % 2147483648), s % n);
    const rs: OdometerReading[] = [];
    for (let i = 0; i < 60; i++) {
      const day = 1 + rnd(28);
      const month = 1 + rnd(6);
      rs.push(R(`2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, 10000 + rnd(3000), { id: `g${i}` }));
    }
    const fast = new Set(findInconsistentReadings(rs).map((b) => b.reading.id));
    const slow = new Set(
      rs.filter((r) => findMonotonicConflicts({ id: r.id, readOn: r.readOn, km: r.km }, rs).length > 0).map((r) => r.id),
    );
    expect(fast).toEqual(slow);
    expect(fast.size).toBeGreaterThan(0);
  });
});

describe('odometer: km percorsi in un periodo (base del costo al km)', () => {
  const rs = [
    R('2026-01-01', 10000),
    R('2026-03-01', 12000),
    R('2026-06-01', 15000),
    R('2026-06-01', 15020),
    R('2026-09-15', 17000),
    R('2026-09-16', 99999, { status: 'ignored' }),
  ];

  it('prima e ultima lettura valida del periodo', () => {
    const t = kmTravelled(rs, '2026-01-01', '2026-06-30')!;
    expect(t.km).toBe(5020);
    expect(t.from.km).toBe(10000);
    expect(t.to.km).toBe(15020);
    expect(t.readings).toBe(4);
  });

  it('estremi inclusi e ignorate escluse', () => {
    expect(kmTravelled(rs, '2026-03-01', '2026-09-15')!.km).toBe(5000);
    expect(kmTravelled(rs, '2026-09-01', '2026-12-31')).toBeNull(); // una sola lettura valida
  });

  it('meno di due letture: non calcolabile', () => {
    expect(kmTravelled(rs, '2027-01-01', '2027-12-31')).toBeNull();
    expect(kmTravelled([], '2026-01-01', '2026-12-31')).toBeNull();
  });

  it('su tutto il registro', () => {
    expect(kmTravelledAllTime(rs)!.km).toBe(7000);
    expect(kmTravelledAllTime([R('2026-01-01', 5)])).toBeNull();
  });
});
