// Registro dell'auto (S-13): una cronologia unica con interventi, rifornimenti, spese, controlli dei livelli, polizze e rate
// pagate, letture del contachilometri, completamenti e scadenze aperte. Filtri per tipo e per periodo.
// Le letture km create da un rifornimento, da un intervento o da un controllo NON si ripetono: i km stanno gia' sulla loro
// voce. Allo stesso modo i completamenti nati da un intervento o da un controllo si leggono nel dettaglio di quella voce.
import { formatScaled, formatDateIt, formatDistance, formatEuro, formatInt, formatPriceWithUnit, formatQuantityWithUnit } from '@/domain/units';
import type { Deps } from '../context';
import { listExpenses } from '../expenses';
import { listFluidChecks } from '../fluids';
import { listFuelLogs } from '../fuel';
import { listPolicies } from '../insurance';
import { listServiceRecords } from '../services';
import { loadDeadlineRows, loadVehicleInfos } from './load';
import type { Timeline, TimelineEntry, TimelineKind, TimelineOptions } from './types';

export const TIMELINE_DEFAULT_LIMIT = 200;

const SOURCE_TEXT: Record<string, string> = {
  manual: 'inserita a mano',
  obd: "letta dall'OBD",
  fuel: 'da un rifornimento',
  service: 'da un intervento',
  fluid_check: 'da un controllo dei livelli',
  import: 'importata',
};

/** Letture km nate da un'altra voce del registro: non si mostrano due volte. */
const LINKED_READING_SOURCES = ['fuel', 'service', 'fluid_check'];
/** Completamenti nati da un intervento o da un controllo: stanno gia' nella voce che li ha creati. */
const LINKED_COMPLETION_SOURCES = ['service', 'check'];

const BASE = { upcoming: false, ignored: false, amountCents: null, km: null, kmText: null } as const;

/**
 * Voci del registro in ordine di data decrescente. `null` se l'auto non esiste (o e' nel cestino).
 * `kinds` restringe ai tipi indicati, `from`/`to` al periodo (estremi inclusi, anche per le scadenze future).
 */
