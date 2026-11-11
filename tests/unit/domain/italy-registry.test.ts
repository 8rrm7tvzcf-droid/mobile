import { describe, expect, it } from 'vitest';
import {
  GAS_RULES,
  INSPECTION_RULES,
  LICENCE_RULES,
  ROAD_TAX_RULES,
  RULE_REGISTRY,
  TRANSFER_RULES,
  buildDeadline,
  dueRechecks,
  getRule,
  inspectionDue,
  licenceExpiry,
  newDriverUntil,
  ownershipTransferDue,
  roadTaxFirstDue,
  roadTaxRenewalDue,
  ruleAppliesOn,
  selectRule,
  staleRules,
  gasCylinderDue,
  datesAfter,
  daysIt,
} from '@/domain/italy';
import { RCA_RULES, rcaDue, rcaStatus } from '@/domain/insurance';
import { TYRE_RULES, dotProductionDate, tyreAge, treadStatus, winterTyreSeason } from '@/domain/tyres';

describe('registro delle regole: ogni regola e un dato con fonte e data di verifica', () => {
  it('id univoci, in formato it.<argomento>.<nome>', () => {
    const ids = RULE_REGISTRY.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^it\.[a-z_]+\.[a-z0-9_.-]+$/);
  });

  it('ogni regola ha fonti con URL https, data di verifica, avvertenza e testi in italiano', () => {
    expect(RULE_REGISTRY.length).toBeGreaterThanOrEqual(30);
    for (const r of RULE_REGISTRY) {
      expect(r.sources.length, r.id).toBeGreaterThan(0);
      for (const s of r.sources) {
        expect(s.url, r.id).toMatch(/^https:\/\//);
        expect(s.label.length, r.id).toBeGreaterThan(0);
      }
      expect(r.verifiedOn, r.id).toBe('2026-10-07');
      expect(r.warningText.length, r.id).toBeGreaterThan(20);
      expect(r.title.length, r.id).toBeGreaterThan(0);
      expect(r.summary.length, r.id).toBeGreaterThan(0);
      expect(['official', 'practice', 'indicative']).toContain(r.confidence);
      expect(['high', 'medium', 'low']).toContain(r.evidence);
      // validFrom <= validTo
      if (r.validTo !== null) expect(r.validFrom <= r.validTo, r.id).toBe(true);
    }
  });

  it('i testi per l utente non hanno apostrofi al posto degli accenti (e\' / puo\' ...)', () => {
    const bad = /\b(e|puo|piu|gia|cosi|perche|ne|ora|dara|verra)'(?=\s|[.,;:)])/;
    for (const r of RULE_REGISTRY) {
      const text = [r.title, r.summary, r.warningText, ...r.openPoints].join(' | ');
      expect(text, r.id).not.toMatch(bad);
    }
  });

  it('getRule ritrova la regola dall id restituito dai calcoli', () => {
    expect(getRule('it.inspection.first')).toBe(INSPECTION_RULES.first);
    expect(getRule('it.rca.grace_period')).toBe(RCA_RULES.grace);
    expect(getRule('it.tyres.winter_window')).toBe(TYRE_RULES.winterWindow);
    expect(getRule('it.gas.gpl_tank')).toBe(GAS_RULES.gplTank);
    expect(getRule('it.licence.expiry')).toBe(LICENCE_RULES.expiry);
    expect(getRule('it.transfer.pra_deadline')).toBe(TRANSFER_RULES.deadline);
    expect(getRule('it.nope')).toBeUndefined();
  });

  it('ogni funzione di calcolo restituisce un ruleId presente nel registro, con rule e metadati coerenti', () => {
    const outcomes = [
      inspectionDue({ firstRegisteredOn: '2022-03-15' }),
      inspectionDue({ firstRegisteredOn: '2022-03-15', lastInspectionOn: '2026-03-10' }),
      inspectionDue({ firstRegisteredOn: '2022-03-15', lastInspectionOn: '2026-03-10', lastOutcome: 'to_repeat' }),
      inspectionDue({ firstRegisteredOn: '2022-03-15', lastInspectionOn: '2026-03-10', lastOutcome: 'suspended' }),
      inspectionDue({ firstRegisteredOn: '2022-03-15', manualDueOn: '2027-05-31' }),
      roadTaxFirstDue({ registeredOn: '2026-03-05', region: 'OTHER' }),
      roadTaxFirstDue({ registeredOn: '2028-03-05', region: 'OTHER' }),
      roadTaxRenewalDue(2026, { registeredOn: '2022-03-15' }),
      roadTaxRenewalDue(2026, { registeredOn: '2022-03-15', paymentMonth: 5 }),
      rcaDue({ expiryOn: '2026-03-10' }),
      rcaDue({ policyStartOn: '2025-03-10' }),
      rcaStatus('2026-03-20', '2026-03-10'),
      winterTyreSeason(2026),
      treadStatus(1.5, true),
      treadStatus(5, true),
      tyreAge('1219', '2026-10-07'),
      gasCylinderDue({ kind: 'cng', type: 'DGM', baseOn: '2023-01-31', firstCycle: false }),
      gasCylinderDue({ kind: 'cng', type: null, baseOn: '2023-01-31', firstCycle: false }),
      gasCylinderDue({ kind: 'gpl', reference: { kind: 'construction', yearMonth: '2018-09' } }),
      licenceExpiry({ birthOn: '1985-04-12', issuedOrRenewedOn: '2026-03-01' }),
      newDriverUntil('2024-12-20'),
      ownershipTransferDue('2026-09-01'),
    ];
    for (const o of outcomes) {
      expect(o).not.toBeNull();
      if (!o) continue;
      const rule = getRule(o.ruleId);
      expect(rule, o.ruleId).toBeDefined();
      expect(o.rule, o.ruleId).toBe(rule);
      expect(o.verifiedOn).toBe(rule?.verifiedOn);
      expect(o.warningText.length).toBeGreaterThan(0);
      expect(['official', 'practice', 'indicative']).toContain(o.confidence);
      expect('dueOn' in o).toBe(true);
    }
  });

  it('la confidenza dei calcoli del gas e sempre bassa; la data manuale e ufficiale', () => {
    for (const r of [GAS_RULES.cngDgm, GAS_RULES.cngR110, GAS_RULES.cngTypeIV, GAS_RULES.cngEndOfLife, GAS_RULES.gplTank]) {
      expect(r.confidence).toBe('indicative');
    }
    expect(GAS_RULES.manual.confidence).toBe('official');
  });
});

