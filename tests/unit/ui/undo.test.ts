import { afterEach, describe, expect, it } from 'vitest';
import { clearUndo, peekUndo, pushUndo } from '@/ui/hooks/undo';

describe('Annulla dopo salvataggio o eliminazione', () => {
  afterEach(() => clearUndo());

  it('tiene un solo promemoria alla volta e lo rinnova a ogni nuovo evento', () => {
    expect(peekUndo()).toBeNull();
    pushUndo({ mode: 'deleted', kind: 'fuel', itemId: 'f1', vehicleId: 'v1', message: 'Rifornimento eliminato.' });
    const first = peekUndo();
    expect(first).toMatchObject({ mode: 'deleted', kind: 'fuel', itemId: 'f1', vehicleId: 'v1' });
    pushUndo({ mode: 'added', kind: 'expense', itemId: 'x1', vehicleId: 'v1', message: 'Spesa salvata.' });
    const second = peekUndo();
    expect(second).toMatchObject({ mode: 'added', kind: 'expense', itemId: 'x1' });
    expect(second!.seq).toBeGreaterThan(first!.seq);
  });

  it('si svuota e non fa nulla se e\' gia\' vuoto', () => {
    pushUndo({ mode: 'added', kind: 'expense', itemId: 'x1', vehicleId: 'v1', message: 'Spesa salvata.' });
    clearUndo();
    expect(peekUndo()).toBeNull();
    expect(() => clearUndo()).not.toThrow();
  });
});
