// Ancora della serie di calendario di una voce: dove cade la scadenza successiva dopo "Fatto" / "Salta" (uso INTERNO al modulo).
// Il bollo non avanza di +12 mesi dalla scadenza corrente: dopo un primo pagamento spostato il rinnovo cade nel mese di
// immatricolazione (REG 2.2/2.6) e il termine e' l'ULTIMO giorno del mese anche in anno bisestile (29/02).
import { endOfMonth } from '@/domain/dates';
import type { LocalDate } from '@/domain/dates';
import { roadTaxSeriesMonth } from '@/domain/italy';
import type { SeriesOptions } from '@/domain/maintenance';
import type { SqlDatabase } from '@/domain/ports';

const ROAD_TAX_TEMPLATE = 'tpl_road_tax';

/**
 * Opzioni della serie per la voce `itemId` quando la scadenza corrente e' `fixedDueOn` (il valore PRIMA dell'avanzamento).
 * Solo il bollo ha un'ancora; per tutte le altre voci, e per una data che non e' a fine mese (letta cosi' dal documento),
 * la serie resta "scadenza + intervallo".
 */
export async function seriesOptionsOf(tx: SqlDatabase, itemId: string, fixedDueOn: LocalDate | null): Promise<SeriesOptions> {
  if (!fixedDueOn || endOfMonth(fixedDueOn) !== fixedDueOn) return {};
  const row = await tx.get<{ template_id: string | null; first_registration_on: string | null }>(
    `SELECT i.template_id, v.first_registration_on FROM maintenance_items i
     JOIN vehicles v ON v.id = i.vehicle_id WHERE i.id = ?`,
    [itemId],
  );
  if (!row || row.template_id !== ROAD_TAX_TEMPLATE) return {};
  return { anchorMonth: roadTaxSeriesMonth(fixedDueOn, row.first_registration_on) };
}
