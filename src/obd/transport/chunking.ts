// Frammentazione del testo come fanno le notifiche BLE (MTU 23 = 20 byte utili). Puro.

export function chunkText(text: string, size: number): string[] {
  if (!Number.isFinite(size) || size <= 0 || text.length <= size) return text.length === 0 ? [] : [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** Piccolo emettitore di eventi per i trasporti. */
export class Emitter<A extends unknown[]> {
  private fns = new Set<(...a: A) => void>();

  on(fn: (...a: A) => void): () => void {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  }

  emit(...a: A): void {
    for (const fn of Array.from(this.fns)) {
      try {
        fn(...a);
      } catch {
        // un ascoltatore difettoso non deve fermare gli altri
      }
    }
  }

  get size(): number {
    return this.fns.size;
  }

  clear(): void {
    this.fns.clear();
  }
}
