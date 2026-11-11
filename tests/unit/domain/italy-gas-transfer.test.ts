import { describe, expect, it } from 'vitest';
import {
  GAS_LEAD_DAYS,
  GAS_RULES,
  TRANSFER_RULES,
  cngEndOfLife,
  cngNextDue,
  gasCylinderDue,
  gplTankDue,
  ownershipTransferDue,
  ownershipTransferReminderDates,
  reminderDates,
} from '@/domain/italy';

// Vettori G1-G6 di REG §5.4: tutti con confidenza BASSA (indicative), mai «ufficiali».
describe('bombole GPL e metano', () => {
  it('G1: R110, immatricolazione 2020-06-15, primo ciclo -> 2024-06-15', () => {
    const r = cngNextDue('R110', '2020-06-15', true);
    expect(r.dueOn).toBe('2024-06-15');
    expect(r.basis).toBe('cng_registration');
    expect(r.ruleId).toBe('it.gas.cng_r110');
  });

  it('G2: R110, ultima riqualificazione 2024-05-20 -> 2028-05-20', () => {
    const r = cngNextDue('R110', '2024-05-20', false);
    expect(r.dueOn).toBe('2028-05-20');
    expect(r.basis).toBe('cng_last_requalification');
  });

  it('G3: DGM, ultima riqualificazione 2023-01-31 -> 2028-01-31', () => {
    expect(cngNextDue('DGM', '2023-01-31', false).dueOn).toBe('2028-01-31');
  });

  it('G4: R110 tipo IV, immatricolazione 2021-03-10 -> 2025-03-10; poi riqualificazione 2025-03-01 -> 2027-03-01', () => {
    expect(cngNextDue('R110_TYPE_IV', '2021-03-10', true).dueOn).toBe('2025-03-10');
    const next = cngNextDue('R110_TYPE_IV', '2025-03-01', false);
    expect(next.dueOn).toBe('2027-03-01');
    expect(next.rule.openPoints.join(' ')).toContain('2 o 4 anni');
  });

  it('G5: serbatoio GPL costruito 2018-09 -> scade 2028-09-30', () => {
    const r = gplTankDue({ kind: 'construction', yearMonth: '2018-09' });
    expect(r.dueOn).toBe('2028-09-30');
    expect(r.basis).toBe('gpl_construction');
    expect(r.caveats).toHaveLength(0);
  });

  it('G5 bis: febbraio bisestile', () => {
    expect(gplTankDue({ kind: 'construction', yearMonth: '2018-02' }).dueOn).toBe('2028-02-29');
  });

  it("GPL con data di riferimento diversa dalla costruzione: data esatta + 10 anni e avviso sul conflitto tra fonti", () => {
    const r = gplTankDue({ kind: 'registration', on: '2016-05-12' });
    expect(r.dueOn).toBe('2026-05-12');
    expect(r.basis).toBe('gpl_registration');
    expect(r.caveats[0]).toContain('le fonti non concordano');
    expect(gplTankDue({ kind: 'installation', on: '2017-01-31' }).basis).toBe('gpl_installation');
  });

  it('G6: bombola metano installata 2012-02-29 -> fine vita 2032-02-29 (20 anni)', () => {
    const r = cngEndOfLife('2012-02-29');
    expect(r.dueOn).toBe('2032-02-29');
    expect(r.basis).toBe('cng_end_of_life');
  });

  it('mese del serbatoio non valido: errore', () => {
    expect(() => gplTankDue({ kind: 'construction', yearMonth: '2018-13' })).toThrow(RangeError);
    expect(() => gplTankDue({ kind: 'construction', yearMonth: '2018/09' })).toThrow(RangeError);
  });

  it('confidenza sempre bassa nei calcoli automatici, con avvertenza «verifica con l officina»', () => {
    const results = [
      cngNextDue('R110', '2020-06-15', true),
      cngNextDue('DGM', '2023-01-31', false),
      cngNextDue('R110_TYPE_IV', '2021-03-10', true),
      cngEndOfLife('2012-02-29'),
      gplTankDue({ kind: 'construction', yearMonth: '2018-09' }),
    ];
    for (const r of results) {
      expect(r.confidence).toBe('indicative');
      expect(r.rule.evidence).not.toBe('high');
      expect(r.warningText).toContain('officina autorizzata');
      expect(r.verifiedOn).toBe('2026-10-07');
    }
    expect(GAS_RULES.gplTank.evidence).toBe('low');
    expect(GAS_RULES.cngTypeIV.evidence).toBe('low');
  });

  it('punto d ingresso unico: tipo sconosciuto -> nessun calcolo, codice motivo', () => {
    const r = gasCylinderDue({ kind: 'cng', type: null, baseOn: '2020-06-15', firstCycle: true });
    expect(r.dueOn).toBeNull();
    expect(r.reasonCode).toBe('GAS_TYPE_UNKNOWN');
    expect(r.ruleId).toBe('it.gas.type_unknown');
  });

  it('punto d ingresso unico: data fissa inserita dall utente, metano, fine vita e GPL', () => {
    const manual = gasCylinderDue({ kind: 'manual', dueOn: '2027-08-31' });
    expect(manual.dueOn).toBe('2027-08-31');
    expect(manual.basis).toBe('manual');
    expect(manual.confidence).toBe('official');
    expect(gasCylinderDue({ kind: 'cng', type: 'R110', baseOn: '2020-06-15', firstCycle: true }).dueOn).toBe('2024-06-15');
    expect(gasCylinderDue({ kind: 'cng_end_of_life', installedOn: '2012-02-29' }).dueOn).toBe('2032-02-29');
    expect(gasCylinderDue({ kind: 'gpl', reference: { kind: 'construction', yearMonth: '2018-09' } }).dueOn).toBe(
      '2028-09-30',
    );
  });

  it('preavvisi del catalogo 90, 30, 7, 0 giorni', () => {
    expect(GAS_LEAD_DAYS).toEqual([90, 30, 7, 0]);
    expect(reminderDates('2028-09-30', GAS_LEAD_DAYS)).toEqual(['2028-07-02', '2028-08-31', '2028-09-23', '2028-09-30']);
  });
});

