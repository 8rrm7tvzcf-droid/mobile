// Canali di notifica Android (SPEC 8.4): `deadlines` (alta), `maintenance` (default), `checks` (bassa), `system` (bassa).
import type { ReminderCategory } from '@/domain/reminders';

export type NotificationChannel = 'deadlines' | 'maintenance' | 'checks' | 'system';

/** Canale di una notifica di promemoria; la sentinella usa sempre `system`. */
export function channelForCategory(category: ReminderCategory): NotificationChannel {
  if (category === 'legal' || category === 'insurance') return 'deadlines';
  if (category === 'check') return 'checks';
  return 'maintenance';
}
