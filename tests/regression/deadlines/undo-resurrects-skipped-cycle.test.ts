// Prova di riproduzione: "Salta" un ciclo, poi "Fatto", poi "Annulla" il Fatto: lo stato deve tornare ESATTAMENTE
// com'era (ciclo saltato, nessun promemoria aperto). Oggi `undoCompletionInTx` riapre solo il promemoria chiuso dal
// completamento (qui non ce n'e' uno: era stato saltato) e la riconciliazione AGGIORNA il promemoria nato dal Fatto
// riportandolo alla scadenza del ciclo saltato: il ciclo saltato "risorge" aperto (e rinotifica).
import { describe, expect, it } from 'vitest';
import { completeDeadline, reconcileVehicle, skipDeadline, undoCompletion } from '@/usecases/deadlines';
import { addItem, addOdo, addVehicle, makeEnv, openReminders, rows, unwrap } from '../../integration/usecases/deadlines/helpers';

describe('annulla esatto dopo un ciclo saltato', () => {
  it('dopo Salta + Fatto + Annulla non deve esistere nessun promemoria aperto per la voce', async () => {
    const env = await makeEnv();
    const v = await addVehicle(env, { nickname: 'Panda' });
    await addOdo(env, v, '2026-06-01', 15000);
    const item = await addItem(env, v, { name: 'Cambio olio', baseline_on: '2026-03-01', baseline_km: 12000, interval_km: 15000, interval_months: 12 });
    await reconcileVehicle(env.deps, v);

    const [rem] = await openReminders(env.db, v);
    unwrap(await skipDeadline(env.deps, rem!['id'] as string)); // l'utente salta questo ciclo
    expect(await openReminders(env.db, v)).toHaveLength(0);

    const done = unwrap(await completeDeadline(env.deps, { itemId: item, doneOn: '2026-10-08' }));
    unwrap(await undoCompletion(env.deps, done.completionId as string)); // ...e annulla il Fatto

    const open = await openReminders(env.db, v);
    const skipped = await rows(env.db, `SELECT id FROM reminders WHERE item_id = ? AND status = 'skipped' AND deleted_at IS NULL`, [item]);
    expect(skipped).toHaveLength(1); // il ciclo saltato resta saltato
    expect(open).toHaveLength(0); // atteso: nessun promemoria aperto (come prima del Fatto); ottenuto: 1 aperto con la scadenza saltata
  });
});
