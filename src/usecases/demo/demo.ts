// Auto demo (F-17): un'auto di prova italiana (benzina) con due anni di storico per esplorare l'app senza inserire dati.
// `is_demo = 1`: si puo' eliminare in qualsiasi momento e NON entra nei backup (SPEC M-4, AC-11 punto 8).
import { runPendingFileDeletions } from '../attachments/pending';
import { fail, invalid, ok, type Deps, type FileDeps, type UsecaseResult } from '../context';
import { insertReading } from '../odometer/store';
import { readSetting } from '../settings';
import { insertVehicleRow, nextSortOrder } from '../vehicles/store';
import { validateVehicleInput } from '../vehicles/validate';
import { buildDemoPlan } from './history';

export interface CreateDemoResult {
  vehicleId: string;
  /** `false` se l'auto di esempio c'era gia' (la funzione non ne crea una seconda). */
  created: boolean;
}

/** Id dell'auto di esempio non eliminata, se c'e'. */
export async function getDemoVehicleId(d: Pick<Deps, 'db'>): Promise<string | null> {
  const row = await d.db.get<{ id: string }>('SELECT id FROM vehicles WHERE is_demo = 1 AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1');
  return row?.id ?? null;
}

export async function hasDemoVehicle(d: Pick<Deps, 'db'>): Promise<boolean> {
  return (await getDemoVehicleId(d)) !== null;
}

const DEMO_SCOPES = ['vehicles', 'odometer', 'fuel', 'service'] as const;
const REMOVED_SCOPES = ['vehicles', 'odometer', 'fuel', 'service', 'insurance', 'reminders'] as const;

/**
 * Crea «Panda di esempio» (Fiat Panda 1.2 Easy, sola benzina) con due anni di letture km, un rifornimento ogni due
 * settimane circa, due tagliandi e una revisione (ogni rifornimento e intervento porta la sua lettura km collegata). Senza targa ne' VIN (non puo' confliggere con l'auto vera dell'utente).
 * Idempotente: se l'auto di esempio esiste gia' la restituisce.
 */
export async function createDemoVehicle(d: Deps): Promise<UsecaseResult<CreateDemoResult>> {
  const existing = await getDemoVehicleId(d);
  if (existing) return ok({ vehicleId: existing, created: false });

  const today = d.clock.todayLocal();
  const plan = buildDemoPlan(today);
  const checked = validateVehicleInput(
    {
      nickname: 'Panda di esempio',
      make: 'Fiat',
      model: 'Panda',
      trim: '1.2 Easy',
      modelYear: Number(plan.firstRegistrationOn.slice(0, 4)),
      firstRegistrationOn: plan.firstRegistrationOn,
      fuelPrimary: 'petrol',
      engineCc: 1242,
      powerKw: 51,
      euroClass: 'Euro 6',
      color: 'Bianco',
      transmission: 'manual',
      tankCapacityMl: 37_000,
      distanceUnit: 'km',
      annualKmEstimate: 11_000,
      notes: "Auto di esempio: i dati sono inventati. Puoi eliminarla quando vuoi da Impostazioni.",
    },
    { today, defaultDistanceUnit: await readSetting(d.db, 'units.distance') },
  );
  if (!checked.ok) return invalid(checked.field, checked.message); // non dovrebbe succedere: il dato e' fisso

  const vehicleId = await d.db.transaction(async (tx) => {
    const now = d.clock.nowIso();
    const id = d.ids.ulid();
    await insertVehicleRow(tx, { id, fields: checked.value, sortOrder: await nextSortOrder(tx), isDemo: true, nowIso: now });

    for (const r of plan.manual) {
      await insertReading(tx, { id: d.ids.ulid(), vehicleId: id, readOn: r.on, km: r.km, source: 'manual', note: null, nowIso: now });
    }
    for (const f of plan.fuel) {
      const fuelId = d.ids.ulid();
      await tx.run(
        `INSERT INTO fuel_logs (id, vehicle_id, filled_on, fuel_type, quantity_milli, quantity_unit, unit_price_milli, total_cents,
                                is_full, missed_before, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'L', ?, ?, 1, 0, ?, ?)`,
        [fuelId, id, f.on, f.fuelType, f.quantityMilli, f.unitPriceMilli, f.totalCents, now, now],
      );
      await tx.run(
        `INSERT INTO odometer_readings (id, vehicle_id, read_on, km, source, status, fuel_log_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'fuel', 'valid', ?, ?, ?)`,
        [d.ids.ulid(), id, f.on, f.km, fuelId, now, now],
      );
    }
    for (const s of plan.services) {
      const serviceId = d.ids.ulid();
      await tx.run(
        `INSERT INTO service_records (id, vehicle_id, service_on, kind, title, total_cents, inspection_result, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [serviceId, id, s.on, s.kind, s.title, s.totalCents, s.inspectionResult ?? null, now, now],
      );
      let position = 0;
      for (const l of s.lines) {
        await tx.run(
          `INSERT INTO service_lines (id, service_record_id, position, line_type, description, amount_cents, spec, fluid_kind, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [d.ids.ulid(), serviceId, position++, l.type, l.description, l.amountCents, l.spec ?? null, l.fluidKind ?? null, now, now],
        );
      }
      await tx.run(
        `INSERT INTO odometer_readings (id, vehicle_id, read_on, km, source, status, service_record_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'service', 'valid', ?, ?, ?)`,
        [d.ids.ulid(), id, s.on, s.km, serviceId, now, now],
      );
    }
    return id;
  }, 'exclusive');

  for (const scope of DEMO_SCOPES) d.events.emit({ type: 'data-changed', scope, vehicleId });
  return ok({ vehicleId, created: true });
}

/**
 * Elimina l'auto di esempio (e a cascata tutto quello che la riguarda: km, rifornimenti, interventi, sessioni OBD
 * simulate...). Definitivo: i dati inventati non vanno nel cestino, e i file degli eventuali allegati si rimuovono subito
 * (la coda `pending_file_deletions` si svuota dopo il commit, come in `purgeVehicle`). `ITEM_NOT_FOUND` se non c'e' un'auto di esempio.
 */
export async function removeDemoVehicle(d: FileDeps): Promise<UsecaseResult<{ removed: number }>> {
  const removed = await d.db.transaction(async (tx) => (await tx.run('DELETE FROM vehicles WHERE is_demo = 1')).changes, 'exclusive');
  if (removed === 0) return fail({ code: 'ITEM_NOT_FOUND' });
  try {
    await runPendingFileDeletions(d);
  } catch {
    // le righe sono gia' sparite: la coda si svuota al prossimo avvio
  }
  for (const scope of REMOVED_SCOPES) d.events.emit({ type: 'data-changed', scope });
  return ok({ removed });
}
