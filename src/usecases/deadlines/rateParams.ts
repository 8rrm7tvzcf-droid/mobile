// Parametri della previsione dei km (impostazioni `forecast.*`): UN solo punto di lettura per riconciliazione, notifiche,
// elenchi, dettaglio e anteprime, cosi' la data prevista e lo stato sono gli stessi ovunque (SPEC 8.3).
import type { RateParams } from '@/domain/maintenance';
import type { SqlDatabase } from '@/domain/ports';

/** Parametri della previsione km salvati nelle impostazioni (`forecast.*`); se mancano valgono i predefiniti del dominio. */
export async function loadRateParams(db: SqlDatabase): Promise<Partial<RateParams>> {
  const rows = await db.all<{ key: string; value: string }>(
    `SELECT key, value FROM app_settings WHERE key IN ('forecast.windowDays','forecast.halfLifeDays','forecast.defaultAnnualKm')`,
  );
  const out: Partial<RateParams> = {};
  for (const r of rows) {
    let v: unknown;
    try {
      v = JSON.parse(r.value);
    } catch {
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (r.key === 'forecast.windowDays') out.windowDays = v;
    else if (r.key === 'forecast.halfLifeDays') out.halfLifeDays = v;
    else if (r.key === 'forecast.defaultAnnualKm') out.defaultAnnualKm = v;
  }
  return out;
}
