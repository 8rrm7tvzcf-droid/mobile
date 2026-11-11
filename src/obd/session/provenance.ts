// Provenienza dei dati (SPEC 5.2): letto dall'auto / stimato / inserito dall'utente.
// Ogni valore mostrato porta la sua etichetta; qui solo il tipo e le funzioni di costruzione.

export type Provenance = 'read' | 'estimated' | 'entered';

/** Etichette per l'utente (italiano), da mostrare sempre e da rendere accessibili ai lettori di schermo. */
export const PROVENANCE_LABEL_IT: Readonly<Record<Provenance, string>> = {
  read: "Letto dall'auto",
  estimated: 'Stimato',
  entered: 'Inserito da te',
};

export interface Reading<T> {
  value: T;
  source: Provenance;
  /** Istante UTC con millisecondi (Clock.nowIso). */
  readAt: string;
  /** Centralina che ha risposto (per i valori letti). */
  ecu?: string;
  /** Per i valori stimati: come sono stati ottenuti. */
  basis?: string;
}

export function readReading<T>(value: T, readAt: string, ecu?: string): Reading<T> {
  const r: Reading<T> = { value, source: 'read', readAt };
  if (ecu !== undefined) r.ecu = ecu;
  return r;
}

export function estimatedReading<T>(value: T, readAt: string, basis: string): Reading<T> {
  return { value, source: 'estimated', readAt, basis };
}

export function enteredReading<T>(value: T, readAt: string): Reading<T> {
  return { value, source: 'entered', readAt };
}

const RANK: Record<Provenance, number> = { entered: 2, read: 1, estimated: 0 };

/**
 * Sceglie tra due letture dello stesso dato: l'inserito dall'utente prevale su ogni stima (SPEC 5.2) e il
 * letto prevale sullo stimato; a pari provenienza vince la piu' recente.
 */
export function preferReading<T>(a: Reading<T>, b: Reading<T>): Reading<T> {
  if (RANK[a.source] !== RANK[b.source]) return RANK[a.source] > RANK[b.source] ? a : b;
  return a.readAt >= b.readAt ? a : b;
}
