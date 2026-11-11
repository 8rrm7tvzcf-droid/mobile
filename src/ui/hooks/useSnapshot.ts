// Tiene la prima lettura di un modulo: i valori di partenza non devono cambiare sotto le mani di chi sta scrivendo
// (le letture reattive si rifanno a ogni evento), ne' far comparire "non trovato" dopo aver eliminato la voce.
import { useRef } from 'react';

export function useSnapshot<T>(value: T | undefined): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  if (value !== undefined && ref.current === undefined) ref.current = value;
  return ref.current;
}