// Vettori S1-S4 di REG §7.3: 60 giorni dalla data di autentica (dies a quo non computatur).
describe('passaggio di proprieta', () => {
  it('S1: autentica 2026-09-01 -> 2026-10-31', () => {
    const r = ownershipTransferDue('2026-09-01');
    expect(r.dueOn).toBe('2026-10-31');
    expect(r.basis).toBe('authentication_date');
    expect(r.ruleId).toBe('it.transfer.pra_deadline');
    expect(r.confidence).toBe('official');
  });

  it('S2: autentica 2026-01-15 -> 2026-03-16', () => {
    expect(ownershipTransferDue('2026-01-15').dueOn).toBe('2026-03-16');
  });

  it('S3: autentica 2026-12-20 -> 2027-02-18', () => {
    expect(ownershipTransferDue('2026-12-20').dueOn).toBe('2027-02-18');
  });

  it('S4: promemoria a 30, 45, 55 e 60 giorni dopo l autentica', () => {
    expect(ownershipTransferReminderDates('2026-09-01')).toEqual(['2026-10-01', '2026-10-16', '2026-10-26', '2026-10-31']);
  });

  it('il termine e un dato configurabile e porta l avvertenza della voce', () => {
    const r = ownershipTransferDue('2026-09-01');
    expect(r.rule).toBe(TRANSFER_RULES.deadline);
    expect(r.warningText).toContain('60 giorni dalla data di autentica');
    const custom = {
      deadline: { ...TRANSFER_RULES.deadline, params: { ...TRANSFER_RULES.deadline.params, days: 30 } },
    };
    expect(ownershipTransferDue('2026-09-01', custom).dueOn).toBe('2026-10-01');
  });
});
