// "Annulla" dopo un salvataggio o un'eliminazione: un solo promemoria alla volta, visibile nelle liste e nel Registro
// anche dopo essere tornati indietro dalla schermata di modifica. Niente persistenza: vale per pochi secondi.
import { useSyncExternalStore } from 'react';

export type UndoKind = 'fuel' | 'expense' | 'service' | 'fluid' | 'policy' | 'attachment';

export interface UndoEntry {
  /** Numero progressivo: serve a riavviare il conto alla rovescia quando ne arriva uno nuovo. */
  seq: number;
  /** 'deleted' = e' stato eliminato (Annulla lo ripristina); 'added' = e' stato aggiunto (Annulla lo elimina). */
  mode: 'deleted' | 'added';
  kind: UndoKind;
  itemId: string;
  vehicleId: string;
  message: string;
  /** Dati per ricreare la voce eliminata quando i casi d'uso non hanno un "ripristina" (controlli livelli). */
  payload?: unknown;
}

let current: UndoEntry | null = null;
let seq = 0;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const l of [...listeners]) l();
};

export function pushUndo(entry: Omit<UndoEntry, 'seq'>): void {
  current = { ...entry, seq: ++seq };
  emit();
}

export function clearUndo(): void {
  if (current === null) return;
  current = null;
  emit();
}

export const peekUndo = (): UndoEntry | null => current;

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function useUndo(): UndoEntry | null {
  return useSyncExternalStore(subscribe, peekUndo, peekUndo);
}
