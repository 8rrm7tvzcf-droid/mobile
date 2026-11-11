// Azioni offerte dalla schermata di recupero oltre a "Riprova". Versione NATIVA: nessuna.
// Sul telefono i dati dell'utente non si cancellano mai da qui: ci pensera' l'assistenza, con la copia di sicurezza
// pre-migrazione e (in futuro) l'esportazione grezza del database. La versione web e' in recovery.web.ts.
import type { RecoveryAction } from './types';

export function getRecoveryActions(): RecoveryAction[] {
  return [];
}
