import { describe, expect, it } from 'vitest';
import { formatPressure } from '@/domain/units';
import type { FluidCheckEntry, FluidStatusEntry } from '@/usecases/fluids';
import {
  buildAddFluidInput,
  fluidErrorField,
  fluidNextCheckText,
  fluidRestoreInput,
  fluidRowSubtitle,
  fluidRowTitle,
  fluidTone,
  fluidsNeedingAttention,
  initialFluidForm,
  levelOptions,
  showsAddedFields,
  switchFluid,
  type FluidFormValues,
} from '@/ui/logic/fluidForm';

const ctx = { today: '2026-10-09', unit: 'km' as const };
const form = (over: Partial<FluidFormValues> = {}): FluidFormValues => ({ ...initialFluidForm('engine_oil', ctx.today), ...over });

describe('Controllo livelli: registrazione in 3 tocchi', () => {
  it('serve l\'esito: fluido -> esito -> salva. Con OK basta questo', () => {
    expect(buildAddFluidInput('v1', form(), ctx)).toMatchObject({ ok: false, errors: { level: expect.any(String) } });
    const ok = buildAddFluidInput('v1', form({ level: 'ok' }), ctx);
    expect(ok).toEqual({ ok: true, input: { vehicleId: 'v1', fluid: 'engine_oil', level: 'ok', checkedOn: '2026-10-09', km: null, notes: null } });
  });

  it('le etichette dell\'esito seguono il fluido: per la pressione «Gonfiata» invece di «Rabboccato»', () => {
    expect(levelOptions('engine_oil').map((o) => o.label)).toEqual(['OK', 'Basso', 'Rabboccato', 'Alto']);
    expect(levelOptions('tyre_pressure').map((o) => o.label)).toEqual(['OK', 'Bassa', 'Gonfiata', 'Alta']);
  });

  it('quantita e prodotto solo con «rabboccato»: in ml o litri, mai per la pressione', () => {
    expect(showsAddedFields({ fluid: 'engine_oil', level: 'topped_up' })).toBe(true);
    expect(showsAddedFields({ fluid: 'engine_oil', level: 'low' })).toBe(false);
    expect(showsAddedFields({ fluid: 'tyre_pressure', level: 'topped_up' })).toBe(false);
    const ml = buildAddFluidInput('v1', form({ level: 'topped_up', added: '250', product: ' 5W-30 ' }), ctx);
    expect(ml.ok && ml.input).toMatchObject({ addedMl: 250, product: '5W-30' });
    const litres = buildAddFluidInput('v1', form({ level: 'topped_up', added: '0,5', addedUnit: 'L' }), ctx);
    expect(litres.ok && litres.input.addedMl).toBe(500);
    // con un esito diverso la quantita scritta prima non viene inviata
    const low = buildAddFluidInput('v1', form({ level: 'low', added: '250', product: 'x' }), ctx);
    expect(low.ok && 'addedMl' in low.input).toBe(false);
    const bad = buildAddFluidInput('v1', form({ level: 'topped_up', added: 'tanto' }), ctx);
    expect(bad).toMatchObject({ ok: false, errors: { added: expect.any(String) } });
  });

  it('pressione in bar con la virgola (2,2 -> 2200 millibar) e intervallo 0,5-6 bar', () => {
    const f = (pressure: string) => buildAddFluidInput('v1', initialWithPressure(pressure), ctx);
    const ok = f('2,2');
    expect(ok.ok && ok.input.valueMillibar).toBe(2200);
    expect(f('2.25')).toMatchObject({ ok: true, input: { valueMillibar: 2250 } });
    expect(f('9')).toMatchObject({ ok: false, errors: { pressure: expect.stringContaining('0,5 e 6') } });
    expect(f('abc')).toMatchObject({ ok: false });
    expect(f('')).toMatchObject({ ok: true });
    // la pressione non si invia per un altro fluido
    const oil = buildAddFluidInput('v1', form({ level: 'ok', pressure: '2,2' }), ctx);
    expect(oil.ok && 'valueMillibar' in oil.input).toBe(false);
  });

  it('data, km e cambio di fluido', () => {
    expect(buildAddFluidInput('v1', form({ level: 'ok', date: '10/10/2026' }), ctx)).toMatchObject({ ok: false, errors: { date: expect.stringContaining('futuro') } });
    expect(buildAddFluidInput('v1', form({ level: 'ok', km: '45.200' }), ctx)).toMatchObject({ ok: true, input: { km: 45200 } });
    expect(buildAddFluidInput('v1', form({ level: 'ok', km: 'x' }), ctx)).toMatchObject({ ok: false, errors: { km: expect.any(String) } });
    const switched = switchFluid(form({ level: 'low', added: '1', product: 'x' }), 'coolant');
    expect(switched).toMatchObject({ fluid: 'coolant', level: null, added: '', product: '' });
  });

  it('i campi del caso d\'uso si riportano al campo del modulo', () => {
    expect(fluidErrorField('valueMillibar')).toBe('pressure');
    expect(fluidErrorField('addedMl')).toBe('added');
    expect(fluidErrorField('checkedOn')).toBe('date');
    expect(fluidErrorField('product')).toBe('form');
  });
});

