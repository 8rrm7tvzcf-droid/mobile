import { describe, expect, it } from 'vitest';
import {
  INSPECTION_LEAD_DAYS,
  INSPECTION_RULES,
  deadlineStatus,
  inspectionDue,
  reminderDates,
  type InspectionRules,
} from '@/domain/italy';

// Vettori R1-R9 di REG §1.6 / SPEC §7.2, ricalcolati a mano (4 anni + fine mese, poi 24 mesi + fine mese).
describe('revisione: scadenza', () => {
  it('R1: prima revisione = fine del mese di immatricolazione + 48 mesi', () => {
    const r = inspectionDue({ firstRegisteredOn: '2022-03-15' });
    expect(r.dueOn).toBe('2026-03-31');
    expect(r.basis).toBe('first_registration');
    expect(r.ruleId).toBe('it.inspection.first');
    expect(r.confidence).toBe('official');
  });

  it('R2: dopo la revisione il riferimento e il mese dell ultima revisione, non l immatricolazione', () => {
    const r = inspectionDue({ firstRegisteredOn: '2022-03-15', lastInspectionOn: '2026-03-10' });
    expect(r.dueOn).toBe('2028-03-31');
    expect(r.basis).toBe('last_inspection');
    expect(r.ruleId).toBe('it.inspection.next');
    expect(r.confidence).toBe('practice');
  });

  it('R3: immatricolazione 29 febbraio 2020 -> 2024-02-29 (anno bisestile)', () => {
    expect(inspectionDue({ firstRegisteredOn: '2020-02-29' }).dueOn).toBe('2024-02-29');
  });

  it('R4: revisione anticipata (febbraio 2026) -> fine febbraio 2028 (bisestile)', () => {
    const r = inspectionDue({ firstRegisteredOn: '2022-06-10', lastInspectionOn: '2026-02-12' });
    expect(r.dueOn).toBe('2028-02-29');
  });

  it('R5 e R6: conta il mese, non il giorno', () => {
    expect(inspectionDue({ firstRegisteredOn: '2018-01-01', lastInspectionOn: '2025-12-31' }).dueOn).toBe('2027-12-31');
    expect(inspectionDue({ firstRegisteredOn: '2018-01-01', lastInspectionOn: '2026-01-31' }).dueOn).toBe('2028-01-31');
  });

  it('V2a (DAT): ultima 2024-06-10 -> 2026-06-30, scaduta da 99 giorni il 2026-10-07', () => {
    const r = inspectionDue({ firstRegisteredOn: '2015-01-01', lastInspectionOn: '2024-06-10' });
    expect(r.dueOn).toBe('2026-06-30');
    const st = deadlineStatus('2026-10-07', r.dueOn as string);
    expect(st.state).toBe('overdue');
    expect(st.daysOverdue).toBe(99);
  });

  it('R9: la data letta sul portale vince su qualunque altro dato', () => {
    const r = inspectionDue({
      firstRegisteredOn: '2022-03-15',
      lastInspectionOn: '2026-03-10',
      manualDueOn: '2027-05-31',
    });
    expect(r.dueOn).toBe('2027-05-31');
    expect(r.basis).toBe('manual');
    expect(r.ruleId).toBe('it.inspection.manual');
    // anche con esito sospeso
    expect(
      inspectionDue({
        firstRegisteredOn: '2022-03-15',
        lastInspectionOn: '2026-03-10',
        lastOutcome: 'suspended',
        manualDueOn: '2027-05-31',
      }).dueOn,
    ).toBe('2027-05-31');
  });
});

describe('revisione: stato (R7, R8)', () => {
  it('R7: scade oggi, 0 giorni', () => {
    const s = deadlineStatus('2026-03-31', '2026-03-31');
    expect(s.state).toBe('due_today');
    expect(s.daysLeft).toBe(0);
    expect(s.label).toBe('Scade oggi');
  });

  it('R8: scaduta da 1 giorno dal giorno dopo', () => {
    const s = deadlineStatus('2026-04-01', '2026-03-31');
    expect(s.state).toBe('overdue');
    expect(s.daysOverdue).toBe(1);
    expect(s.label).toBe('Scaduta da 1 giorno');
    expect(deadlineStatus('2026-04-03', '2026-03-31').label).toBe('Scaduta da 3 giorni');
  });

  it('valida: giorni mancanti e testo italiano', () => {
    expect(deadlineStatus('2026-03-30', '2026-03-31').label).toBe('Scade domani');
    const s = deadlineStatus('2026-03-26', '2026-03-31');
    expect(s.state).toBe('valid');
    expect(s.daysLeft).toBe(5);
    expect(s.label).toBe('Scade tra 5 giorni');
  });
});

