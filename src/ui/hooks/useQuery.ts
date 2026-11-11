// Letture reattive: la schermata chiede i dati a un caso d'uso e li rilegge da sola quando arriva un evento
// 'data-changed' sul bus (SPEC 8.6) o quando torna in primo piano. Niente SQL qui: solo casi d'uso di lettura.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp, type AppRoot } from '@/bootstrap';

export type QueryDeps = AppRoot['deps'];

export interface QueryState<T> {
  data: T | undefined;
  /** Testo gia' in italiano se la lettura e' fallita. */
  error: string | null;
  /** Vero finche' non e' arrivata la prima lettura. */
  loading: boolean;
  reload: () => void;
}

/** Piccolo ritardo che raccoglie in una sola rilettura i molti eventi di una scrittura. */
const COALESCE_MS = 40;

export function useQuery<T>(read: (deps: QueryDeps) => Promise<T>, inputs: readonly unknown[] = [], errorText = ''): QueryState<T> {
  const { deps } = useApp();
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loading: boolean }>({
    data: undefined,
    error: null,
    loading: true,
  });
  const latestRead = useRef(read);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latestRead.current = read;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const run = useCallback(async (): Promise<void> => {
    const id = ++sequence.current;
    try {
      const data = await latestRead.current(deps);
      if (mounted.current && id === sequence.current) setState({ data, error: null, loading: false });
    } catch {
      if (mounted.current && id === sequence.current) {
        setState((s) => ({ data: s.data, error: errorText || 'Non riesco a leggere i dati. Riprova tra un momento.', loading: false }));
      }
    }
  }, [deps, errorText]);

  // Rilettura quando la schermata prende il fuoco o cambiano gli ingressi.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => void run(), [run, ...inputs]));

  // Rilettura quando i dati cambiano.
  useEffect(
    () =>
      deps.events.on((e) => {
        if (e.type !== 'data-changed' && e.type !== 'backup-imported') return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void run(), COALESCE_MS);
      }),
    [deps, run],
  );

  const reload = useCallback(() => void run(), [run]);
  return { data: state.data, error: state.error, loading: state.loading, reload };
}
