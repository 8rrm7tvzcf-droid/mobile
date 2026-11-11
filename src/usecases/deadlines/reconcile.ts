// Riconciliazione dei promemoria (data.md 3.9, SPEC 8.3): contratto fra agenti
//   reconcileAll(d): Promise<void>   e   reconcileVehicle(d, vehicleId): Promise<void>
// Legge dal DB gli ingredienti di ReconcileInput, chiama il motore (`planReminderChanges`, puro) e applica
// create/update/close/remove in UNA transazione per veicolo. Idempotente (I5): una seconda esecuzione non cambia nulla.
// Scrive solo le colonne cache dei promemoria generati e crea/chiude/rimuove promemoria generati (I2).
import type { Deps } from '../context';
import { reconcileInTx } from './load';

/** Riconcilia i promemoria di un veicolo. Non fa nulla se il veicolo non esiste, e' nel cestino o non e' attivo. */
export async function reconcileVehicle(d: Deps, vehicleId: string): Promise<void> {
  const outcome = await d.db.transaction((tx) => reconcileInTx(tx, d, vehicleId), 'exclusive');
  // Un evento solo se qualcosa e' cambiato: chi ascolta 'reminders' per riconciliare non entra in un ciclo.
  if (outcome.changed) d.events.emit({ type: 'data-changed', scope: 'reminders', vehicleId });
}

/** Riconcilia tutti i veicoli attivi (avvio, ritorno in primo piano, task in background). */
export async function reconcileAll(d: Deps): Promise<void> {
  const rows = await d.db.all<{ id: string }>(
    `SELECT id FROM vehicles WHERE deleted_at IS NULL AND status = 'active' ORDER BY sort_order, id`,
  );
  for (const v of rows) await reconcileVehicle(d, v.id);
}