describe('revisione: esiti', () => {
  it('regolare (o esito assente) = nuova scadenza biennale', () => {
    const base = { firstRegisteredOn: '2018-01-01', lastInspectionOn: '2026-03-10' } as const;
    expect(inspectionDue({ ...base, lastOutcome: 'regular' }).dueOn).toBe('2028-03-31');
    expect(inspectionDue({ ...base, lastOutcome: null }).dueOn).toBe('2028-03-31');
  });

  it('da ripetere: entro un mese di calendario (non 30 giorni)', () => {
    const r = inspectionDue({ firstRegisteredOn: '2018-01-01', lastInspectionOn: '2026-03-10', lastOutcome: 'to_repeat' });
    expect(r.dueOn).toBe('2026-04-10');
    expect(r.basis).toBe('repeat');
    expect(r.ruleId).toBe('it.inspection.repeat');
    // clamp a fine mese: 31 gennaio + 1 mese = 28 febbraio (30 giorni darebbe il 2 marzo)
    expect(
      inspectionDue({ firstRegisteredOn: '2018-01-01', lastInspectionOn: '2026-01-31', lastOutcome: 'to_repeat' }).dueOn,
    ).toBe('2026-02-28');
  });

  it('sospesa: nessuna data inventata, codice motivo e avvertenza senza dichiarazioni sulla circolazione', () => {
    const r = inspectionDue({ firstRegisteredOn: '2018-01-01', lastInspectionOn: '2026-03-10', lastOutcome: 'suspended' });
    expect(r.dueOn).toBeNull();
    expect(r.reasonCode).toBe('INSPECTION_SUSPENDED');
    expect(r.basis).toBe('suspended');
    expect(r.warningText).toContain('nuova richiesta di revisione');
    expect(r.warningText).not.toMatch(/puoi circolare|non puoi circolare/);
  });

  it('auto importata: confidenza bassa e avviso, la data resta calcolata', () => {
    const r = inspectionDue({ firstRegisteredOn: '2022-03-15', importedFromAbroad: true });
    expect(r.dueOn).toBe('2026-03-31');
    expect(r.confidence).toBe('indicative');
    expect(r.caveats).toHaveLength(1);
    expect(inspectionDue({ firstRegisteredOn: '2022-03-15' }).caveats).toHaveLength(0);
  });
});

describe('revisione: regole come dati', () => {
  it('ogni risultato porta regola, id, data di verifica, confidenza e avvertenza', () => {
    const r = inspectionDue({ firstRegisteredOn: '2022-03-15' });
    expect(r.rule).toBe(INSPECTION_RULES.first);
    expect(r.ruleId).toBe(r.rule.id);
    expect(r.verifiedOn).toBe('2026-10-07');
    expect(r.warningText).toContain('art. 80 del Codice della Strada');
    expect(r.warningText).toContain('173 a 694');
    expect(r.rule.sources.length).toBeGreaterThan(0);
  });

  it("l'intervallo di 24 mesi e' un dato configurabile, non una costante (pacchetto UE)", () => {
    const annual: InspectionRules = {
      ...INSPECTION_RULES,
      next: { ...INSPECTION_RULES.next, params: { ...INSPECTION_RULES.next.params, afterMonths: 12 } },
    };
    expect(inspectionDue({ firstRegisteredOn: '2018-01-01', lastInspectionOn: '2026-03-10' }, annual).dueOn).toBe('2027-03-31');
    expect(inspectionDue({ firstRegisteredOn: '2018-01-01', lastInspectionOn: '2026-03-10' }).dueOn).toBe('2028-03-31');
  });

  it('preavvisi del catalogo 60, 30, 14, 7, 0 giorni (SPEC 7.2)', () => {
    expect(INSPECTION_LEAD_DAYS).toEqual([60, 30, 14, 7, 0]);
    expect(reminderDates('2026-03-31', INSPECTION_LEAD_DAYS)).toEqual([
      '2026-01-30',
      '2026-03-01',
      '2026-03-17',
      '2026-03-24',
      '2026-03-31',
    ]);
  });

  it('input con data non valida: errore, nessun risultato inventato', () => {
    expect(() => inspectionDue({ firstRegisteredOn: '2022-02-30' })).toThrow(RangeError);
  });
});
