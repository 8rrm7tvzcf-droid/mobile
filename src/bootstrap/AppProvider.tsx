// Provider radice dell'app (SPEC 8.6, "src/app/_layout.tsx: provider radice"): costruisce l'AppRoot una sola volta,
// mostra un caricamento finche' l'avvio non e' finito e, se l'avvio fallisce, una schermata di recupero in italiano
// semplice (database piu' nuovo dell'app -> "Aggiorna MyGarage"; migrazione fallita -> dati al sicuro + codice per
// l'assistenza). Al ritorno in primo piano chiede la ripianificazione di promemoria e notifiche (al massimo una al minuto).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { getRecoveryActions } from './recovery';
import { createAppRoot } from './root';
import { describeStartupError, type StartupErrorInfo } from './startupError';
import { hasReplan, type AppRoot } from './types';

const AppContext = createContext<AppRoot | null>(null);

/** L'AppRoot corrente. Lancia se usato fuori da <AppProvider>: il provider non mostra i figli finche' l'avvio non e' finito. */
export function useApp(): AppRoot {
  const root = useContext(AppContext);
  if (!root) throw new Error('useApp() va usato dentro <AppProvider>');
  return root;
}

// Una sola creazione per processo, anche con il doppio effetto di StrictMode e con il Fast Refresh.
let sharedRoot: Promise<AppRoot> | null = null;
function loadSharedRoot(): Promise<AppRoot> {
  sharedRoot ??= createAppRoot().catch((e: unknown) => {
    sharedRoot = null; // un nuovo tentativo riparte da capo
    throw e;
  });
  return sharedRoot;
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; root: AppRoot }
  | { status: 'error'; info: StartupErrorInfo };

export interface AppProviderProps {
  children: ReactNode;
  /** Solo per le prove: sostituisce createAppRoot (in tal caso non c'e' memoria condivisa fra i montaggi). */
  createRoot?: () => Promise<AppRoot>;
}

export function AppProvider({ children, createRoot }: AppProviderProps): ReactNode {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const ownRoot = useRef<Promise<AppRoot> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let promise: Promise<AppRoot>;
    if (createRoot) {
      ownRoot.current ??= createRoot();
      promise = ownRoot.current;
    } else {
      promise = loadSharedRoot();
    }
    promise.then(
      (root) => {
        if (!cancelled) setState({ status: 'ready', root });
      },
      (e: unknown) => {
        ownRoot.current = null;
        if (!cancelled) setState({ status: 'error', info: describeStartupError(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [createRoot, attempt]);

  // ritorno in primo piano: il giorno puo' essere cambiato, il permesso notifiche anche, il fuso pure
  const root = state.status === 'ready' ? state.root : null;
  useEffect(() => {
    if (!root || !hasReplan(root)) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') root.replan.requestForeground();
    });
    return () => sub.remove();
  }, [root]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  if (state.status === 'ready') return <AppContext.Provider value={state.root}>{children}</AppContext.Provider>;
  if (state.status === 'error') return <StartupErrorScreen info={state.info} onRetry={retry} />;
  return <LoadingScreen />;
}

// ---------------------------------------------------------------------------------------------------------------------
// Schermate di avvio (senza dipendere dal tema dell'app, che a questo punto potrebbe non essere pronto)

function useColors(): { bg: string; text: string; muted: string; primary: string; onPrimary: string; border: string; danger: string } {
  const dark = useColorScheme() === 'dark';
  return dark
    ? { bg: '#0F1115', text: '#F2F4F8', muted: '#9AA3B2', primary: '#4DA3FF', onPrimary: '#06121F', border: '#2A2F3A', danger: '#FF7A7A' }
    : { bg: '#FFFFFF', text: '#12161C', muted: '#5B6573', primary: '#0A6CD6', onPrimary: '#FFFFFF', border: '#D8DDE5', danger: '#B3261E' };
}

function LoadingScreen(): ReactNode {
  const c = useColors();
  return (
    <View style={[styles.center, { backgroundColor: c.bg }]} accessibilityLabel="Apertura di MyGarage in corso">
      <ActivityIndicator size="large" color={c.primary} />
      <Text style={[styles.hint, { color: c.muted }]}>Apro MyGarage…</Text>
    </View>
  );
}

function StartupErrorScreen({ info, onRetry }: { info: StartupErrorInfo; onRetry: () => void }): ReactNode {
  const c = useColors();
  const actions = getRecoveryActions();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = actions.find((a) => a.id === confirming);

  const runAction = async (): Promise<void> => {
    if (!pending) return;
    setBusy(true);
    try {
      await pending.run();
    } finally {
      setBusy(false);
      setConfirming(null);
    }
    onRetry();
  };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.errorContent}>
      <Text accessibilityRole="header" style={[styles.title, { color: c.text }]}>
        {info.title}
      </Text>
      <Text style={[styles.body, { color: c.text }]}>{info.message}</Text>

      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [styles.button, { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1 }]}
      >
        <Text style={[styles.buttonText, { color: c.onPrimary }]}>Riprova</Text>
      </Pressable>

      {pending ? (
        <View style={[styles.confirm, { borderColor: c.border }]}>
          <Text style={[styles.body, { color: c.text }]}>{pending.warning}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void runAction()}
            style={({ pressed }) => [styles.button, { backgroundColor: c.danger, opacity: pressed || busy ? 0.7 : 1 }]}
          >
            <Text style={[styles.buttonText, { color: c.bg }]}>{pending.label}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setConfirming(null)} style={styles.link}>
            <Text style={{ color: c.primary, fontSize: 16 }}>Annulla</Text>
          </Pressable>
        </View>
      ) : (
        actions.map((a) => (
          <Pressable key={a.id} accessibilityRole="button" onPress={() => setConfirming(a.id)} style={styles.link}>
            <Text style={{ color: c.danger, fontSize: 16 }}>{a.label}</Text>
          </Pressable>
        ))
      )}

      <Text selectable style={[styles.detail, { color: c.muted }]}>
        Codice per l'assistenza: {info.detail}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  hint: { fontSize: 16 },
  errorContent: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' },
  title: { fontSize: 24, fontWeight: '700' },
  body: { fontSize: 17, lineHeight: 25 },
  button: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  buttonText: { fontSize: 17, fontWeight: '600' },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  confirm: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 16, gap: 12 },
  detail: { fontSize: 12, lineHeight: 18, marginTop: 8 },
});
