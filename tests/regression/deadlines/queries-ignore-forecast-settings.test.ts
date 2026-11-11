// Prova di riproduzione: le impostazioni `forecast.*` (validate in usecases/settings) valgono per la riconciliazione
// (cache dei promemoria, notifiche) e per getKmForecast, ma `loadDeadlineRows` (Oggi / scadenze dell'auto) valuta le
// stesse scadenze con i parametri PREDEFINITI. Risultato: la schermata mostra una data stimata e uno stato diversi da
// quelli su cui vengono programmate le notifiche.
import { describe, expect, it } from 'vitest';
import { reconcileVehicle } from '@/usecases/deadlines';
import { getVehicleDeadlines } from '@/usecases/queries';
import { addItem, addOdo, addVehicle, makeEnv, openReminders } from '../../integration/usecases/deadlines/helpers';

describe('forecast.* impostazioni', () => {
  it('la data prevista mostrata nelle scadenze coincide con quella della cache usata dalle notifiche', async () => {
    const env = await makeEnv(); // oggi = 2026-10-08
    const v = await addVehicle(env, { nickname: 'Panda' }); // nessuna stima annua, nessuna immatricolazione: prior = defaultAnnualKm
    await addOdo(env, v, '2026-10-01', 20000);
    await addItem(env, v, { name: 'Cambio olio', baseline_on: '2026-03-01', baseline_km: 12000, interval_km: 15000, interval_months: 36, soon_km: 0 });
    await env.db.run(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('forecast.defaultAnnualKm', '100000')`); // utente che fa molti km
    await reconcileVehicle(env.deps, v);

    const [cached] = await openReminders(env.db, v);
    const vd = await getVehicleDeadlines(env.deps, v);
    const row = vd!.rows.find((r) => r.title === 'Cambio olio')!;
    expect(cached!['forecast_on']).not.toBeNull();
    // la cache (con il parametro dell'utente: ~274 km/g) prevede i 27.000 km fra ~26 giorni; la UI usa 32,9 km/g (~213 giorni)
    expect(row.forecastOn).toBe(cached!['forecast_on']);
  });
});
