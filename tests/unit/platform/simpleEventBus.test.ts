import { describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '@/domain/ports';
import { createSimpleEventBus } from '@/platform/events/simpleEventBus';

const ev: DomainEvent = { type: 'data-changed', scope: 'vehicles', vehicleId: 'v1' };

describe('createSimpleEventBus', () => {
  it("consegna l'evento a tutti gli ascoltatori, in ordine di iscrizione", () => {
    const bus = createSimpleEventBus();
    const seen: string[] = [];
    bus.on(() => seen.push('a'));
    bus.on((e) => seen.push(`b:${e.type}`));
    bus.emit(ev);
    expect(seen).toEqual(['a', 'b:data-changed']);
  });

  it('on() restituisce la funzione per disiscriversi', () => {
    const bus = createSimpleEventBus();
    const fn = vi.fn();
    const off = bus.on(fn);
    bus.emit(ev);
    off();
    off(); // idempotente
    bus.emit(ev);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("un ascoltatore che lancia non blocca gli altri ne' chi emette", () => {
    const onListenerError = vi.fn();
    const bus = createSimpleEventBus({ onListenerError });
    const after = vi.fn();
    bus.on(() => {
      throw new Error('boom');
    });
    bus.on(after);
    expect(() => bus.emit(ev)).not.toThrow();
    expect(after).toHaveBeenCalledWith(ev);
    expect(onListenerError).toHaveBeenCalledTimes(1);
    expect(onListenerError.mock.calls[0]?.[1]).toBe(ev);
  });

  it("si puo' disiscrivere un altro ascoltatore durante l'emissione", () => {
    const bus = createSimpleEventBus();
    const second = vi.fn();
    let offSecond = (): void => undefined;
    bus.on(() => offSecond());
    offSecond = bus.on(second);
    bus.emit(ev);
    expect(second).not.toHaveBeenCalled();
  });

  it("un ascoltatore iscritto durante l'emissione parte dall'evento successivo", () => {
    const bus = createSimpleEventBus();
    const late = vi.fn();
    bus.on(() => {
      bus.on(late);
    });
    bus.emit(ev);
    expect(late).not.toHaveBeenCalled();
    bus.emit({ type: 'backup-imported' });
    expect(late).toHaveBeenCalledTimes(1);
  });
});