function initialWithPressure(pressure: string): FluidFormValues {
  return { ...initialFluidForm('tyre_pressure', ctx.today), level: 'ok', pressure };
}

describe('Controllo livelli: stato, storico e annulla', () => {
  const status = (over: Partial<FluidStatusEntry>): FluidStatusEntry => ({ fluid: 'engine_oil', kind: 'ok', nextCheckOn: null, nextCheckKm: null, ...over }) as FluidStatusEntry;
  const check = (over: Partial<FluidCheckEntry> = {}): FluidCheckEntry =>
    ({
      id: 'c1', vehicleId: 'v1', checkedOn: '2026-10-01', fluid: 'tyre_pressure', level: 'topped_up', valueMillibar: 2200, addedMl: null, km: 45200, product: null,
      notes: 'a freddo', fluidLabelIt: 'Pressione pneumatici', levelLabelIt: 'Gonfiata', odometerReadingId: 'o1', createdAt: '', ...over,
    }) as FluidCheckEntry;

  it('il semaforo ha sempre icona e tono: mai controllato, da tenere d\'occhio, da ricontrollare, ok', () => {
    expect(fluidTone('never')).toEqual({ tone: 'unknown', icon: 'help' });
    expect(fluidTone('attention')).toEqual({ tone: 'warning', icon: 'alert' });
    expect(fluidTone('overdue')).toEqual({ tone: 'warning', icon: 'clock' });
    expect(fluidTone('ok')).toEqual({ tone: 'ok', icon: 'check' });
  });

  it('conta i fluidi da controllare o ricontrollare', () => {
    expect(fluidsNeedingAttention([status({ kind: 'ok' }), status({ kind: 'never' }), status({ kind: 'overdue' }), status({ kind: 'attention' })])).toBe(3);
    expect(fluidsNeedingAttention([])).toBe(0);
  });

  it('prossimo controllo consigliato a data e/o km', () => {
    expect(fluidNextCheckText(status({}), 'km')).toBeNull();
    expect(fluidNextCheckText(status({ nextCheckOn: '2026-11-01' }), 'km')).toBe('Prossimo controllo consigliato: 01/11/2026');
    expect(fluidNextCheckText(status({ nextCheckOn: '2026-11-01', nextCheckKm: 46200 }), 'km')).toBe('Prossimo controllo consigliato: 01/11/2026 oppure verso i 46.200 km');
  });

  it('riga di storico e dati per ricreare il controllo con Annulla', () => {
    const c = check();
    expect(fluidRowTitle(c)).toBe('Pressione pneumatici · Gonfiata');
    expect(fluidRowSubtitle(c, 'km')).toBe(`01/10/2026 · ${formatPressure(2200, 'bar')} · 45.200 km`);
    expect(fluidRowSubtitle(check({ fluid: 'engine_oil', valueMillibar: null, addedMl: 1500, product: '5W-30', km: null }), 'km')).toBe('01/10/2026 · Aggiunti 1,5 L · 5W-30');
    expect(fluidRestoreInput(c)).toEqual({
      vehicleId: 'v1',
      fluid: 'tyre_pressure',
      level: 'topped_up',
      checkedOn: '2026-10-01',
      km: 45200,
      notes: 'a freddo',
      valueMillibar: 2200,
      onOdometerConflict: 'skip_km',
    });
  });
});
