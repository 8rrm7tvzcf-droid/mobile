// Stato "sto salvando": evita il doppio tocco e mostra l'attesa sul pulsante.
import { useCallback, useRef, useState } from 'react';

export function useBusy(): { busy: boolean; run: <T>(fn: () => Promise<T>) => Promise<T | undefined> } {
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (locked.current) return undefined;
    locked.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}
