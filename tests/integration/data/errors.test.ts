// Traduzione degli errori di SQLite in errori di dominio, sui messaggi VERI prodotti dal database.
import { beforeEach, describe, expect, it } from 'vitest';
import { sqlErrorMessage, toDomainError } from '@/data/db/errors';
import { insertRow, odometerRow, openBootedDb, vehicleRow, type TestDb } from '../../support/db';

let t: TestDb;
beforeEach(async () => {
  t = await openBootedDb();
});

const catchError = async (fn: () => Promise<unknown>): Promise<unknown> => {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error('doveva lanciare');
};

describe('toDomainError', () => {
  it('ODO_NON_MONOTONIC dal trigger dei chilometri', async () => {
    const v = await insertRow(t.db, 'vehicles', vehicleRow());
    await insertRow(t.db, 'odometer_readings', odometerRow(v, '2026-06-01', 15000));
    const e = await catchError(() => insertRow(t.db, 'odometer_readings', odometerRow(v, '2026-03-02', 16000)));
    expect(toDomainError(e)).toEqual({
      code: 'ODO_NON_MONOTONIC',
      message: 'I chilometri non sono coerenti con le altre letture del veicolo.',
    });
  });

  it('DUPLICATE_PLATE dall\'indice unico sulla targa', async () => {
    await insertRow(t.db, 'vehicles', vehicleRow({ plate: 'AB123CD' }));
    const e = await catchError(() => insertRow(t.db, 'vehicles', vehicleRow({ plate: 'AB123CD' })));
    expect(toDomainError(e)).toEqual({ code: 'DUPLICATE_PLATE' });
  });

  it('un VIN duplicato o altri errori non diventano DUPLICATE_PLATE: undefined (da rilanciare)', async () => {
    await insertRow(t.db, 'vehicles', vehicleRow({ vin: 'ZFA12345678901234' }));
    const dupVin = await catchError(() => insertRow(t.db, 'vehicles', vehicleRow({ vin: 'ZFA12345678901234' })));
    expect(toDomainError(dupVin)).toBeUndefined();
    expect(toDomainError(new Error('boom'))).toBeUndefined();
    expect(toDomainError('stringa')).toBeUndefined();
    expect(toDomainError(null)).toBeUndefined();
  });

  it('sqlErrorMessage accetta Error, stringhe, oggetti con message e valori qualsiasi', () => {
    expect(sqlErrorMessage(new Error('x'))).toBe('x');
    expect(sqlErrorMessage('y')).toBe('y');
    expect(sqlErrorMessage({ message: 'z' })).toBe('z');
    expect(sqlErrorMessage(42)).toBe('42');
  });
});