export async function getTimeline(d: Deps, vehicleId: string, options: TimelineOptions = {}): Promise<Timeline | null> {
  const today = d.clock.todayLocal();
  const [vehicle] = await loadVehicleInfos(d.db, today, { vehicleId });
  if (!vehicle) return null;
  const unit = vehicle.distanceUnit;
  const want = (k: TimelineKind): boolean => !options.kinds || options.kinds.length === 0 || options.kinds.includes(k);
  const range = { from: options.from ?? undefined, to: options.to ?? undefined };
  const entries: TimelineEntry[] = [];
  const kmFields = (km: number | null): Pick<TimelineEntry, 'km' | 'kmText'> => ({ km, kmText: km === null ? null : formatDistance(km, unit) });

  if (want('service')) {
    for (const s of await listServiceRecords(d, vehicleId, range)) {
      entries.push({
        ...BASE,
        id: s.id,
        kind: 'service',
        date: s.serviceOn,
        title: s.title,
        text: [s.kindLabel, s.workshopName].filter(Boolean).join(' · '),
        tone: 'neutral',
        icon: 'service',
        amountCents: s.totalCents,
        ...kmFields(s.km),
      });
    }
  }

  if (want('fuel')) {
    for (const f of await listFuelLogs(d, vehicleId, range)) {
      const parts = [formatQuantityWithUnit(f.quantityMilli, f.quantityUnit)];
      if (f.unitPriceMilli !== null) parts.push(formatPriceWithUnit(f.unitPriceMilli, f.quantityUnit));
      parts.push(f.isFull ? 'pieno' : 'parziale');
      if (f.consumption?.computed) parts.push(f.consumption.text);
      entries.push({
        ...BASE,
        id: f.id,
        kind: 'fuel',
        date: f.filledOn,
        title: `Rifornimento · ${f.fuelLabel}`,
        text: parts.join(' · '),
        tone: 'neutral',
        icon: 'fuel',
        amountCents: f.totalCents,
        ...kmFields(f.kmIgnored ? null : f.km),
      });
    }
  }

  if (want('expense')) {
    for (const e of await listExpenses(d, vehicleId, range)) {
      entries.push({
        ...BASE,
        id: e.id,
        kind: 'expense',
        date: e.spentOn,
        title: e.categoryName,
        text: [e.description, e.vendor].filter(Boolean).join(' · '),
        tone: 'neutral',
        icon: 'expense',
        amountCents: e.amountCents,
      });
    }
  }

  if (want('fluid')) {
    for (const c of await listFluidChecks(d, vehicleId, range)) {
      const parts = [c.levelLabelIt];
      if (c.addedMl != null) parts.push(c.addedMl >= 1000 ? `${formatScaled(c.addedMl, 3)} L aggiunti` : `${formatInt(c.addedMl)} ml aggiunti`);
      if (c.valueMillibar != null) parts.push(`${formatScaled(Math.round(c.valueMillibar / 10), 2)} bar`);
      if (c.product) parts.push(c.product);
      entries.push({
        ...BASE,
        id: c.id,
        kind: 'fluid',
        date: c.checkedOn,
        title: `Controllo · ${c.fluidLabelIt}`,
        text: parts.join(' · '),
        tone: 'neutral',
        icon: 'fluid',
        ...kmFields(c.km ?? null),
      });
    }
  }

  const policies = want('policy') || want('installment') ? await listPolicies(d, vehicleId) : [];

  if (want('policy')) {
    for (const p of policies) {
      if ((range.from && p.startOn < range.from) || (range.to && p.startOn > range.to)) continue;
      entries.push({
        ...BASE,
        id: p.id,
        kind: 'policy',
        date: p.startOn,
        title: `${p.kindLabel} · ${p.company}`,
        text: `Dal ${formatDateIt(p.startOn)} al ${formatDateIt(p.endOn)} · ${p.statusLabel}`,
        tone: 'neutral',
        icon: 'policy',
      });
    }
  }

  if (want('installment')) {
    const paid = await d.db.all<{ id: string; paid_on: string; amount_cents: number; installment_no: number; n: number; kind: string; company: string }>(
      `SELECT p.id, p.paid_on, p.amount_cents, p.installment_no, pol.kind, pol.company,
              (SELECT COUNT(*) FROM insurance_payments x WHERE x.policy_id = p.policy_id AND x.deleted_at IS NULL) AS n
         FROM insurance_payments p JOIN insurance_policies pol ON pol.id = p.policy_id
        WHERE pol.vehicle_id = ? AND pol.deleted_at IS NULL AND p.deleted_at IS NULL AND p.paid_on IS NOT NULL`,
      [vehicleId],
    );
    const kindLabels = new Map<string, string>(policies.map((p) => [p.kind, p.kindLabel]));
    for (const r of paid) {
      if ((range.from && r.paid_on < range.from) || (range.to && r.paid_on > range.to)) continue;
      entries.push({
        ...BASE,
        id: r.id,
        kind: 'installment',
        date: r.paid_on,
        title: `Rata pagata · ${kindLabels.get(r.kind) ?? 'Assicurazione'}`,
        text: `${r.n > 1 ? `Rata ${r.installment_no} di ${r.n} · ` : ''}${r.company} · ${formatEuro(r.amount_cents)}`,
        tone: 'neutral',
        icon: 'payment',
        amountCents: r.amount_cents,
      });
    }
  }

  if (want('odometer')) {
    const readings = await d.db.all<{ id: string; read_on: string; km: number; source: string; status: string }>(
      `SELECT id, read_on, km, source, status FROM odometer_readings
        WHERE vehicle_id = ? AND deleted_at IS NULL ORDER BY read_on DESC, km DESC, id DESC`,
      [vehicleId],
    );
    for (const r of readings) {
      if (LINKED_READING_SOURCES.includes(r.source)) continue;
      const ignored = r.status === 'ignored';
      entries.push({
        ...BASE,
        id: r.id,
        kind: 'odometer',
        date: r.read_on,
        title: 'Lettura km',
        text: `${formatDistance(r.km, unit)} · ${SOURCE_TEXT[r.source] ?? r.source}${ignored ? ' (ignorata)' : ''}`,
        tone: 'neutral',
        icon: 'gauge',
        ignored,
        ...kmFields(r.km),
      });
    }
  }

  if (want('completion')) {
    const completions = await d.db.all<{ id: string; done_on: string; done_km: number | null; name: string; source: string }>(
      `SELECT c.id, c.done_on, c.done_km, c.source, i.name FROM maintenance_completions c
         JOIN maintenance_items i ON i.id = c.item_id
        WHERE i.vehicle_id = ? AND c.deleted_at IS NULL`,
      [vehicleId],
    );
    for (const c of completions) {
      if (LINKED_COMPLETION_SOURCES.includes(c.source)) continue;
      entries.push({
        ...BASE,
        id: c.id,
        kind: 'completion',
        date: c.done_on,
        title: c.name,
        text: c.done_km != null ? `Fatto a ${formatDistance(c.done_km, unit)}` : 'Fatto',
        tone: 'ok',
        icon: 'done',
        ...kmFields(c.done_km),
      });
    }
  }

  if (want('deadline') && vehicle.status === 'active') {
    for (const row of await loadDeadlineRows(d.db, d.clock, [vehicle])) {
      const date = row.effectiveDueOn ?? row.dueOn;
      if (!date) continue; // senza data (da configurare) non ha posto nel registro
      entries.push({
        ...BASE,
        id: row.id,
        kind: 'deadline',
        date,
        title: row.title,
        text: row.summary,
        tone: row.tone,
        icon: row.icon,
        upcoming: true,
      });
    }
  }

  const inRange = entries.filter((e) => (!range.from || e.date >= range.from) && (!range.to || e.date <= range.to));
  inRange.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? 1 : -1));
  return { vehicleId, entries: inRange.slice(0, options.limit ?? TIMELINE_DEFAULT_LIMIT) };
}
