// Suggerimenti di "Cosa hai fatto?" (F-36) e "ultimo fatto" ricavato dallo storico degli interventi (precompila il wizard
// "Imposta le scadenze" e l'auto demo). Sola lettura.
import { formatDateIt } from '@/domain/units';
import type { LocalDate, SqlDatabase } from '@/domain/ports';
import type { Deps } from '../context';
import { categoryOfText, matchService } from './classify';
import type { LineLike, ServiceLike } from './classify';
import { withOilChange } from './validate';
import type { LastDoneSuggestion, ServiceItemSuggestion, ServiceKind, ServiceLineInput, SuggestItemsOptions } from './types';

/**
 * Le voci attive del veicolo con l'indicazione di quali l'intervento completa (`matched`) e quali pre-selezionare
 * (`preselected`: indicate e non gia' segnate come fatte lo stesso giorno). Prima le indicate, poi le altre nell'ordine delle voci.
 */
export async function computeSuggestions(
  db: SqlDatabase,
  vehicleId: string,
  like: ServiceLike,
  o: { serviceOn?: LocalDate | null; excludeRecordId?: string | null } = {},
): Promise<ServiceItemSuggestion[]> {
  const match = matchService(like);
  const items = await db.all<{ id: string; name: string; template_id: string | null; category: string }>(
    `SELECT id, name, template_id, category FROM maintenance_items
     WHERE vehicle_id = ? AND deleted_at IS NULL AND is_active = 1 ORDER BY sort_order, name, id`,
    [vehicleId],
  );
  const doneSameDay = new Set<string>();
  if (o.serviceOn) {
    const rows = await db.all<{ item_id: string }>(
      `SELECT DISTINCT c.item_id FROM maintenance_completions c JOIN maintenance_items i ON i.id = c.item_id
       WHERE i.vehicle_id = ? AND c.deleted_at IS NULL AND c.done_on = ? AND (c.service_record_id IS NULL OR c.service_record_id <> ?)`,
      [vehicleId, o.serviceOn, o.excludeRecordId ?? ''],
    );
    for (const r of rows) doneSameDay.add(r.item_id);
  }

  const out: ServiceItemSuggestion[] = items.map((it) => {
    let reason: string | null = null;
    let matched = false;
    if (it.template_id) {
      const why = match.templates.get(it.template_id);
      if (why) {
        matched = true;
        reason = why;
      } else {
        reason = match.notCompleted.get(it.template_id) ?? null;
      }
    } else {
      const cat = categoryOfText(it.name);
      const why = cat ? match.categories.get(cat) : undefined;
      if (why) {
        matched = true;
        reason = why;
      }
    }
    const alreadyDoneOn = o.serviceOn && doneSameDay.has(it.id) ? o.serviceOn : null;
    if (matched && alreadyDoneOn) reason = `${reason ?? ''} (già segnata come fatta il ${formatDateIt(alreadyDoneOn)}: niente doppione)`.trim();
    return {
      itemId: it.id,
      name: it.name,
      templateId: it.template_id,
      category: it.category,
      matched,
      preselected: matched && alreadyDoneOn === null,
      reason,
      alreadyDoneOn,
    };
  });
  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => Number(b.s.matched) - Number(a.s.matched) || a.i - b.i)
    .map((x) => x.s);
}

/**
 * Propone le voci di manutenzione che l'intervento probabilmente completa (olio e filtro olio -> cambio olio, filtro abitacolo,
 * freni...), in base alle categorie delle righe e al tipo. E' il contenuto della schermata S-21 "Cosa hai fatto?".
 */
export async function suggestItemsForLines(
  d: Pick<Deps, 'db'>,
  vehicleId: string,
  lines: readonly ServiceLineInput[],
  opts: SuggestItemsOptions = {},
): Promise<ServiceItemSuggestion[]> {
  const like: ServiceLike = {
    kind: opts.kind ?? 'other',
    title: opts.title ?? null,
    inspectionResult: opts.inspectionResult ?? null,
    lines: withOilChange(lines, opts.oilChange),
  };
  return computeSuggestions(d.db, vehicleId, like, { serviceOn: opts.serviceOn ?? null, excludeRecordId: opts.excludeRecordId ?? null });
}

/**
 * Per ogni voce del catalogo (`tpl_*`) l'ultima volta che un intervento l'ha fatta: data e km (null se quell'intervento non
 * ha km). Ricavato dallo storico con le stesse regole di `suggestItemsForLines`; una revisione conta solo se regolare.
 */
export async function suggestLastDoneFromHistory(d: Pick<Deps, 'db'>, vehicleId: string): Promise<Record<string, LastDoneSuggestion>> {
  const records = await d.db.all<{
    id: string;
    service_on: LocalDate;
    kind: ServiceKind;
    title: string;
    inspection_result: 'regular' | 'repeat' | 'suspended' | null;
    km: number | null;
  }>(
    `SELECT s.id, s.service_on, s.kind, s.title, s.inspection_result,
            (SELECT o.km FROM odometer_readings o WHERE o.service_record_id = s.id AND o.deleted_at IS NULL) AS km
     FROM service_records s WHERE s.vehicle_id = ? AND s.deleted_at IS NULL
     ORDER BY s.service_on, km, s.created_at, s.id`,
    [vehicleId],
  );
  const lineRows = await d.db.all<{ service_record_id: string; line_type: LineLike['lineType']; fluid_kind: LineLike['fluidKind']; description: string }>(
    `SELECT l.service_record_id, l.line_type, l.fluid_kind, l.description FROM service_lines l
     JOIN service_records s ON s.id = l.service_record_id WHERE s.vehicle_id = ? AND s.deleted_at IS NULL ORDER BY l.service_record_id, l.position`,
    [vehicleId],
  );
  const byRecord = new Map<string, LineLike[]>();
  for (const l of lineRows) {
    const list = byRecord.get(l.service_record_id) ?? [];
    list.push({ lineType: l.line_type, fluidKind: l.fluid_kind, description: l.description });
    byRecord.set(l.service_record_id, list);
  }

  const out: Record<string, LastDoneSuggestion> = {};
  for (const r of records) {
    const match = matchService({ kind: r.kind, title: r.title, inspectionResult: r.inspection_result, lines: byRecord.get(r.id) ?? [] });
    for (const templateId of match.templates.keys()) {
      out[templateId] = { templateId, doneOn: r.service_on, doneKm: r.km, serviceRecordId: r.id, serviceTitle: r.title };
    }
  }
  return out;
}