describe('validita delle regole nel tempo', () => {
  it('selectRule e ruleAppliesOn rispettano validFrom e validTo (estremi inclusi)', () => {
    const [a, b] = ROAD_TAX_RULES.firstPayment;
    expect(ruleAppliesOn(a, '2027-12-31')).toBe(true);
    expect(ruleAppliesOn(a, '2028-01-01')).toBe(false);
    expect(ruleAppliesOn(b, '2027-12-31')).toBe(false);
    expect(ruleAppliesOn(b, '2028-01-01')).toBe(true);
    expect(selectRule([a, b], '2030-06-01')).toBe(b);
    expect(selectRule([a], '2030-06-01')).toBeUndefined();
  });

  it('buildDeadline permette di declassare la confidenza senza toccare la regola', () => {
    const r = buildDeadline(INSPECTION_RULES.first, '2026-03-31', 'first_registration', { confidence: 'indicative' });
    expect(r.confidence).toBe('indicative');
    expect(r.rule.confidence).toBe('official');
  });
});

describe('freschezza delle fonti (SPEC §7, principio 5)', () => {
  it('subito dopo la verifica nessuna regola e da rileggere', () => {
    expect(staleRules('2026-10-08')).toEqual([]);
    expect(staleRules('2027-04-07')).toEqual([]); // 6 mesi esatti dopo la verifica: ancora ok
  });

  it('dopo 6 mesi dalla verifica tutte le regole vanno rilette', () => {
    expect(staleRules('2027-04-08')).toHaveLength(RULE_REGISTRY.length);
  });

  it('controlli puntuali: 2026-11-16 (D.L. 162/2026) e 2026-12-01 (importi ISTAT)', () => {
    expect(dueRechecks('2026-10-08')).toEqual([]);
    expect(dueRechecks('2026-11-16').map((c) => c.on)).toEqual(['2026-11-16']);
    expect(dueRechecks('2026-12-01').map((c) => c.on)).toEqual(['2026-11-16', '2026-12-01']);
  });
});

describe('utilita di calendario', () => {
  it('plurale dei giorni', () => {
    expect(daysIt(0)).toBe('0 giorni');
    expect(daysIt(1)).toBe('1 giorno');
    expect(daysIt(2)).toBe('2 giorni');
  });

  it('datesAfter: ordinate e senza doppioni', () => {
    expect(datesAfter('2026-09-01', [60, 30, 30])).toEqual(['2026-10-01', '2026-10-31']);
  });

  it('smoke: le funzioni dei tre moduli si compongono senza orologio', () => {
    // nessun Date.now(): ogni funzione riceve la data come parametro
    expect(dotProductionDate(1, 2020)).toBe('2020-01-01');
  });
});
