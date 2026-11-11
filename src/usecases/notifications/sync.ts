// Sincronizzazione delle notifiche locali (SPEC 8.4): permesso -> carica -> piano (finestra 60 + sentinella) -> testi
// -> differenza per hash con quanto e' nel sistema -> cancella/programma. Idempotente: se nulla cambia, zero chiamate.
import { diffScheduled, TEST_KEY } from '@/domain/notifications';
import type { PermissionState } from '@/domain/ports';
import type { NotificationDeps } from '../context';
import { buildPlannedNotifications } from './plan';

export interface SyncReport {
  /** Permesso di sistema al momento della sincronizzazione. */
  permission: PermissionState;
  /** Notifiche desiderate dal piano (sentinella compresa). */
  planned: number;
  /** Notifiche programmate in questa esecuzione (nuove o con hash cambiato). */
  scheduled: number;
  /** Notifiche cancellate in questa esecuzione (assenti dal piano o con hash cambiato, poi riprogrammate). */
  cancelled: number;
  /** Vero se il permesso c'e' e il sistema e' gia' allineato: nessuna chiamata di scheduling. */
  skippedUnchanged: boolean;
}

/**
 * Allinea le notifiche del sistema al piano. Con il permesso negato/bloccato/non chiesto NON fallisce: nessuna chiamata
 * di scheduling e il permesso e' riportato nel report (la UI mostra il banner). Le chiavi che non iniziano per `mg1:`
 * non sono nostre e si ignorano; la notifica di prova (`mg1:test`) non viene mai cancellata da una sincronizzazione.
 * Gli errori dello scheduler si propagano (il coordinatore li registra).
 */
export async function syncNotifications(d: NotificationDeps): Promise<SyncReport> {
  const permission = await d.scheduler.getPermission();
  const plan = await buildPlannedNotifications(d);
  if (permission !== 'granted') {
    return { permission, planned: plan.items.length, scheduled: 0, cancelled: 0, skippedUnchanged: false };
  }
  const existing = (await d.scheduler.listScheduled()).filter((e) => e.key !== TEST_KEY);
  const diff = diffScheduled(plan.items, existing);
  if (diff.cancel.length > 0) await d.scheduler.cancel(diff.cancel);
  if (diff.schedule.length > 0) await d.scheduler.schedule(diff.schedule, plan.timeZone);
  return {
    permission,
    planned: plan.items.length,
    scheduled: diff.schedule.length,
    cancelled: diff.cancel.length,
    skippedUnchanged: diff.cancel.length === 0 && diff.schedule.length === 0,
  };
}
